// party.js —— 派对/联机网络模块（Electron 主进程）
// 提供：局域网 UDP 发现、TCP 主机/客户端、互联网公网IP + UPnP 端口转发、消息帧
const dgram = require('dgram');
const net = require('net');
const https = require('https');
const http = require('http');
const os = require('os');
const { URL } = require('url');

const PARTY_UDP_PORT = 48765;
const PARTY_MAGIC = 'PIXELCITYPARTY/1';
const DISCOVERY_TTL_MS = 15000; // 15 秒内有广播才算"附近"

function nowMs() { return Date.now(); }

// 取本机局域网 IPv4（非回环、非虚拟）
function getLanIp() {
  const ifaces = os.networkInterfaces();
  let best = null;
  for (const name of Object.keys(ifaces)) {
    for (const f of ifaces[name] || []) {
      if (f.family !== 'IPv4' || f.internal) continue;
      // 跳过明显的虚拟网卡
      if (/vmware|virtualbox|vethernet|hyper-v|docker/i.test(name)) continue;
      if (!best) best = f.address;
      // 优先 192.168 / 10. / 172.
      if (/^192\.168\./.test(f.address) || /^10\./.test(f.address)) { best = f.address; break; }
    }
  }
  return best || '127.0.0.1';
}

// 取公网 IP（best effort，3s 超时）
function getPublicIp() {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    const req = https.get('https://api.ipify.org?format=json', (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { finish(JSON.parse(data).ip || null); } catch { finish(null); }
      });
    });
    req.on('error', () => finish(null));
    req.setTimeout(3000, () => { req.destroy(); finish(null); });
  });
}

// ---------- 最小 UPnP IGD 端口转发（best effort） ----------
function ssdpDiscoverIgd(timeoutMs = 3000) {
  return new Promise((resolve) => {
    const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    const msg = [
      'M-SEARCH * HTTP/1.1',
      'HOST: 239.255.255.250:1900',
      'MAN: "ssdp:discover"',
      'MX: 2',
      'ST: urn:schemas-upnp-org:device:InternetGatewayDevice:1',
      '', ''
    ].join('\r\n');
    let resolved = false;
    const finish = (loc) => { if (!resolved) { resolved = true; sock.close(); resolve(loc || null); } };
    sock.on('message', (buf) => {
      const text = buf.toString();
      const m = text.match(/LOCATION:\s*(\S+)/i);
      if (m) finish(m[1]);
    });
    sock.bind(() => {
      sock.setBroadcast(true);
      sock.send(msg, 0, msg.length, 1900, '239.255.255.250');
    });
    setTimeout(() => finish(null), timeoutMs);
  });
}

function httpGet(urlStr) {
  return new Promise((resolve) => {
    let done = false;
    const fin = (v) => { if (!done) { done = true; resolve(v); } };
    try {
      const u = new URL(urlStr);
      const lib = u.protocol === 'https:' ? https : http;
      const req = lib.get(urlStr, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => fin(data));
      });
      req.on('error', () => fin(null));
      req.setTimeout(4000, () => { req.destroy(); fin(null); });
    } catch { fin(null); }
  });
}

// 从 IGD 描述 XML 里找 WANIPConnection 的 controlURL
async function findWanControl(location) {
  const xml = await httpGet(location);
  if (!xml) return null;
  // 找 service 块
  const serviceRegex = /<service>[\s\S]*?<\/service>/g;
  let m;
  while ((m = serviceRegex.exec(xml)) !== null) {
    const block = m[0];
    if (/WANIPConnection|WANPPPConnection/i.test(block)) {
      const cu = block.match(/<controlURL>([^<]+)<\/controlURL>/i);
      const su = block.match(/<eventSubURL>([^<]+)<\/eventSubURL>/i) || block.match(/<SCPDURL>([^<]+)<\/SCPDURL>/i);
      if (cu) {
        const base = new URL(location);
        const ctrl = new URL(cu[1], base);
        return ctrl.href;
      }
    }
  }
  return null;
}

async function addPortMapping(ctrlUrl, extPort, intPort, intIp) {
  return new Promise((resolve) => {
    const soap = `<?xml version="1.0"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
<s:Body>
<u:AddPortMapping xmlns:u="urn:schemas-upnp-org:service:WANIPConnection:1">
<NewRemoteHost></NewRemoteHost>
<NewExternalPort>${extPort}</NewExternalPort>
<NewProtocol>TCP</NewProtocol>
<NewInternalPort>${intPort}</NewInternalPort>
<NewInternalClient>${intIp}</NewInternalClient>
<NewEnabled>1</NewEnabled>
<NewPortMappingDescription>PixelCityParty</NewPortMappingDescription>
<NewLeaseDuration>3600</NewLeaseDuration>
</u:AddPortMapping>
</s:Body>
</s:Envelope>`;
    const u = new URL(ctrlUrl);
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request({
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search,
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset="utf-8"',
        'SOAPAction': '"urn:schemas-upnp-org:service:WANIPConnection:1#AddPortMapping"',
        'Content-Length': Buffer.byteLength(soap),
        'Connection': 'close'
      }
    }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode === 200)); });
    req.on('error', () => resolve(false));
    req.setTimeout(4000, () => { req.destroy(); resolve(false); });
    req.write(soap);
    req.end();
  });
}

async function tryUpnp(port, lanIp) {
  try {
    const loc = await ssdpDiscoverIgd(3000);
    if (!loc) return false;
    const ctrl = await findWanControl(loc);
    if (!ctrl) return false;
    return await addPortMapping(ctrl, port, port, lanIp);
  } catch { return false; }
}

// ---------- 消息帧（4 字节大端长度 + JSON） ----------
function writeMsg(socket, obj) {
  if (socket.destroyed) return;
  const json = Buffer.from(JSON.stringify(obj), 'utf8');
  const hdr = Buffer.alloc(4);
  hdr.writeUInt32BE(json.length, 0);
  socket.write(Buffer.concat([hdr, json]));
}

// 给一个 socket 装上分帧读取器，按消息回调
function attachFramedReader(socket, onMsg) {
  let buf = Buffer.alloc(0);
  socket.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    while (buf.length >= 4) {
      const len = buf.readUInt32BE(0);
      if (buf.length < 4 + len) break;
      const json = buf.slice(4, 4 + len).toString('utf8');
      buf = buf.slice(4 + len);
      try { onMsg(JSON.parse(json)); } catch {}
    }
  });
}

function randCode(len = 6) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 去掉易混
  let s = '';
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

// ====================================================================
//  PartyManager
// ====================================================================
class PartyManager {
  constructor(getMainWindow) {
    this.getMainWindow = getMainWindow;
    this.reset();
  }

  reset() {
    this.role = null;            // 'host' | 'client' | null
    this.code = null;
    this.hostName = null;
    this.myName = null;
    this.lanIp = null;
    this.publicIp = null;
    this.port = null;
    this.upnpOk = false;
    // host
    this.tcpServer = null;
    this.peers = new Map();      // socket -> {id, name, addr}
    this.nextClientId = 1;
    // client
    this.hostSocket = null;
    this.myClientId = null;
    // discovery
    this.discSocket = null;
    this.discListening = false;
    this.discovered = new Map(); // key `${ip}:${port}` -> info
  }

  _emit(evt) {
    const w = this.getMainWindow && this.getMainWindow();
    if (w && !w.isDestroyed()) w.webContents.send('party:event', evt);
  }

  // ---------- 局域网发现 ----------
  startDiscovery() {
    if (this.discListening) return;
    const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    sock.on('message', (buf, rinfo) => {
      const text = buf.toString();
      if (!text.startsWith(PARTY_MAGIC)) return;
      try {
        const json = text.slice(PARTY_MAGIC.length).trim();
        const info = JSON.parse(json);
        info.ip = rinfo.address;
        info.port = info.port || rinfo.port;
        info.lastSeen = nowMs();
        this.discovered.set(`${info.ip}:${info.port}`, info);
      } catch {}
    });
    sock.on('error', () => {});
    sock.bind(PARTY_UDP_PORT, () => { this.discListening = true; });
    this.discSocket = sock;
  }

  stopDiscovery() {
    if (this.discSocket) { try { this.discSocket.close(); } catch {} this.discSocket = null; }
    this.discListening = false;
  }

  discoverList() {
    const cutoff = nowMs() - DISCOVERY_TTL_MS;
    const out = [];
    for (const [k, v] of this.discovered) {
      if (v.lastSeen < cutoff) continue;
      // 不显示自己
      if (this.role === 'host' && v.code === this.code) continue;
      out.push({ code: v.code, name: v.name, hostName: v.hostName, ip: v.ip, port: v.port, players: v.players, scene: v.scene });
    }
    return out;
  }

  // ---------- 主机 ----------
  async hostStart({ name }) {
    if (this.role) this.leave();
    this.role = 'host';
    this.hostName = name || '主机';
    this.myName = name || '主机';
    this.lanIp = getLanIp();

    // TCP 服务器
    const server = net.createServer((socket) => this._onClientConnect(socket));
    await new Promise((resolve) => server.listen(0, '0.0.0.0', resolve));
    this.port = server.address().port;
    this.tcpServer = server;
    this.code = randCode();

    // 启动发现（自己也监听，方便过滤自己；同时广播）
    this.startDiscovery();
    this._startBroadcast();

    // 公网 IP + UPnP（best effort，不阻塞）
    getPublicIp().then((ip) => { this.publicIp = ip; });
    tryUpnp(this.port, this.lanIp).then((ok) => { this.upnpOk = ok; });

    return {
      code: this.code,
      lanIp: this.lanIp,
      port: this.port,
      publicIp: null, // 异步获取，前端可稍后查询 state
      isHost: true
    };
  }

  _startBroadcast() {
    this._broadcastTimer = setInterval(() => {
      if (this.role !== 'host') return;
      const info = {
        code: this.code,
        name: this.hostName,
        hostName: this.hostName,
        port: this.port,
        players: 1 + this.peers.size,
        scene: this._sceneLabel || 'lobby'
      };
      const msg = PARTY_MAGIC + JSON.stringify(info);
      const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      sock.bind(() => {
        sock.setBroadcast(true);
        sock.send(msg, 0, msg.length, PARTY_UDP_PORT, '255.255.255.255');
        // 也发到子网定向
        const sub = this.lanIp.split('.').slice(0, 3).join('.') + '.255';
        sock.send(msg, 0, msg.length, PARTY_UDP_PORT, sub);
        sock.close();
      });
    }, 2000);
  }

  _onClientConnect(socket) {
    socket.setNoDelay(true);
    let peer = { id: this.nextClientId++, name: '?', addr: socket.remoteAddress, socket };
    this.peers.set(socket, peer);
    attachFramedReader(socket, (msg) => this._onClientMsg(socket, msg));
    socket.on('close', () => this._onClientDisconnect(socket));
    socket.on('error', () => this._onClientDisconnect(socket));
  }

  _onClientMsg(socket, msg) {
    const peer = this.peers.get(socket);
    if (!peer) return;
    if (msg.type === 'hello') {
      peer.name = (msg.name || '玩家').slice(0, 12);
      // 回 welcome
      writeMsg(socket, { type: 'welcome', clientId: peer.id, hostName: this.hostName });
      this._emit({ type: 'client-join', id: peer.id, name: peer.name });
      this._broadcastLobby();
    } else if (msg.type === 'input') {
      peer.lastInput = msg;
      this._emit({ type: 'client-input', id: peer.id, input: msg });
    } else if (msg.type === 'leave') {
      socket.end();
    }
  }

  _onClientDisconnect(socket) {
    const peer = this.peers.get(socket);
    if (!peer) return;
    this.peers.delete(socket);
    this._emit({ type: 'client-leave', id: peer.id, name: peer.name });
    this._broadcastLobby();
  }

  _broadcastLobby() {
    const players = [{ id: 0, name: this.hostName, isHost: true }];
    for (const [, p] of this.peers) players.push({ id: p.id, name: p.name, isHost: false });
    const payload = { type: 'lobby', players, hostName: this.hostName };
    for (const [, p] of this.peers) writeMsg(p.socket, payload);
    this._emit({ type: 'lobby', players });
  }

  hostBroadcast(obj) {
    if (this.role !== 'host') return;
    for (const [, p] of this.peers) writeMsg(p.socket, obj);
  }

  // 定向发送给某个客户端
  hostSendTo(clientId, obj) {
    if (this.role !== 'host') return;
    for (const [, p] of this.peers) {
      if (p.id === clientId) { writeMsg(p.socket, obj); return; }
    }
  }

  hostSetSceneLabel(label) { this._sceneLabel = label; }

  // ---------- 客户端 ----------
  async join({ code, addr, name }) {
    if (this.role) this.leave();
    this.myName = (name || '玩家').slice(0, 12);
    let ip, port;
    if (addr) {
      const [h, p] = addr.split(':');
      ip = h.trim(); port = parseInt(p, 10);
    } else if (code) {
      // 在已发现的附近派对里按 code 匹配
      const list = this.discoverList();
      const hit = list.find(p => p.code.toUpperCase() === code.toUpperCase());
      if (!hit) throw new Error('没找到这个派对码（请确认朋友在同一局域网，或让他用"联机地址"）');
      ip = hit.ip; port = hit.port;
    } else {
      throw new Error('需要派对码或地址');
    }
    if (!ip || !port) throw new Error('地址无效');

    // 连接
    const sock = new net.Socket();
    sock.setNoDelay(true);
    const ok = await new Promise((resolve) => {
      sock.setTimeout(5000, () => { sock.destroy(); resolve(false); });
      sock.connect(port, ip, () => { sock.setTimeout(0); resolve(true); });
      sock.on('error', () => resolve(false));
    });
    if (!ok) throw new Error('连接失败（对方可能不在线、或路由器没转发端口）');

    this.role = 'client';
    this.hostSocket = sock;
    this.myClientId = null;
    attachFramedReader(sock, (msg) => this._onHostMsg(msg));
    sock.on('close', () => this._emit({ type: 'disconnected', reason: '与主机的连接断开' }));
    sock.on('error', () => this._emit({ type: 'disconnected', reason: '连接出错' }));
    // 发 hello
    writeMsg(sock, { type: 'hello', name: this.myName });
    return { ok: true, ip, port };
  }

  _onHostMsg(msg) {
    if (msg.type === 'welcome') {
      this.myClientId = msg.clientId;
      this._emit({ type: 'welcome', clientId: msg.clientId, hostName: msg.hostName });
    } else {
      this._emit(msg);
    }
  }

  clientSend(obj) {
    if (this.hostSocket && !this.hostSocket.destroyed) writeMsg(this.hostSocket, obj);
  }

  // ---------- 通用 ----------
  getState() {
    return {
      role: this.role,
      code: this.code,
      hostName: this.hostName,
      lanIp: this.lanIp,
      publicIp: this.publicIp,
      port: this.port,
      upnpOk: this.upnpOk,
      myClientId: this.myClientId,
      isHost: this.role === 'host'
    };
  }

  leave() {
    if (this.role === 'host') {
      if (this._broadcastTimer) { clearInterval(this._broadcastTimer); this._broadcastTimer = null; }
      for (const [, p] of this.peers) { try { writeMsg(p.socket, { type: 'kick', reason: '主机已关闭派对' }); p.socket.end(); } catch {} }
      this.peers.clear();
      if (this.tcpServer) { try { this.tcpServer.close(); } catch {} this.tcpServer = null; }
    } else if (this.role === 'client') {
      if (this.hostSocket) { try { writeMsg(this.hostSocket, { type: 'leave' }); this.hostSocket.end(); } catch {} this.hostSocket = null; }
    }
    this.stopDiscovery();
    const hadRole = this.role;
    this.reset();
    if (hadRole) this._emit({ type: 'left' });
  }
}

module.exports = { PartyManager, getLanIp, getPublicIp, randCode };

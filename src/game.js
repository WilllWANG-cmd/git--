/* ========================================================================
   像素城市求生  Pixel City Survival
   一款 2D 像素末日生存游戏（Electron 桌面应用）
   ======================================================================== */

(() => {
  'use strict';

  // ---------- 基础常量 ----------
  const TILE = 16;            // 一个图块的内部分辨率
  const VIEW_W = 640;
  const VIEW_H = 480;
  const VIEW_TW = VIEW_W / TILE; // 40
  const VIEW_TH = VIEW_H / TILE; // 30

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  // ---------- 输入 ----------
  const keys = {};
  let keyPressed = {}; // 单次按下
  function anyDialogOpen() { return namingPending || joinPending || hostNamePending; }
  window.addEventListener('keydown', (e) => {
    // 任何对话框打开时，把按键完全交给输入框
    if (anyDialogOpen()) { return; }
    if (e.code === 'F3') { party.debugHud = !party.debugHud; e.preventDefault(); return; }
    // F12 由主进程拦截并通过 dev:toggle IPC 通知，这里不再处理
    if (!keys[e.code]) keyPressed[e.code] = true;
    keys[e.code] = true;
    if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(e.code)) e.preventDefault();
  });
  window.addEventListener('keyup', (e) => {
    if (anyDialogOpen()) return;
    keys[e.code] = false;
  });

  // ---------- 鼠标 ----------
  function canvasPoint(e) {
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (VIEW_W / rect.width);
    const y = (e.clientY - rect.top) * (VIEW_H / rect.height);
    return { x, y };
  }
  // 全局鼠标位置（画布内部坐标），用于瞄准
  let mousePos = { x: VIEW_W/2, y: VIEW_H/2 };
  canvas.addEventListener('mousemove', (e) => {
    const { x, y } = canvasPoint(e);
    mousePos = { x, y };
    if (state !== 'SAVES') { saveHover = -1; return; }
    saveHover = saveRowAt(x, y);
  });
  canvas.addEventListener('click', (e) => {
    if (namingPending) return; // 命名对话框打开时不响应画布点击
    const { x, y } = canvasPoint(e);
    handleClick(x, y);
  });

  // ---------- 工具 ----------
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rand = (a, b) => a + Math.random() * (b - a);
  const randi = (a, b) => Math.floor(rand(a, b));
  const choice = (arr) => arr[randi(0, arr.length)];
  const dist2 = (ax, ay, bx, by) => { const dx = ax - bx, dy = ay - by; return dx*dx + dy*dy; };

  // ---------- 颜色调板 ----------
  const PAL = {
    asphalt: '#2a2a33',
    asphalt2: '#222229',
    road: '#3a3a44',
    roadLine: '#8a8a3a',
    sidewalk: '#5a5a64',
    grass: '#2c4a2a',
    grassDark: '#1e3a1e',
    buildingWall: '#4a4a5a',
    buildingWall2: '#3e3e4e',
    buildingWin: '#1a2233',
    buildingWinLit: '#7a8a4a',
    door: '#6a3a1a',
    doorFrame: '#3a1a0a',
    interiorFloor: '#6a5a4a',
    interiorFloor2: '#5a4a3a',
    interiorWall: '#3a3a44',
    interiorWall2: '#2a2a34',
    stair: '#8a8a8a',
    stairDark: '#5a5a5a',
    blood: '#8a1a1a',
    ui: '#d0d0e0',
    uiDim: '#707080',
    uiBg: 'rgba(10,10,18,0.85)',
    danger: '#d04040',
    heal: '#40d070',
    fog: '#9aa0b0'
  };

  // ---------- 物品类型 ----------
  const ITEMS = {
    medkit:    { name: '医疗包', heal: 50, color: '#f0f0f0', sym: '✚', stack: 5 },
    canned:    { name: '罐头',   heal: 15, color: '#c08030', sym: '▤', stack: 10 },
    water:     { name: '矿泉水', heal: 10, color: '#4090d0', sym: '◉', stack: 10 },
    bandage:   { name: '绷带',   heal: 20, color: '#e0e0c0', sym: '◑', stack: 8 },
    ammo:      { name: '子弹',   heal: 0,  color: '#d0a030', sym: '⁝', stack: 99, kind: 'ammo' },
  };

  // ---------- 怪物类型 ----------
  const MON = {
    zombie: {
      name: '僵尸', hp: 30, speed: 0.45, dmg: 8, atkRange: 18, atkCd: 700,
      xp: 10, color: '#5a7a3a', color2: '#3a5a2a', eye: '#d04040'
    },
    fogman: {
      name: '雾中人', hp: 22, speed: 1.1, dmg: 14, atkRange: 22, atkCd: 500,
      xp: 20, color: '#9aa0b0', color2: '#6a7080', eye: '#e0e0f0', fog: true
    }
  };

  // ====================================================================
  //  世界生成
  // ====================================================================

  // 城市地图：tile 类型
  // 0 路面 / 1 人行道 / 2 草地 / 3 楼房外墙(不可进) / 4 楼房门(可进) / 5 玩家所在楼入口
  function generateCity(seed) {
    const W = 80, H = 60;
    const map = new Uint8Array(W * H);
    const buildings = [];

    // 用简单 seeded random —— 城市生成必须完全由 seed 决定，否则读档后地图变了会卡墙
    let s = (seed | 0) || 1;
    const rng = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
    const srandi = (a, b) => Math.floor(a + rng() * (b - a));
    const schoice = (arr) => arr[Math.floor(rng() * arr.length)];

    // 先全部填路面
    map.fill(0);

    // 横纵街道
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        // 街区划分：每 16 个 tile 一块，外圈是人行道
        const bx = x % 16, by = y % 12;
        if (bx === 0 || by === 0) {
          map[y*W+x] = 1; // 人行道
        }
      }
    }

    // 在每个街区里放置 1-2 个建筑
    const blockCols = Math.floor(W / 16);
    const blockRows = Math.floor(H / 12);
    let homePlaced = false;
    let bidx = 0;
    for (let byi = 0; byi < blockRows; byi++) {
      for (let bxi = 0; bxi < blockCols; bxi++) {
        const ox = bxi * 16 + 1;
        const oy = byi * 12 + 1;
        const bw = srandi(7, 14);
        const bh = srandi(6, 10);
        if (ox + bw > bxi*16 + 15 || oy + bh > byi*12 + 11) continue;

        const id = 'b' + (bidx++);
        const isHome = !homePlaced && (bxi === Math.floor(blockCols/2)) && (byi === Math.floor(blockRows/2));
        if (isHome) homePlaced = true;

        const building = {
          id, x: ox, y: oy, w: bw, h: bh,
          kind: isHome ? 'home' : schoice(['zombie','fog','zombie','fog','mixed']),
          floors: isHome ? 3 : srandi(2, 5),
          looted: {},     // floorIdx -> bool
          cleared: {},    // floorIdx -> bool
          isHome
        };
        buildings.push(building);

        // 画墙
        for (let yy = 0; yy < bh; yy++) {
          for (let xx = 0; xx < bw; xx++) {
            map[(oy+yy)*W + (ox+xx)] = 3;
          }
        }
        // 门：底边中间
        const dx = ox + Math.floor(bw/2);
        const dy = oy + bh - 1;
        map[dy*W + dx] = isHome ? 5 : 4;
        building.door = { x: dx, y: dy };
      }
    }

    // 兜底：若 home 没被放置（极少），把第一个楼设为 home
    if (!homePlaced && buildings.length > 0) {
      const b = buildings[0];
      b.kind = 'home'; b.isHome = true; b.floors = 3;
      map[b.door.y * W + b.door.x] = 5;
    }

    return { W, H, map, buildings, seed };
  }

  // 建筑内部：一层楼。返回 tile 网格与实体列表
  // tile: 0 地板 / 1 墙 / 2 楼梯上 / 3 楼梯下 / 4 出口门(到城市)
  function generateFloor(building, floorIdx, isHome, cleared) {
    const W = 24, H = 18;
    const map = new Uint8Array(W * H);
    // 外圈墙
    for (let x = 0; x < W; x++) { map[x] = 1; map[(H-1)*W+x] = 1; }
    for (let y = 0; y < H; y++) { map[y*W] = 1; map[y*W+(W-1)] = 1; }
    // 内部地板
    for (let y = 1; y < H-1; y++)
      for (let x = 1; x < W-1; x++)
        map[y*W+x] = 0;

    // 随机房间隔断
    const rng = Math.random;
    const walls = [];
    // 几道竖墙
    const vCount = randi(1, 3);
    for (let i = 0; i < vCount; i++) {
      const wx = randi(6, W-6);
      const wy0 = 1;
      const wy1 = randi(Math.floor(H/2), H-2);
      for (let y = wy0; y <= wy1; y++) {
        if (rng() > 0.2) map[y*W+wx] = 1;
      }
      // 留一个开口
      const gap = randi(wy0+1, wy1-1);
      map[gap*W+wx] = 0;
    }
    const hCount = randi(1, 3);
    for (let i = 0; i < hCount; i++) {
      const wy = randi(5, H-5);
      const wx0 = 1;
      const wx1 = randi(Math.floor(W/2), W-2);
      for (let x = wx0; x <= wx1; x++) {
        if (rng() > 0.2) map[wy*W+x] = 1;
      }
      const gap = randi(wx0+1, wx1-1);
      map[wy*W+gap] = 0;
    }

    // 出口门：底边中间 -> 回到城市
    const ex = Math.floor(W/2);
    map[(H-1)*W + ex] = 4;

    // 楼梯
    if (floorIdx < building.floors - 1) {
      // 楼梯上：放在右上角附近
      let sx = W - 3, sy = 2;
      map[sy*W+sx] = 2;
    }
    if (floorIdx > 0) {
      // 楼梯下：放在左上角附近
      let sx = 2, sy = 2;
      map[sy*W+sx] = 3;
    }

    // 物品点 —— 保证每层都有物资
    const items = [];
    if (!cleared) {
      // 先收集所有可行走的地板格，确保一定能放下物资
      const floorTiles = [];
      for (let y = 2; y < H-2; y++) {
        for (let x = 2; x < W-2; x++) {
          if (map[y*W+x] === 0) floorTiles.push([x, y]);
        }
      }
      // 打乱
      for (let i = floorTiles.length - 1; i > 0; i--) {
        const j = randi(0, i + 1);
        [floorTiles[i], floorTiles[j]] = [floorTiles[j], floorTiles[i]];
      }
      const itemCount = Math.min(
        floorTiles.length,
        isHome ? randi(3, 5) : randi(3, 6)
      );
      const kinds = isHome
        ? ['medkit','canned','water','bandage','medkit']
        : ['canned','water','bandage','medkit','ammo','ammo','canned'];
      for (let i = 0; i < itemCount; i++) {
        const [tx, ty] = floorTiles[i];
        const k = choice(kinds);
        items.push({ x: tx*TILE + TILE/2, y: ty*TILE + TILE/2, type: k, taken: false });
      }
    }

    // 怪物（非 home 楼）
    const monsters = [];
    if (!isHome && !cleared) {
      const mCount = (building.kind === 'fog') ? randi(2, 4)
                   : (building.kind === 'zombie') ? randi(3, 6)
                   : randi(2, 5);
      for (let i = 0; i < mCount; i++) {
        let tx, ty, tries = 0;
        do {
          tx = randi(3, W-3); ty = randi(3, H-3); tries++;
        } while (map[ty*W+tx] !== 0 && tries < 40);
        if (map[ty*W+tx] !== 0) continue;
        const kind = (building.kind === 'fog') ? 'fogman'
                   : (building.kind === 'zombie') ? 'zombie'
                   : choice(['zombie','fogman']);
        monsters.push(makeMonster(kind, tx*TILE + TILE/2, ty*TILE + TILE/2));
      }
    }

    return { W, H, map, items, monsters, floorIdx };
  }

  function makeMonster(kind, x, y) {
    const m = MON[kind];
    return {
      kind, x, y, hp: m.hp, maxHp: m.hp,
      vx: 0, vy: 0,
      lastAtk: 0, hurtFlash: 0,
      wanderTx: x, wanderTy: y, nextWander: 0,
      alive: true
    };
  }

  // ====================================================================
  //  游戏状态
  // ====================================================================

  let state = 'MENU';   // MENU / SAVES / NAMING / PLAYING / PAUSED / DEAD
  let game = null;      // 当前对局
  let menuSel = 0;
  let savesList = [];
  let saveCursor = 0;
  let saveHover = -1;
  let toast = null;     // {text, until}
  let lastTime = 0;
  let playtimeAcc = 0;
  let devMode = false;  // 开发者模式：仅存档内（single 模式 PLAYING 中）按 F12 切换

  // ---------- 命名对话框 ----------
  const nameDialog = document.getElementById('nameDialog');
  const nameInput = document.getElementById('nameInput');
  const nameOk = document.getElementById('nameOk');
  const nameCancel = document.getElementById('nameCancel');
  let namingPending = false; // 是否正在等待命名
  let namingReturnState = 'MENU';

  function openNameDialog() {
    namingPending = true;
    namingReturnState = state;
    state = 'NAMING';
    nameInput.value = '';
    nameDialog.classList.remove('hidden');
    // 默认填充一个建议名
    nameInput.placeholder = '输入存档名（可中文），默认：幸存者' + randi(100, 999);
    setTimeout(() => nameInput.focus(), 0);
  }
  function closeNameDialog() {
    namingPending = false;
    nameDialog.classList.add('hidden');
    nameInput.blur();
  }
  function confirmName() {
    if (!namingPending) return;
    let name = (nameInput.value || '').trim();
    if (!name) name = '幸存者' + randi(100, 999);
    name = name.slice(0, 16);
    closeNameDialog();
    newGame(name);
    game.createdAt = Date.now();
    saveGame();
  }
  function cancelName() {
    if (!namingPending) return;
    closeNameDialog();
    state = namingReturnState;
  }
  nameOk.addEventListener('click', confirmName);
  nameCancel.addEventListener('click', cancelName);
  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); confirmName(); }
    else if (e.key === 'Escape') { e.preventDefault(); cancelName(); }
  });
  // 点击对话框背景不触发画布点击：阻止冒泡
  nameDialog.addEventListener('click', (e) => e.stopPropagation());

  // ====================================================================
  //  派对 / 联机
  // ====================================================================
  const joinDialog = document.getElementById('joinDialog');
  const joinInput = document.getElementById('joinInput');
  const joinOk = document.getElementById('joinOk');
  const joinCancel = document.getElementById('joinCancel');
  const hostNameDialog = document.getElementById('hostNameDialog');
  const hostNameInput = document.getElementById('hostNameInput');
  const hostNameOk = document.getElementById('hostNameOk');
  const hostNameCancel = document.getElementById('hostNameCancel');

  // 派对运行时状态（渲染端）
  const party = {
    role: null,            // 'host' | 'client'
    code: null, addr: null,
    hostName: null, myName: null,
    myClientId: null,
    stateInfo: null,       // 来自 party:state 的信息（公网IP等）
    lobbyPlayers: [],      // [{id, name, isHost}]
    clientInputs: {},      // 主机端：clientId -> 最新输入
    discoverList: [],
    discoverTimer: 0,
    broadcastAcc: 0,       // 主机广播累计
    inputSendAcc: 0,       // 客户端发送输入累计
    lastSentSceneKey: null // 用于只在场景变化时发送地图
  };
  let joinPending = false;
  let hostNamePending = false;

  function openJoinDialog() {
    joinPending = true;
    state = 'JOINING';
    joinInput.value = '';
    joinDialog.classList.remove('hidden');
    setTimeout(() => joinInput.focus(), 0);
  }
  function closeJoinDialog() {
    joinPending = false;
    joinDialog.classList.add('hidden');
    joinInput.blur();
  }
  async function confirmJoin() {
    if (!joinPending) return;
    const v = (joinInput.value || '').trim();
    if (!v) return;
    closeJoinDialog();
    // 判断是地址（含冒号）还是派对码
    let args;
    if (v.includes(':')) args = { addr: v };
    else args = { code: v.toUpperCase() };
    args.name = party.myName || ('玩家' + randi(100,999));
    toastMsg('正在连接...', 1500);
    const r = await window.api.partyJoin(args);
    if (!r.ok) { toastMsg('加入失败：' + (r.error || ''), 3500); state = 'PARTY'; return; }
    party.role = 'client';
    state = 'CLIENT_LOBBY';
    toastMsg('已连接，等待主机开始游戏', 2000);
  }
  joinOk.addEventListener('click', confirmJoin);
  joinCancel.addEventListener('click', () => { closeJoinDialog(); state = 'PARTY'; });
  joinInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); confirmJoin(); }
    else if (e.key === 'Escape') { e.preventDefault(); closeJoinDialog(); state = 'PARTY'; }
  });
  joinDialog.addEventListener('click', (e) => e.stopPropagation());

  function openHostNameDialog() {
    hostNamePending = true;
    state = 'HOST_NAMING';
    hostNameInput.value = '';
    hostNameDialog.classList.remove('hidden');
    setTimeout(() => hostNameInput.focus(), 0);
  }
  function closeHostNameDialog() {
    hostNamePending = false;
    hostNameDialog.classList.add('hidden');
    hostNameInput.blur();
  }
  async function confirmHostName() {
    if (!hostNamePending) return;
    let name = (hostNameInput.value || '').trim() || ('玩家' + randi(100,999));
    name = name.slice(0, 12);
    closeHostNameDialog();
    party.myName = name;
    toastMsg('正在创建派对...', 1500);
    const r = await window.api.partyHostStart({ name });
    if (!r.ok) { toastMsg('创建失败：' + (r.error || ''), 3000); state = 'PARTY'; return; }
    party.role = 'host';
    party.code = r.data.code;
    party.addr = r.data.lanIp + ':' + r.data.port;
    party.lobbyPlayers = [{ id: 0, name: name, isHost: true }];
    state = 'HOST_LOBBY';
    toastMsg('派对已创建！把派对码或地址发给朋友', 3000);
    // 拉取一次状态（公网IP可能还在获取）
    refreshPartyState();
  }
  hostNameOk.addEventListener('click', confirmHostName);
  hostNameCancel.addEventListener('click', () => { closeHostNameDialog(); state = 'PARTY'; });
  hostNameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); confirmHostName(); }
    else if (e.key === 'Escape') { e.preventDefault(); closeHostNameDialog(); state = 'PARTY'; }
  });
  hostNameDialog.addEventListener('click', (e) => e.stopPropagation());

  async function refreshPartyState() {
    if (!window.api || !window.api.partyState) return;
    try { party.stateInfo = await window.api.partyState(); } catch {}
  }

  async function refreshDiscover() {
    if (!window.api || !window.api.partyDiscover) return;
    try { party.discoverList = await window.api.partyDiscover(); } catch {}
  }

  async function leaveParty() {
    if (window.api && window.api.partyLeave) {
      try { await window.api.partyLeave(); } catch {}
    }
    party.role = null;
    party.code = null; party.addr = null;
    party.lobbyPlayers = [];
    party.clientInputs = {};
    party.myClientId = null;
  }

  // 派对事件订阅
  let _partyUnsub = null;
  function attachPartyEvents() {
    if (_partyUnsub || !window.api || !window.api.onPartyEvent) return;
    _partyUnsub = window.api.onPartyEvent((evt) => onPartyEvent(evt));
  }

  function onPartyEvent(evt) {
    if (!evt) return;
    switch (evt.type) {
      case 'welcome':
        party.myClientId = evt.clientId;
        party.hostName = evt.hostName;
        break;
      case 'lobby':
        party.lobbyPlayers = evt.players || [];
        break;
      case 'client-join':
        if (party.role === 'host') {
          // 游戏进行中：为新加入的客户端建立 avatar，放到城市出生点
          if (game && game.netMode === 'host') {
            const lp = (party.lobbyPlayers || []).find(x => x.id === evt.id);
            if (lp && !game.remotePlayers.some(r => r.id === lp.id)) {
              const rp = makePlayerEntity(lp.name, lp.id, false);
              rp.scene = 'city'; rp.curBuilding = null; rp.curFloor = 0;
              const home = game.city.buildings.find(b => b.isHome) || game.city.buildings[0];
              const cityBundle = ensureCityScene();
              activateScene(cityBundle);
              placePlayerNear(rp, home.door.x * TILE + TILE/2, (home.door.y + 2) * TILE + TILE/2);
              game.remotePlayers.push(rp);
              syncBundle(cityBundle);
              activateScene(sceneOf(game.player));
            }
          }
        }
        break;
      case 'client-leave':
        if (party.role === 'host' && game && game.netMode === 'host') {
          game.remotePlayers = (game.remotePlayers || []).filter(rp => rp.id !== evt.id);
          if (party.clientInputs) delete party.clientInputs[evt.id];
        }
        break;
      case 'client-input':
        party._inputEvents = (party._inputEvents || 0) + 1;
        party.clientInputs[evt.id] = evt.input;
        break;
      case 'start':
        // 客户端：进入游戏
        clientStartGame(evt);
        break;
      case 'snapshot':
        if (party.role === 'client') clientApplySnapshot(evt);
        break;
      case 'toast':
        if (evt.text) toastMsg(evt.text, evt.ms || 2000);
        break;
      case 'kick':
        toastMsg('被请出派对：' + (evt.reason || ''), 3500);
        leaveParty();
        if (state === 'PLAYING') { state = 'MENU'; game = null; }
        else { state = 'MENU'; }
        break;
      case 'disconnected':
        toastMsg('连接断开：' + (evt.reason || '与主机失去连接'), 3500);
        leaveParty();
        if (state === 'PLAYING') { state = 'MENU'; game = null; }
        else if (state === 'CLIENT_LOBBY') { state = 'PARTY'; }
        break;
      case 'left':
        break;
    }
  }

  // ---------- 主机：开始游戏 ----------
  async function hostStartGame() {
    if (party.role !== 'host') return;
    // 用主机名作为存档名
    const seed = (Math.random() * 0x7fffffff) | 0;
    const city = generateCity(seed);
    const home = city.buildings.find(b => b.isHome) || city.buildings[0];
    const hostName = party.myName || '主机';
    const player = makePlayerEntity(hostName, 0, true);
    const stats = { kills: 0, looted: 0, deaths: 0, dmgDealt: 0, dmgTaken: 0 };
    game = {
      id: 'party_' + Date.now().toString(36),
      name: hostName + ' 的派对',
      createdAt: 0, updatedAt: 0, playtime: 0,
      seed, city, player, stats,
      scene: 'city', curBuilding: null, curFloor: 0, floor: null,
      cam: { x: 0, y: 0 },
      cityMonsters: [], nextCitySpawn: 0, fogIntensity: 0,
      bullets: [], cityItems: [],
      netMode: 'host', remotePlayers: [],
      scenes: new Map(),
      needSave: false
    };
    player.scene = 'city'; player.curBuilding = null; player.curFloor = 0;
    // 玩家放在 home 门口
    const d = home.door;
    player.x = d.x * TILE + TILE/2;
    player.y = (d.y + 2) * TILE + TILE/2;
    // 为每个已连接客户端建立 avatar
    // 从 lobbyPlayers 取（isHost=false 的）
    for (const lp of party.lobbyPlayers) {
      if (lp.isHost) continue;
      const rp = makePlayerEntity(lp.name, lp.id, false);
      rp.scene = 'city'; rp.curBuilding = null; rp.curFloor = 0;
      rp.x = player.x; rp.y = player.y;
      game.remotePlayers.push(rp);
    }
    enterCity();
    // 重新把每个玩家放在 home 门口附近可走格（独立位置，避免重叠/卡墙）
    {
      const cityBundle = ensureCityScene();
      activateScene(cityBundle);
      const ex = d.x * TILE + TILE/2, ey = (d.y + 2) * TILE + TILE/2;
      placePlayerNear(game.player, ex, ey);
      for (const rp of game.remotePlayers) placePlayerNear(rp, ex, ey);
      syncBundle(cityBundle);
    }
    state = 'PLAYING';
    // 通知所有客户端开始
    partyHostBroadcastMsg({
      type: 'start',
      seed, yourId: 0,
      hostName,
      players: party.lobbyPlayers
    });
    toastMsg('游戏开始！', 1500);
    refreshPartyState();
  }

  function makePlayerEntity(name, id, isHost) {
    return {
      id, name, isHost,
      hp: 100, maxHp: 100,
      x: 0, y: 0, facing: 0, walkPhase: 0,
      inv: {}, weapon: 'fists', ammo: 0,
      lastAtk: 0, lastShoot: 0, hurtFlash: 0,
      baseAtk: 12, atkRange: 22, atkCd: 380,
      isLocal: isHost, // 主机端只有 host 是 local
      scene: 'city', curBuilding: null, curFloor: 0
    };
  }

  function partyHostBroadcastMsg(obj) {
    if (window.api && window.api.partyHostBroadcast) {
      window.api.partyHostBroadcast(obj);
    }
  }

  // ---------- 主机：广播快照（按客户端所在场景定向发送） ----------
  function overviewOf(p, isHost) {
    return {
      id: p.id || 0, name: p.name, isHost,
      x: Math.round(p.x), y: Math.round(p.y),
      hp: p.hp, maxHp: p.maxHp,
      facing: p.facing, aimDx: (p.lastAim||{}).dx || 0, aimDy: (p.lastAim||{}).dy || 0,
      hurtFlash: p.hurtFlash || 0, walkPhase: p.walkPhase || 0,
      ammo: p.ammo || 0, inv: p.inv || {},
      scene: p.scene || 'city',
      curBuildingId: p.curBuilding ? p.curBuilding.id : null,
      curFloor: p.curFloor || 0
    };
  }
  function maybeBroadcastSnapshot() {
    party.broadcastAcc += 16; // 近似帧时间
    if (party.broadcastAcc < 60) return; // ~16 次/秒
    party.broadcastAcc = 0;
    if (!game || game.netMode !== 'host') return;

    // 全玩家概览（每个客户端都拿得到所有队友的状态，用于 HUD）
    const allOverview = [overviewOf(game.player, true)];
    for (const rp of game.remotePlayers) allOverview.push(overviewOf(rp, false));

    for (const cp of game.remotePlayers) {
      const bundle = sceneOf(cp);
      if (!bundle) continue;
      const key = sceneKeyOf(cp);
      const sceneChanged = (cp._lastSceneKey !== key);
      cp._lastSceneKey = key;
      activateScene(bundle);
      const monsters = currentMonsters().map(m => ({
        kind: m.kind, x: Math.round(m.x), y: Math.round(m.y),
        hp: m.hp, maxHp: m.maxHp, hurtFlash: m.hurtFlash || 0, alive: m.alive
      }));
      let items = [];
      if (game.scene === 'interior') items = game.floor.items.filter(i=>!i.taken).map(i=>({x:i.x,y:i.y,type:i.type}));
      else items = (game.cityItems||[]).filter(i=>!i.taken).map(i=>({x:i.x,y:i.y,type:i.type}));
      const bullets = (game.bullets||[]).map(b => ({x:Math.round(b.x),y:Math.round(b.y),dx:b.dx,dy:b.dy}));
      const snap = {
        type: 'snapshot',
        mySceneKey: key,
        scene: game.scene,
        curBuildingId: game.curBuilding ? game.curBuilding.id : null,
        curFloor: game.curFloor,
        seed: game.seed,
        sceneChanged,
        cityMap: (game.scene === 'city' && sceneChanged) ? Array.from(game.city.map) : null,
        floorMap: (game.scene === 'interior' && sceneChanged) ? Array.from(game.floor.map) : null,
        floorW: game.scene === 'interior' ? game.floor.W : null,
        floorH: game.scene === 'interior' ? game.floor.H : null,
        curBuildingKind: game.curBuilding ? game.curBuilding.kind : null,
        curBuildingIsHome: game.curBuilding ? game.curBuilding.isHome : false,
        curBuildingFloors: game.curBuilding ? game.curBuilding.floors : 0,
        players: allOverview, monsters, items, bullets,
        cityItems: game.scene === 'city' ? items : [],
        fogIntensity: game.fogIntensity || 0,
        stats: { kills: game.stats.kills || 0 }
      };
      if (window.api.partyHostSendTo) window.api.partyHostSendTo(cp.id, snap);
    }
    // 恢复主机场景
    activateScene(sceneOf(game.player));
    // 同步场景标签给发现者
    if (window.api.partyHostSetSceneLabel) {
      window.api.partyHostSetSceneLabel(game.scene === 'city' ? '城市' : '楼内F' + (game.curFloor+1));
    }
  }

  // ---------- 客户端：开始游戏 ----------
  function clientStartGame(evt) {
    const seed = evt.seed;
    const city = generateCity(seed);
    const home = city.buildings.find(b => b.isHome) || city.buildings[0];
    // 找到自己
    const me = (evt.players || []).find(p => p.id === party.myClientId) || { id: party.myClientId, name: party.myName || '玩家' };
    const player = makePlayerEntity(me.name || party.myName || '玩家', me.id, false);
    player.isLocal = true; // 客户端：自己就是本地
    const stats = { kills: 0, looted: 0, deaths: 0, dmgDealt: 0, dmgTaken: 0 };
    game = {
      id: 'party_client_' + Date.now().toString(36),
      name: party.hostName + ' 的派对',
      createdAt: 0, updatedAt: 0, playtime: 0,
      seed, city, player, stats,
      scene: 'city', curBuilding: null, curFloor: 0, floor: null,
      cam: { x: 0, y: 0 },
      cityMonsters: [], nextCitySpawn: 0, fogIntensity: 0,
      bullets: [], cityItems: [],
      netMode: 'client', remotePlayers: [],
      scenes: null, // 客户端不维护 scenes Map，靠快照里的 game.scene/floor
      needSave: false
    };
    player.scene = 'city'; player.curBuilding = null; player.curFloor = 0;
    const d = home.door;
    player.x = d.x * TILE + TILE/2;
    player.y = (d.y + 2) * TILE + TILE/2;
    game.cityItems = [];
    updateCamera();
    state = 'PLAYING';
    toastMsg('加入派对成功！等待主机带领', 2000);
  }

  // ---------- 客户端：应用快照 ----------
  function clientApplySnapshot(s) {
    if (!game || game.netMode !== 'client') return;
    party._snapCount = (party._snapCount || 0) + 1;
    // 场景/地图
    if (s.scene !== game.scene || (s.sceneChanged && s.cityMap) || (s.sceneChanged && s.floorMap)) {
      if (s.scene === 'city') {
        if (s.cityMap) {
          // 用主机的地图覆盖（与种子重建一致，覆盖以防差异）
          game.city.map = Uint8Array.from(s.cityMap);
        }
        game.scene = 'city';
        game.curBuilding = null; game.floor = null;
      } else {
        // interior
        if (s.floorMap) {
          const fW = s.floorW, fH = s.floorH;
          game.floor = { W: fW, H: fH, map: Uint8Array.from(s.floorMap), items: [], monsters: [] };
        }
        game.scene = 'interior';
        game.curFloor = s.curFloor;
        // 重建 curBuilding 占位（供 HUD 显示）
        if (!game.curBuilding || game.curBuilding.id !== s.curBuildingId) {
          game.curBuilding = game.city.buildings.find(b => b.id === s.curBuildingId) || {
            id: s.curBuildingId, kind: s.curBuildingKind, isHome: s.curBuildingIsHome, floors: s.curBuildingFloors, cleared: {}
          };
        }
      }
    }
    // 怪物
    if (s.scene === 'city') {
      game.cityMonsters = (s.monsters||[]).map(m => ({
        kind: m.kind, x: m.x, y: m.y, hp: m.hp, maxHp: m.maxHp,
        hurtFlash: m.hurtFlash, alive: m.alive !== false,
        lastAtk: 0, nextWander: 0, wanderTx: m.x, wanderTy: m.y
      }));
    } else if (game.floor) {
      game.floor.monsters = (s.monsters||[]).map(m => ({
        kind: m.kind, x: m.x, y: m.y, hp: m.hp, maxHp: m.maxHp,
        hurtFlash: m.hurtFlash, alive: m.alive !== false,
        lastAtk: 0, nextWander: 0, wanderTx: m.x, wanderTy: m.y
      }));
    }
    // 物品
    const items = (s.items||[]).map(i => ({x:i.x, y:i.y, type:i.type, taken:false}));
    if (s.scene === 'interior' && game.floor) game.floor.items = items;
    else game.cityItems = items;
    // 子弹
    const now = performance.now();
    game.bullets = (s.bullets||[]).map(b => ({x:b.x, y:b.y, dx:b.dx, dy:b.dy, born: now, dmg: 25}));
    // 玩家
    const meId = party.myClientId;
    const players = s.players || [];
    const me = players.find(p => p.id === meId);
    if (me) {
      game.player.x = me.x; game.player.y = me.y;
      game.player.hp = me.hp; game.player.maxHp = me.maxHp;
      game.player.facing = me.facing;
      game.player.walkPhase = me.walkPhase;
      game.player.hurtFlash = me.hurtFlash;
      game.player.ammo = me.ammo;
      game.player.inv = me.inv || {};
      game.player.lastAim = { dx: me.aimDx, dy: me.aimDy };
      game.player.name = me.name;
      // 场景归属（用于 HUD/同场景渲染判断）
      game.player.scene = me.scene || 'city';
      game.player.curFloor = me.curFloor || 0;
      game.player.curBuilding = me.curBuildingId != null
        ? (game.city.buildings.find(b => b.id === me.curBuildingId) || { id: me.curBuildingId, kind: s.curBuildingKind, isHome: s.curBuildingIsHome, floors: s.curBuildingFloors, cleared: {} })
        : null;
    }
    game.remotePlayers = players.filter(p => p.id !== meId).map(p => {
      const cb = p.curBuildingId != null
        ? (game.city.buildings.find(b => b.id === p.curBuildingId) || { id: p.curBuildingId, kind: null, isHome: false, floors: 0, cleared: {} })
        : null;
      return {
        id: p.id, name: p.name, isHost: p.isHost,
        x: p.x, y: p.y, hp: p.hp, maxHp: p.maxHp,
        facing: p.facing, walkPhase: p.walkPhase, hurtFlash: p.hurtFlash,
        ammo: p.ammo, inv: p.inv || {}, lastAim: { dx: p.aimDx, dy: p.aimDy },
        scene: p.scene || 'city', curBuilding: cb, curFloor: p.curFloor || 0
      };
    });
    game.fogIntensity = s.fogIntensity || 0;
    if (s.stats) game.stats.kills = s.stats.kills || 0;
    updateCamera();
  }

  // ---------- 客户端：发送输入 ----------
  function clientTick(dt) {
    if (!game || game.netMode !== 'client') return;
    party.inputSendAcc += dt;
    // 发送输入 ~30Hz
    if (party.inputSendAcc < 33) { keyPressed = {}; return; }
    party.inputSendAcc = 0;
    const inp = readLocalInput();
    inp.name = party.myName;
    party._lastSentMv = { mx: inp.mx, my: inp.my };
    party._sentInputs = (party._sentInputs || 0) + 1;
    window.api.partySend({ type: 'input', mx: inp.mx, my: inp.my, aimDx: inp.aimDx, aimDy: inp.aimDy, attack: inp.attack, shoot: inp.shoot, interact: inp.interact, useItem: inp.useItem });
    keyPressed = {};
  }

  // 新建对局
  function newGame(name) {
    devMode = false;
    const seed = (Math.random() * 0x7fffffff) | 0;
    const city = generateCity(seed);
    const home = city.buildings.find(b => b.isHome) || city.buildings[0];
    const player = {
      name: name || '幸存者',
      hp: 100, maxHp: 100,
      x: 0, y: 0,            // 在场景中的像素坐标
      facing: 0,             // 0 下 1 左 2 右 3 上
      walkPhase: 0,
      inv: {},               // type -> count
      weapon: 'fists',
      ammo: 0,
      lastAtk: 0,
      hurtFlash: 0,
      baseAtk: 12,           // 拳头伤害
      atkRange: 22,
      atkCd: 380,
      // 场景归属（独立场景用）
      scene: 'city', curBuilding: null, curFloor: 0
    };
    const stats = { kills: 0, looted: 0, deaths: 0, dmgDealt: 0, dmgTaken: 0 };

    const g = {
      id: 'save_' + Date.now().toString(36) + '_' + Math.floor(Math.random()*1e6).toString(36),
      name: name || '幸存者',
      createdAt: 0, updatedAt: 0, playtime: 0,
      seed, city, player, stats,
      scene: 'city',         // 当前激活场景（用于渲染/单玩家）
      curBuilding: null, curFloor: 0, floor: null,
      cam: { x: 0, y: 0 },
      cityMonsters: [],
      nextCitySpawn: 0,
      fogIntensity: 0,
      bullets: [],
      // 联机 / 多场景
      netMode: 'single',
      remotePlayers: [],
      scenes: new Map(),
      needSave: false
    };

    // 玩家放在 home 楼门口外的路上
    const d = home.door;
    player.x = d.x * TILE + TILE/2;
    player.y = (d.y + 2) * TILE + TILE/2;

    game = g;
    enterCity();
    state = 'PLAYING';
    toastMsg('找到你的高楼 (绿色门) 以进入安全区', 4000);
  }

  // 进入城市场景
  function enterCity() {
    const bundle = ensureCityScene();
    activateScene(bundle);
    // 在城市里生成少量僵尸/雾中人
    game.cityMonsters = [];
    const n = randi(3, 7);
    for (let i = 0; i < n; i++) {
      const kind = Math.random() < 0.6 ? 'zombie' : 'fogman';
      let tx, ty, tries = 0;
      do {
        tx = randi(2, game.city.W-2); ty = randi(2, game.city.H-2); tries++;
      } while ((game.city.map[ty*game.city.W+tx] !== 0 && game.city.map[ty*game.city.W+tx] !== 1) && tries < 30);
      if (game.city.map[ty*game.city.W+tx] > 1) continue;
      const mx = tx*TILE + TILE/2, my = ty*TILE + TILE/2;
      if (dist2(mx, my, game.player.x, game.player.y) < 200*200) continue;
      game.cityMonsters.push(makeMonster(kind, mx, my));
    }
    game.nextCitySpawn = performance.now() + 20000;
    syncBundle(bundle);
  }

  // 进入建筑（针对单个玩家 p，独立场景）
  function enterBuildingAs(p, building, floorIdx = 0) {
    const bundle = ensureInteriorScene(building, floorIdx);
    p.scene = 'interior'; p.curBuilding = building; p.curFloor = floorIdx;
    activateScene(bundle);
    const { ex, ey } = floorEntryPoint();
    placePlayerNear(p, ex, ey);
    if (p === game.player) {
      if (building.isHome) toastMsg('安全屋 · 第 ' + (floorIdx+1) + ' 层', 2200);
      else toastMsg(building.kind === 'zombie' ? '僵尸楼 · 第 ' + (floorIdx+1) + ' 层'
                  : building.kind === 'fog' ? '雾中人巢穴 · 第 ' + (floorIdx+1) + ' 层'
                  : '未知建筑 · 第 ' + (floorIdx+1) + ' 层', 2200);
    }
  }
  // 兼容旧调用（单玩家）
  function enterBuilding(building, floorIdx = 0) { enterBuildingAs(game.player, building, floorIdx); }
  function enterBuildingShared(building, floorIdx = 0) { enterBuildingAs(game.player, building, floorIdx); }

  // 出口门 -> 回到城市（针对单个玩家）
  function exitToCityAs(p) {
    const b = p.curBuilding;
    const cityBundle = ensureCityScene();
    p.scene = 'city'; p.curBuilding = null; p.curFloor = 0;
    activateScene(cityBundle);
    if (b) placePlayerNear(p, b.door.x * TILE + TILE/2, (b.door.y + 1) * TILE + TILE/2);
  }


  // ====================================================================
  //  存档
  // ====================================================================

  async function refreshSaves() {
    const all = await window.api.saveList();
    // 读取存档界面只列出还没死的存档
    savesList = all.filter(s => (s.hp || 0) > 0);
  }

  function serializeGame() {
    return {
      id: game.id,
      name: game.name,
      createdAt: game.createdAt,
      updatedAt: game.updatedAt,
      playtime: game.playtime + playtimeAcc,
      seed: game.seed,
      // city: 重建即可，但保留 buildings 的 looted/cleared 状态
      cityBuildingsState: game.city.buildings.map(b => ({
        id: b.id, looted: b.looted, cleared: b.cleared
      })),
      player: {
        name: game.player.name,
        hp: game.player.hp, maxHp: game.player.maxHp,
        x: game.player.x, y: game.player.y,
        facing: game.player.facing,
        inv: game.player.inv,
        weapon: game.player.weapon,
        ammo: game.player.ammo,
        baseAtk: game.player.baseAtk,
        atkRange: game.player.atkRange,
        atkCd: game.player.atkCd
      },
      stats: game.stats,
      scene: game.scene,
      curBuildingId: game.curBuilding ? game.curBuilding.id : null,
      curFloor: game.curFloor
    };
  }

  async function saveGame() {
    if (!game) return;
    if (game.netMode !== 'single') return; // 联机不存档
    activateScene(sceneOf(game.player)); // 确保序列化的是本地玩家所在场景
    const payload = serializeGame();
    const r = await window.api.writeSave(payload);
    if (r.ok) {
      game.updatedAt = r.updatedAt;
      if (!game.createdAt) game.createdAt = r.updatedAt;
      toastMsg('已保存：' + game.name, 1500);
    } else {
      toastMsg('保存失败', 2000);
    }
    game.needSave = false;
  }

  async function loadGameById(id) {
    const data = await window.api.loadSave(id);
    if (!data) { toastMsg('存档损坏', 2000); return false; }
    devMode = false;
    const city = generateCity(data.seed);
    // 还原 building 状态
    for (const bs of data.cityBuildingsState || []) {
      const b = city.buildings.find(x => x.id === bs.id);
      if (b) { b.looted = bs.looted || {}; b.cleared = bs.cleared || {}; }
    }
    game = {
      id: data.id,
      name: data.name,
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
      playtime: data.playtime || 0,
      seed: data.seed,
      city,
      player: Object.assign({
        // 这些是运行时字段，不进存档，读档时补默认值，避免 undefined/NaN
        walkPhase: 0,
        hurtFlash: 0,
        lastAtk: 0,
        lastShoot: 0
      }, data.player),
      stats: data.stats,
      scene: 'city',
      curBuilding: null, curFloor: 0, floor: null,
      cam: { x: 0, y: 0 },
      cityMonsters: [], nextCitySpawn: 0, fogIntensity: 0,
      bullets: [],
      netMode: 'single', remotePlayers: [],
      scenes: new Map(),
      needSave: false
    };
    game.player.scene = 'city'; game.player.curBuilding = null; game.player.curFloor = 0;
    // 旧版存档兼容：子弹曾经放在 inv.ammo，现在统一到 p.ammo（开枪资源）
    // 每个旧子弹物品按 AMMO_PER_PICKUP 折算成发数
    if (game.player.inv && game.player.inv.ammo) {
      game.player.ammo = (game.player.ammo || 0) + game.player.inv.ammo * AMMO_PER_PICKUP;
      delete game.player.inv.ammo;
    }
    // 恢复场景
    if (data.scene === 'interior' && data.curBuildingId) {
      const b = city.buildings.find(x => x.id === data.curBuildingId);
      if (b) {
        enterBuilding(b, data.curFloor || 0); // 会设置 game.player.scene/curBuilding/curFloor
        // 覆盖玩家位置为存档位置
        game.player.x = data.player.x;
        game.player.y = data.player.y;
      } else {
        enterCity();
        game.player.scene = 'city'; game.player.curBuilding = null; game.player.curFloor = 0;
        game.player.x = data.player.x;
        game.player.y = data.player.y;
      }
    } else {
      enterCity();
      game.player.scene = 'city'; game.player.curBuilding = null; game.player.curFloor = 0;
      game.player.x = data.player.x;
      game.player.y = data.player.y;
    }
    // 同步激活场景到玩家所在场景，再校正位置
    activateScene(sceneOf(game.player));
    // 安全网：若存档位置卡在墙里（旧版存档或位置漂移），挪到最近的可走格
    nudgePlayerToWalkable();
    state = 'PLAYING';
    toastMsg('已载入：' + game.name, 1500);
    return true;
  }

  // 把卡在不可走格里的玩家挪到最近的可走格（螺旋向外搜索）
  function nudgePlayerToWalkable() {
    if (!game) return;
    const p = game.player;
    if (canWalk(p.x, p.y)) return;
    const W = game.scene === 'city' ? game.city.W : game.floor.W;
    const H = game.scene === 'city' ? game.city.H : game.floor.H;
    const tx0 = Math.floor(p.x / TILE);
    const ty0 = Math.floor(p.y / TILE);
    for (let r = 1; r < Math.max(W, H); r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue; // 只查外圈
          const tx = tx0 + dx, ty = ty0 + dy;
          if (tx < 0 || ty < 0 || tx >= W || ty >= H) continue;
          if (isWalkableTile(tx, ty)) {
            p.x = tx * TILE + TILE / 2;
            p.y = ty * TILE + TILE / 2;
            toastMsg('位置已校正', 1500);
            return;
          }
        }
      }
    }
    // 实在找不到，回 home 楼门口
    const home = game.city.buildings.find(b => b.isHome) || game.city.buildings[0];
    if (home) {
      game.scene = 'city';
      game.curBuilding = null; game.floor = null;
      p.x = home.door.x * TILE + TILE / 2;
      p.y = (home.door.y + 1) * TILE + TILE / 2;
      toastMsg('位置已校正', 1500);
    }
  }

  // ====================================================================
  //  更新逻辑
  // ====================================================================

  // 所有玩家（本地 + 远程），用于怪物寻路、拾取、渲染
  function allPlayers() {
    if (!game) return [];
    const arr = [game.player];
    if (game.remotePlayers) for (const rp of game.remotePlayers) arr.push(rp);
    return arr;
  }

  // ---------- 多场景（独立场景联机） ----------
  // game.scenes: Map<key, bundle>
  // bundle: { scene, curBuilding, curFloor, floor, cityMonsters, cityItems, bullets, fogIntensity }
  function sceneKeyOf(p) {
    if (!p) return 'city';
    if (p.scene === 'city' || !p.curBuilding) return 'city';
    return 'b:' + p.curBuilding.id + ':' + p.curFloor;
  }
  function sceneOf(p) {
    if (!game || !game.scenes) return null;
    return game.scenes.get(sceneKeyOf(p)) || null;
  }
  function activateScene(bundle) {
    if (!bundle) return;
    game.scene = bundle.scene;
    game.curBuilding = bundle.curBuilding;
    game.curFloor = bundle.curFloor;
    game.floor = bundle.floor;
    game.cityMonsters = bundle.cityMonsters;
    game.cityItems = bundle.cityItems;
    game.bullets = bundle.bullets;
    game.fogIntensity = bundle.fogIntensity || 0;
  }
  function syncBundle(bundle) {
    if (!bundle) return;
    bundle.curBuilding = game.curBuilding;
    bundle.curFloor = game.curFloor;
    bundle.floor = game.floor;
    bundle.cityMonsters = game.cityMonsters;
    bundle.cityItems = game.cityItems;
    bundle.bullets = game.bullets;
    bundle.fogIntensity = game.fogIntensity;
  }
  function ensureCityScene() {
    if (!game.scenes.has('city')) {
      game.scenes.set('city', {
        scene: 'city', curBuilding: null, curFloor: 0, floor: null,
        cityMonsters: game.cityMonsters || [], cityItems: game.cityItems || [],
        bullets: game.bullets || [], fogIntensity: 0
      });
    }
    return game.scenes.get('city');
  }
  function ensureInteriorScene(building, floorIdx) {
    const key = 'b:' + building.id + ':' + floorIdx;
    let bundle = game.scenes.get(key);
    if (!bundle) {
      const cleared = building.cleared[floorIdx];
      const floor = generateFloor(building, floorIdx, building.isHome, cleared);
      bundle = {
        scene: 'interior', curBuilding: building, curFloor: floorIdx, floor,
        cityMonsters: [], cityItems: [], bullets: [], fogIntensity: 0
      };
      game.scenes.set(key, bundle);
    }
    return bundle;
  }
  // 在当前激活场景里把玩家 p 放到 (ex,ey) 附近可走格
  function placePlayerNear(p, ex, ey) {
    const r = 5;
    const tryAt = (px, py) => px >= 0 && py >= 0 &&
      canWalk(px - r, py - r) && canWalk(px + r, py - r) &&
      canWalk(px - r, py + r) && canWalk(px + r, py + r);
    if (tryAt(ex, ey)) { p.x = ex; p.y = ey; return; }
    for (let rad = 1; rad < 14; rad++) {
      for (let dy = -rad; dy <= rad; dy++) {
        for (let dx = -rad; dx <= rad; dx++) {
          if (Math.abs(dx) !== rad && Math.abs(dy) !== rad) continue;
          const px = ex + dx * TILE, py = ey + dy * TILE;
          if (tryAt(px, py)) { p.x = px; p.y = py; return; }
        }
      }
    }
    p.x = ex; p.y = ey;
  }
  // 计算某楼层入口坐标（基于当前激活的 floor）
  function floorEntryPoint() {
    const f = game.floor;
    let ex = Math.floor(f.W/2) * TILE + TILE/2;
    let ey = (f.H - 3) * TILE + TILE/2;
    // 楼梯下进入
    if (game.curFloor > 0) {
      for (let y = 0; y < f.H; y++) for (let x = 0; x < f.W; x++) {
        if (f.map[y*f.W+x] === 3) { ex = x*TILE + TILE/2; ey = (y+1)*TILE + TILE/2; }
      }
    }
    return { ex, ey };
  }

  function readLocalInput() {
    let mx = 0, my = 0;
    if (keys['ArrowLeft'] || keys['KeyA']) mx -= 1;
    if (keys['ArrowRight'] || keys['KeyD']) mx += 1;
    if (keys['ArrowUp'] || keys['KeyW']) my -= 1;
    if (keys['ArrowDown'] || keys['KeyS']) my += 1;
    if (mx !== 0 && my !== 0) { mx *= 0.7071; my *= 0.7071; }
    const aim = aimDir();
    let useItem = null;
    if (keyPressed['Digit1']) useItem = 'medkit';
    else if (keyPressed['Digit2']) useItem = 'bandage';
    else if (keyPressed['Digit3']) useItem = 'canned';
    else if (keyPressed['Digit4']) useItem = 'water';
    return {
      mx, my,
      aimDx: aim.dx, aimDy: aim.dy,
      attack: !!(keys['Space'] || keys['KeyJ']),
      shoot: !!keys['KeyK'],
      interact: !!(keyPressed['KeyE'] || keyPressed['KeyF']),
      useItem,
      isLocal: true
    };
  }

  // 通用：推进一个玩家实体（本地或远程）
  function stepPlayerEntity(p, input, dt, isLocal) {
    const speed = 90;
    const nx = p.x + input.mx * speed * dt / 1000;
    const ny = p.y + input.my * speed * dt / 1000;
    if (canWalk(nx, p.y)) p.x = nx;
    if (canWalk(p.x, ny)) p.y = ny;

    if (input.attack || input.shoot) {
      p.facing = cardinalFromDir(input.aimDx, input.aimDy);
    } else if (input.mx < 0) p.facing = 1;
    else if (input.mx > 0) p.facing = 2;
    else if (input.my < 0) p.facing = 3;
    else if (input.my > 0) p.facing = 0;

    if (input.mx !== 0 || input.my !== 0) p.walkPhase = (p.walkPhase || 0) + dt / 100;

    // 互动 / 自动进门：所有被模拟的玩家都能触发自己的场景切换（独立场景）
    if (game.netMode !== 'client') {
      if (input.interact) interactAs(p);
      // 走到城市门上自动进入
      if (p.scene === 'city') {
        const tx = Math.floor(p.x / TILE);
        const ty = Math.floor(p.y / TILE);
        const t = game.city.map[ty*game.city.W + tx];
        if (t === 4 || t === 5) {
          const b = game.city.buildings.find(bb => bb.door.x === tx && bb.door.y === ty);
          if (b) enterBuildingAs(p, b, 0);
        }
      }
    }

    if (input.attack) attackForPlayer(p, input.aimDx, input.aimDy);
    if (input.shoot) shootForPlayer(p, input.aimDx, input.aimDy);
    if (input.useItem) useItemForPlayer(p, input.useItem);

    if ((p.hurtFlash || 0) > 0) p.hurtFlash = (p.hurtFlash || 0) - dt;
  }

  function update(dt) {
    if (state !== 'PLAYING' || !game) return;
    playtimeAcc += dt;

    // 1. 推进本地玩家（在本地玩家的场景里）
    activateScene(sceneOf(game.player));
    const localInput = readLocalInput();
    stepPlayerEntity(game.player, localInput, dt, true);

    // 2. 主机：推进远程玩家（各自场景）
    if (game.netMode === 'host' && game.remotePlayers) {
      for (const cp of game.remotePlayers) {
        activateScene(sceneOf(cp));
        const raw = party.clientInputs[cp.id] || { mx:0, my:0, aimDx:0, aimDy:1, attack:false, shoot:false, interact:false, useItem:null };
        // 边沿触发：interact / useItem 只在按下那一帧生效（输入会跨帧保留）
        const prevInt = cp._prevInteract || false;
        const prevUse = cp._prevUseItem || null;
        const inp = Object.assign({}, raw, {
          interact: raw.interact && !prevInt,
          useItem: (raw.useItem && raw.useItem !== prevUse) ? raw.useItem : null
        });
        cp._prevInteract = !!raw.interact;
        cp._prevUseItem = raw.useItem || null;
        stepPlayerEntity(cp, inp, dt, false);
        syncBundle(sceneOf(cp));
      }
    }
    syncBundle(sceneOf(game.player));

    // 暂停 / 存档（仅本地）
    if (keyPressed['Escape']) state = 'PAUSED';
    if (keyPressed['KeyR'] && game.netMode === 'single') saveGame();

    // 3. 逐场景模拟（仅含玩家的场景）
    if (game.netMode !== 'client') {
      const scenePlayers = new Map();
      for (const pl of allPlayers()) {
        const k = sceneKeyOf(pl);
        if (!scenePlayers.has(k)) scenePlayers.set(k, []);
        scenePlayers.get(k).push(pl);
      }
      for (const [key, players] of scenePlayers) {
        const bundle = game.scenes.get(key);
        if (!bundle) continue;
        activateScene(bundle);
        updateMonsters(dt, players);
        updateBullets(dt);
        autoPickupAll(players);
        if (bundle.scene === 'city') updateCitySpawn(dt, players);
        // 雾气
        if (bundle.scene === 'city') game.fogIntensity = 0.25 + 0.2 * Math.sin(performance.now() / 9000);
        else game.fogIntensity = bundle.curBuilding && bundle.curBuilding.kind === 'fog' ? 0.35 : 0;
        // 清理死亡怪物
        if (game.scene === 'city') game.cityMonsters = game.cityMonsters.filter(m => m.alive);
        else if (game.floor) game.floor.monsters = game.floor.monsters.filter(m => m.alive);
        syncBundle(bundle);
      }
    }

    // 受伤闪烁（所有玩家）
    for (const pl of allPlayers()) {
      if ((pl.hurtFlash || 0) > 0) pl.hurtFlash = (pl.hurtFlash || 0) - dt;
      if (pl.hp <= 0) pl.hp = 0;
    }

    // 死亡判定（仅本地玩家在主机/单人下进入 DEAD）
    if (game.netMode !== 'client') {
      if (devMode) {
        // 开发者模式：血量无限，不会死亡
        game.player.hp = game.player.maxHp;
      } else if (game.player.hp <= 0) {
        game.player.hp = 0;
        state = 'DEAD';
        game.stats.deaths = (game.stats.deaths || 0) + 1;
        if (game.netMode === 'host') {
          partyHostBroadcastMsg({ type: 'kick', reason: '主机已死亡，派对结束' });
        }
      }
    }

    // 恢复主机场景 + 相机
    activateScene(sceneOf(game.player));
    updateCamera();

    // 主机：定时广播快照
    if (game.netMode === 'host') maybeBroadcastSnapshot();

    keyPressed = {};
  }

  function canWalk(px, py) {
    if (!game) return false;
    const r = 5; // 玩家半径
    const points = [
      [px - r, py - r], [px + r, py - r],
      [px - r, py + r], [px + r, py + r]
    ];
    for (const [x, y] of points) {
      const tx = Math.floor(x / TILE);
      const ty = Math.floor(y / TILE);
      if (!isWalkableTile(tx, ty)) return false;
    }
    return true;
  }

  function isWalkableTile(tx, ty) {
    if (game.scene === 'city') {
      if (tx < 0 || ty < 0 || tx >= game.city.W || ty >= game.city.H) return false;
      const t = game.city.map[ty*game.city.W + tx];
      // 0 路面 / 1 人行道 / 4 楼房门 / 5 home 门 可走；3 楼墙不可走
      return t === 0 || t === 1 || t === 4 || t === 5;
    } else {
      const f = game.floor;
      if (tx < 0 || ty < 0 || tx >= f.W || ty >= f.H) return false;
      const t = f.map[ty*f.W + tx];
      // 0 地板 / 2 楼梯上 / 3 楼梯下 / 4 出口 可走；1 墙不可走
      return t === 0 || t === 2 || t === 3 || t === 4;
    }
  }

  function interactAs(p) {
    if (!game || !p) return;
    // 切到该玩家的场景
    const bundle = sceneOf(p);
    if (!bundle) return;
    activateScene(bundle);
    if (p.scene === 'city') {
      const cx = Math.floor(p.x / TILE);
      const cy = Math.floor(p.y / TILE);
      const fx = Math.floor((p.x + dirX(p.facing) * 14) / TILE);
      const fy = Math.floor((p.y + dirY(p.facing) * 14) / TILE);
      const W = game.city.W;
      const candidates = [
        [cx, cy], [fx, fy],
        [cx+1, cy], [cx-1, cy], [cx, cy+1], [cx, cy-1]
      ];
      for (const [tx, ty] of candidates) {
        if (tx < 0 || ty < 0 || tx >= W || ty >= game.city.H) continue;
        const t = game.city.map[ty*W + tx];
        if (t === 4 || t === 5) {
          const b = game.city.buildings.find(bb => bb.door.x === tx && bb.door.y === ty);
          if (b) { enterBuildingAs(p, b, 0); return; }
        }
      }
    } else {
      const f = game.floor;
      if (!f) return;
      const cx = Math.floor(p.x / TILE);
      const cy = Math.floor(p.y / TILE);
      const fx = Math.floor((p.x + dirX(p.facing) * 14) / TILE);
      const fy = Math.floor((p.y + dirY(p.facing) * 14) / TILE);
      const W = f.W;
      const tileAt = (tx, ty) => {
        if (tx < 0 || ty < 0 || tx >= W || ty >= f.H) return -1;
        return f.map[ty*W + tx];
      };
      let t = tileAt(cx, cy);
      if (t !== 2 && t !== 3 && t !== 4) t = tileAt(fx, fy);
      if (t === 2) {
        enterBuildingAs(p, p.curBuilding, p.curFloor + 1);
      } else if (t === 3) {
        if (p.curFloor > 0) enterBuildingAs(p, p.curBuilding, p.curFloor - 1);
      } else if (t === 4) {
        exitToCityAs(p);
      }
    }
  }
  function interact() { interactAs(game.player); }

  function dirX(f) { return f === 1 ? -1 : f === 2 ? 1 : 0; }
  function dirY(f) { return f === 0 ? 1 : f === 3 ? -1 : 0; }

  // 由鼠标位置算出瞄准方向（归一化）；存到 p.lastAim 供渲染挥拳方向
  function aimDir() {
    const p = game.player;
    const wx = mousePos.x + game.cam.x;
    const wy = mousePos.y + game.cam.y;
    let dx = wx - p.x, dy = wy - p.y;
    const d = Math.hypot(dx, dy);
    if (d < 0.001) return { dx: dirX(p.facing), dy: dirY(p.facing) };
    return { dx: dx/d, dy: dy/d };
  }
  // 把任意方向转成四向 facing（0下 1左 2右 3上）
  function cardinalFromDir(dx, dy) {
    if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 2 : 1;
    return dy > 0 ? 0 : 3;
  }

  function attackForPlayer(p, aimDx, aimDy) {
    const now = performance.now();
    if (now - (p.lastAtk || 0) < (p.atkCd || 380)) return;
    p.lastAtk = now;
    p.lastAim = { dx: aimDx, dy: aimDy };

    const range = p.atkRange || 22;
    const monsters = currentMonsters();
    let hit = false;
    for (const m of monsters) {
      if (!m.alive) continue;
      const mdx = m.x - p.x, mdy = m.y - p.y;
      const d = Math.hypot(mdx, mdy);
      if (d > range + 8) continue;
      if (d > 0.1) {
        const dot = (mdx*aimDx + mdy*aimDy) / d;
        if (dot < 0.3) continue;
      }
      m.hp -= (p.baseAtk || 12);
      m.hurtFlash = 120;
      game.stats.dmgDealt += (p.baseAtk || 12);
      hit = true;
      m.x += aimDx * 6; m.y += aimDy * 6;
      if (m.hp <= 0) {
        m.alive = false;
        game.stats.kills++;
        if (m.kind === 'fogman' && Math.random() < 0.5) spawnLootAt(m.x, m.y, 'ammo');
        else if (m.kind === 'zombie' && Math.random() < 0.25) spawnLootAt(m.x, m.y, choice(['canned','water','bandage']));
      }
    }
    if (hit) checkFloorCleared();
  }
  // 兼容旧调用
  function tryAttack() { attackForPlayer(game.player, aimDir().dx, aimDir().dy); }

  // ---------- 远程开枪 ----------
  const SHOOT_DMG = 25;
  const SHOOT_SPEED = 320;     // px/s
  const SHOOT_LIFE = 900;      // ms
  const SHOOT_CD = 240;        // ms
  function shootForPlayer(p, aimDx, aimDy) {
    if (!devMode || p !== game.player) {
      if ((p.ammo || 0) <= 0) {
        if (p.isLocal !== false) {
          if (!p._noAmmoToast || performance.now() - p._noAmmoToast > 1500) {
            toastMsg('没有子弹了！按 K 开枪，空格挥拳', 1200);
            p._noAmmoToast = performance.now();
          }
        }
        return;
      }
    }
    const now = performance.now();
    if (now - (p.lastShoot || 0) < SHOOT_CD) return;
    p.lastShoot = now;
    if (!devMode || p !== game.player) p.ammo -= 1;
    p.lastAim = { dx: aimDx, dy: aimDy };
    game.bullets.push({
      x: p.x + aimDx * 8,
      y: p.y + aimDy * 8,
      dx: aimDx, dy: aimDy,
      born: now,
      dmg: SHOOT_DMG
    });
  }
  function tryShoot() { shootForPlayer(game.player, aimDir().dx, aimDir().dy); }

  function updateBullets(dt) {
    if (!game.bullets || game.bullets.length === 0) return;
    const now = performance.now();
    const monsters = currentMonsters();
    const survivors = [];
    for (const b of game.bullets) {
      // 推进
      b.x += b.dx * SHOOT_SPEED * dt / 1000;
      b.y += b.dy * SHOOT_SPEED * dt / 1000;
      // 寿命
      if (now - b.born > SHOOT_LIFE) continue;
      // 撞墙
      const tx = Math.floor(b.x / TILE);
      const ty = Math.floor(b.y / TILE);
      if (!isWalkableTile(tx, ty)) continue;
      // 撞怪物
      let hitMonster = false;
      for (const m of monsters) {
        if (!m.alive) continue;
        if (dist2(b.x, b.y, m.x, m.y) <= 10*10) {
          m.hp -= b.dmg;
          m.hurtFlash = 120;
          game.stats.dmgDealt += b.dmg;
          // 击退
          const ddx = m.x - b.x, ddy = m.y - b.y;
          const d = Math.hypot(ddx, ddy) || 1;
          m.x += ddx/d * 4; m.y += ddy/d * 4;
          if (m.hp <= 0) {
            m.alive = false;
            game.stats.kills++;
            if (m.kind === 'fogman' && Math.random() < 0.5) {
              spawnLootAt(m.x, m.y, 'ammo');
            } else if (m.kind === 'zombie' && Math.random() < 0.25) {
              spawnLootAt(m.x, m.y, choice(['canned','water','bandage']));
            }
          }
          hitMonster = true;
          break;
        }
      }
      if (hitMonster) { checkFloorCleared(); continue; }
      survivors.push(b);
    }
    game.bullets = survivors;
  }

  function renderBullets() {
    if (!game.bullets || game.bullets.length === 0) return;
    const cam = game.cam;
    for (const b of game.bullets) {
      const sx = b.x - cam.x, sy = b.y - cam.y;
      // 弹头
      ctx.fillStyle = '#ffe070';
      ctx.fillRect(Math.round(sx) - 1, Math.round(sy) - 1, 3, 3);
      // 尾焰
      ctx.fillStyle = 'rgba(255,160,40,0.6)';
      ctx.fillRect(Math.round(sx - b.dx*4) - 1, Math.round(sy - b.dy*4) - 1, 2, 2);
    }
  }

  function spawnLootAt(x, y, type) {
    if (game.scene === 'interior') {
      game.floor.items.push({ x, y, type, taken: false });
    } else {
      // 城市掉落：放到 cityMonsters 之外的简单 ground items
      if (!game.cityItems) game.cityItems = [];
      game.cityItems.push({ x, y, type, taken: false });
    }
  }

  function currentMonsters() {
    return game.scene === 'city' ? game.cityMonsters : (game.floor ? game.floor.monsters : []);
  }

  function checkFloorCleared() {
    if (game.scene !== 'interior') return;
    const alive = game.floor.monsters.some(m => m.alive);
    if (!alive) {
      game.curBuilding.cleared[game.curFloor] = true;
    }
  }

  function useItemForPlayer(p, type) {
    const def = ITEMS[type];
    if (!def) return;
    if (devMode && p === game.player) {
      // 开发者模式：本地玩家无限使用，不消耗
      if (def.heal > 0) {
        if (p.hp < p.maxHp) {
          p.hp = Math.min(p.maxHp, p.hp + def.heal);
          if (p === game.player) toastMsg('使用 ' + def.name + ' +' + def.heal + ' HP', 1000);
        } else if (p === game.player) {
          toastMsg('生命已满', 800);
        }
      } else if (def.kind === 'ammo') {
        p.ammo = (p.ammo || 0) + 10;
        if (p === game.player) toastMsg('+' + def.name + ' x10', 1000);
      }
      return;
    }
    if ((p.inv[type] || 0) <= 0) return;
    if (def.heal > 0) {
      if (p.hp >= p.maxHp) {
        if (p === game.player) toastMsg('生命已满', 1000);
        return;
      }
      p.hp = Math.min(p.maxHp, p.hp + def.heal);
      if (p === game.player) toastMsg('使用 ' + def.name + ' +' + def.heal + ' HP', 1200);
    } else if (def.kind === 'ammo') {
      p.ammo = (p.ammo || 0) + 10;
      if (p === game.player) toastMsg('+' + def.name + ' x10', 1200);
    }
    p.inv[type] -= 1;
    if (p.inv[type] <= 0) delete p.inv[type];
  }
  function useItem(type) { useItemForPlayer(game.player, type); }

  function updateMonsters(dt, players) {
    if (!players) players = allPlayers();
    const monsters = currentMonsters();
    const now = performance.now();
    for (const m of monsters) {
      if (!m.alive) continue;
      if (m.hurtFlash > 0) m.hurtFlash -= dt;
      const def = MON[m.kind];
      // 找最近的活着的玩家
      let target = null, bestD2 = Infinity;
      for (const pl of players) {
        if ((pl.hp || 0) <= 0) continue;
        const d2 = dist2(m.x, m.y, pl.x, pl.y);
        if (d2 < bestD2) { bestD2 = d2; target = pl; }
      }
      const p = target || players[0];
      const d2 = bestD2;
      const aggro = (m.kind === 'fogman') ? 280*280 : 220*220;
      if (target && d2 < aggro) {
        // 追击
        const dx = p.x - m.x, dy = p.y - m.y;
        const d = Math.hypot(dx, dy) || 1;
        let spd = def.speed * 60;
        if (m.kind === 'fogman' && game.fogIntensity > 0.3) spd *= 1.3;
        const nx = m.x + dx/d * spd * dt / 1000;
        const ny = m.y + dy/d * spd * dt / 1000;
        if (canWalkMonster(m, nx, m.y)) m.x = nx;
        if (canWalkMonster(m, m.x, ny)) m.y = ny;
        if (d2 <= def.atkRange*def.atkRange && now - m.lastAtk > def.atkCd) {
          m.lastAtk = now;
          p.hp -= def.dmg;
          p.hurtFlash = 200;
          game.stats.dmgTaken += def.dmg;
        }
      } else {
        // 闲逛
        if (now > m.nextWander) {
          m.nextWander = now + rand(1500, 3500);
          m.wanderTx = m.x + rand(-60, 60);
          m.wanderTy = m.y + rand(-60, 60);
        }
        const dx = m.wanderTx - m.x, dy = m.wanderTy - m.y;
        const d = Math.hypot(dx, dy) || 1;
        const spd = def.speed * 30;
        const nx = m.x + dx/d * spd * dt / 1000;
        const ny = m.y + dy/d * spd * dt / 1000;
        if (canWalkMonster(m, nx, m.y)) m.x = nx;
        if (canWalkMonster(m, m.x, ny)) m.y = ny;
      }
    }
    if (game.scene === 'city') {
      game.cityMonsters = game.cityMonsters.filter(m => m.alive);
    } else {
      game.floor.monsters = game.floor.monsters.filter(m => m.alive);
    }
  }

  function canWalkMonster(m, px, py) {
    const r = 5;
    const points = [
      [px - r, py - r], [px + r, py - r],
      [px - r, py + r], [px + r, py + r]
    ];
    for (const [x, y] of points) {
      const tx = Math.floor(x / TILE);
      const ty = Math.floor(y / TILE);
      if (!isWalkableTile(tx, ty)) return false;
    }
    return true;
  }

  function updateCamera() {
    if (!game) return;
    const p = game.player;
    const worldW = (game.scene === 'city' ? game.city.W : game.floor.W) * TILE;
    const worldH = (game.scene === 'city' ? game.city.H : game.floor.H) * TILE;
    let cx = p.x - VIEW_W/2;
    let cy = p.y - VIEW_H/2;
    cx = clamp(cx, 0, Math.max(0, worldW - VIEW_W));
    cy = clamp(cy, 0, Math.max(0, worldH - VIEW_H));
    game.cam.x = cx; game.cam.y = cy;
  }

  // ---------- 拾取 ----------
  const AMMO_PER_PICKUP = 3; // 每个子弹物品给 3 发
  function pickupForPlayer(p, items) {
    for (const it of items) {
      if (it.taken) continue;
      if (dist2(it.x, it.y, p.x, p.y) < 14*14) {
        const def = ITEMS[it.type];
        if (it.type === 'ammo') {
          p.ammo = (p.ammo || 0) + AMMO_PER_PICKUP;
          it.taken = true;
          game.stats.looted++;
          if (p === game.player) toastMsg('拾取 子弹 x' + AMMO_PER_PICKUP + '  (K 开枪)', 1100);
          continue;
        }
        const cap = def.stack || 99;
        if ((p.inv[it.type] || 0) >= cap) continue;
        it.taken = true;
        p.inv[it.type] = (p.inv[it.type] || 0) + 1;
        game.stats.looted++;
        if (p === game.player) toastMsg('拾取 ' + def.name, 1000);
      }
    }
  }
  function tryPickup() {
    if (!game) return;
    let items = null;
    if (game.scene === 'interior') items = game.floor.items;
    else items = game.cityItems || [];
    pickupForPlayer(game.player, items);
    if (game.scene === 'interior') game.floor.items = game.floor.items.filter(i => !i.taken);
    else game.cityItems = (game.cityItems || []).filter(i => !i.taken);
  }
  function autoPickupAll(players) {
    if (!game) return;
    if (!players) players = allPlayers();
    let items = null;
    if (game.scene === 'interior') items = game.floor.items;
    else items = game.cityItems || [];
    for (const pl of players) pickupForPlayer(pl, items);
    if (game.scene === 'interior') game.floor.items = game.floor.items.filter(i => !i.taken);
    else game.cityItems = (game.cityItems || []).filter(i => !i.taken);
  }
  // 兼容旧调用
  function autoPickup() { autoPickupAll(allPlayers()); }

  function updateCitySpawn(dt, players) {
    if (!players) players = allPlayers();
    const now = performance.now();
    if (now > game.nextCitySpawn && game.cityMonsters.length < 12) {
      const kind = Math.random() < 0.65 ? 'zombie' : 'fogman';
      let tx, ty, tries = 0;
      do {
        tx = randi(2, game.city.W-2); ty = randi(2, game.city.H-2); tries++;
      } while (game.city.map[ty*game.city.W+tx] > 1 && tries < 30);
      if (game.city.map[ty*game.city.W+tx] <= 1) {
        const sx = tx*TILE + TILE/2, sy = ty*TILE + TILE/2;
        let far = true;
        for (const pl of players) if (dist2(sx, sy, pl.x, pl.y) < 200*200) far = false;
        if (far) game.cityMonsters.push(makeMonster(kind, sx, sy));
      }
      game.nextCitySpawn = now + rand(12000, 25000);
    }
  }

  // ====================================================================
  //  渲染
  // ====================================================================

  function render() {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);

    if (state === 'MENU') { renderMenu(); return; }
    if (state === 'NAMING') { if (namingReturnState === 'SAVES') renderSaves(); else renderMenu(); renderToast(); return; }
    if (state === 'HOST_NAMING') { renderMenu(); renderToast(); return; }
    if (state === 'JOINING') { renderParty(); renderToast(); return; }
    if (state === 'PARTY') { renderParty(); renderToast(); return; }
    if (state === 'HOST_LOBBY' || state === 'CLIENT_LOBBY') { renderLobby(); renderToast(); return; }
    if (state === 'SAVES') { renderSaves(); return; }
    if (state === 'PAUSED') { renderWorld(); renderPause(); return; }
    if (state === 'DEAD') { renderWorld(); renderDead(); return; }
    if (state === 'PLAYING') { renderWorld(); renderHUD(); }
    renderToast();
  }

  function renderWorld() {
    if (!game) return;
    // 渲染本地玩家所在场景
    activateScene(sceneOf(game.player));
    if (game.scene === 'city') renderCity();
    else renderInterior();
    // 怪物
    renderMonsters();
    // 子弹
    renderBullets();
    // 远程玩家：只渲染与本地玩家在同一场景的
    if (game.remotePlayers && game.remotePlayers.length) {
      const myKey = sceneKeyOf(game.player);
      for (const rp of game.remotePlayers) {
        if (sceneKeyOf(rp) === myKey) renderRemotePlayer(rp);
      }
    }
    // 本地玩家
    renderPlayer();
    // 雾
    if (game.fogIntensity > 0) renderFog(game.fogIntensity);
  }

  function renderCity() {
    const { W, H, map } = game.city;
    const cam = game.cam;
    const tx0 = Math.floor(cam.x / TILE);
    const ty0 = Math.floor(cam.y / TILE);
    for (let ty = ty0; ty < ty0 + VIEW_TH + 1; ty++) {
      for (let tx = tx0; tx < tx0 + VIEW_TW + 1; tx++) {
        if (tx < 0 || ty < 0 || tx >= W || ty >= H) {
          // 外部草地
          ctx.fillStyle = PAL.grassDark;
          ctx.fillRect(tx*TILE - cam.x, ty*TILE - cam.y, TILE, TILE);
          continue;
        }
        const t = map[ty*W + tx];
        const sx = tx*TILE - cam.x, sy = ty*TILE - cam.y;
        drawCityTile(t, sx, sy, tx, ty);
      }
    }
    // 城市掉落物
    const items = game.cityItems || [];
    for (const it of items) {
      if (it.taken) continue;
      drawItem(it, cam);
    }
  }

  function drawCityTile(t, sx, sy, tx, ty) {
    if (t === 0) {
      // 路面
      ctx.fillStyle = PAL.road;
      ctx.fillRect(sx, sy, TILE, TILE);
      // 路面斑点
      if ((tx*7 + ty*13) % 5 === 0) {
        ctx.fillStyle = PAL.asphalt;
        ctx.fillRect(sx+3, sy+4, 2, 2);
      }
      // 路面中央黄线
      if (ty % 6 === 3) {
        ctx.fillStyle = PAL.roadLine;
        ctx.fillRect(sx, sy + TILE/2 - 1, TILE, 2);
      }
    } else if (t === 1) {
      // 人行道
      ctx.fillStyle = PAL.sidewalk;
      ctx.fillRect(sx, sy, TILE, TILE);
      ctx.fillStyle = PAL.asphalt2;
      ctx.fillRect(sx, sy, TILE, 1);
      ctx.fillRect(sx, sy+TILE-1, TILE, 1);
    } else if (t === 2) {
      ctx.fillStyle = PAL.grass;
      ctx.fillRect(sx, sy, TILE, TILE);
      if ((tx+ty) % 2 === 0) {
        ctx.fillStyle = PAL.grassDark;
        ctx.fillRect(sx+5, sy+6, 2, 2);
      }
    } else if (t === 3) {
      // 楼房外墙
      ctx.fillStyle = (tx + ty) % 2 === 0 ? PAL.buildingWall : PAL.buildingWall2;
      ctx.fillRect(sx, sy, TILE, TILE);
      // 窗户
      if ((tx % 3 === 1) && (ty % 3 === 1)) {
        ctx.fillStyle = ((tx*ty) % 7 === 0) ? PAL.buildingWinLit : PAL.buildingWin;
        ctx.fillRect(sx+3, sy+3, 10, 7);
        ctx.fillStyle = PAL.buildingWall2;
        ctx.fillRect(sx+7, sy+3, 1, 7);
      }
    } else if (t === 4) {
      // 普通楼门
      ctx.fillStyle = PAL.buildingWall;
      ctx.fillRect(sx, sy, TILE, TILE);
      ctx.fillStyle = PAL.doorFrame;
      ctx.fillRect(sx+2, sy+1, 12, 14);
      ctx.fillStyle = PAL.door;
      ctx.fillRect(sx+3, sy+2, 10, 12);
      ctx.fillStyle = '#d0c040';
      ctx.fillRect(sx+10, sy+8, 2, 2);
    } else if (t === 5) {
      // home 门（绿色）
      ctx.fillStyle = PAL.buildingWall;
      ctx.fillRect(sx, sy, TILE, TILE);
      ctx.fillStyle = PAL.doorFrame;
      ctx.fillRect(sx+2, sy+1, 12, 14);
      ctx.fillStyle = '#2a8a4a';
      ctx.fillRect(sx+3, sy+2, 10, 12);
      ctx.fillStyle = '#5ad07a';
      ctx.fillRect(sx+4, sy+3, 8, 1);
      ctx.fillStyle = '#d0c040';
      ctx.fillRect(sx+10, sy+8, 2, 2);
    }
  }

  function renderInterior() {
    const f = game.floor;
    const cam = game.cam;
    const tx0 = Math.floor(cam.x / TILE);
    const ty0 = Math.floor(cam.y / TILE);
    for (let ty = ty0; ty < ty0 + VIEW_TH + 1; ty++) {
      for (let tx = tx0; tx < tx0 + VIEW_TW + 1; tx++) {
        if (tx < 0 || ty < 0 || tx >= f.W || ty >= f.H) continue;
        const t = f.map[ty*f.W + tx];
        const sx = tx*TILE - cam.x, sy = ty*TILE - cam.y;
        drawInteriorTile(t, sx, sy, tx, ty);
      }
    }
    // 物品
    for (const it of f.items) {
      if (it.taken) continue;
      drawItem(it, cam);
    }
  }

  function drawInteriorTile(t, sx, sy, tx, ty) {
    // 地板
    ctx.fillStyle = (tx + ty) % 2 === 0 ? PAL.interiorFloor : PAL.interiorFloor2;
    ctx.fillRect(sx, sy, TILE, TILE);
    if (t === 1) {
      ctx.fillStyle = (tx + ty) % 2 === 0 ? PAL.interiorWall : PAL.interiorWall2;
      ctx.fillRect(sx, sy, TILE, TILE);
      // 墙顶亮边
      ctx.fillStyle = '#4a4a54';
      ctx.fillRect(sx, sy, TILE, 2);
    } else if (t === 2) {
      // 楼梯上
      ctx.fillStyle = PAL.stair;
      ctx.fillRect(sx, sy, TILE, TILE);
      ctx.fillStyle = PAL.stairDark;
      for (let i = 0; i < 4; i++) ctx.fillRect(sx+1, sy+2+i*3, 14, 2);
      ctx.fillStyle = '#d0d040';
      ctx.fillRect(sx+6, sy+2, 4, 4);
    } else if (t === 3) {
      // 楼梯下
      ctx.fillStyle = PAL.stair;
      ctx.fillRect(sx, sy, TILE, TILE);
      ctx.fillStyle = PAL.stairDark;
      for (let i = 0; i < 4; i++) ctx.fillRect(sx+1, sy+8-i*3, 14, 2);
      ctx.fillStyle = '#d0d040';
      ctx.fillRect(sx+6, sy+10, 4, 4);
    } else if (t === 4) {
      // 出口门
      ctx.fillStyle = PAL.interiorWall;
      ctx.fillRect(sx, sy, TILE, TILE);
      ctx.fillStyle = PAL.doorFrame;
      ctx.fillRect(sx+2, sy, 12, 16);
      ctx.fillStyle = '#2a6a8a';
      ctx.fillRect(sx+3, sy+1, 10, 14);
      ctx.fillStyle = '#d0c040';
      ctx.fillRect(sx+10, sy+8, 2, 2);
      // 出口标识
      ctx.fillStyle = '#e0e0e0';
      ctx.fillRect(sx+5, sy+3, 6, 1);
    }
  }

  function drawItem(it, cam) {
    const def = ITEMS[it.type];
    const sx = it.x - cam.x, sy = it.y - cam.y;
    // 阴影
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillRect(sx - 4, sy + 4, 8, 2);
    // 物品方块
    ctx.fillStyle = def.color;
    ctx.fillRect(sx - 4, sy - 4, 8, 8);
    ctx.fillStyle = '#000';
    ctx.fillRect(sx - 4, sy - 4, 8, 1);
    ctx.fillRect(sx - 4, sy + 3, 8, 1);
    // 高亮闪烁
    const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 300);
    ctx.fillStyle = `rgba(255,255,200,${0.2 + 0.3*pulse})`;
    ctx.fillRect(sx - 5, sy - 5, 10, 1);
  }

  function renderMonsters() {
    const cam = game.cam;
    for (const m of currentMonsters()) {
      if (!m.alive) continue;
      const sx = m.x - cam.x, sy = m.y - cam.y;
      if (sx < -20 || sx > VIEW_W + 20 || sy < -20 || sy > VIEW_H + 20) continue;
      const def = MON[m.kind];
      // 阴影
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(sx - 5, sy + 5, 10, 2);
      // 身体（8x10）
      const flash = m.hurtFlash > 0;
      ctx.fillStyle = flash ? '#ffffff' : def.color;
      ctx.fillRect(sx - 4, sy - 5, 8, 10);
      ctx.fillStyle = flash ? '#ffffff' : def.color2;
      ctx.fillRect(sx - 4, sy + 1, 8, 4);
      // 头
      ctx.fillStyle = flash ? '#ffffff' : def.color;
      ctx.fillRect(sx - 3, sy - 8, 6, 4);
      // 眼睛
      ctx.fillStyle = def.eye;
      if (m.kind === 'fogman') {
        ctx.fillRect(sx - 2, sy - 7, 1, 2);
        ctx.fillRect(sx + 1, sy - 7, 1, 2);
      } else {
        ctx.fillRect(sx - 2, sy - 6, 2, 1);
        ctx.fillRect(sx + 1, sy - 6, 2, 1);
      }
      // 雾中人周围雾
      if (m.kind === 'fogman') {
        ctx.fillStyle = 'rgba(180,190,210,0.18)';
        ctx.fillRect(sx - 10, sy - 12, 20, 22);
      }
      // 血条
      if (m.hp < m.maxHp) {
        ctx.fillStyle = '#000';
        ctx.fillRect(sx - 5, sy - 12, 10, 2);
        ctx.fillStyle = PAL.danger;
        ctx.fillRect(sx - 5, sy - 12, Math.ceil(10 * m.hp / m.maxHp), 2);
      }
    }
  }

  function renderPlayer() {
    const p = game.player;
    const cam = game.cam;
    const sx = p.x - cam.x, sy = p.y - cam.y;
    // 阴影
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(sx - 5, sy + 5, 10, 2);
    // 身体
    const flash = (p.hurtFlash || 0) > 0;
    const phase = Number.isFinite(p.walkPhase) ? p.walkPhase : 0;
    const bob = Math.sin(phase) * 1;
    ctx.fillStyle = flash ? '#ffffff' : '#3a5a8a';
    ctx.fillRect(sx - 4, sy - 4 + bob, 8, 8);
    // 头
    ctx.fillStyle = flash ? '#ffffff' : '#d0a070';
    ctx.fillRect(sx - 3, sy - 8 + bob, 6, 4);
    // 头发
    ctx.fillStyle = '#3a2a1a';
    ctx.fillRect(sx - 3, sy - 8 + bob, 6, 2);
    // 眼睛
    ctx.fillStyle = '#000';
    if (p.facing === 0) { // 下
      ctx.fillRect(sx - 2, sy - 5 + bob, 1, 1);
      ctx.fillRect(sx + 1, sy - 5 + bob, 1, 1);
    } else if (p.facing === 1) { // 左
      ctx.fillRect(sx - 2, sy - 6 + bob, 1, 1);
    } else if (p.facing === 2) { // 右
      ctx.fillRect(sx + 1, sy - 6 + bob, 1, 1);
    } else { // 上
      // 看不见眼睛
    }
    // 腿（简单摆动）
    ctx.fillStyle = '#2a2a3a';
    const legSwing = Math.sin(p.walkPhase * 2) * 1;
    ctx.fillRect(sx - 3, sy + 4 + bob, 2, 3 + legSwing);
    ctx.fillRect(sx + 1, sy + 4 + bob, 2, 3 - legSwing);
    // 攻击挥砍动画（沿鼠标瞄准方向）
    const now = performance.now();
    if (now - p.lastAtk < 150) {
      const aim = p.lastAim || { dx: dirX(p.facing), dy: dirY(p.facing) };
      ctx.fillStyle = '#f0e0a0';
      ctx.fillRect(sx + aim.dx*8 - 2, sy + aim.dy*8 - 2, 4, 4);
      // 挥砍弧线
      ctx.fillStyle = 'rgba(240,224,160,0.5)';
      ctx.fillRect(sx + aim.dx*12 - 1, sy + aim.dy*12 - 1, 3, 3);
    }
  }

  // 远程玩家头像（不同颜色，带名字）
  const REMOTE_COLORS = ['#8a3a5a','#5a8a3a','#8a6a3a','#5a3a8a','#3a8a8a'];
  function renderRemotePlayer(p) {
    const cam = game.cam;
    const sx = p.x - cam.x, sy = p.y - cam.y;
    if (sx < -20 || sx > VIEW_W + 20 || sy < -20 || sy > VIEW_H + 20) return;
    const colIdx = (p.id || 0) % REMOTE_COLORS.length;
    const body = REMOTE_COLORS[colIdx];
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(sx - 5, sy + 5, 10, 2);
    const flash = (p.hurtFlash || 0) > 0;
    const phase = Number.isFinite(p.walkPhase) ? p.walkPhase : 0;
    const bob = Math.sin(phase) * 1;
    ctx.fillStyle = flash ? '#ffffff' : body;
    ctx.fillRect(sx - 4, sy - 4 + bob, 8, 8);
    ctx.fillStyle = flash ? '#ffffff' : '#d0a070';
    ctx.fillRect(sx - 3, sy - 8 + bob, 6, 4);
    ctx.fillStyle = '#2a2a1a';
    ctx.fillRect(sx - 3, sy - 8 + bob, 6, 2);
    ctx.fillStyle = '#000';
    if (p.facing === 0) { ctx.fillRect(sx - 2, sy - 5 + bob, 1, 1); ctx.fillRect(sx + 1, sy - 5 + bob, 1, 1); }
    else if (p.facing === 1) { ctx.fillRect(sx - 2, sy - 6 + bob, 1, 1); }
    else if (p.facing === 2) { ctx.fillRect(sx + 1, sy - 6 + bob, 1, 1); }
    ctx.fillStyle = '#2a2a3a';
    const legSwing = Math.sin((phase) * 2) * 1;
    ctx.fillRect(sx - 3, sy + 4 + bob, 2, 3 + legSwing);
    ctx.fillRect(sx + 1, sy + 4 + bob, 2, 3 - legSwing);
    // 名字 + HP 条
    ctx.fillStyle = '#fff';
    ctx.font = '9px Microsoft YaHei, Consolas, monospace';
    const nm = p.name || '玩家';
    ctx.textAlign = 'center';
    ctx.fillText(nm, sx, sy - 12);
    ctx.textAlign = 'left';
    const w = 14, hpw = Math.max(0, Math.min(1, (p.hp||0)/(p.maxHp||100))) * w;
    ctx.fillStyle = '#400';
    ctx.fillRect(sx - w/2, sy - 11, w, 2);
    ctx.fillStyle = hpw > 0 ? '#40c060' : '#c04040';
    ctx.fillRect(sx - w/2, sy - 11, hpw, 2);
  }

  function renderFog(intensity) {
    ctx.fillStyle = `rgba(154,160,176,${0.18 * intensity})`;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    // 雾中人时雾更浓的暗角
    if (game.scene === 'city' && game.cityMonsters.some(m => m.kind === 'fogman')) {
      const grd = ctx.createRadialGradient(VIEW_W/2, VIEW_H/2, 60, VIEW_W/2, VIEW_H/2, 360);
      grd.addColorStop(0, 'rgba(20,20,30,0)');
      grd.addColorStop(1, `rgba(20,20,30,${0.4 * intensity})`);
      ctx.fillStyle = grd;
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    }
  }

  // ---------- HUD ----------
  function renderHUD() {
    const p = game.player;
    // 顶部状态条
    ctx.fillStyle = PAL.uiBg;
    ctx.fillRect(0, 0, VIEW_W, 28);
    // [调试] 联机状态面板（默认开，按 F3 关）
    if (game.netMode && game.netMode !== 'single' && party.debugHud !== false) {
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillRect(0, 28, 360, 50);
      ctx.fillStyle = '#80d0ff';
      ctx.font = '9px Consolas, monospace';
      if (game.netMode === 'host') {
        ctx.fillText('HOST myId=' + party.myClientId + ' rp=[' + (game.remotePlayers||[]).map(r=>r.id).join(',') + '] inEvts=' + (party._inputEvents||0), 4, 40);
        const cks = Object.keys(party.clientInputs||{});
        let line2 = 'clientInputs=[' + cks.join(',') + ']';
        for (const id of cks) {
          const ci = party.clientInputs[id];
          const rp = (game.remotePlayers||[]).find(r=>r.id===Number(id));
          line2 += ' | #' + id + ' mv=(' + (ci?ci.mx:0) + ',' + (ci?ci.my:0) + ') pos=(' + (rp?Math.round(rp.x):'?') + ',' + (rp?Math.round(rp.y):'?') + ')';
        }
        ctx.fillText(line2, 4, 52);
        ctx.fillText('local pos=(' + Math.round(game.player.x) + ',' + Math.round(game.player.y) + ') scene=' + sceneKeyOf(game.player), 4, 64);
      } else {
        ctx.fillText('CLIENT myId=' + party.myClientId + ' snaps=' + (party._snapCount||0) + ' sent=' + (party._sentInputs||0) + ' sentAcc=' + Math.round(party.inputSendAcc), 4, 40);
        const lastSent = party._lastSentMv || {mx:0, my:0};
        ctx.fillText('lastSent mv=(' + lastSent.mx + ',' + lastSent.my + ') myPos=(' + Math.round(game.player.x) + ',' + Math.round(game.player.y) + ')', 4, 52);
        ctx.fillText('myScene=' + sceneKeyOf(game.player) + ' rp=[' + (game.remotePlayers||[]).map(r=>r.id).join(',') + ']', 4, 64);
      }
    }
    // HP
    ctx.fillStyle = '#000';
    ctx.fillRect(8, 8, 120, 12);
    ctx.fillStyle = PAL.danger;
    const hpW = Math.ceil(120 * p.hp / p.maxHp);
    ctx.fillRect(8, 8, hpW, 12);
    ctx.fillStyle = PAL.ui;
    ctx.font = '10px Consolas, monospace';
    ctx.textBaseline = 'middle';
    ctx.fillText('HP ' + Math.ceil(p.hp) + '/' + p.maxHp, 12, 14);

    // 名字 / 场景
    ctx.fillStyle = PAL.ui;
    ctx.fillText(p.name, 140, 14);
    ctx.fillStyle = PAL.uiDim;
    const sceneName = game.scene === 'city' ? '城市街道'
                    : (game.curBuilding.isHome ? '安全屋' :
                       game.curBuilding.kind === 'zombie' ? '僵尸楼' :
                       game.curBuilding.kind === 'fog' ? '雾巢' : '未知楼')
                      + ' F' + (game.curFloor+1);
    ctx.fillText(sceneName, 240, 14);

    // 击杀
    ctx.fillStyle = PAL.uiDim;
    ctx.fillText('击杀 ' + (game.stats.kills || 0), 360, 14);

    // 子弹（醒目显示，因为它是远程武器资源）
    const ammo = game.player.ammo || 0;
    ctx.fillStyle = ammo > 0 ? '#ffe070' : PAL.uiDim;
    ctx.font = 'bold 11px Consolas, monospace';
    ctx.fillText(devMode ? '子弹 ∞  [K 开枪]' : ('子弹 x' + ammo + '  [K 开枪]'), 440, 14);

    // 开发者模式标识（不显示按键）
    if (devMode) {
      ctx.fillStyle = '#ff6060';
      ctx.font = 'bold 10px Consolas, monospace';
      ctx.fillText('[ 开发者模式 ]', 560, 14);
    }

    // 物品栏（底部）
    const invY = VIEW_H - 28;
    ctx.fillStyle = PAL.uiBg;
    ctx.fillRect(0, invY, VIEW_W, 28);
    let xi = 8;
    const order = ['medkit','bandage','canned','water','ammo'];
    for (let i = 0; i < order.length; i++) {
      const t = order[i];
      // 子弹是直接资源，从 p.ammo 读取；其它从 inv 读取
      const n = (t === 'ammo') ? (p.ammo || 0) : (p.inv[t] || 0);
      const def = ITEMS[t];
      ctx.fillStyle = '#1a1a24';
      ctx.fillRect(xi, invY + 4, 24, 20);
      ctx.fillStyle = (t === 'ammo' && (n > 0 || devMode)) ? '#ffe070' : def.color;
      ctx.fillRect(xi + 2, invY + 6, 8, 8);
      ctx.fillStyle = PAL.ui;
      ctx.font = '8px Consolas, monospace';
      ctx.fillText(def.name, xi + 12, invY + 12);
      ctx.fillStyle = PAL.ui;
      ctx.font = '10px Consolas, monospace';
      ctx.fillText(devMode ? '∞' : ('x' + n), xi + 2, invY + 20);
      // 快捷键（子弹格显示 K，其它显示数字）
      ctx.fillStyle = PAL.uiDim;
      ctx.font = '8px Consolas, monospace';
      ctx.fillText((t === 'ammo') ? 'K' : ((i+1) + ''), xi + 20, invY + 22);
      xi += 30;
    }
    // 提示
    ctx.fillStyle = PAL.uiDim;
    ctx.font = '9px Consolas, monospace';
    const coop = game.netMode && game.netMode !== 'single';
    if (coop) {
      const line = game.netMode === 'host' ? '主机：WASD移动 鼠标瞄准 空格/J挥拳 K开枪 E进出建筑  ESC暂停'
                                          : '客户端：WASD移动 鼠标瞄准 空格/J挥拳 K开枪 E进出建筑  ESC暂停  (各自独立场景)';
      ctx.fillText(line, 8, invY - 6);
      // 队伍 HP（右上）—— 含各自场景标签
      const sceneTag = (pl) => pl.scene === 'city' ? '城' : ('F' + ((pl.curFloor||0)+1));
      let tx = VIEW_W - 8;
      ctx.textAlign = 'right';
      const team = [game.player].concat(game.remotePlayers || []);
      for (let i = team.length - 1; i >= 0; i--) {
        const mp = team[i];
        const nm = (mp.name || '?').slice(0, 6);
        const hpPct = Math.max(0, Math.min(1, (mp.hp||0)/(mp.maxHp||100)));
        ctx.fillStyle = mp === game.player ? '#ffe070' : PAL.ui;
        ctx.font = '9px Microsoft YaHei, Consolas, monospace';
        const label = nm + '[' + sceneTag(mp) + '] ' + Math.ceil(mp.hp||0);
        ctx.fillText(label, tx, 14);
        tx -= ctx.measureText(label).width + 14;
        ctx.fillStyle = '#400';
        ctx.fillRect(tx, 8, 30, 12);
        ctx.fillStyle = hpPct > 0.5 ? '#40c060' : hpPct > 0.2 ? '#e0c040' : '#c04040';
        ctx.fillRect(tx, 8, Math.ceil(30 * hpPct), 12);
        tx -= 36;
      }
      ctx.textAlign = 'left';
    } else {
      ctx.fillText('WASD移动  鼠标瞄准  空格/J挥拳  K开枪  E互动  1-4用物品  R保存  ESC暂停', 8, invY - 6);
    }

    // 鼠标准星
    if (state === 'PLAYING') {
      const mx = Math.round(mousePos.x), my = Math.round(mousePos.y);
      ctx.fillStyle = 'rgba(255,224,112,0.85)';
      ctx.fillRect(mx - 5, my, 3, 1);
      ctx.fillRect(mx + 3, my, 3, 1);
      ctx.fillRect(mx, my - 5, 1, 3);
      ctx.fillRect(mx, my + 3, 1, 3);
      ctx.fillStyle = 'rgba(255,224,112,0.5)';
      ctx.fillRect(mx, my, 1, 1);
    }
  }

  function renderToast() {
    if (!toast) return;
    const now = performance.now();
    if (now > toast.until) { toast = null; return; }
    ctx.fillStyle = PAL.uiBg;
    const w = ctx.measureText(toast.text).width + 16;
    ctx.font = '12px Microsoft YaHei, Consolas, monospace';
    const tw = ctx.measureText(toast.text).width + 16;
    ctx.fillRect(VIEW_W/2 - tw/2, 40, tw, 22);
    ctx.fillStyle = PAL.ui;
    ctx.textBaseline = 'middle';
    ctx.fillText(toast.text, VIEW_W/2 - tw/2 + 8, 51);
  }

  function toastMsg(text, ms) {
    toast = { text, until: performance.now() + ms };
  }

  // ---------- 开发者模式 ----------
  function toggleDevMode() {
    devMode = !devMode;
    if (devMode) {
      // 开启：补满血量，物品视为无限（不实际改 inv，使用时不消耗）
      game.player.hp = game.player.maxHp;
      toastMsg('开发者模式已开启', 1800);
    } else {
      // 关闭：物品清零（包括子弹），血量保留但不超过上限
      game.player.inv = {};
      game.player.ammo = 0;
      if (game.player.hp > game.player.maxHp) game.player.hp = game.player.maxHp;
      toastMsg('开发者模式已关闭，物品已清零', 1800);
    }
  }

  // ---------- 菜单 ----------
  const menuItems = [
    { label: '单人游戏', action: async () => { await refreshSaves(); state = 'SAVES'; saveCursor = -1; } },
    { label: '加入派对', action: () => { attachPartyEvents(); refreshDiscover(); state = 'PARTY'; } }
  ];

  function renderMenu() {
    // 标题背景：像素城市轮廓
    ctx.fillStyle = '#0a0a14';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    // 远景楼群剪影
    const t = performance.now() / 1000;
    for (let i = 0; i < 18; i++) {
      const bw = 30 + (i*37) % 30;
      const bh = 80 + (i*53) % 180;
      const bx = i * 36 - 10;
      const by = VIEW_H - bh - 60;
      ctx.fillStyle = i % 2 === 0 ? '#15152a' : '#101020';
      ctx.fillRect(bx, by, bw, bh);
      // 窗户
      ctx.fillStyle = ((i*7 + Math.floor(t)) % 11 === 0) ? '#7a8a4a' : '#1a2233';
      for (let wy = 0; wy < Math.floor(bh/14); wy++) {
        for (let wx = 0; wx < Math.floor(bw/10); wx++) {
          if ((wx + wy + i) % 3 !== 0)
            ctx.fillRect(bx + 3 + wx*9, by + 4 + wy*12, 4, 6);
        }
      }
    }
    // 月亮
    ctx.fillStyle = '#e0e0c0';
    ctx.beginPath(); ctx.arc(VIEW_W - 80, 70, 24, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = '#0a0a14';
    ctx.beginPath(); ctx.arc(VIEW_W - 70, 64, 22, 0, Math.PI*2); ctx.fill();

    // 标题
    ctx.fillStyle = PAL.ui;
    ctx.font = 'bold 32px Microsoft YaHei, Consolas, monospace';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('像素城市求生', VIEW_W/2 - 100, 120);
    ctx.font = '12px Consolas, monospace';
    ctx.fillStyle = PAL.uiDim;
    ctx.fillText('PIXEL  CITY  SURVIVAL', VIEW_W/2 - 70, 140);

    // 菜单项
    ctx.font = '16px Microsoft YaHei, Consolas, monospace';
    const menuStartY = 230;
    const menuGap = 34;
    for (let i = 0; i < menuItems.length; i++) {
      const sel = i === menuSel;
      ctx.fillStyle = sel ? '#ffe070' : PAL.ui;
      const y = menuStartY + i * menuGap;
      ctx.fillText((sel ? '▶ ' : '  ') + menuItems[i].label, VIEW_W/2 - 80, y);
    }
    ctx.fillStyle = PAL.uiDim;
    ctx.font = '10px Consolas, monospace';
    ctx.fillText('↑↓ 选择   Enter 确定   （或鼠标点击）', VIEW_W/2 - 90, VIEW_H - 30);
  }

  function menuInput() {
    if (keyPressed['ArrowUp'] || keyPressed['KeyW']) menuSel = (menuSel - 1 + menuItems.length) % menuItems.length;
    if (keyPressed['ArrowDown'] || keyPressed['KeyS']) menuSel = (menuSel + 1) % menuItems.length;
    if (keyPressed['Enter'] || keyPressed['Space']) menuItems[menuSel].action();
  }

  // ---------- 派对界面几何 ----------
  const PARTY_BTN_W = 200, PARTY_BTN_H = 40;
  const PARTY_CREATE = { x: VIEW_W/2 - PARTY_BTN_W - 16, y: 410, w: PARTY_BTN_W, h: PARTY_BTN_H, label: '创建派对' };
  const PARTY_JOIN   = { x: VIEW_W/2 + 16, y: 410, w: PARTY_BTN_W, h: PARTY_BTN_H, label: '加入派对' };
  const PARTY_BACK   = { x: VIEW_W/2 - 60, y: 470, w: 120, h: 28, label: '返回主菜单' };
  const LOBBY_START  = { x: VIEW_W/2 - 90, y: 420, w: 180, h: 40, label: '开始游戏' };
  const LOBBY_LEAVE  = { x: VIEW_W/2 - 70, y: 478, w: 140, h: 28, label: '离开派对' };

  function hitBtn(b, x, y) { return x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h; }

  function renderParty() {
    ctx.fillStyle = '#0a0a14';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    ctx.fillStyle = PAL.ui;
    ctx.font = 'bold 22px Microsoft YaHei, Consolas, monospace';
    ctx.fillText('派对', 20, 40);
    ctx.fillStyle = PAL.uiDim;
    ctx.font = '11px Consolas, monospace';
    ctx.fillText('局域网朋友：让对方点"创建派对"，你点列表或输入派对码', 20, 58);
    ctx.fillText('互联网朋友：让对方点"创建派对"，把"联机地址"发你，你输入 地址:端口', 20, 72);

    // 附近的派对
    ctx.fillStyle = PAL.ui;
    ctx.font = 'bold 14px Microsoft YaHei, Consolas, monospace';
    ctx.fillText('附近的派对（局域网）', 20, 100);
    if (!party.discoverList || party.discoverList.length === 0) {
      ctx.fillStyle = PAL.uiDim;
      ctx.font = '12px Microsoft YaHei, Consolas, monospace';
      ctx.fillText('（暂未发现附近派对…让对方先创建，或在搜索中）', 20, 124);
    } else {
      ctx.font = '12px Microsoft YaHei, Consolas, monospace';
      for (let i = 0; i < party.discoverList.length; i++) {
        const p = party.discoverList[i];
        const y = 116 + i * 30;
        ctx.fillStyle = 'rgba(255,224,112,0.08)';
        ctx.fillRect(20, y - 14, VIEW_W - 40, 26);
        ctx.strokeStyle = '#3a3a52'; ctx.lineWidth = 1;
        ctx.strokeRect(20, y - 14, VIEW_W - 40, 26);
        ctx.fillStyle = '#ffe070';
        ctx.font = 'bold 13px Consolas, monospace';
        ctx.fillText(p.code, 32, y);
        ctx.fillStyle = PAL.ui;
        ctx.font = '12px Microsoft YaHei, Consolas, monospace';
        ctx.fillText('主机：' + (p.hostName || p.name || '?'), 110, y);
        ctx.fillStyle = PAL.uiDim;
        ctx.fillText('玩家 ' + (p.players || 1) + ' 人', 300, y);
        ctx.fillText((p.ip || '') + ':' + (p.port || ''), 380, y);
        ctx.fillStyle = '#80d080';
        ctx.font = '11px Consolas, monospace';
        ctx.fillText('点击加入 ▶', VIEW_W - 92, y);
      }
    }

    // 两个按钮
    drawBigButton(PARTY_CREATE, false);
    drawBigButton(PARTY_JOIN, false);
    drawSmallButton(PARTY_BACK, false);

    // 公网IP提示
    ctx.fillStyle = PAL.uiDim;
    ctx.font = '10px Consolas, monospace';
    ctx.fillText('提示：互联网联机需主机路由器支持 UPnP 或手动端口转发。', 20, VIEW_H - 16);
  }

  function renderLobby() {
    ctx.fillStyle = '#0a0a14';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    const isHost = party.role === 'host';
    ctx.fillStyle = PAL.ui;
    ctx.font = 'bold 22px Microsoft YaHei, Consolas, monospace';
    ctx.fillText(isHost ? '派对大厅（你是主机）' : '派对大厅（等待主机开始）', 20, 40);

    if (isHost) {
      // 显示派对码 + 地址
      ctx.fillStyle = '#ffe070';
      ctx.font = 'bold 14px Consolas, monospace';
      ctx.fillText('派对码（局域网）：' + (party.code || '?'), 20, 76);
      ctx.fillStyle = PAL.ui;
      ctx.font = '13px Consolas, monospace';
      let addrLine = '联机地址（互联网）：' + (party.addr || '?');
      const si = party.stateInfo;
      if (si && si.publicIp) addrLine = '联机地址（互联网）：' + si.publicIp + ':' + (si.port || (party.addr||'').split(':')[1]);
      ctx.fillText(addrLine, 20, 96);
      ctx.fillStyle = PAL.uiDim;
      ctx.font = '11px Microsoft YaHei, Consolas, monospace';
      let upnpLine = 'UPnP 端口转发：';
      if (si && si.upnpOk) upnpLine += '已自动开启 ✓（朋友可直接用上面的地址）';
      else if (si && si.publicIp) upnpLine += '未自动开启。若朋友连不上，请在路由器把端口 ' + (si.port) + ' 转发到本机';
      else upnpLine += '检测中…';
      ctx.fillText(upnpLine, 20, 114);
      // 重新拉取状态（公网IP异步）
      if (!si || !si.publicIp) refreshPartyState();
    } else {
      ctx.fillStyle = PAL.uiDim;
      ctx.font = '12px Microsoft YaHei, Consolas, monospace';
      ctx.fillText('已连接到主机：' + (party.hostName || '?'), 20, 76);
    }

    // 玩家列表
    ctx.fillStyle = PAL.ui;
    ctx.font = 'bold 14px Microsoft YaHei, Consolas, monospace';
    ctx.fillText('玩家列表', 20, 150);
    ctx.font = '13px Microsoft YaHei, Consolas, monospace';
    const players = party.lobbyPlayers || [];
    for (let i = 0; i < players.length; i++) {
      const pl = players[i];
      const y = 174 + i * 26;
      ctx.fillStyle = pl.isHost ? '#ffe070' : PAL.ui;
      ctx.fillText((pl.isHost ? '★ ' : '• ') + (pl.name || '?') + (pl.isHost ? '  (主机)' : ''), 32, y);
    }
    if (players.length === 0) {
      ctx.fillStyle = PAL.uiDim;
      ctx.fillText('（暂无玩家）', 32, 174);
    }

    if (isHost) {
      drawBigButton(LOBBY_START, false);
      drawSmallButton(LOBBY_LEAVE, false);
    } else {
      drawSmallButton(LOBBY_LEAVE, false);
      ctx.fillStyle = PAL.uiDim;
      ctx.font = '11px Microsoft YaHei, Consolas, monospace';
      ctx.fillText('等待主机点击"开始游戏"…', VIEW_W/2 - 80, 430);
    }
  }

  function drawBigButton(b, hover) {
    ctx.fillStyle = hover ? '#2a6a8a' : '#1a3a5a';
    ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.strokeStyle = hover ? '#5aaaca' : '#3a5a7a'; ctx.lineWidth = 2;
    ctx.strokeRect(b.x, b.y, b.w, b.h);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 16px Microsoft YaHei, Consolas, monospace';
    ctx.textBaseline = 'middle';
    ctx.fillText(b.label, b.x + b.w/2 - ctx.measureText(b.label).width/2, b.y + b.h/2);
    ctx.textBaseline = 'alphabetic';
  }
  function drawSmallButton(b, hover) {
    ctx.fillStyle = hover ? '#3a3a52' : '#222238';
    ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.strokeStyle = hover ? '#6a6a82' : '#3a3a4e';
    ctx.lineWidth = 1;
    ctx.strokeRect(b.x, b.y, b.w, b.h);
    ctx.fillStyle = PAL.ui;
    ctx.font = '12px Microsoft YaHei, Consolas, monospace';
    ctx.textBaseline = 'middle';
    ctx.fillText(b.label, b.x + b.w/2 - ctx.measureText(b.label).width/2, b.y + b.h/2);
    ctx.textBaseline = 'alphabetic';
  }

  function partyInput() {
    if (keyPressed['Escape']) { state = 'MENU'; }
    // 定期刷新附近派对
    party.discoverTimer = (party.discoverTimer || 0) + 1;
    if (party.discoverTimer > 30) { party.discoverTimer = 0; refreshDiscover(); }
  }

  function lobbyInput() {
    if (keyPressed['Escape']) { leaveParty(); state = 'MENU'; }
  }

  function promptNewSave() {
    // 已被命名对话框流程取代
    openNameDialog();
  }

  // ---------- 存档列表 ----------
  // 存档行几何
  const SAVE_ROW_X = 20, SAVE_ROW_W = VIEW_W - 40, SAVE_ROW_H = 50, SAVE_ROW_GAP = 56, SAVE_ROW_Y0 = 80;
  // 底部按钮
  const SAVE_BTN_Y = 444, SAVE_BTN_H = 30, SAVE_BTN_W = 150;
  const SAVE_BTN_ENTER = { x: VIEW_W/2 - SAVE_BTN_W - 10, y: SAVE_BTN_Y, w: SAVE_BTN_W, h: SAVE_BTN_H, label: '进入存档' };
  const SAVE_BTN_NEW   = { x: VIEW_W/2 + 10, y: SAVE_BTN_Y, w: SAVE_BTN_W, h: SAVE_BTN_H, label: '新建存档' };
  const SAVE_BTN_BACK  = { x: VIEW_W/2 - 60, y: SAVE_BTN_Y + SAVE_BTN_H + 6, w: 120, h: 22, label: '返回主菜单' };
  function saveRowAt(x, y) {
    if (x < SAVE_ROW_X || x > SAVE_ROW_X + SAVE_ROW_W) return -1;
    const rel = y - (SAVE_ROW_Y0 - 14);
    if (rel < 0) return -1;
    const i = Math.floor(rel / SAVE_ROW_GAP);
    if (i < 0 || i >= savesList.length) return -1;
    // 行内多余空隙不算
    if (rel - i * SAVE_ROW_GAP > SAVE_ROW_H) return -1;
    return i;
  }

  function renderSaves() {
    ctx.fillStyle = '#0a0a14';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    ctx.fillStyle = PAL.ui;
    ctx.font = 'bold 20px Microsoft YaHei, Consolas, monospace';
    ctx.fillText('单人游戏', 20, 36);
    ctx.fillStyle = PAL.uiDim;
    ctx.font = '10px Consolas, monospace';
    ctx.fillText('点击存档以选中 · ↑↓ 选择 · Enter 进入 · Delete 删除 · ESC 返回', 20, 54);

    const hasSel = saveCursor >= 0 && saveCursor < savesList.length;

    if (savesList.length === 0) {
      ctx.fillStyle = PAL.uiDim;
      ctx.font = '14px Microsoft YaHei, Consolas, monospace';
      ctx.fillText('（还没有存档，点击下方「新建存档」开始）', VIEW_W/2 - 170, VIEW_H/2 - 40);
    } else {
      ctx.font = '12px Microsoft YaHei, Consolas, monospace';
      for (let i = 0; i < savesList.length; i++) {
        const s = savesList[i];
        const sel = i === saveCursor;
        const hov = i === saveHover;
        const y = SAVE_ROW_Y0 + i * SAVE_ROW_GAP;
        let bg = 'rgba(255,255,255,0.04)';
        if (hov) bg = 'rgba(255,224,112,0.10)';
        if (sel) bg = 'rgba(255,224,112,0.18)';
        ctx.fillStyle = bg;
        ctx.fillRect(SAVE_ROW_X, y - 14, SAVE_ROW_W, SAVE_ROW_H);
        ctx.strokeStyle = sel ? '#ffe070' : (hov ? '#6a6a52' : '#2a2a3e');
        ctx.lineWidth = sel ? 2 : 1;
        ctx.strokeRect(SAVE_ROW_X, y - 14, SAVE_ROW_W, SAVE_ROW_H);
        ctx.fillStyle = sel ? '#ffe070' : PAL.ui;
        ctx.font = 'bold 14px Microsoft YaHei, Consolas, monospace';
        ctx.fillText(s.name, 32, y);
        ctx.fillStyle = PAL.uiDim;
        ctx.font = '10px Consolas, monospace';
        const dt = new Date(s.updatedAt || s.createdAt);
        const dateStr = dt.toLocaleString('zh-CN');
        const mins = Math.floor((s.playtime || 0) / 60000);
        ctx.fillText('更新：' + dateStr + '   游玩：' + mins + '分', 32, y + 14);
        ctx.fillText('HP ' + (s.hp||0) + '/' + (s.maxHp||0) + '   击杀 ' + (s.kills||0) + '   场景 ' + (s.scene === 'city' ? '城市' : '楼内'), 32, y + 26);
      }
    }

    // 底部按钮
    drawSaveBtn(SAVE_BTN_ENTER, hasSel);
    drawSaveBtn(SAVE_BTN_NEW, true);
    drawSaveBtn(SAVE_BTN_BACK, true);
  }

  // 通用按钮绘制：enabled 控制亮/灰
  function drawSaveBtn(b, enabled) {
    const hov = hitBtn(b, mousePos.x, mousePos.y);
    ctx.fillStyle = enabled ? (hov ? 'rgba(255,224,112,0.22)' : 'rgba(255,224,112,0.10)') : 'rgba(255,255,255,0.04)';
    ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.strokeStyle = enabled ? (hov ? '#ffe070' : '#8a8a52') : '#3a3a4e';
    ctx.lineWidth = hov && enabled ? 2 : 1;
    ctx.strokeRect(b.x, b.y, b.w, b.h);
    ctx.fillStyle = enabled ? (hov ? '#ffe070' : PAL.ui) : PAL.uiDim;
    ctx.font = 'bold 13px Microsoft YaHei, Consolas, monospace';
    ctx.textBaseline = 'middle';
    ctx.fillText(b.label, b.x + 14, b.y + b.h/2 + 1);
    ctx.textBaseline = 'alphabetic';
  }

  function savesInput() {
    if (savesList.length === 0) {
      if (keyPressed['Escape']) state = 'MENU';
      return;
    }
    if (saveCursor >= savesList.length) saveCursor = savesList.length - 1;
    if (keyPressed['ArrowUp'] || keyPressed['KeyW']) saveCursor = saveCursor < 0 ? 0 : (saveCursor - 1 + savesList.length) % savesList.length;
    if (keyPressed['ArrowDown'] || keyPressed['KeyS']) saveCursor = saveCursor < 0 ? 0 : (saveCursor + 1) % savesList.length;
    if ((keyPressed['Enter'] || keyPressed['Space']) && saveCursor >= 0) loadGameById(savesList[saveCursor].id);
    if ((keyPressed['Delete'] || keyPressed['KeyX']) && saveCursor >= 0) {
      const s = savesList[saveCursor];
      window.api.confirm('确定删除存档「' + s.name + '」吗？').then(async (ok) => {
        if (ok) {
          await window.api.deleteSave(s.id);
          await refreshSaves();
          if (saveCursor >= savesList.length) saveCursor = Math.max(-1, savesList.length - 1);
        }
      });
    }
    if (keyPressed['Escape']) state = 'MENU';
  }

  // ---------- 暂停 ----------
  const PAUSE_RESUME = { x: VIEW_W/2 - 80, y: VIEW_H/2 + 14, w: 160, h: 38, label: '返回游戏' };
  function renderPause() {
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    ctx.fillStyle = PAL.ui;
    ctx.font = 'bold 24px Microsoft YaHei, Consolas, monospace';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('暂停', VIEW_W/2 - 30, VIEW_H/2 - 30);
    // 返回游戏按钮
    drawBigButton(PAUSE_RESUME, hitBtn(PAUSE_RESUME, mousePos.x, mousePos.y));
    ctx.font = '12px Consolas, monospace';
    ctx.fillStyle = PAL.uiDim;
    const coop = game && game.netMode && game.netMode !== 'single';
    if (coop) ctx.fillText('M 离开派对并返回主菜单', VIEW_W/2 - 110, VIEW_H/2 + 70);
    else ctx.fillText('R 保存    M 返回主菜单', VIEW_W/2 - 90, VIEW_H/2 + 70);
  }

  function pauseInput() {
    const coop = game && game.netMode && game.netMode !== 'single';
    if (keyPressed['Escape']) state = 'PLAYING';
    if (keyPressed['KeyR'] && !coop) { saveGame(); state = 'PLAYING'; }
    if (keyPressed['KeyM']) {
      if (!coop && game) saveGame();
      if (coop) leaveParty();
      state = 'MENU';
      game = null;
    }
  }

  // ---------- 死亡 ----------
  function renderDead() {
    ctx.fillStyle = 'rgba(60,0,0,0.65)';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    ctx.fillStyle = PAL.danger;
    ctx.font = 'bold 32px Microsoft YaHei, Consolas, monospace';
    ctx.fillText('你死了', VIEW_W/2 - 50, VIEW_H/2 - 20);
    ctx.fillStyle = PAL.ui;
    ctx.font = '12px Consolas, monospace';
    ctx.fillText('击杀 ' + (game.stats.kills||0) + '   拾取 ' + (game.stats.looted||0), VIEW_W/2 - 70, VIEW_H/2 + 10);
    ctx.fillStyle = PAL.uiDim;
    ctx.fillText('Enter 返回主菜单', VIEW_W/2 - 60, VIEW_H/2 + 40);
  }

  function deadInput() {
    if (keyPressed['Enter'] || keyPressed['Escape']) {
      const coop = game && game.netMode && game.netMode !== 'single';
      if (!coop && game) saveGame();
      if (coop) leaveParty();
      state = 'MENU';
      game = null;
    }
  }

  // ---------- 鼠标点击 ----------
  function handleClick(x, y) {
    if (state === 'MENU') {
      // 菜单项区域
      const menuStartY = 230, menuGap = 34;
      for (let i = 0; i < menuItems.length; i++) {
        const rowY = menuStartY - 14 + i * menuGap;
        if (y >= rowY && y < rowY + 30 && x > VIEW_W/2 - 120 && x < VIEW_W/2 + 120) {
          menuSel = i;
          menuItems[i].action();
          return;
        }
      }
    } else if (state === 'SAVES') {
      const i = saveRowAt(x, y);
      if (i >= 0) { saveCursor = i; return; } // 仅选中，不立即载入
      const hasSel = saveCursor >= 0 && saveCursor < savesList.length;
      if (hasSel && hitBtn(SAVE_BTN_ENTER, x, y)) { loadGameById(savesList[saveCursor].id); return; }
      if (hitBtn(SAVE_BTN_NEW, x, y)) { openNameDialog(); return; }
      if (hitBtn(SAVE_BTN_BACK, x, y)) { state = 'MENU'; return; }
    } else if (state === 'PARTY') {
      // 附近派对点击
      for (let i = 0; i < (party.discoverList||[]).length; i++) {
        const ry = 116 + i * 30 - 14;
        if (y >= ry && y < ry + 26 && x > 20 && x < VIEW_W - 20) {
          const p = party.discoverList[i];
          attachPartyEvents();
          window.api.partyJoin({ addr: (p.ip) + ':' + (p.port), name: party.myName || ('玩家'+randi(100,999)) })
            .then((r) => {
              if (!r.ok) { toastMsg('加入失败：' + (r.error||''), 3000); return; }
              party.role = 'client';
              state = 'CLIENT_LOBBY';
              toastMsg('已连接，等待主机开始游戏', 2000);
            });
          return;
        }
      }
      if (hitBtn(PARTY_CREATE, x, y)) { attachPartyEvents(); openHostNameDialog(); return; }
      if (hitBtn(PARTY_JOIN, x, y)) { attachPartyEvents(); openJoinDialog(); return; }
      if (hitBtn(PARTY_BACK, x, y)) { state = 'MENU'; return; }
    } else if (state === 'HOST_LOBBY') {
      if (hitBtn(LOBBY_START, x, y)) { hostStartGame(); return; }
      if (hitBtn(LOBBY_LEAVE, x, y)) { leaveParty(); state = 'MENU'; return; }
    } else if (state === 'CLIENT_LOBBY') {
      if (hitBtn(LOBBY_LEAVE, x, y)) { leaveParty(); state = 'MENU'; return; }
    } else if (state === 'PAUSED') {
      if (hitBtn(PAUSE_RESUME, x, y)) { state = 'PLAYING'; return; }
    } else if (state === 'DEAD') {
      // 死亡：联机下先离开派对
      if (party.role) leaveParty();
      if (game) saveGame();
      state = 'MENU';
      game = null;
    }
  }

  // ====================================================================
  //  主循环
  // ====================================================================

  function loop(t) {
    const dt = Math.min(50, t - lastTime || 16);
    lastTime = t;

    if (state === 'MENU') menuInput();
    else if (state === 'SAVES') savesInput();
    else if (state === 'NAMING' || state === 'HOST_NAMING' || state === 'JOINING') { /* 输入由 HTML 对话框处理 */ }
    else if (state === 'PARTY') partyInput();
    else if (state === 'HOST_LOBBY' || state === 'CLIENT_LOBBY') lobbyInput();
    else if (state === 'PAUSED') pauseInput();
    else if (state === 'DEAD') deadInput();
    else if (state === 'PLAYING') {
      if (game && game.netMode === 'client') {
        clientTick(dt);   // 客户端：发输入，渲染靠快照
      } else {
        update(dt);
      }
    }

    render();
    keyPressed = {};   // 每帧清空单次按键，避免暂停/恢复时同一按键跨帧重复触发
    requestAnimationFrame(loop);
  }
  // 启动时订阅派对事件
  attachPartyEvents();
  // 订阅主进程的 F12 开发者模式切换
  if (window.api && window.api.onDevToggle) {
    window.api.onDevToggle(() => {
      if (state === 'PLAYING' && game && game.netMode === 'single') toggleDevMode();
    });
  }
  requestAnimationFrame(loop);

})();

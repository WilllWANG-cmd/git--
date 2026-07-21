const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  saveList: () => ipcRenderer.invoke('save:list'),
  loadSave: (id) => ipcRenderer.invoke('save:load', id),
  writeSave: (payload) => ipcRenderer.invoke('save:write', payload),
  deleteSave: (id) => ipcRenderer.invoke('save:delete', id),
  confirm: (message) => ipcRenderer.invoke('dialog:confirm', message),

  // 派对 / 联机
  partyHostStart: (args) => ipcRenderer.invoke('party:hostStart', args),
  partyJoin: (args) => ipcRenderer.invoke('party:join', args),
  partyLeave: () => ipcRenderer.invoke('party:leave'),
  partyState: () => ipcRenderer.invoke('party:state'),
  partyDiscover: () => ipcRenderer.invoke('party:discover'),
  partySend: (obj) => ipcRenderer.invoke('party:send', obj),
  partyHostBroadcast: (obj) => ipcRenderer.invoke('party:hostBroadcast', obj),
  partyHostSendTo: (clientId, obj) => ipcRenderer.invoke('party:hostSendTo', { clientId, obj }),
  partyHostSetSceneLabel: (label) => ipcRenderer.invoke('party:hostSetSceneLabel', label),
  onPartyEvent: (cb) => {
    const handler = (event, payload) => cb(payload);
    ipcRenderer.on('party:event', handler);
    return () => ipcRenderer.removeListener('party:event', handler);
  },

  // 开发者模式切换（由主进程在 F12 拦截后发送）
  onDevToggle: (cb) => {
    const handler = () => cb();
    ipcRenderer.on('dev:toggle', handler);
    return () => ipcRenderer.removeListener('dev:toggle', handler);
  }
});

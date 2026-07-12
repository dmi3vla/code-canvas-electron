const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  pickProject: () => ipcRenderer.invoke('dialog:pickProject'),
  saveCanvas: (canvasData) => ipcRenderer.invoke('dialog:saveCanvas', canvasData),
  openCanvas: () => ipcRenderer.invoke('dialog:openCanvas'),
  readTextFile: (targetPath) => ipcRenderer.invoke('file:readText', targetPath),
  getVersion: () => ipcRenderer.invoke('app:getVersion'),
  onMenuAction: (callback) => {
    const listener = (_, payload) => callback(payload);
    ipcRenderer.on('menu-action', listener);
    return () => ipcRenderer.removeListener('menu-action', listener);
  }
});

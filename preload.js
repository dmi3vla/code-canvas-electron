const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Project (cache-first semantic open)
  openProject: () => ipcRenderer.invoke('project:open'),
  getCurrentProject: () => ipcRenderer.invoke('project:getCurrent'),
  writeProjectCache: (payload) => ipcRenderer.invoke('project:writeCache', payload),
  deleteProjectCache: () => ipcRenderer.invoke('project:deleteCache'),

  // Apply codemap → canvas + write root cache (Phase 1; agent in Phase 2)
  applyCodemapAndCache: (payload) => ipcRenderer.invoke('codemap:applyAndCache', payload),

  // Legacy structural import
  pickProject: () => ipcRenderer.invoke('dialog:pickProject'),

  // Canvas dialogs (export / open any file)
  saveCanvas: (canvasData) => ipcRenderer.invoke('dialog:saveCanvas', canvasData),
  openCanvas: () => ipcRenderer.invoke('dialog:openCanvas'),

  readTextFile: (targetPath) => ipcRenderer.invoke('file:readText', targetPath),
  getVersion: () => ipcRenderer.invoke('app:getVersion'),

  // Windsurf-compatible settings (~/.cometix/codemap/settings.json)
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (keyOrObject, value) => ipcRenderer.invoke('settings:set', keyOrObject, value),
  getSettingsPath: () => ipcRenderer.invoke('settings:getPath'),

  onMenuAction: (callback) => {
    const listener = (_, payload) => callback(payload);
    ipcRenderer.on('menu-action', listener);
    return () => ipcRenderer.removeListener('menu-action', listener);
  }
});

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Project (cache-first semantic open)
  openProject: () => ipcRenderer.invoke('project:open'),
  getCurrentProject: () => ipcRenderer.invoke('project:getCurrent'),
  writeProjectCache: (payload) => ipcRenderer.invoke('project:writeCache', payload),
  deleteProjectCache: () => ipcRenderer.invoke('project:deleteCache'),

  // Apply codemap → canvas + write root cache
  applyCodemapAndCache: (payload) => ipcRenderer.invoke('codemap:applyAndCache', payload),

  // Full GPT generation (stages 1–6) + auto-save to project root
  generateCodemap: (payload) => ipcRenderer.invoke('codemap:generate', payload),
  retryTrace: (payload) => ipcRenderer.invoke('codemap:retryTrace', payload),
  retryMermaid: (payload) => ipcRenderer.invoke('codemap:retryMermaid', payload),
  generateSuggestions: (payload) => ipcRenderer.invoke('suggestions:generate', payload),
  onCodemapProgress: (callback) => {
    const listener = (_, payload) => callback(payload);
    ipcRenderer.on('codemap:progress', listener);
    return () => ipcRenderer.removeListener('codemap:progress', listener);
  },

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
  },

  // Chat
  sendChatMessage: (message, context) => ipcRenderer.invoke('agent:chatMessage', { message, context }),
  onChatChunk: (callback) => {
    const listener = (_, chunk) => callback(chunk);
    ipcRenderer.on('agent:chatChunk', listener);
    return () => ipcRenderer.removeListener('agent:chatChunk', listener);
  }
});

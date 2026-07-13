/**
 * Electron preload script — exposes IPC bridge to renderer (webview)
 */

import { contextBridge, ipcRenderer } from 'electron';

export interface ElectronAPI {
  settings: {
    get: () => Promise<any>;
    set: (key: string, value: string) => Promise<any>;
    getPath: () => Promise<string>;
  };
  project: {
    open: () => Promise<{ path: string; name: string } | null>;
    getCurrent: () => Promise<{ path: string; name: string } | null>;
  };
  file: {
    open: (filePath: string, line: number) => Promise<boolean>;
    showInFolder: (filePath: string) => Promise<void>;
  };
  shell: {
    openExternal: (url: string) => Promise<void>;
  };
  /** Send message to main process (agent) */
  sendToAgent: (message: any) => void;
  /** Listen for messages from extension backend */
  onExtensionMessage: (callback: (message: any) => void) => () => void;
}

const api: ElectronAPI = {
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (key, value) => ipcRenderer.invoke('settings:set', key, value),
    getPath: () => ipcRenderer.invoke('settings:getPath'),
  },
  project: {
    open: () => ipcRenderer.invoke('project:open'),
    getCurrent: () => ipcRenderer.invoke('project:getCurrent'),
  },
  file: {
    open: (filePath, line) => ipcRenderer.invoke('file:open', filePath, line),
    showInFolder: (filePath) => ipcRenderer.invoke('file:showInFolder', filePath),
  },
  shell: {
    openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  },
  sendToAgent: (message) => ipcRenderer.send('agent:message', message),
  onExtensionMessage: (callback) => {
    const handler = (_event: any, message: any) => callback(message);
    ipcRenderer.on('extension:message', handler);
    return () => ipcRenderer.removeListener('extension:message', handler);
  },
};

contextBridge.exposeInMainWorld('codemap', api);

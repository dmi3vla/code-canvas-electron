import React, { createContext, useContext, useMemo } from 'react';
import type { VsCodeApi, WebviewToExtensionMessage, ElectronAPI } from './types';

/**
 * VS Code webview API can only be acquired once per webview.
 * We acquire it in one place (entry) and inject via React context.
 */

const VsCodeApiContext = createContext<VsCodeApi | null>(null);
const ElectronApiContext = createContext<ElectronAPI | null>(null);

function createFallbackApi(): VsCodeApi {
  return {
    postMessage: (msg: WebviewToExtensionMessage) => console.log('postMessage:', msg),
    getState: () => null,
    setState: () => {},
  };
}

/** Detect whether we're running inside Electron (standalone) or VS Code */
export function isElectronStandalone(): boolean {
  return !!(window as any).codemap;
}

export function getElectronApi(): ElectronAPI | null {
  return (window as any).codemap || null;
}

export function createVsCodeApi(): VsCodeApi {
  const w = window as any;
  if (typeof w.acquireVsCodeApi === 'function') {
    return w.acquireVsCodeApi();
  }
  // Electron standalone: use IPC bridge
  if (w.codemap) {
    return {
      postMessage: (msg: WebviewToExtensionMessage) => w.codemap.sendToAgent(msg),
      getState: () => null,
      setState: () => {},
    };
  }
  return createFallbackApi();
}

export function ExtensionBridgeProvider(props: { api: VsCodeApi; electronApi?: ElectronAPI | null; children: React.ReactNode }) {
  return (
    <VsCodeApiContext.Provider value={props.api}>
      <ElectronApiContext.Provider value={props.electronApi || null}>
        {props.children}
      </ElectronApiContext.Provider>
    </VsCodeApiContext.Provider>
  );
}

export function useVsCodeApi(): VsCodeApi {
  const api = useContext(VsCodeApiContext);
  if (!api) {
    throw new Error('useVsCodeApi must be used within <ExtensionBridgeProvider>');
  }
  return api;
}

export function useElectronApi(): ElectronAPI | null {
  return useContext(ElectronApiContext);
}

/**
 * Typed command helpers. Components call functions, not `api.postMessage({ command: ... })`.
 * This keeps VS Code messaging details in one place.
 */
export function useExtensionCommands() {
  const api = useVsCodeApi();
  const electronApi = useElectronApi();

  return useMemo(
    () => ({
      send: (message: WebviewToExtensionMessage) => api.postMessage(message),
      ready: () => api.postMessage({ command: 'ready' }),
      submit: (query: string, mode: 'fast' | 'smart') =>
        api.postMessage({ command: 'submit', query, mode }),
      openFile: (path: string, line: number) => {
        if (electronApi) {
          electronApi.file.open(path, line);
        } else {
          api.postMessage({ command: 'openFile', path, line });
        }
      },
      refreshHistory: () => api.postMessage({ command: 'refreshHistory' }),
      deleteHistory: (filename: string) => api.postMessage({ command: 'deleteHistory', filename }),
      loadHistory: (filename: string) => api.postMessage({ command: 'loadHistory', filename }),
      refreshSuggestions: () => api.postMessage({ command: 'refreshSuggestions' }),
      openJson: () => api.postMessage({ command: 'openJson' }),
      ensureMermaidDiagram: () => api.postMessage({ command: 'ensureMermaidDiagram' }),
      retryTrace: (traceId: string) => api.postMessage({ command: 'retryTrace', traceId }),
      retryAllTraces: () => api.postMessage({ command: 'retryAllTraces' }),
      regenerateMermaidDiagram: () => api.postMessage({ command: 'regenerateMermaidDiagram' }),
      // Electron-specific
      openProject: async () => {
        if (electronApi) return electronApi.project.open();
        return null;
      },
      getCurrentProject: async () => {
        if (electronApi) return electronApi.project.getCurrent();
        return null;
      },
      getSettings: async () => {
        if (electronApi) return electronApi.settings.get();
        return null;
      },
      setSetting: async (key: string, value: string) => {
        if (electronApi) return electronApi.settings.set(key, value);
        return null;
      },
      openSettingsFile: async () => {
        if (electronApi) {
          const p = await electronApi.settings.getPath();
          if (p) electronApi.file.showInFolder(p);
        }
      },
    }),
    [api, electronApi]
  );
}



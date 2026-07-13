/**
 * Electron main process for Codemap standalone app
 */

import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { initSettings, getSettings, setSetting, getSettingsFilePath } from './settings';
import { createPlatform, getPlatform } from './platform';

let mainWindow: BrowserWindow | null = null;
let currentProjectPath: string | null = null;
let appInitFn: ((send: (msg: any) => void) => void) | null = null;
let handleRendererMsgFn: ((msg: any) => void) | null = null;

const platform = createPlatform();

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'Codemap Explorer',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Load the webview HTML
  mainWindow.loadFile(path.join(__dirname, 'webview', 'index.html'));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Send message from backend to renderer
function sendToRenderer(msg: any) {
  mainWindow?.webContents.send('extension:message', msg);
}

// ─── IPC Handlers ─────────────────────────────────────────────

function setupIPC() {
  // Settings
  ipcMain.handle('settings:get', () => getSettings());
  ipcMain.handle('settings:set', (_event, key: string, value: string) => {
    setSetting(key, value);
    return getSettings();
  });
  ipcMain.handle('settings:getPath', () => getSettingsFilePath());

  // Open project folder
  ipcMain.handle('project:open', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openDirectory'],
      title: 'Open Project Folder',
    });
    if (!result.canceled && result.filePaths.length > 0) {
      currentProjectPath = result.filePaths[0];
      platform.setWorkspaceRoot(currentProjectPath);
      return { path: currentProjectPath, name: path.basename(currentProjectPath) };
    }
    return null;
  });

  ipcMain.handle('project:getCurrent', () => {
    if (!currentProjectPath) return null;
    return { path: currentProjectPath, name: path.basename(currentProjectPath) };
  });

  // File operations
  ipcMain.handle('file:open', async (_event, filePath: string, line: number) => {
    const fullPath = currentProjectPath
      ? path.join(currentProjectPath, filePath)
      : filePath;
    if (fs.existsSync(fullPath)) {
      await shell.openPath(fullPath);
      return true;
    }
    return false;
  });

  ipcMain.handle('file:showInFolder', async (_event, filePath: string) => {
    shell.showItemInFolder(filePath);
  });

  // Agent messages from webview → forward to appEntry
  ipcMain.on('agent:message', (_event, message: any) => {
    console.log('[main] ← webview:', message.command);
    if (handleRendererMsgFn) {
      handleRendererMsgFn(message);
    } else {
      console.error('[main] handleRendererMsgFn is null, dropping message:', message.command);
    }
  });

  // Open external URLs
  ipcMain.handle('shell:openExternal', async (_event, url: string) => {
    await shell.openExternal(url);
  });
}

// ─── App Lifecycle ────────────────────────────────────────────

app.whenReady().then(async () => {
  initSettings();
  setupIPC();
  createWindow();

  console.log('[main] Loading appEntry...');
  
  // Load the app entry (backend logic) via runtime require
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const appEntry = require('./appEntry.js');
  console.log('[main] appEntry loaded, calling initApp...');
  
  appEntry.initApp(sendToRenderer);
  appInitFn = appEntry.initApp;
  handleRendererMsgFn = appEntry.handleRendererMessage;
  
  console.log('[main] Backend ready, handleRendererMsgFn set:', typeof handleRendererMsgFn);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

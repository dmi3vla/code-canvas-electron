/**
 * Electron platform bridge — replaces vscode API for standalone backend.
 * 
 * This provides all the functionality that the extension code expects from vscode:
 * - Configuration (settings)
 * - File system access (workspace root)
 * - UI (notifications, input dialogs via webview)
 * - Commands (IPC with webview)
 * - Output channel (logger)
 */

import { EventEmitter } from 'events';
import { getSetting, onSettingsChange, type CodemapSettings } from './settings';
import * as path from 'path';
import * as fs from 'fs';

export class ElectronPlatform extends EventEmitter {
  private workspaceRoot: string = process.cwd();
  private outputChannel: ElectronOutputChannel;

  constructor() {
    super();
    this.outputChannel = new ElectronOutputChannel();

    // Forward settings changes
    onSettingsChange((settings) => {
      this.emit('configChanged', settings);
    });
  }

  // ─── Workspace ─────────────────────────────────────────────

  setWorkspaceRoot(rootPath: string) {
    this.workspaceRoot = rootPath;
    this.emit('workspaceChanged', rootPath);
  }

  getWorkspaceRoot(): string {
    return this.workspaceRoot;
  }

  getWorkspaceFolders(): Array<{ uri: { fsPath: string }; name: string; index: number }> | undefined {
    return [{
      uri: { fsPath: this.workspaceRoot },
      name: path.basename(this.workspaceRoot),
      index: 0,
    }];
  }

  // ─── Configuration ─────────────────────────────────────────

  getConfiguration(section: string) {
    const self = this;
    return {
      get<T>(key: string, defaultValue?: T): T {
        // Map codemap.* keys to settings by calling getSetting()
        const settingKey = key as keyof CodemapSettings;
        const value = getSetting(settingKey);
        return (value !== undefined && value !== '') ? value as unknown as T : defaultValue as T;
      },
      async update(key: string, value: any, target?: any): Promise<void> {
        // This will be handled by the webview settings UI and forwarded
        self.emit('configUpdate', { key: `${section}.${key}`, value });
      },
    };
  }

  // ─── Window / UI ───────────────────────────────────────────

  showInformationMessage(message: string, ...items: string[]): Promise<string | undefined> {
    console.log('[NOTIFY] INFO:', message, items);
    return Promise.resolve(undefined);
  }

  showWarningMessage(message: string, ...items: string[]): Promise<string | undefined> {
    console.warn('[NOTIFY] WARN:', message, items);
    return Promise.resolve(undefined);
  }

  showErrorMessage(message: string, ...items: string[]): Promise<string | undefined> {
    console.error('[NOTIFY] ERROR:', message, items);
    return Promise.resolve(undefined);
  }

  // ─── Commands ──────────────────────────────────────────────

  registerCommand(commandId: string, handler: (...args: any[]) => any) {
    // Store command handlers for IPC
    this.emit('commandRegistered', { commandId, handler });
    return { dispose: () => {} };
  }

  executeCommand(commandId: string, ...args: any[]) {
    this.emit('commandExecute', { commandId, args });
    return Promise.resolve();
  }

  // ─── Output Channel ────────────────────────────────────────

  createOutputChannel(name: string): ElectronOutputChannel {
    return this.outputChannel;
  }

  getOutputChannel(): ElectronOutputChannel {
    return this.outputChannel;
  }

  // ─── URI ───────────────────────────────────────────────────

  static file(filePath: string) {
    return { fsPath: filePath, scheme: 'file', path: filePath };
  }

  // ─── Env ───────────────────────────────────────────────────

  env = {
    openExternal: async (uri: { fsPath?: string; toString?: () => string }) => {
      const { shell } = require('electron');
      const p = typeof uri.fsPath === 'string' ? uri.fsPath : String(uri);
      await shell.openPath(p);
      return true;
    },
  };

  // ─── Event forwarding ──────────────────────────────────────

  onDidChangeConfiguration(listener: (e: any) => void) {
    const handler = (settings: CodemapSettings) => {
      listener({ affectsConfiguration: (section: string) => section === 'codemap' });
    };
    onSettingsChange(handler);
    return { dispose: () => {} };
  }

  // ─── Webview message handling ──────────────────────────────

  handleWebviewMessage(message: any) {
    this.emit('webviewMessage', message);
  }
}

// ─── Output Channel ───────────────────────────────────────────

export class ElectronOutputChannel {
  private buffer: Array<{ timestamp: string; level: string; message: string }> = [];
  private listeners: Array<(entry: any) => void> = [];

  appendLine(value: string) {
    const entry = {
      timestamp: new Date().toISOString(),
      level: 'INFO',
      message: value,
    };
    this.buffer.push(entry);
    this.listeners.forEach(l => l(entry));
  }

  show() {
    // In standalone, log entries are sent to webview
  }

  dispose() {}

  getEntries() {
    return [...this.buffer];
  }

  onEntry(listener: (entry: any) => void) {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }
}

// ─── Singleton ────────────────────────────────────────────────

let platformInstance: ElectronPlatform | null = null;

export function createPlatform(): ElectronPlatform {
  if (!platformInstance) {
    platformInstance = new ElectronPlatform();
  }
  return platformInstance;
}

export function getPlatform(): ElectronPlatform {
  if (!platformInstance) {
    // Lazy init: create default platform (settings will be loaded later)
    platformInstance = new ElectronPlatform();
  }
  return platformInstance;
}

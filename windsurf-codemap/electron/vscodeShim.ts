/**
 * VS Code API shim for the standalone Electron backend.
 * 
 * This module replaces the 'vscode' import when building for standalone Electron.
 * It provides a minimal implementation of the VS Code API that the extension code uses.
 * 
 * Used via esbuild alias: 'vscode' → './electron/vscodeShim'
 */

import { getPlatform } from './platform';

const platform = getPlatform();

// ─── Namespace re-exports ────────────────────────────────────

export const workspace = {
  getConfiguration: (section: string) => platform.getConfiguration(section),
  get workspaceFolders() { return platform.getWorkspaceFolders(); },
  onDidChangeConfiguration: (listener: any) => platform.onDidChangeConfiguration(listener),
  onDidSaveTextDocument: (_listener: any) => ({ dispose: () => {} }),
  openTextDocument: async (uri: any) => {
    // In standalone, we can't open text documents in VS Code
    // Return a mock document
    const fs = require('fs');
    const path = require('path');
    const filePath = uri?.fsPath || String(uri);
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      return {
        uri,
        getText: () => content,
        lineCount: content.split('\n').length,
        lineAt: (i: number) => ({ text: content.split('\n')[i] || '' }),
        languageId: 'plaintext',
        isDirty: false,
        isUntitled: false,
        fileName: path.basename(filePath),
      };
    } catch {
      throw new Error(`Cannot open file: ${filePath}`);
    }
  },
};

export const window = {
  showInputBox: async (_options?: any) => {
    // In standalone, input is handled by the React UI
    return undefined;
  },
  showInformationMessage: (message: string, ...items: string[]) =>
    platform.showInformationMessage(message, ...items),
  showWarningMessage: (message: string, ...items: string[]) =>
    platform.showWarningMessage(message, ...items),
  showErrorMessage: (message: string, ...items: string[]) =>
    platform.showErrorMessage(message, ...items),
  createOutputChannel: (name: string) => platform.createOutputChannel(name),
  get activeTextEditor() { return undefined; },
  onDidChangeActiveTextEditor: (_listener: any) => ({ dispose: () => {} }),
  showTextDocument: async (_uri: any, _options?: any) => {
    // In standalone, open file in system editor
    const { shell } = require('electron');
    const filePath = _uri?.fsPath || String(_uri);
    await shell.openPath(filePath);
    return undefined;
  },
  createWebviewPanel: (_options: any) => {
    throw new Error('Not supported in standalone mode');
  },
};

export const commands = {
  registerCommand: (id: string, handler: any) => platform.registerCommand(id, handler),
  executeCommand: (id: string, ...args: any[]) => platform.executeCommand(id, ...args),
};

export class Uri {
  scheme: string;
  fsPath: string;
  path: string;

  constructor(fsPath: string) {
    this.scheme = 'file';
    this.fsPath = fsPath;
    this.path = fsPath;
  }

  static file(p: string) {
    return new Uri(p);
  }

  static parse(p: string) {
    return new Uri(p);
  }

  static joinPath(base: any, ...pathSegments: string[]) {
    const path = require('path');
    const basePath = base?.fsPath || String(base);
    return new Uri(path.join(basePath, ...pathSegments));
  }

  toString() {
    return this.fsPath;
  }

  with(_change: any) {
    return this;
  }
}

export class Range {
  constructor(
    public startLine: number,
    public startCharacter: number,
    public endLine: number,
    public endCharacter: number
  ) {}
}

export const env = {
  openExternal: async (uri: any) => {
    const { shell } = require('electron');
    const p = typeof uri?.fsPath === 'string' ? uri.fsPath : String(uri);
    await shell.openPath(p);
    return true;
  },
};

export const ExtensionContext = class MockExtensionContext {
  subscriptions: Array<{ dispose: () => void }> = [];
  get extensionUri() {
    return new Uri(process.cwd());
  }
  get extensionPath() { return process.cwd(); }
  get globalStorageUri() {
    return new Uri(process.cwd());
  }
};

export enum ConfigurationTarget {
  Global = 1,
  Workspace = 2,
  WorkspaceFolder = 3,
}

// ─── Webview types ───────────────────────────────────────────

export class EventEmitter<T> {
  private listeners: Array<(e: T) => any> = [];
  
  event(listener: (e: T) => any) {
    this.listeners.push(listener);
    return {
      dispose: () => {
        this.listeners = this.listeners.filter(l => l !== listener);
      },
    };
  }
  
  fire(data: T) {
    for (const listener of this.listeners) {
      try { listener(data); } catch { /* ignore */ }
    }
  }
}

export class WebviewView {
  public webview: any;
  public visible: boolean = true;
  public title: string = '';
  
  private _onDidChangeVisibility = new EventEmitter<void>();
  private _onDidDispose = new EventEmitter<void>();
  
  onDidChangeVisibility = this._onDidChangeVisibility.event.bind(this._onDidChangeVisibility);
  onDidDispose = this._onDidDispose.event.bind(this._onDidDispose);

  constructor(webview: any) {
    this.webview = webview;
  }

  show(preserveFocus?: boolean) { this.visible = true; }
  dispose() { this._onDidDispose.fire(); }
}

export interface WebviewViewProvider {
  resolveWebviewView(
    webviewView: WebviewView,
    context: any,
    token: any
  ): void | Promise<void>;
}

export interface CancellationToken {
  isCancellationRequested: boolean;
  onCancellationRequested: (listener: any) => { dispose: () => void };
}

export class CancellationTokenSource {
  token: CancellationToken = {
    isCancellationRequested: false,
    onCancellationRequested: () => ({ dispose: () => {} }),
  };
  cancel() { this.token.isCancellationRequested = true; }
  dispose() {}
}

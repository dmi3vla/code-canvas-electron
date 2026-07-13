/**
 * Standalone Electron app entry point — replaces extension.ts
 * 
 * This module initializes the Codemap backend in standalone mode.
 * It creates the CodemapViewProvider and wires it to the Electron IPC bridge.
 */

import { initSettings, getSettings, setSettings, onSettingsChange } from './settings';
import { getPlatform, createPlatform } from './platform';
import { CodemapViewProvider } from '../src/views/CodemapViewProvider';
import { isConfigured, refreshConfig } from '../src/agent';
import { initLogger, info } from '../src/logger';
import { getStoragePath, listCodemaps } from '../src/storage/codemapStorage';
import * as path from 'path';
import * as fs from 'fs';

// ─── Mock Webview ────────────────────────────────────────────

interface MockWebview {
  options: any;
  html: string;
  cspSource: string;
  asWebviewUri: (uri: any) => any;
  postMessage: (msg: any) => void;
  onDidReceiveMessage: (callback: (msg: any) => void) => void;
}

class MockWebviewView {
  public webview: MockWebview;
  public visible: boolean = true;
  private _messageHandlers: Array<(msg: any) => void> = [];

  constructor(private _postToRenderer: (msg: any) => void) {
    const self = this;
    this.webview = {
      options: {},
      html: '',
      cspSource: "'self'",
      asWebviewUri(uri: any) {
        return uri;
      },
      postMessage(msg: any) {
        self._postToRenderer(msg);
      },
      onDidReceiveMessage(callback: (msg: any) => void) {
        self._messageHandlers.push(callback);
      },
    };
  }

  receiveMessage(msg: any) {
    for (const handler of this._messageHandlers) {
      try { handler(msg); } catch (e) { console.error('Message handler error:', e); }
    }
  }

  show(_preserveFocus?: boolean) {}
  dispose() {}
}

// ─── Core Setup ──────────────────────────────────────────────

let provider: CodemapViewProvider | null = null;
let webviewView: MockWebviewView | null = null;
const platform = createPlatform();

/**
 * Initialize the standalone app.
 * Called from the Electron main process.
 */
export function initApp(sendToRenderer: (msg: any) => void): void {
  console.log('[appEntry] initApp starting...');

  // Init settings
  initSettings();
  console.log('[appEntry] settings initialized:', JSON.stringify(getSettings()));

  // Init logger (console-based in standalone)
  initLogger();
  info('Codemap standalone app starting...');

  // Create the mock webview view
  webviewView = new MockWebviewView((msg: any) => {
    console.log('[appEntry] → renderer:', msg.type);
    sendToRenderer(msg);
  });

  // Create extension URI (points to dist folder)
  const extensionUri = {
    scheme: 'file',
    fsPath: path.join(__dirname, '..'),
    path: path.join(__dirname, '..'),
    toString() { return this.fsPath; },
    with(_change: any) { return this; },
  };

  try {
    // Instantiate CodemapViewProvider (same as extension!)
    provider = new CodemapViewProvider(extensionUri as any);
    console.log('[appEntry] CodemapViewProvider created');

    // Resolve the webview
    provider.resolveWebviewView(webviewView as any, {} as any, {} as any);
    console.log('[appEntry] resolveWebviewView completed');
  } catch (err) {
    console.error('[appEntry] ERROR during init:', err);
  }

  info('Standalone app initialized');
  console.log('[appEntry] initApp complete, handler count:', webviewView?.['_messageHandlers']?.length);
}

/**
 * Handle messages from the renderer (webview)
 */
export function handleRendererMessage(message: any): void {
  console.log('[appEntry] ← renderer:', message.command);
  if (webviewView) {
    webviewView.receiveMessage(message);
  } else {
    console.error('[appEntry] webviewView is null, cannot handle message');
  }
}

/**
 * Get current settings snapshot
 */
export { getSettings, setSettings, onSettingsChange };

/**
 * Check if API is configured
 */
export { isConfigured };

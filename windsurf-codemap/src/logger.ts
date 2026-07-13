/**
 * Logger module for Codemap
 * In VS Code: uses OutputChannel. In standalone: uses console.
 */

// Try to import vscode — if it fails, we're in standalone mode
let vscodeModule: any = null;
try {
  vscodeModule = require('vscode');
} catch {
  // Standalone mode — vscode is not available
}

interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
}

let outputChannel: any = null;
const logBuffer: LogEntry[] = [];

function appendToChannel(value: string) {
  if (outputChannel && typeof outputChannel.appendLine === 'function') {
    outputChannel.appendLine(value);
  }
  // Always log to console for debugging
  console.log('[codemap]', value);
}

/**
 * Initialize the logger
 */
export function initLogger(): any {
  if (vscodeModule && vscodeModule.window) {
    outputChannel = vscodeModule.window.createOutputChannel('Codemap Agent');
    return outputChannel;
  }
  // Standalone: return a mock
  return {
    appendLine: (v: string) => { console.log(v); },
    show: () => {},
    dispose: () => {},
  };
}

/**
 * Get the logger instance
 */
export function getLogger(): any {
  return outputChannel;
}

/**
 * Log a message with timestamp
 */
export function log(level: 'INFO' | 'WARN' | 'ERROR' | 'DEBUG', message: string, ...args: unknown[]): void {
  if (!outputChannel && vscodeModule) {
    initLogger();
  }
  
  const timestamp = new Date().toISOString();
  const prefix = `[${timestamp}] [${level}]`;
  
  let fullMessage = `${prefix} ${message}`;
  
  if (args.length > 0) {
    const argsStr = args.map(arg => {
      if (typeof arg === 'object') {
        try {
          return JSON.stringify(arg, null, 2);
        } catch {
          return String(arg);
        }
      }
      return String(arg);
    }).join(' ');
    fullMessage += ' ' + argsStr;
  }

  appendToChannel(fullMessage);
  
  // Keep buffer
  logBuffer.push({ timestamp, level, message: fullMessage });
  if (logBuffer.length > 1000) {
    logBuffer.shift();
  }
}

export function info(message: string, ...args: unknown[]): void {
  log('INFO', message, ...args);
}

export function warn(message: string, ...args: unknown[]): void {
  log('WARN', message, ...args);
}

export function error(message: string, ...args: unknown[]): void {
  log('ERROR', message, ...args);
}

export function debug(message: string, ...args: unknown[]): void {
  log('DEBUG', message, ...args);
}

export function separator(title: string): void {
  const line = '='.repeat(80);
  appendToChannel(`\n${line}\n  ${title}\n${line}`);
}

export function show(): void {
  if (outputChannel && typeof outputChannel.show === 'function') {
    outputChannel.show();
  }
}

export function getLogEntries(): LogEntry[] {
  return [...logBuffer];
}





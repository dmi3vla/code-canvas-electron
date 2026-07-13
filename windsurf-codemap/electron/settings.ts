/**
 * Settings management for standalone Electron app.
 * Stores config in ~/.cometix/codemap/settings.json
 * Replaces vscode.workspace.getConfiguration('codemap').
 * 
 * IMPORTANT: Always reads from file — never caches in memory,
 * because this module may be bundled into multiple output files
 * (main.js and appEntry.js) which would have separate module state.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const COMETIX_DIR = path.join(os.homedir(), '.cometix', 'codemap');
const SETTINGS_FILE = path.join(COMETIX_DIR, 'settings.json');

export interface CodemapSettings {
  openaiApiKey: string;
  openaiBaseUrl: string;
  model: string;
  language: string;
}

const DEFAULT_SETTINGS: CodemapSettings = {
  openaiApiKey: '',
  openaiBaseUrl: 'https://api.deepseek.com/v1',
  model: 'deepseek-v4-pro',
  language: 'Русский',
};

let changeListeners: Array<(settings: CodemapSettings) => void> = [];

/** Always reads fresh from disk */
function loadFromFile(): CodemapSettings {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const raw = fs.readFileSync(SETTINGS_FILE, 'utf-8');
      return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
    }
  } catch { /* ignore corrupt file */ }
  return { ...DEFAULT_SETTINGS };
}

function saveToFile(settings: CodemapSettings): void {
  if (!fs.existsSync(COMETIX_DIR)) {
    fs.mkdirSync(COMETIX_DIR, { recursive: true });
  }
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
}

export function initSettings(): CodemapSettings {
  if (!fs.existsSync(COMETIX_DIR)) {
    fs.mkdirSync(COMETIX_DIR, { recursive: true });
  }
  if (!fs.existsSync(SETTINGS_FILE)) {
    saveToFile(DEFAULT_SETTINGS);
  }
  return loadFromFile();
}

export function getSettings(): CodemapSettings {
  return loadFromFile();
}

export function getSetting<K extends keyof CodemapSettings>(key: K): CodemapSettings[K] {
  return loadFromFile()[key];
}

export function setSetting<K extends keyof CodemapSettings>(key: K, value: CodemapSettings[K]): void {
  const settings = loadFromFile();
  settings[key] = value;
  saveToFile(settings);
  notifyListeners();
}

export function setSettings(partial: Partial<CodemapSettings>): void {
  const settings = { ...loadFromFile(), ...partial };
  saveToFile(settings);
  notifyListeners();
}

export function getSettingsFilePath(): string {
  return SETTINGS_FILE;
}

export function onSettingsChange(listener: (settings: CodemapSettings) => void): () => void {
  changeListeners.push(listener);
  return () => {
    changeListeners = changeListeners.filter(l => l !== listener);
  };
}

function notifyListeners(): void {
  const settings = loadFromFile();
  for (const listener of changeListeners) {
    try { listener(settings); } catch { /* ignore */ }
  }
}

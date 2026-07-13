/**
 * GPT agent settings — shared with windsurf-codemap Electron standalone.
 * Stores config in ~/.cometix/codemap/settings.json
 *
 * Always reads from file — never caches in memory (safe across entry points).
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const COMETIX_DIR = path.join(os.homedir(), '.cometix', 'codemap');
const SETTINGS_FILE = path.join(COMETIX_DIR, 'settings.json');

const DEFAULT_SETTINGS = {
  openaiApiKey: '',
  openaiBaseUrl: 'https://api.deepseek.com/v1',
  model: 'deepseek-v4-pro',
  language: 'Русский'
};

function loadFromFile() {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const raw = fs.readFileSync(SETTINGS_FILE, 'utf-8');
      return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
    }
  } catch {
    /* ignore corrupt file */
  }
  return { ...DEFAULT_SETTINGS };
}

function saveToFile(settings) {
  if (!fs.existsSync(COMETIX_DIR)) {
    fs.mkdirSync(COMETIX_DIR, { recursive: true });
  }
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
}

function initSettings() {
  if (!fs.existsSync(COMETIX_DIR)) {
    fs.mkdirSync(COMETIX_DIR, { recursive: true });
  }
  if (!fs.existsSync(SETTINGS_FILE)) {
    saveToFile(DEFAULT_SETTINGS);
  }
  return loadFromFile();
}

function getSettings() {
  return loadFromFile();
}

function getSetting(key) {
  return loadFromFile()[key];
}

function setSetting(key, value) {
  const settings = loadFromFile();
  settings[key] = value;
  saveToFile(settings);
  return settings;
}

function setSettings(partial) {
  const settings = { ...loadFromFile(), ...partial };
  saveToFile(settings);
  return settings;
}

function getSettingsFilePath() {
  return SETTINGS_FILE;
}

function isConfigured() {
  return Boolean(loadFromFile().openaiApiKey);
}

module.exports = {
  DEFAULT_SETTINGS,
  initSettings,
  getSettings,
  getSetting,
  setSetting,
  setSettings,
  getSettingsFilePath,
  isConfigured
};

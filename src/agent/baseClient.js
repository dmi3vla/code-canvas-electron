/**
 * OpenAI-compatible client using windsurf settings store.
 */

const { createOpenAI } = require('@ai-sdk/openai');
const { getSettings } = require('./settings');

let cachedClient = null;
let cachedConfig = null;

function getOpenAIClient() {
  const settings = getSettings();
  const apiKey = settings.openaiApiKey || '';
  const baseUrl = settings.openaiBaseUrl || 'https://api.openai.com/v1';

  if (!apiKey) {
    cachedClient = null;
    cachedConfig = null;
    return null;
  }

  if (cachedClient && cachedConfig?.apiKey === apiKey && cachedConfig?.baseUrl === baseUrl) {
    return cachedClient;
  }

  cachedClient = createOpenAI({
    apiKey,
    baseURL: baseUrl
  });
  cachedConfig = { apiKey, baseUrl };
  return cachedClient;
}

function getModelName() {
  return getSettings().model || 'deepseek-v4-pro';
}

function getLanguage() {
  return getSettings().language || 'Русский';
}

function isConfigured() {
  return getOpenAIClient() !== null;
}

function refreshConfig() {
  cachedClient = null;
  cachedConfig = null;
  return isConfigured();
}

module.exports = {
  getOpenAIClient,
  getModelName,
  getLanguage,
  isConfigured,
  refreshConfig
};

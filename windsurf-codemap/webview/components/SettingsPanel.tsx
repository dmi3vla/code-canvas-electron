import React, { useState, useEffect, useCallback } from 'react';
import { Settings, FolderOpen, Key, Globe, Cpu, Languages, X, Check, Folder } from 'lucide-react';
import { useElectronApi } from '../extensionBridge';
import type { ElectronSettings, ElectronProject } from '../types';

interface SettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

export const SettingsPanel: React.FC<SettingsPanelProps> = ({ isOpen, onClose }) => {
  const electronApi = useElectronApi();

  const [settings, setSettings] = useState<ElectronSettings>({
    openaiApiKey: '',
    openaiBaseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o',
    language: 'English',
  });
  const [project, setProject] = useState<ElectronProject | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Load settings and project on open
  useEffect(() => {
    if (isOpen && electronApi) {
      electronApi.settings.get().then(setSettings);
      electronApi.project.getCurrent().then(setProject);
    }
  }, [isOpen, electronApi]);

  const handleChange = useCallback((key: keyof ElectronSettings, value: string) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  }, []);

  const handleSave = useCallback(async () => {
    if (!electronApi) return;
    setSaving(true);
    await electronApi.settings.set('openaiApiKey', settings.openaiApiKey);
    await electronApi.settings.set('openaiBaseUrl', settings.openaiBaseUrl);
    await electronApi.settings.set('model', settings.model);
    await electronApi.settings.set('language', settings.language);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }, [electronApi, settings]);

  const handleOpenProject = useCallback(async () => {
    if (!electronApi) return;
    const result = await electronApi.project.open();
    if (result) {
      setProject(result);
    }
  }, [electronApi]);

  if (!isOpen || !electronApi) return null;

  return (
    <div className="settings-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="settings-panel">
        <div className="settings-header">
          <Settings size={18} />
          <h2>Settings</h2>
          <button className="icon-btn" onClick={onClose} title="Close">
            <X size={18} />
          </button>
        </div>

        <div className="settings-body">
          {/* Project Section */}
          <div className="settings-section">
            <h3><FolderOpen size={14} /> Project</h3>
            <div className="settings-row">
              {project ? (
                <div className="project-info">
                  <Folder size={16} />
                  <span className="project-name">{project.name}</span>
                  <span className="project-path">{project.path}</span>
                </div>
              ) : (
                <span className="settings-hint">No project opened</span>
              )}
              <button className="settings-btn" onClick={handleOpenProject}>
                {project ? 'Change...' : 'Open Project...'}
              </button>
            </div>
          </div>

          {/* API Section */}
          <div className="settings-section">
            <h3><Key size={14} /> API Configuration</h3>

            <div className="settings-field">
              <label><Key size={12} /> API Key</label>
              <input
                type="password"
                value={settings.openaiApiKey}
                onChange={(e) => handleChange('openaiApiKey', e.target.value)}
                placeholder="sk-..."
              />
            </div>

            <div className="settings-field">
              <label><Globe size={12} /> Base URL</label>
              <input
                type="text"
                value={settings.openaiBaseUrl}
                onChange={(e) => handleChange('openaiBaseUrl', e.target.value)}
                placeholder="https://api.deepseek.com/v1"
              />
            </div>

            <div className="settings-field">
              <label><Cpu size={12} /> Model</label>
              <select
                value={settings.model}
                onChange={(e) => handleChange('model', e.target.value)}
              >
                <optgroup label="DeepSeek">
                  <option value="deepseek-v4-pro">deepseek-v4-pro</option>
                  <option value="deepseek-v4-flash">deepseek-v4-flash</option>
                  <option value="deepseek-chat">deepseek-chat (v3)</option>
                  <option value="deepseek-reasoner">deepseek-reasoner (r1)</option>
                </optgroup>
                <optgroup label="OpenAI">
                  <option value="gpt-4o">gpt-4o</option>
                  <option value="gpt-4o-mini">gpt-4o-mini</option>
                  <option value="gpt-4-turbo">gpt-4-turbo</option>
                  <option value="gpt-3.5-turbo">gpt-3.5-turbo</option>
                </optgroup>
                <optgroup label="Anthropic (via compatible API)">
                  <option value="claude-3-5-sonnet-20241022">claude-3.5-sonnet</option>
                  <option value="claude-3-opus-20240229">claude-3-opus</option>
                </optgroup>
              </select>
            </div>

            <div className="settings-field">
              <label><Languages size={12} /> Language</label>
              <select
                value={settings.language}
                onChange={(e) => handleChange('language', e.target.value)}
              >
                <option value="English">English</option>
                <option value="Russian">Русский</option>
                <option value="Chinese">中文</option>
                <option value="Japanese">日本語</option>
                <option value="Korean">한국어</option>
              </select>
            </div>
          </div>
        </div>

        <div className="settings-footer">
          <button
            className="settings-btn save-btn"
            onClick={handleSave}
            disabled={saving}
          >
            {saved ? <><Check size={14} /> Saved!</> : saving ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
      </div>
    </div>
  );
};

// src/editor/editor-entry.js
//
// Изолированный компонент "редактор". Не знает про canvas, не знает про
// agent/codemap — только про CodeMirror и про свой узкий контракт.
//
// Контракт (v2 — вкладки + редактирование + сохранение):
//   mount(container)
//   openFiles({ files: [{ path, content, line? }], onSave? }) — открывает
//     главный файл + вкладки зависимостей, каждый редактируемый.
//   openFile(path, content, line?) — совместимость: одна вкладка.
//   dispose()
//
// Собирается esbuild'ом в один самодостаточный бандл (dist/editor.bundle.js).

import { EditorView, basicSetup } from 'codemirror';
import { EditorState, StateEffect, StateField } from '@codemirror/state';
import { keymap } from '@codemirror/view';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { cpp } from '@codemirror/lang-cpp';
import { oneDark } from '@codemirror/theme-one-dark';
import { Decoration } from '@codemirror/view';

// --- anchor (подсветка строки), аналог revealRange+decoration в VSCode ---

const setAnchorEffect = StateEffect.define();

const anchorField = StateField.define({
  create() {
    return Decoration.none;
  },
  update(decorations, tr) {
    decorations = decorations.map(tr.changes);
    for (const effect of tr.effects) {
      if (effect.is(setAnchorEffect)) {
        decorations = effect.value
          ? Decoration.set([
              Decoration.line({ attributes: { class: 'cm-anchor-line' } }).range(effect.value)
            ])
          : Decoration.none;
      }
    }
    return decorations;
  },
  provide: (field) => EditorView.decorations.from(field)
});

const anchorTheme = EditorView.baseTheme({
  '.cm-anchor-line': {
    backgroundColor: 'rgba(90, 160, 255, 0.18)',
    outline: '1px solid rgba(90, 160, 255, 0.55)'
  }
});

// --- выбор языковой поддержки по расширению файла ---

function languageExtensionFor(pathOrLang) {
  const key = String(pathOrLang || '').toLowerCase();
  if (/\.(jsx?|tsx?|mjs|cjs)$/.test(key) || key === 'javascript' || key === 'typescript') {
    return javascript({ jsx: true, typescript: true });
  }
  if (/\.py$/.test(key) || key === 'python') {
    return python();
  }
  if (/\.(c|h|cpp|cc|hpp|cs)$/.test(key) || key === 'cpp' || key === 'c' || key === 'csharp') {
    return cpp();
  }
  // Fallback: без языковой подсветки, но редактор остаётся рабочим —
  // не блокируем открытие файла из-за отсутствия конкретного lang-пакета
  // (go/rust/java добавляются по мере необходимости, список конечен).
  return [];
}

function baseName(p) {
  return String(p || '').split(/[/\\]/).pop() || p;
}

/**
 * Многофайловый редактор с вкладками.
 * Главный файл (узел) + вкладки его ближайших зависимостей.
 * Все вкладки редактируемые; сохранение через onSave(path, content).
 */
class CodeCanvasEditor {
  constructor() {
    this.view = null;
    this.tabsBar = null;
    this.container = null;
    /** @type {Array<{ path, doc, line, dirty }>} */
    this.tabs = [];
    this.activeIndex = -1;
    this.onSave = null;
  }

  mount(container) {
    if (this.view) return;
    this.container = container;

    // Вкладки над областью редактора.
    this.tabsBar = document.createElement('div');
    this.tabsBar.className = 'editor-tabs';
    container.appendChild(this.tabsBar);

    const editorHost = document.createElement('div');
    editorHost.className = 'editor-view-host';
    container.appendChild(editorHost);

    this.view = new EditorView({
      state: this._makeState('', ''),
      parent: editorHost
    });
  }

  _makeState(path, content) {
    const self = this;
    const saveKeymap = keymap.of([
      {
        key: 'Mod-s',
        preventDefault: true,
        run: () => {
          self.saveActive();
          return true;
        }
      }
    ]);
    return EditorState.create({
      doc: content,
      extensions: [
        basicSetup,
        oneDark,
        anchorField,
        anchorTheme,
        languageExtensionFor(path),
        saveKeymap,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) self._markActiveDirty();
        })
      ]
    });
  }

  /**
   * Открыть набор файлов вкладками. Первый — главный (узел).
   * @param {{ files: Array<{path:string, content:string, line?:number}>, onSave?: (path:string, content:string)=>Promise<void>|void }} opts
   */
  openFiles(opts) {
    if (!this.view) throw new Error('CodeCanvasEditor.mount() must be called before openFiles()');
    const files = (opts && opts.files) || [];
    this.onSave = (opts && opts.onSave) || null;

    this.tabs = files.map((f) => ({
      path: f.path,
      doc: f.content || '',
      line: typeof f.line === 'number' ? f.line : null,
      dirty: false
    }));
    this.activeIndex = this.tabs.length ? 0 : -1;
    this._renderTabs();
    if (this.activeIndex >= 0) this._activate(this.activeIndex, { fromOpen: true });
  }

  // Совместимость со старым контрактом — одна вкладка.
  openFile(path, content, line) {
    this.openFiles({ files: [{ path, content, line }], onSave: this.onSave });
  }

  _persistActiveDoc() {
    if (this.activeIndex < 0) return;
    this.tabs[this.activeIndex].doc = this.view.state.doc.toString();
  }

  _markActiveDirty() {
    if (this.activeIndex < 0) return;
    const tab = this.tabs[this.activeIndex];
    if (!tab.dirty) {
      tab.dirty = true;
      this._renderTabs();
    }
  }

  _activate(index, { fromOpen = false } = {}) {
    if (index < 0 || index >= this.tabs.length) return;
    // Сохранить текущий буфер перед переключением.
    if (!fromOpen && this.activeIndex >= 0 && this.activeIndex !== index) {
      this._persistActiveDoc();
    }
    this.activeIndex = index;
    const tab = this.tabs[index];
    this.view.setState(this._makeState(tab.path, tab.doc));
    if (typeof tab.line === 'number' && tab.line > 0) {
      this.highlightLine(tab.line);
    }
    this._renderTabs();
  }

  _renderTabs() {
    if (!this.tabsBar) return;
    this.tabsBar.innerHTML = '';
    this.tabs.forEach((tab, i) => {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'editor-tab' + (i === this.activeIndex ? ' active' : '');
      el.title = tab.path;
      const label = document.createElement('span');
      label.className = 'editor-tab-label';
      label.textContent = (tab.dirty ? '● ' : '') + baseName(tab.path);
      el.appendChild(label);
      el.addEventListener('click', () => this._activate(i));
      this.tabsBar.appendChild(el);
    });
  }

  async saveActive() {
    if (this.activeIndex < 0) return;
    this._persistActiveDoc();
    const tab = this.tabs[this.activeIndex];
    if (!this.onSave) return;
    try {
      await this.onSave(tab.path, tab.doc);
      tab.dirty = false;
      this._renderTabs();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[editor] save failed', err);
    }
  }

  highlightLine(lineNumber) {
    if (!this.view) return;
    const doc = this.view.state.doc;
    const clamped = Math.min(Math.max(lineNumber, 1), doc.lines);
    const linePos = doc.line(clamped);

    this.view.dispatch({
      effects: [
        setAnchorEffect.of(linePos.from),
        EditorView.scrollIntoView(linePos.from, { y: 'center' })
      ]
    });
  }

  dispose() {
    this.view?.destroy();
    this.view = null;
    if (this.tabsBar && this.tabsBar.parentNode) {
      this.tabsBar.parentNode.removeChild(this.tabsBar);
    }
    this.tabsBar = null;
    this.tabs = [];
    this.activeIndex = -1;
  }
}

window.CodeCanvasEditor = new CodeCanvasEditor();

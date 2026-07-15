/**
 * Chat panel — conversational AI about the current codemap / selected node.
 * Экспортируется в window.CodeCanvasChat.
 */
(function () {
  'use strict';

  /**
   * Mount chat into a container element.
   * @param {HTMLElement} mountEl
   * @param {object} options
   * @param {() => {nodeId?: string, nodeTitle?: string, nodePath?: string, traceId?: string}} options.getNodeContext
   */
  function mount(mountEl, options) {
    if (!mountEl) return;

    const opts = options || {};
    let messages = [];

    mountEl.innerHTML = '';

    // Messages list
    const msgList = document.createElement('div');
    msgList.className = 'chat-messages';
    mountEl.appendChild(msgList);

    // Input area
    const inputRow = document.createElement('div');
    inputRow.className = 'chat-input-row';

    const textarea = document.createElement('textarea');
    textarea.className = 'chat-textarea';
    textarea.rows = 2;
    textarea.placeholder = 'Спросите о коде, архитектуре, конкретной ноде…';
    inputRow.appendChild(textarea);

    const sendBtn = document.createElement('button');
    sendBtn.className = 'chat-send-btn';
    sendBtn.textContent = '→';
    sendBtn.title = 'Отправить (Enter)';
    inputRow.appendChild(sendBtn);

    mountEl.appendChild(inputRow);

    function addMessage(role, text) {
      messages.push({ role, text });
      const el = document.createElement('div');
      el.className = `chat-msg chat-msg-${role}`;
      el.textContent = text;
      msgList.appendChild(el);
      msgList.scrollTop = msgList.scrollHeight;
      return el;
    }

    function addStreamingMessage(role) {
      const el = document.createElement('div');
      el.className = `chat-msg chat-msg-${role} chat-msg-streaming`;
      msgList.appendChild(el);
      return {
        appendText: (t) => {
          el.textContent += t;
          msgList.scrollTop = msgList.scrollHeight;
        },
        finalize: () => {
          el.classList.remove('chat-msg-streaming');
          messages.push({ role, text: el.textContent });
        }
      };
    }

    async function sendMessage() {
      const text = textarea.value.trim();
      if (!text) return;

      if (!window.electronAPI?.sendChatMessage) {
        addMessage('assistant', 'Чат недоступен: electronAPI.sendChatMessage не найден.');
        return;
      }

      textarea.value = '';
      textarea.disabled = true;
      sendBtn.disabled = true;

      addMessage('user', text);

      // Build context from current node
      let context = null;
      if (opts.getNodeContext) {
        const ctx = opts.getNodeContext();
        if (ctx && ctx.nodeId) {
          context = `Выбранная нода: "${ctx.nodeTitle || ''}" (тип: ${ctx.nodeType || '?'}, путь: ${ctx.nodePath || 'нет'}, trace: ${ctx.traceId || 'нет'}). Содержимое: ${(ctx.nodeContent || '').slice(0, 500)}`;
        }
      }

      const streamEl = addStreamingMessage('assistant');

      // Listen for chunks
      const unsub = window.electronAPI.onChatChunk((chunk) => {
        if (chunk.type === 'text') {
          streamEl.appendText(chunk.content);
        } else if (chunk.type === 'error') {
          streamEl.appendText(`\n\n⚠️ Ошибка: ${chunk.error}`);
          streamEl.finalize();
        } else if (chunk.type === 'finish') {
          streamEl.finalize();
        }
      });

      try {
        const result = await window.electronAPI.sendChatMessage(text, context);
        if (!result.ok) {
          streamEl.appendText(`\n\n⚠️ ${result.error || 'Неизвестная ошибка'}`);
        }
        streamEl.finalize();
      } catch (err) {
        streamEl.appendText(`\n\n⚠️ Ошибка соединения: ${err.message || err}`);
        streamEl.finalize();
      } finally {
        unsub();
        textarea.disabled = false;
        sendBtn.disabled = false;
        textarea.focus();
      }
    }

    sendBtn.addEventListener('click', sendMessage);
    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });

    return {
      destroy: () => {
        mountEl.innerHTML = '';
      }
    };
  }

  window.CodeCanvasChat = { mount };
})();

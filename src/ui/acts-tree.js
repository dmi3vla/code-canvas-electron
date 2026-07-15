/**
 * Clickable tree for traceTextDiagram (Windsurf TraceDiagramView port).
 * Global: window.ActsTree
 */
(function (global) {
  'use strict';

  function cleanTitle(text) {
    return String(text || '')
      .replace(/^[└├│─\s]+/, '')
      .trim();
  }

  function parseDiagramLine(line) {
    let level = 0;
    let i = 0;

    while (i < line.length) {
      const char = line[i];
      if (char === '│' || char === ' ' || char === '\t') {
        if (char === '│') {
          level++;
          i += 4;
        } else if (line.substring(i, i + 4) === '    ') {
          level++;
          i += 4;
        } else {
          i++;
        }
      } else if (char === '├' || char === '└') {
        while (
          i < line.length &&
          (line[i] === '├' || line[i] === '└' || line[i] === '─' || line[i] === ' ')
        ) {
          i++;
        }
        break;
      } else {
        break;
      }
    }

    let content = cleanTitle(line.substring(i).trim());
    const linkMatch = content.match(/^(.+?)\s*<--\s*(.+)$/);
    if (!linkMatch) {
      return { level, title: content, link: null };
    }

    const title = cleanTitle(linkMatch[1]);
    const linkStr = linkMatch[2].trim();
    const locationMatch = linkStr.match(/^(\d+[a-z])$/i);
    if (locationMatch) {
      return {
        level,
        title,
        link: { type: 'location', locationId: locationMatch[1].toLowerCase() }
      };
    }

    const fileMatch = linkStr.match(/^(.+):(\d+)$/);
    if (fileMatch) {
      let filePath = fileMatch[1].replace(/\\\\/g, '\\');
      if (/^[a-zA-Z][:\\/]/.test(filePath)) {
        filePath = filePath.replace(/\//g, '\\');
      }
      return {
        level,
        title,
        link: {
          type: 'file',
          filePath,
          lineNumber: parseInt(fileMatch[2], 10)
        }
      };
    }

    let filePath = linkStr.replace(/\\\\/g, '\\');
    if (/^[a-zA-Z][:\\/]/.test(filePath)) {
      filePath = filePath.replace(/\//g, '\\');
    }
    return { level, title, link: { type: 'file', filePath } };
  }

  function parseTraceTextDiagram(diagram) {
    const lines = String(diagram || '')
      .split('\n')
      .filter((line) => line.trim());
    if (!lines.length) return [];

    const rootNodes = [];
    const stack = [];
    let nodeId = 0;

    for (const line of lines) {
      const isTreeLine = line.includes('├') || line.includes('└') || line.includes('│');
      const parsed = parseDiagramLine(line);
      const node = {
        id: `dn-${nodeId++}`,
        title: parsed.title,
        link: parsed.link,
        children: [],
        level: isTreeLine ? parsed.level : -1
      };

      if (!isTreeLine) {
        rootNodes.push(node);
        stack.length = 0;
        stack.push({ node, level: -1 });
        continue;
      }

      while (stack.length > 0 && stack[stack.length - 1].level >= parsed.level) {
        stack.pop();
      }
      if (stack.length > 0) {
        stack[stack.length - 1].node.children.push(node);
      } else {
        rootNodes.push(node);
      }
      stack.push({ node, level: parsed.level });
    }

    return rootNodes;
  }

  function flattenTree(nodes, depth, connectors) {
    const rows = [];
    nodes.forEach((node, idx) => {
      const isLast = idx === nodes.length - 1;
      rows.push({
        id: node.id,
        title: node.title,
        link: node.link,
        depth,
        isLast,
        connectors: connectors.slice()
      });
      if (node.children.length) {
        rows.push(...flattenTree(node.children, depth + 1, connectors.concat(!isLast)));
      }
    });
    return rows;
  }

  /**
   * @param {string} diagram
   * @param {{ onLocation?: (id: string) => void, onFile?: (path: string, line?: number) => void }} handlers
   * @returns {HTMLElement}
   */
  function renderTreeElement(diagram, handlers = {}) {
    const wrap = document.createElement('div');
    wrap.className = 'acts-tree';

    const nodes = parseTraceTextDiagram(diagram);
    if (!nodes.length) {
      wrap.innerHTML = '<div class="acts-tree-empty">Нет дерева для этого act</div>';
      return wrap;
    }

    let rootTitle = null;
    let rows = [];
    const first = nodes[0];
    if (first && first.level === -1 && first.children.length > 0) {
      rootTitle = first.title;
      rows = flattenTree(first.children, 0, []);
    } else {
      rows = flattenTree(nodes, 0, []);
    }

    if (rootTitle) {
      const root = document.createElement('div');
      root.className = 'acts-tree-root';
      root.textContent = rootTitle;
      wrap.appendChild(root);
    }

    const body = document.createElement('div');
    body.className = 'acts-tree-body';

    for (const row of rows) {
      const el = document.createElement('div');
      el.className = 'acts-tree-row' + (row.link ? ' clickable' : '');

      const connectors = document.createElement('span');
      connectors.className = 'acts-tree-connectors';
      connectors.setAttribute('aria-hidden', 'true');
      for (const show of row.connectors) {
        const col = document.createElement('span');
        col.className = 'acts-tree-col' + (show ? ' has-line' : '');
        connectors.appendChild(col);
      }
      const elbow = document.createElement('span');
      elbow.className = 'acts-tree-elbow ' + (row.isLast ? 'last' : 'mid');
      connectors.appendChild(elbow);
      el.appendChild(connectors);

      if (row.link?.type === 'location' && row.link.locationId) {
        const badge = document.createElement('span');
        badge.className = 'acts-tree-badge';
        badge.textContent = row.link.locationId;
        el.appendChild(badge);
      }

      const title = document.createElement('span');
      title.className = 'acts-tree-title';
      title.textContent = row.title;
      el.appendChild(title);

      if (row.link) {
        el.title =
          row.link.type === 'location'
            ? `Location ${row.link.locationId}`
            : `${row.link.filePath}${row.link.lineNumber ? ':' + row.link.lineNumber : ''}`;
        el.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (row.link.type === 'location' && handlers.onLocation) {
            handlers.onLocation(row.link.locationId);
          } else if (row.link.type === 'file' && handlers.onFile) {
            handlers.onFile(row.link.filePath, row.link.lineNumber);
          }
        });
      }

      body.appendChild(el);
    }

    wrap.appendChild(body);
    return wrap;
  }

  global.ActsTree = {
    parseTraceTextDiagram,
    flattenTree,
    renderTreeElement
  };
})(typeof window !== 'undefined' ? window : globalThis);

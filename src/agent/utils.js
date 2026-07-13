const fs = require('fs');
const path = require('path');

function generateWorkspaceLayout(workspaceRoot, maxDepth = 3) {
  const lines = [];
  const ignoredPatterns = [
    'node_modules',
    '.git',
    '.vscode',
    '__pycache__',
    '.pytest_cache',
    'dist',
    'build',
    'out',
    '.next',
    'coverage',
    '.nyc_output'
  ];

  function walkDir(dir, prefix = '', depth = 0) {
    if (depth > maxDepth) {
      lines.push(`${prefix}[...]`);
      return;
    }

    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    entries.sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1;
      if (!a.isDirectory() && b.isDirectory()) return 1;
      return a.name.localeCompare(b.name);
    });

    entries = entries.filter((e) => !ignoredPatterns.includes(e.name) && !e.name.startsWith('.'));

    const maxEntries = 15;
    const hasMore = entries.length > maxEntries;
    const displayEntries = entries.slice(0, maxEntries);

    for (let i = 0; i < displayEntries.length; i++) {
      const entry = displayEntries[i];
      const isLast = i === displayEntries.length - 1 && !hasMore;
      const marker = isLast ? '└── ' : '├── ';
      const childPrefix = prefix + (isLast ? '    ' : '│   ');

      if (entry.isDirectory()) {
        lines.push(`${prefix}${marker}${entry.name}/`);
        walkDir(path.join(dir, entry.name), childPrefix, depth + 1);
      } else {
        lines.push(`${prefix}${marker}${entry.name}`);
      }
    }

    if (hasMore) {
      lines.push(`${prefix}└── [+${entries.length - maxEntries} more items]`);
    }
  }

  walkDir(workspaceRoot);
  return lines.join('\n');
}

function extractCodemapFromResponse(text) {
  const codemapMatch = text.match(/<CODEMAP>\s*([\s\S]*?)\s*<\/CODEMAP>/);
  if (codemapMatch) {
    try {
      return JSON.parse(codemapMatch[1]);
    } catch (e) {
      console.error('Failed to parse CODEMAP JSON:', e);
    }
  }

  const jsonMatch = text.match(/\{[\s\S]*"title"[\s\S]*"traces"[\s\S]*\}/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[0]);
    } catch (e) {
      console.error('Failed to parse JSON from response:', e);
    }
  }

  return null;
}

function extractTraceDiagram(text) {
  const match = text.match(/<TRACE_TEXT_DIAGRAM>\s*([\s\S]*?)\s*<\/TRACE_TEXT_DIAGRAM>/);
  return match ? match[1].trim() : null;
}

function extractTraceGuide(text) {
  const match = text.match(/<TRACE_GUIDE>\s*([\s\S]*?)\s*<\/TRACE_GUIDE>/);
  return match ? match[1].trim() : null;
}

function extractMermaidDiagram(text) {
  const mermaidMatch = text.match(/```mermaid\s*([\s\S]*?)\s*```/i);
  if (mermaidMatch) return mermaidMatch[1].trim();
  return null;
}

function isResearchComplete(text) {
  const indicators = [
    'I am done researching',
    'done researching',
    'research is complete',
    'finished exploring',
    'completed my analysis',
    'Would you like to hear more?'
  ];
  const lowerText = text.toLowerCase();
  return indicators.some((ind) => lowerText.includes(ind.toLowerCase()));
}

function formatCurrentDate() {
  return new Date().toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZoneName: 'short'
  });
}

function getUserOs() {
  return process.platform === 'win32' ? 'windows' : process.platform;
}

module.exports = {
  generateWorkspaceLayout,
  extractCodemapFromResponse,
  extractTraceDiagram,
  extractTraceGuide,
  extractMermaidDiagram,
  isResearchComplete,
  formatCurrentDate,
  getUserOs
};

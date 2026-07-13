/**
 * Stub vscode module — re-exports the Electron shim.
 * Used for standalone builds where the real 'vscode' package is not available.
 * The esbuild standalone build resolves 'vscode' imports to this file.
 */
module.exports = require('./electron/vscodeShim');

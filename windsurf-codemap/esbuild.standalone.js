/**
 * Standalone Electron build configuration
 */

const esbuild = require("esbuild");
const fs = require("fs");
const path = require("path");

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/**
 * @type {import('esbuild').Plugin}
 */
const esbuildProblemMatcherPlugin = {
  name: 'esbuild-problem-matcher',
  setup(build) {
    build.onStart(() => {
      console.log('[watch] build started');
    });
    build.onEnd((result) => {
      result.errors.forEach(({ text, location }) => {
        console.error(`✘ [ERROR] ${text}`);
        if (location) {
          console.error(`    ${location.file}:${location.line}:${location.column}:`);
        }
      });
      console.log('[watch] build finished');
    });
  },
};

/**
 * CSS extraction plugin
 */
const cssExtractPlugin = {
  name: 'css-extract',
  setup(build) {
    const cssContents = [];
    build.onLoad({ filter: /\.css$/ }, async (args) => {
      const css = await fs.promises.readFile(args.path, 'utf8');
      cssContents.push(css);
      return { contents: '', loader: 'js' };
    });
    build.onEnd(async () => {
      if (cssContents.length > 0) {
        const outdir = path.dirname(build.initialOptions.outfile);
        const cssFile = path.join(outdir, 'main.css');
        await fs.promises.mkdir(outdir, { recursive: true });
        await fs.promises.writeFile(cssFile, cssContents.join('\n'));
        cssContents.length = 0;
      }
    });
  },
};

/**
 * Copy prompts plugin
 */
const copyPromptsPlugin = {
  name: 'copy-prompts',
  setup(build) {
    build.onEnd(async () => {
      const srcDir = path.join(__dirname, 'prompts');
      const destDir = path.join(__dirname, 'dist', 'standalone', 'prompts');
      async function copyDir(src, dest) {
        await fs.promises.mkdir(dest, { recursive: true });
        const entries = await fs.promises.readdir(src, { withFileTypes: true });
        for (const entry of entries) {
          const srcPath = path.join(src, entry.name);
          const destPath = path.join(dest, entry.name);
          if (entry.isDirectory()) {
            await copyDir(srcPath, destPath);
          } else {
            await fs.promises.copyFile(srcPath, destPath);
          }
        }
      }
      if (fs.existsSync(srcDir)) {
        await copyDir(srcDir, destDir);
        console.log('[prompts] Copied prompt templates');
      }
    });
  },
};

/**
 * vscode → electron/vscodeShim alias plugin
 * Uses onResolve with namespace to intercept vscode imports
 */
const vscodeShimPlugin = {
  name: 'vscode-shim',
  setup(build) {
    build.onResolve({ filter: /^vscode$/ }, (args) => {
      if (args.path === 'vscode') {
        return {
          path: path.resolve(__dirname, 'electron', 'vscodeShim.ts'),
        };
      }
      return undefined;
    });
  },
};

async function main() {
  const outdir = path.join(__dirname, 'dist', 'standalone');

  // 1. Webview build (Browser, React)
  const webviewCtx = await esbuild.context({
    entryPoints: ['webview/main.tsx'],
    bundle: true,
    format: 'iife',
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: 'browser',
    outfile: path.join(outdir, 'webview', 'main.js'),
    logLevel: 'silent',
    plugins: [cssExtractPlugin, esbuildProblemMatcherPlugin],
  });

  // 2. Electron main process (Node) — thin launcher, appEntry loaded at runtime
  const mainCtx = await esbuild.context({
    entryPoints: ['electron/main.ts'],
    bundle: true,
    format: 'cjs',
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: 'node',
    outfile: path.join(outdir, 'main.js'),
    external: ['electron', './appEntry.js'],
    logLevel: 'silent',
    plugins: [esbuildProblemMatcherPlugin],
  });

  // 3. Electron preload (Node, but with browser-ish APIs)
  const preloadCtx = await esbuild.context({
    entryPoints: ['electron/preload.ts'],
    bundle: true,
    format: 'cjs',
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: 'node',
    outfile: path.join(outdir, 'preload.js'),
    external: ['electron'],
    logLevel: 'silent',
    plugins: [esbuildProblemMatcherPlugin],
  });

  // 4. Backend (Codemap logic) with vscode shimmed
  const backendCtx = await esbuild.context({
    entryPoints: ['electron/appEntry.ts'],
    bundle: true,
    format: 'cjs',
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: 'node',
    outfile: path.join(outdir, 'appEntry.js'),
    external: ['electron'],
    logLevel: 'silent',
    plugins: [
      vscodeShimPlugin,
      copyPromptsPlugin,
      esbuildProblemMatcherPlugin,
    ],
  });

  // 5. Copy HTML template
  const copyHtmlPlugin = {
    name: 'copy-html',
    setup(build) {
      build.onEnd(async () => {
        const srcHtml = path.join(__dirname, 'electron', 'webview.html');
        const destHtml = path.join(outdir, 'webview', 'index.html');
        await fs.promises.mkdir(path.dirname(destHtml), { recursive: true });
        await fs.promises.copyFile(srcHtml, destHtml);
        console.log('[html] Copied webview.html');
      });
    },
  };

  // Add HTML copy to webview build
  const webviewCtx2 = await esbuild.context({
    entryPoints: ['webview/main.tsx'],
    bundle: true,
    format: 'iife',
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: 'browser',
    outfile: path.join(outdir, 'webview', 'main.js'),
    logLevel: 'silent',
    plugins: [cssExtractPlugin, copyHtmlPlugin, esbuildProblemMatcherPlugin],
  });

  // Dispose the duplicate context (we'll use webviewCtx2)
  await webviewCtx.dispose();

  if (watch) {
    await Promise.all([
      webviewCtx2.watch(),
      mainCtx.watch(),
      preloadCtx.watch(),
      backendCtx.watch(),
    ]);
  } else {
    await webviewCtx2.rebuild();
    await mainCtx.rebuild();
    await preloadCtx.rebuild();
    await backendCtx.rebuild();
    await webviewCtx2.dispose();
    await mainCtx.dispose();
    await preloadCtx.dispose();
    await backendCtx.dispose();
  }

  console.log('[standalone] Build complete →', outdir);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});

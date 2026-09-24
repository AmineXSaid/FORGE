import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { createSvgIconsPlugin } from 'vite-plugin-svg-icons';

/**
 * `vite-plugin-svg-icons`, with its `load` hook limited to its own two
 * virtual modules.
 *
 * In a build, version 2.0.1's `load` calls `createModuleCode()` -- a
 * synchronous glob and stat of every icon, and a 1 MB sprite string -- for
 * **every** module in the app, and only then checks whether the id is one of
 * its own. That is modules x 1,160 icons: the webview build stalled in
 * "transforming..." for 25 minutes and more (2026-09-24), where without the
 * plugin it finishes in 26 seconds. A hook filter keeps the bundler from
 * calling it for anything else; the plugin's own output is unchanged.
 */
function svgIcons(options: Parameters<typeof createSvgIconsPlugin>[0]) {
  const plugin = createSvgIconsPlugin(options);
  const load = plugin.load as (this: unknown, id: string, ...rest: unknown[]) => unknown;
  return {
    ...plugin,
    load: {
      filter: { id: /^virtual:svg-icons-(register|names)$/ },
      handler(this: unknown, id: string, ...rest: unknown[]) {
        return load.call(this, id, ...rest);
      },
    },
  } as typeof plugin;
}

export default defineConfig(() => ({
  root: __dirname,
  server: {
    port: Number(process.env.VITE_DEV_PORT) || 5173,
    strictPort: true,
    fs: {
      // 允许从工作区根目录及外部资源目录读取文件（用于别名资源与图标目录）
      allow: [
        path.resolve(__dirname, '../..'),
        path.resolve(__dirname, '../../assets'),
        path.resolve(__dirname, '../../resources'),
        path.resolve(__dirname, '../../node_modules'),
      ],
    },
  },
  plugins: [
    vue(),
    tailwindcss(),
    svgIcons({
      iconDirs: [path.resolve(__dirname, '../../assets/icons')],
      symbolId: 'icon-[name]',
      svgoOptions: true,
    }),
    {
      name: 'filter-mdi-fonts',
      generateBundle(options, bundle) {
        // 只保留 woff2 格式的 MDI 字体，删除其他格式
        for (const fileName of Object.keys(bundle)) {
          if (fileName.includes('materialdesignicons-webfont') && !fileName.endsWith('.woff2')) {
            delete bundle[fileName];
          }
        }
      },
    },
    {
      name: 'copy-svg-icons-to-media',
      apply: 'build',
      async writeBundle(options) {
        const srcDir = path.resolve(__dirname, '../../assets/icons');
        const outDir = (options as any).dir || path.resolve(__dirname, '../../dist/media');
        const destDir = path.resolve(outDir, 'icons');

        async function ensureDir(dir: string) {
          await fsp.mkdir(dir, { recursive: true });
        }

        async function copyDir(src: string, dest: string) {
          await ensureDir(dest);
          const entries = await fsp.readdir(src, { withFileTypes: true });
          for (const entry of entries) {
            const s = path.join(src, entry.name);
            const d = path.join(dest, entry.name);
            if (entry.isDirectory()) {
              await copyDir(s, d);
            } else if (entry.isFile()) {
              await fsp.copyFile(s, d);
            }
          }
        }

        if (fs.existsSync(srcDir)) {
          await copyDir(srcDir, destDir);
        }
      },
    },
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // 使用本地的 codicon 资源替换依赖包中的资源
      '@vscode/codicons/dist/codicon.css': path.resolve(__dirname, '../../assets/codicons/codicon.css'),
      '@vscode/codicons/dist/codicon.ttf': path.resolve(__dirname, '../../assets/codicons/codicon.ttf'),
    },
  },
  base: '',
  build: {
    outDir: path.resolve(__dirname, '../../dist/media'),
    emptyOutDir: true,
    assetsDir: '',
    sourcemap: false,
    rolldownOptions: {
      output: {
        entryFileNames: 'main.js',
        assetFileNames: (assetInfo) => {
          const name = assetInfo.name ?? '';
          if (name.endsWith('.css')) return 'style.css';
          if (name.includes('materialdesignicons-webfont') && name.endsWith('.woff2')) {
            return 'materialicon.woff2';
          }
          return '[name][extname]';
        },
      },
    },
  },
}));

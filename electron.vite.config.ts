import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'node:path'
import { fileViewerRenderers } from '@file-viewer/vite-plugin'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
        },
        external: [
          'electron',
          'better-sqlite3',
          'croner',
        ],
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        external: ['electron'],
        output: {
          format: 'cjs',
        },
        input: {
          index: resolve(__dirname, 'src/preload/index.ts'),
        },
      },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src/renderer/src'),
        '@shared': resolve(__dirname, 'src/shared'),
        '@renderer': resolve(__dirname, 'src/renderer/src'),
      },
    },
    plugins: [
      vue({
        template: {
          compilerOptions: {
            // Electron <webview> 是原生自定义元素，避免 Vue 尝试解析为组件
            isCustomElement: (tag) => tag === 'webview',
          },
        },
      }),
      // File Viewer 渲染器装配 + Worker/WASM 资产复制
      // preset-office 已在依赖中，插件自动发现并注册
      fileViewerRenderers({
        preset: 'office',
        copyAssets: true,
        chunkStrategy: 'renderer',
      }),
    ],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
        },
      },
    },
  },
})

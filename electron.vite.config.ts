import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'
import unocss from 'unocss/vite'
import { resolve } from 'node:path'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
        },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
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
    plugins: [vue(), unocss()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
        },
      },
    },
  },
})

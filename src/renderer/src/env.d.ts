/// <reference types="electron-vite/node" />

import type { ElectronAPI } from './types/electron-api'

declare interface Window {
  electron: ElectronAPI
}

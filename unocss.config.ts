import { defineConfig, presetUno, presetAttributify } from 'unocss'

export default defineConfig({
  preflights: false,
  presets: [presetUno(), presetAttributify()],
})

import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'

const app = createApp(App)

// 抑制 ResizeObserver 无害警告（naive-ui 内部 resize 处理触发）
app.config.errorHandler = (err) => {
  if (err instanceof Error && err.message.includes('ResizeObserver loop')) return
  console.error(err)
}

app.use(createPinia())
app.mount('#app')

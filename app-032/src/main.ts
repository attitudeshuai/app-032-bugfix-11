import { createApp } from 'vue'
import App from './App.vue'
import { router } from './router'
import { loadStore } from './core/store'

loadStore()

createApp(App).use(router).mount('#app')

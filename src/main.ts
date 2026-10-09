import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import './assets/main.css'
import { vModalFocus } from './directives/modalFocus'

createApp(App).directive('modal-focus', vModalFocus).use(createPinia()).use(router).mount('#app')

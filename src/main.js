import './assets/main.css'

import { createApp } from 'vue'
import App from './App.vue'
import { registerSW } from 'virtual:pwa-register'

// Service Worker を登録（本番ビルド時のみ有効化）
// 新しい版が利用可能な時や、オフライン準備完了時にコンソールに表示
if ('serviceWorker' in navigator) {
  registerSW({
    immediate: true,
    onNeedRefresh() {
      console.log('[PWA] 新しいバージョンがあります。ページを再読み込みしてください。')
    },
    onOfflineReady() {
      console.log('[PWA] オフラインで利用できるようになりました。')
    },
  })
}

createApp(App).mount('#app')

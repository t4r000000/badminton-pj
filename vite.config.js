import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  // 相対パスでホストしてもオフラインで開けるようにする
  base: './',
  plugins: [
    vue(),
    vueDevTools(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'pwa.svg'],
      manifest: {
        name: 'バドミントン ダブルス組み合わせ',
        short_name: 'バドミントン組み合わせ',
        description:
          'バドミントン ダブルス対戦の組み合わせ生成 / 対戦履歴 / 勝敗記録 (オフライン対応)',
        theme_color: '#0a6b4a',
        background_color: '#f1f5f3',
        display: 'standalone',
        start_url: './',
        scope: './',
        lang: 'ja',
        icons: [
          {
            src: 'pwa.svg',
            sizes: '192x192 512x512',
            type: 'image/svg+xml',
            purpose: 'any',
          },
          {
            src: 'pwa-maskable.svg',
            sizes: '512x512',
            type: 'image/svg+xml',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        // SPA なのでナビゲーションはすべて index.html に
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
      },
      devOptions: {
        enabled: false, // dev サーバーでは SW を有効化しない（混乱を避ける）
      },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})

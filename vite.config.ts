import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  base: './',
  plugins: [react(), VitePWA({
    registerType: 'autoUpdate',
    includeAssets: ['icon.svg'],
    manifest: {
      name: 'ふたりの予定', short_name: 'ふたりの予定', description: '夫婦で共有するシンプルなリマインダー',
      theme_color: '#f7f8fc', background_color: '#f7f8fc', display: 'standalone', lang: 'ja', start_url: './',
      icons: [
        { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }
      ]
    },
    workbox: { navigateFallback: 'index.html' }
  })]
})

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

const apiUrl = process.env.VITE_API_URL

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    // APP_HOST reaches this container only as the host part of VITE_API_URL
    allowedHosts: apiUrl?.startsWith('http') ? [new URL(apiUrl).hostname] : [],
    proxy: {
      '/api': {
        target: process.env.VITE_API_URL || 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
})

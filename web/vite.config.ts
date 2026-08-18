import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Proxy /api → backend do Almoxarifado (uvicorn app:app --port 8100)
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5180,
    proxy: {
      '/api': { target: 'http://127.0.0.1:8100', changeOrigin: true },
    },
  },
})

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import cesium from 'vite-plugin-cesium'

export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/KrigingTS/' : '/',
  plugins: [vue(), cesium()],
  resolve: {
    alias: {
      '@': '/src'
    }
  }
}))

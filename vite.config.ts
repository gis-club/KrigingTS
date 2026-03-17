import { defineConfig, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'
import cesium from 'vite-plugin-cesium'
import fs from 'fs'
import path from 'path'

function fixCesiumBase(base: string): Plugin {
  return {
    name: 'fix-cesium-base',
    enforce: 'post',
    closeBundle: {
      order: 'post',
      sequential: true,
      async handler() {
        const distDir = path.resolve(__dirname, 'dist')
        const wrongDir = path.resolve(distDir, base.replace(/^\/|\/$/g, ''))
        if (fs.existsSync(wrongDir)) {
          const entries = fs.readdirSync(wrongDir)
          for (const entry of entries) {
            const src = path.join(wrongDir, entry)
            const dest = path.join(distDir, entry)
            fs.renameSync(src, dest)
          }
          fs.rmdirSync(wrongDir)
        }
      }
    }
  }
}

const BASE = '/KrigingTS/'

export default defineConfig({
  base: BASE,
  plugins: [
    vue(),
    cesium(),
    fixCesiumBase(BASE)
  ],
  resolve: {
    alias: {
      '@': '/src'
    }
  }
})

import { rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import { vditorDevPlugin, vditorProdBuildPlugin } from './vite/vditorPlugin'

const cwd = process.cwd()
const argv = process.argv
const isProdBuild = argv.includes('build') && argv.some((arg) => arg.includes('production'))

if (isProdBuild) {
  rmSync(resolve(cwd, 'out'), { recursive: true, force: true })
}

if (argv.join(',').includes('mode')) {
  void import('./build')
}

// The Markdown editor webview is built from the embedded vditor (see vditor/).
// This vite config only orchestrates the extension host build (build.ts) and
// the vditor build; the root index.html is a placeholder entry for vite.
export default defineConfig(({ command }) => ({
  plugins: [
    command === 'serve' ?
      vditorDevPlugin() : vditorProdBuildPlugin()
  ],
  define: {
    global: 'globalThis',
  },
  server: {
    cors: {
      origin: true,
    },
    host: '127.0.0.1',
    port: 5739,
    fs: {
      allow: ['..'],
    },
  },
  base: '',
}))

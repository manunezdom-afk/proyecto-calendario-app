import { existsSync, mkdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const candidates = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
]

const chrome = candidates.find(existsSync)
if (!chrome) {
  console.error('No se encontró Chrome ni Edge.')
  process.exit(1)
}

const input   = pathToFileURL(resolve('scripts/icon-template.html')).href
const outDir  = resolve('public/icons')
mkdirSync(outDir, { recursive: true })

const targets = [
  { size: 180, file: 'apple-touch-icon.png' },
  { size: 192, file: 'icon-192.png' },
  { size: 512, file: 'icon-512.png' },
  { size: 32,  file: 'favicon-32.png' },
]

for (const { size, file } of targets) {
  const output = resolve(outDir, file)
  const args = [
    '--headless',
    '--disable-gpu',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    `--window-size=${size},${size}`,
    '--virtual-time-budget=10000',
    `--screenshot=${output}`,
    `${input}?v=${Date.now()}`,
  ]
  const { status } = spawnSync(chrome, args, { stdio: 'inherit' })
  if (status !== 0) {
    console.error(`Falló al renderizar ${file}`)
    process.exit(status ?? 1)
  }
  console.log(`✓ ${file} (${size}×${size})`)
}

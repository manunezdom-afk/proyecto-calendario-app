import { existsSync, mkdirSync, unlinkSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import sharp from 'sharp'

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

const input  = pathToFileURL(resolve('scripts/icon-template.html')).href
const outDir = resolve('public/icons')
mkdirSync(outDir, { recursive: true })

const masterSize = 1024
const master = resolve(outDir, '_master.png')

const args = [
  '--headless',
  '--disable-gpu',
  '--hide-scrollbars',
  '--force-device-scale-factor=1',
  `--window-size=${masterSize},${masterSize}`,
  '--virtual-time-budget=5000',
  `--screenshot=${master}`,
  input,
]
const { status } = spawnSync(chrome, args, { stdio: 'inherit' })
if (status !== 0) {
  console.error('Falló el render del master')
  process.exit(status ?? 1)
}

const meta = await sharp(master).metadata()
const side = Math.min(meta.width, meta.height)

const targets = [
  { size: 180, file: 'apple-touch-icon.png' },
  { size: 192, file: 'icon-192.png' },
  { size: 512, file: 'icon-512.png' },
  { size: 32,  file: 'favicon-32.png' },
]

for (const { size, file } of targets) {
  await sharp(master)
    .extract({ left: 0, top: 0, width: side, height: side })
    .resize(size, size, { fit: 'cover', kernel: 'lanczos3' })
    .png({ compressionLevel: 9 })
    .toFile(resolve(outDir, file))
  console.log(`✓ ${file} (${size}×${size})`)
}

unlinkSync(master)

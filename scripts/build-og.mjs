import { existsSync } from 'node:fs'
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
  console.error('No se encontró Chrome ni Edge. Instalá alguno o editá scripts/build-og.mjs')
  process.exit(1)
}

const input  = pathToFileURL(resolve('landing/og-template.html')).href
const output = resolve('public/landing/og.png')

const args = [
  '--headless=new',
  '--disable-gpu',
  '--hide-scrollbars',
  '--window-size=1200,630',
  '--virtual-time-budget=10000',
  `--screenshot=${output}`,
  input,
]

const { status } = spawnSync(chrome, args, { stdio: 'inherit' })
process.exit(status ?? 0)

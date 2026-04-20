// Genera los splash screens de iOS (apple-touch-startup-image) a partir del
// icono principal + color de fondo del manifest.
//
// Uso: npm run build:splash
// Salida: public/splash/*.png

import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import sharp from 'sharp'

const OUT_DIR = resolve('public/splash')
mkdirSync(OUT_DIR, { recursive: true })

const manifest = JSON.parse(readFileSync(resolve('public/manifest.json'), 'utf8'))
const BG = manifest.background_color || '#0a0a0f'
const ICON_SRC = resolve('public/icons/icon-512.png')

// Device matrix: [width, height, descriptive name]
// Portrait, luego landscape. Los tamaños siguen la guía de Apple:
// https://developer.apple.com/design/human-interface-guidelines/foundations/layout
const SIZES = [
  [1290, 2796, 'iphone-15-pro-max'],
  [1179, 2556, 'iphone-15-pro'],
  [1284, 2778, 'iphone-14-plus'],
  [1170, 2532, 'iphone-14'],
  [1125, 2436, 'iphone-x'],
  [828, 1792, 'iphone-xr'],
  [750, 1334, 'iphone-8'],
  [1668, 2388, 'ipad-pro-11'],
  [2048, 2732, 'ipad-pro-12-9'],
]

// Icono centrado ocupando ~30% del menor lado.
for (const [w, h] of SIZES) {
  const iconSize = Math.round(Math.min(w, h) * 0.3)
  const icon = await sharp(ICON_SRC)
    .resize(iconSize, iconSize, { fit: 'contain', background: BG })
    .png()
    .toBuffer()

  const out = await sharp({
    create: { width: w, height: h, channels: 4, background: BG },
  })
    .composite([{ input: icon, gravity: 'center' }])
    .png()
    .toBuffer()

  const filename = `splash-${w}x${h}.png`
  writeFileSync(resolve(OUT_DIR, filename), out)
  console.log('✓', filename)

  // Landscape (solo para iPads; los iPhone PWAs usan portrait)
  if (w >= 1600) {
    const outLand = await sharp({
      create: { width: h, height: w, channels: 4, background: BG },
    })
      .composite([{ input: icon, gravity: 'center' }])
      .png()
      .toBuffer()
    const filenameLand = `splash-${h}x${w}.png`
    writeFileSync(resolve(OUT_DIR, filenameLand), outLand)
    console.log('✓', filenameLand)
  }
}

console.log(`\n${SIZES.length}+ splash screens generados en public/splash/`)

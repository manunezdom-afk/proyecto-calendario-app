// Genera el AppIcon 1024×1024 que necesita Xcode/App Store
// a partir de public/icons/icon-512.png (o del template HTML si existe Chrome).
//
// Uso:
//   npm run build:ios-icons
//
// Lo escribe en ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png
// (ese filename lo usa Capacitor por convención; representa el icono universal 1024)

import { existsSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import sharp from 'sharp'

const SOURCE = resolve('public/icons/icon-512.png')
const OUT_DIR = resolve('ios/App/App/Assets.xcassets/AppIcon.appiconset')
const OUT_FILE = resolve(OUT_DIR, 'AppIcon-512@2x.png')

if (!existsSync(SOURCE)) {
  console.error(`No existe ${SOURCE}. Corré primero: npm run build:icons`)
  process.exit(1)
}

if (!existsSync(OUT_DIR)) {
  console.error(`No existe ${OUT_DIR}. Corré primero: npx cap add ios`)
  process.exit(1)
}

// App Store NO permite alpha en el AppIcon. Aplanamos sobre el fondo de la app.
await sharp(SOURCE)
  .resize(1024, 1024, { fit: 'cover', kernel: 'lanczos3' })
  .flatten({ background: { r: 10, g: 10, b: 15 } })
  .png({ compressionLevel: 9 })
  .toFile(OUT_FILE)

console.log(`✓ AppIcon 1024×1024 generado en ${OUT_FILE}`)
mkdirSync(OUT_DIR, { recursive: true })

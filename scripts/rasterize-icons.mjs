import sharp from 'sharp'
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const iconsDir = resolve(__dirname, '..', 'public', 'icons')

const svgBuf = await readFile(resolve(iconsDir, 'icon.svg'))

const targets = [
  { name: 'favicon-32.png', size: 32 },
  { name: 'apple-touch-icon-120.png', size: 120 },
  { name: 'apple-touch-icon-152.png', size: 152 },
  { name: 'apple-touch-icon-167.png', size: 167 },
  { name: 'apple-touch-icon.png', size: 180 },
  { name: 'icon-192.png', size: 192 },
  { name: 'icon-512.png', size: 512 },
  { name: 'icon-1024.png', size: 1024 },
]

for (const { name, size } of targets) {
  const out = resolve(iconsDir, name)
  const png = await sharp(svgBuf, { density: 384 })
    .resize(size, size, { fit: 'cover' })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer()
  await writeFile(out, png)
  console.log(`wrote ${name} (${size}×${size}, ${png.length} bytes)`)
}

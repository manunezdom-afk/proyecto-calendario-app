// Genera el AppIcon 1024×1024 de la app iOS NATIVA (ios-native/) a partir
// de un SVG que replica 1:1 la marca `FocusLogoMark` de SwiftUI
// (ios-native/Focus/Shared/SharedComponents.swift): gradiente diagonal de
// 4 paradas (electric cobalt → focus blue → deep navy → hint violet),
// halo radial blanco, autofocus brackets con glow y punto central con glow.
//
// Uso:
//   node scripts/build-native-ios-icon.mjs
//
// Notas:
// - iOS aplica la máscara squircle — el PNG va full-bleed cuadrado.
// - App Store NO permite canal alpha en el AppIcon → .flatten().
// - Si cambias la marca en SwiftUI, cambia el SVG aquí y regenera: el ícono
//   del home screen y el logo dentro de la app deben ser la misma cosa.
//
// Geometría (fracciones de `size` en FocusLogoMark, escaladas a 1024):
//   box brackets 0.58 → 594 (half 297) · largo 0.137 → 140 · grosor 0.022
//   → 23 · dot 0.186 → Ø190 · halo endRadius 0.42 → 430 sobre círculo 0.92.

import { resolve } from 'node:path'
import sharp from 'sharp'

const OUT = resolve('ios-native/Focus/Assets.xcassets/AppIcon.appiconset/AppIcon.png')

// Brackets: esquinas de un cuadrado invisible centrado (cx=cy=512).
const C = 512
const HALF = 297   // 0.58 × 1024 / 2
const LEN = 140    // 0.137 × 1024
const T = 23       // 0.022 × 1024
const R = T / 2

const brackets = [
  // [x, y, w, h] — dos brazos por esquina, igual que FocusBracketsMark.
  [C - HALF, C - HALF, LEN, T], [C - HALF, C - HALF, T, LEN],             // TL
  [C + HALF - LEN, C - HALF, LEN, T], [C + HALF - T, C - HALF, T, LEN],   // TR
  [C - HALF, C + HALF - T, LEN, T], [C - HALF, C + HALF - LEN, T, LEN],   // BL
  [C + HALF - LEN, C + HALF - T, LEN, T], [C + HALF - T, C + HALF - LEN, T, LEN], // BR
]

const rects = brackets
  .map(([x, y, w, h]) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${R}"/>`)
  .join('\n      ')

const svg = `<svg width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1024" y2="1024" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#3B82F6"/>
      <stop offset="0.40" stop-color="#2563EB"/>
      <stop offset="0.85" stop-color="#182F82"/>
      <stop offset="1" stop-color="#2E2185"/>
    </linearGradient>
    <radialGradient id="halo" cx="512" cy="512" r="430" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#FFFFFF" stop-opacity="0.32"/>
      <stop offset="0.55" stop-color="#A6CCFF" stop-opacity="0.16"/>
      <stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/>
    </radialGradient>
    <filter id="glowSoft" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="26"/>
    </filter>
    <filter id="glowDot" x="-80%" y="-80%" width="260%" height="260%">
      <feGaussianBlur stdDeviation="36"/>
    </filter>
  </defs>

  <rect width="1024" height="1024" fill="url(#bg)"/>
  <circle cx="512" cy="512" r="471" fill="url(#halo)"/>

  <!-- Glow blanco difuso debajo de los brackets (shadow radius 0.025) -->
  <g fill="#FFFFFF" opacity="0.5" filter="url(#glowSoft)">
      ${rects}
  </g>
  <g fill="#FFFFFF">
      ${rects}
  </g>

  <!-- Punto central con glow premium (0.186 Ø, shadow 0.07) -->
  <circle cx="512" cy="512" r="95" fill="#FFFFFF" opacity="0.7" filter="url(#glowDot)"/>
  <circle cx="512" cy="512" r="95" fill="#FFFFFF"/>
</svg>`

await sharp(Buffer.from(svg))
  .resize(1024, 1024)
  .flatten({ background: { r: 37, g: 99, b: 235 } })
  .png({ compressionLevel: 9 })
  .toFile(OUT)

const meta = await sharp(OUT).metadata()
console.log(`✓ AppIcon nativo regenerado: ${OUT} (${meta.width}×${meta.height}, canales: ${meta.channels})`)

# Icono orbital de Focus

7 de septiembre de 2026. Sustituye las esquinas de escáner y el punto central del icono anterior por una marca orbital azul/lavanda sobre tinta, coherente con el rediseño nativo.

Asset final: [AppIcon.png](../../ios-native/Focus/Assets.xcassets/AppIcon.appiconset/AppIcon.png), PNG opaco de 1024 × 1024. Se conserva el set `AppIcon`, seleccionado en Debug y Release. No hay iconos alternativos. Build 26 tanto para la app como para el widget.

## Generación

Generado con la herramienta integrada de imágenes, modo generación nueva; una imagen, sin referencias externas. Original conservado en `.codex/generated_images/01a07d6c-9ac8-7d32-9e60-1ee6bca22d62/exec-d26920b8-8184-4584-9891-ce33e6400bf8.png` dentro del directorio del usuario. La salida de 1254 × 1254 se normalizó a 1024 × 1024 con `sips`; no se alteró el diseño ni se añadieron esquinas redondeadas.

Prompt utilizado:

> Use case: logo-brand. Create ONE finished iOS app icon asset for Focus, a premium personal productivity app that turns mental clutter into concrete tasks. Output a single square 1024 x 1024 image, fully opaque, with the design filling the canvas edge to edge. This is the actual icon artwork, NOT a phone mockup, NOT a presentation sheet. The current app's identity is pearl/ink with cobalt and iris light, and its new mark is orbital. Design: a large, precisely centered sculptural orbital mark made from TWO overlapping rounded-diamond loops, as smooth continuous satin ribbons crossing naturally into one compact elegant symbol with a clearly open central space. Shape should read like a refined focusing orbit, vertically balanced, not a sideways infinity sign. It must be instantly legible at 60 pixels; simple, bold silhouette, generous negative space. The mark occupies about 64 percent of the canvas. Ribbon colors move subtly from icy blue-white at the upper left to cool lavender/iris at the lower right; restrained material depth and soft highlights, more polished graphic than shiny 3D toy. Background is uninterrupted near-black blue ink (#0D111C), with an extremely subtle diffuse cobalt/iris ambient light immediately behind the mark. Premium, slightly futuristic, quiet and distinctive. No letters, no words, no captions, no watermark. No star, no sparkles, no camera scanning brackets, no central dot. No decorative particles or tiny details. Do not bake rounded outer corners, border, bevelled app tile, or external shadow into the asset; the entire square is filled with opaque ink background so iOS applies its own mask.

## Verificación

- Fuente inspeccionada visualmente; dimensiones y ausencia de transparencia verificadas con `sips`.
- Se actualiza sobre `me.usefocus.app` con el mismo equipo de firma y permisos. No requiere desinstalación, cambios de almacenamiento ni argumentos de pruebas en el dispositivo real.
- Compilación Debug para iOS correcta y firma verificada con `codesign --verify --deep --strict`. El `Info.plist` compilado selecciona `AppIcon` como icono principal y declara build 26.
- Icono de 120 × 120 del paquete inspeccionado visualmente tras decodificar la optimización PNG de Apple con `pngcrush`; corresponde al nuevo orbital y es legible en tamaño pequeño.
- Actualización instalada sobre la app existente en el iPhone 16 de Martín. `devicectl device info apps --bundle-id me.usefocus.app` confirmó versión 1.0 y build 26; lanzamiento normal correcto. No se desinstaló la app ni se usaron fixtures.
- Evidencia local: `/tmp/focus-icon-device-build.log`, `/tmp/focus-icon-install.json`, `/tmp/focus-icon-installed-app.json`, `/tmp/focus-icon-launch.json`. La comprobación del icono es del recurso empaquetado; no se obtuvo captura del Home Screen físico.

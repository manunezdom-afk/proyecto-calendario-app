# Hilante — nombre del asistente de Focus

Decisión de producto: 7 de septiembre de 2026. Reemplaza el nombre visible **Nova** por **Hilante**. Focus conserva su nombre y su icono orbital.

## Por qué Hilante

Se pronuncia **i-LAN-te**, tiene siete letras, tres sílabas y no necesita tilde. La asociación propuesta es **hilar lo que tienes en mente hasta convertirlo en un siguiente paso**. Se conecta con la captura de intenciones y las cintas orbitales de Focus. El verbo *hilar* admite relacionar, unir y enlazar, según el [DLE](https://dle.rae.es/hilar); la promesa de producto es una construcción de marca, no una definición oficial de «Hilante».

La evaluación favorece una palabra cálida con una imagen reconocible. No se hicieron pruebas de recuerdo con usuarios: la facilidad de recuerdo es una hipótesis de diseño. Sus límites concretos son la H muda —al oírlo puede escribirse «Ilante»— y la posible lectura rápida como «hilarante». En inglés la pronunciación puede variar.

## Contraste y descartes

Se investigaron nombres exactos, variantes y combinaciones con app, asistente, AI, software, productividad y calendario. Las consultas incluyeron fuentes de producto, tiendas y referencias lingüísticas. El contraste amplio y sus fuentes están en [investigación de producto](NAMING_CANDIDATES_TECH.md) y [contraste verbal](NAMING_CANDIDATES_UX.md).

| Candidato | Decisión y evidencia determinante |
|---|---|
| Hilante | Elegido por ajuste conceptual y menor coincidencia directa en asistentes encontrados. Existe una [marca de moda homónima](https://karensq11.wixsite.com/hilante). |
| Cauro | Excelente sonido; descartado por una [agencia de creatividad y tecnología de Prensa Ibérica](https://www.linkedin.com/company/agenciacauro) que ya utiliza la misma metáfora del viento. |
| Pliegue | Imagen concreta de dar forma; peor pronunciación internacional y más impersonal como vocativo. |
| Orillo | Cercano a [Ovillo](https://app.ovillo.lat/), un copiloto con chat y tareas. |
| Nova | Coincide con un [chatbot móvil](https://chatnova.com/download) y otro [asistente de calendario y mensajes](https://novaassistant.ai/). |
| Arilo, Hilvo | Coincidencias directas con [captura de ideas y tareas](https://www.arilo.in/) y [gestión de proyectos](https://hilvo.app/). |
| Plico, Tildo | Coincidencias con [organización de pendientes](https://apps.apple.com/us/app/plico-time-to-focus-today/id6766375791) y [dictado para Mac](https://www.tildo.app/). |
| Rilva, Tildra | Ya usados para [un asistente empresarial](https://rilven.com/en/product/rilven-ai) y [resumen de artículos con IA](https://chromewebstore.google.com/detail/tildra-ai-powered-article/hoidpdngehcfbjcbbejokfohepkjlepc). |

## Comprobación directa de tiendas

El servicio Search de Apple se consultó el 7 de septiembre con `Hilante` en Chile, España y Estados Unidos. Devolvió 1, 1 y 4 resultados respectivamente; ninguno se titulaba Hilante. Sí apareció HILANET, y en Estados Unidos otras tres sugerencias. La variante `Ilante` produjo siete resultados distintos, incluido Ilant Health. Son resultados aproximados del buscador: no se interpretan como coincidencias exactas ni como catálogos completos. [Respuestas guardadas](qa/hilante-appstore-search.json).

Las búsquedas restringidas a Google Play y Chrome Web Store no mostraron un producto exacto llamado Hilante en este barrido. No se verificaron registros nacionales de marcas, disponibilidad en App Store Connect, dominios ni usuarios sociales. No se garantiza exclusividad o registrabilidad; la [OMPI distingue sus colecciones y los registros nacionales/regionales](https://www.wipo.int/en/web/global-brand-database).

## Uso e implementación

- Nombre visible: **Hilante**. Descriptor: «el asistente de Focus». Usarlo en navegación, encabezados y ajustes; las confirmaciones explican la acción realizada.
- iOS centraliza la identidad en `AssistantBrand.displayName`. El permiso del micrófono incluye el mismo nombre en `Info.plist`.
- Se conserva la representación interna `nova`: claves de almacenamiento, roles, rutas, IDs de accesibilidad, telemetría y contratos. El cambio no migra ni reescribe contenido del usuario.
- Los prompts del servidor se actualizan en origen. El historial previo se conserva literalmente, incluso si contiene «Nova». Las respuestas de un servidor anterior pueden seguir presentándose con ese nombre hasta publicar el backend; no se ocultan mediante sustituciones indiscriminadas.
- La interfaz web y sus páginas enlazadas se actualizan en origen para que la próxima publicación sea coherente.

El cambio queda en commits locales. No se publica el servidor, la web ni una versión de App Store en esta ejecución.

## Validación de la implementación

| Comprobación | Resultado |
|---|---|
| Backend | 254/254 pruebas aprobadas, incluidas seis nuevas para identidad, historial y contratos. Proveedores simulados; no se hicieron peticiones pagas de IA. |
| Web | Compilación Vite correcta, salida temporal fuera del repositorio. Se comprobaron sintaxis e identificadores de los componentes modificados. |
| Ejecución iOS | 23/23 pruebas aprobadas. Cuatro regresiones nuevas cubren conversación anterior, entidades llamadas Nova, bloqueo de acciones y diferencia entre cuota agotada y saturación temporal. |
| Recorrido iOS | Captura en Hoy → pendiente guardado → historial en Hilante aprobado. Conserva los IDs de accesibilidad existentes. |
| Imagen renderizada | Nombre Hilante completo y legible en respuesta y pestaña, con la misma marca orbital. [Captura del simulador](qa/visual/hilante-capture.png). |
| iPhone físico | Build Debug firmado y verificado; versión 1.0 (27) instalada sobre la anterior en el iPhone 16. `devicectl` confirmó el build. El lanzamiento automático fue rechazado porque el teléfono estaba bloqueado; no se inspeccionó visualmente su pantalla. |

Evidencia local: `/tmp/focus-hilante-backend-unit.log`, `/tmp/focus-hilante-web-build.log`, `/tmp/focus-hilante-native.xcresult`, `/tmp/focus-hilante-device.log`, `/tmp/focus-hilante-install.json`, `/tmp/focus-hilante-installed-app.json` y `/tmp/focus-hilante-launch.json`. Las comprobaciones de código y búsqueda no demuestran recuerdo real con usuarios ni ausencia de marcas similares.

Commits de implementación: `3bedab1` (web/servidor) y `e77677a` (iOS). Sin push ni publicación.

# Validación de Focus 2.0

Fecha: 2026-09-07. La evidencia corresponde al código local hasta `93563cc`, sobre `fc09049`, en `focus-os-dev`. No se desplegaron APIs, políticas ni migraciones, y no se publicaron builds.

## Resultados

| Verificación | Resultado y alcance |
|---|---|
| Backend | 248/248 pruebas Node. Incluye contratos, acciones inválidas, errores de proveedores, presupuestos, concurrencia de contadores y eliminación de cuenta simulada. |
| Lógica iOS | 42/42 XCTest en iPhone 17, iOS 26.4.1: 15 datos/sync, 19 ejecución de Nova y 8 ciclo de dictado. |
| Interfaz iPhone 17 | 7 recorridos aprobados entre las ejecuciones `ui-3` y `ui-4`. Captura e historial compartido; onboarding vacío; validación de correo y modo local; eventos; tareas; teclado/Ajustes; eliminación persistente. |
| Interfaz iPhone SE 3 | Los mismos 7 recorridos aprobados entre `small-ui-2` y `login-final`. El primer entorno se reinició al quedar detenido en instalación antes de ejecutar tests. |
| Revisión manual | Computer Use: onboarding, tarea manual, navegación, teclado, modo oscuro, Dynamic Type accessibility-large, rechazo real de voz y notificaciones, persistencia del aviso al relanzar. |
| Web | `npm run build` correcto. El frontend web conserva su recorrido existente. |
| Release iPhone | Compilación sin firma de distribución verificada. No equivale a un archivo firmado, validación de App Store ni prueba en hardware. |

Los primeros recorridos UI detectaron selectores de prueba que resolvían un contenedor de toolbar o buscaban texto donde iOS expone un botón. Se corrigieron los selectores tras comprobar la jerarquía de accesibilidad y el guardado real. La prueba de correo inválido ahora comprueba su error inline al enviar, que es el comportamiento del formulario.

Las pruebas de Nova también detectaron dos errores de producto corregidos: una frase hipotética creaba un elemento y una cita médica sin hora perdía su seguimiento. Las pruebas de datos verifican fallos de disco con rollback, reinicio offline, cambios durante una subida, respuestas de otra sesión, campos nulos y fechas civiles en Chile/Nueva Zelanda. Recuperar los mismos datos en cuentas distintas genera identificadores propios y conserva sus relaciones.

En el SE el teclado ocultaba el botón de acceso y el error quedaba fuera de vista: se redujo el encabezado y el envío cierra el teclado para mostrar la validación. El recorrido corregido pasa. Tras denegar notificaciones, un aviso persistente explica que no llegarán alertas y ofrece Ajustes; se verificó que conserva la navegación y permanece tras reinicio. La pantalla de dictado se abre completa para mostrar la recuperación sin recortar el mensaje en el SE. El snapshot final de lógica vuelve a aprobar 42/42 en `final-check`; los últimos cambios de presentación pasan build Debug/Release y revisión visual.

## Reproducir

```sh
npm run test:unit
npm run build
xcodebuild -project ios-native/Focus.xcodeproj -scheme Focus \
  -destination 'platform=iOS Simulator,name=Focus 2.0 QA' \
  -parallel-testing-enabled NO test
xcodebuild -project ios-native/Focus.xcodeproj -scheme Focus \
  -configuration Release -destination 'generic/platform=iOS' \
  CODE_SIGNING_ALLOWED=NO build
```

Los argumentos `--ui-testing`, `--reset-fixture` y `--onboarding` solo funcionan en Debug. Los tests usan datos sintéticos y almacenamiento temporal; el reset de fixture requiere explícitamente `--ui-testing`. No hay códigos OTP fijos ni bypass de autenticación en Release.

Capturas reales del simulador: [onboarding](qa/onboarding.png), [Hoy vacío](qa/home-empty.png), [captura](qa/capture-result.png), [Nova con teclado](qa/nova-keyboard.png), [formulario de evento](qa/event-edit.png), [Ajustes](qa/settings.png). Los `.xcresult` y logs completos de esta sesión se conservan en `/tmp/focus-2-*`; las capturas seleccionadas quedan versionadas aquí.

Pantalla pequeña: [teclado](qa/small-nova-keyboard.png), [correo inválido](qa/small-login-error.png), [modo oscuro](qa/small-dark.png), [texto grande](qa/small-large-text.png), [voz denegada](qa/voice-denied.png), [notificaciones denegadas](qa/notifications-denied.png).

## Límites comprobados y pendientes externos

- La cola de sincronización y el borrado de cuenta se probaron con transportes/servidores simulados. Falta validar con cuentas de prueba autorizadas y el esquema desplegado.
- No se enviaron peticiones pagadas a modelos. La lógica local, validadores, contratos y fallos de proveedores sí se probaron; la precisión y latencia de los modelos reales requieren un recorrido remoto autorizado.
- Los avisos usan una ventana de las próximas 64 notificaciones, descontando otros avisos de la app. Se rellena al activar, editar o recibir una notificación en foreground. iOS no garantiza ejecutar Focus para rellenarla mientras permanece cerrada. El cron APNs existente consulta eventos web; no es respaldo de los eventos nativos.
- El dictado exige un modelo local disponible. Se probaron denegación/cancelación/continuaciones tardías mediante inyección; el audio y su precisión requieren hardware real.
- La migración opcional `020_atomic_ai_usage.sql` no está aplicada. El fallback de contadores evita pérdidas habituales mediante compare-and-swap, pero comprobar una cuota y registrar consumo no reserva cuota para peticiones simultáneas.
- Firma, OTP real, sincronización entre dispositivos, entrega real de notificaciones, accesibilidad con VoiceOver en hardware y condiciones de proveedores se detallan en [RELEASE.md](RELEASE.md). No se certifican como terminados.

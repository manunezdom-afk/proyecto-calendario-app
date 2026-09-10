# Home + Hilante: pulido de presentación iOS

Alcance: vistas nativas Home/Hilante, composer, Markdown y estados de respuesta. Sin cambios en backend, transporte, contratos, modelos de IA ni persistencia de conversaciones.

## Relevancia de Home

- Solo se presenta el último mensaje si es de Hilante y no hay procesamiento, error o propuesta pendiente.
- Hasta 90 segundos: extracto de hasta seis líneas y dos recibos confirmados.
- Desde 90 segundos: texto compacto de dos líneas; los recibos de ejecución desaparecen.
- A los diez minutos, al cambiar el día o tras cambios en tareas/eventos: se retira suavemente. Se recalcula al volver del background.
- La regla es conservadora y local, no una interpretación semántica de IA. No mantiene consejos durante todo el día sin evidencia estructurada de vigencia.
- El botón «Ver en Hilante» abre el historial completo. La caducidad nunca borra ni reescribe mensajes; tampoco caduca propuestas pendientes de revisión.

## Interacción

UITextView conserva saltos, selección y scroll del cursor. Crece hasta cinco líneas (máximo absoluto: 160 pt), con controles fuera del área desplazable. Return inserta una línea; Enviar usa su botón. Home desplaza la fila del composer al aparecer el teclado y al crecer, manteniendo Dictar y Enviar visibles también con letra XXL. Altura y respuestas usan transiciones breves; Reduce Motion evita estas animaciones y deja estático el símbolo. Se conservan los haptics y las confirmaciones del ejecutor existente.

Foundation renderiza énfasis en bloques nativos: encabezados discretos, viñetas, numeración y saltos. Home ofrece un extracto; Hilante conserva el contenido completo.

## Verificación

Fixtures exclusivamente DEBUG, opt-in mediante `--ui-testing --reset-fixture --hilante-preview=short|long|compact|expired|expiring|thinking`. Sin red, credenciales ni datos reales. Las pruebas de esta misión están en `HilantePresentationTests` y `HilantePresentationUITests`.

La build de entrega se prepara desde HEAD más los cambios de esta misión en `/tmp/focus-home-polish-isolated`, para excluir modificaciones preexistentes, incluyendo consentimiento y ejecución.

### Resultado — 9 de septiembre de 2026

- Tres pruebas unitarias de Markdown/caducidad pasaron, junto al flujo existente de captura local e historial compartido.
- Las tres pruebas `HilantePresentationUITests` pasaron en iPhone SE (3.ª generación), iOS 26.5: entradas cortas/largas, crecimiento y contracción, scroll interno, teclado, respuestas cortas/largas, compactación, caducidad visible, historial y cancelación sin resultado prematuro.
- Revisión real con Simulator/Computer Use y capturas de XCTest, en claro y oscuro. La revisión con Dynamic Type XXL detectó controles ocultos por el teclado en Home; se corrigió y se repitió únicamente la prueba del composer en oscuro + XXL, con resultado satisfactorio.
- Reduce Motion activado en Configuración del simulador y confirmado (`ReduceMotionEnabled = 1`): símbolo de pensamiento estático y Cancelar visible. Los haptics existentes se conservaron; no se evaluó físicamente su sensación.
- Build Release aislada compilada e instalada mediante `devicectl` en «iPhone de Martin (2)», bundle `me.usefocus.app`, sin desinstalar ni reiniciar sus datos. Incluye la corrección final de teclado.
- No se probaron llamadas reales de IA ni se modificó backend. La relevancia sigue siendo una heurística local de tiempo/contexto, no una valoración semántica del contenido.

Evidencia local de esta ejecución: `/tmp/focus-home-polish-ui-final.xcresult`, `/tmp/focus-home-polish-large-fixed.xcresult`, `/tmp/focus-home-polish-final.log` (pruebas unitarias y captura local; ejecución posterior interrumpida por arranque del simulador), `/tmp/focus-home-polish-device-final.log` y `/tmp/focus-home-polish-install-final.log`. Las capturas se mantienen fuera del repositorio.

## Corrección de captura y Home contextual — 10 de septiembre de 2026

- Composer: se elimina la animación ligada a cada cambio de texto y el placeholder SwiftUI superpuesto. Un único UITextView controla texto, cursor y placeholder UIKit, ocultado de forma síncrona. La fuente solo se actualiza si cambia; SwiftUI no reinyecta valores durante la edición. Solo se anima la altura exterior, hasta cinco líneas/160 pt, con scroll interno. Las pruebas esperan que iOS termine de procesar el borrado masivo antes de comprobar el campo vacío.
- Compromisos: una gramática afirmativa de obligación/primera persona con hora concreta permite capturar acciones y destinos, conservando las reglas existentes de fecha/hora y las aclaraciones del contexto. Se preserva el verbo del título antes del parser genérico. Preguntas, negación, hipótesis, alternativas y referencias ambiguas quedan fuera de esa autorización local. No se modifica el backend ni la selección de modelos remotos.
- El caso «tengo que salir a las 3:20» se probó exactamente desde el composer: crea «Salir», hoy a las 15:20, escribe el snapshot local, aparece en Tu agenda, responde tras guardar y sobrevive al relanzamiento. Las cuatro variantes del encargo pasan con reloj sintético a las 10:00 del día actual. Se comprueban repetición sin duplicados y fallo de persistencia sin éxito falso.
- Ruta observada en ejecución: `local_parser`, razón `explicit_scheduled_commitment`, sin proveedor. Antes, la política local rechazaba esa gramática y exigía interpretación remota. La clasificación determinista del router remoto para las cuatro frases sin historial devuelve Luna (`everyday_request`); esto no demuestra qué modelo respondió en la conversación histórica del usuario, para la que no tenemos un trace de aquella solicitud.
- Home: encabezado contextual más corto; prioridad urgente primero, o agenda primero cuando no hay prioridades o el próximo evento está a menos de 90 minutos. La próxima cita tiene hora y título destacados sobre un fondo tonal. El resto de la agenda usa filas ligeras. Se omiten prioridades/agenda vacías y sus explicaciones redundantes; una jornada despejada conserva solo una línea y creación manual. La elegibilidad se refresca cada minuto.

### Comandos focalizados y evidencia

Proyecto aislado: `/tmp/focus-home-action-isolated/ios-native/Focus.xcodeproj`, construido desde HEAD más el delta de esta misión, sin cambios preexistentes de consentimiento/ejecución. En todos los comandos se usó `-scheme Focus -jobs 1 -disableAutomaticPackageResolution -skipPackageUpdates`.

- Lógica y recorrido: `xcodebuild ... -destination 'platform=iOS Simulator,id=9D4A1CB5-E19C-4303-9F9B-15B5B820AB06' -only-testing:FocusTests/ScheduledCommitmentTests -only-testing:FocusUITests/HomeCommitmentUITests -only-testing:FocusUITests/HilantePresentationUITests/testComposerKeepsMultilineTextAndControlsAboveKeyboard -parallel-testing-enabled NO test`. Las tres pruebas de compromisos, los cinco estados de Home y el caso exacto con relanzamiento pasaron. El primer intento detectó que el test de borrado comprobaba el valor antes de finalizar la inyección de teclas; se corrigió esa espera y se verificó el campo realmente vacío.
- Composer final: mismas opciones, seleccionando únicamente `HomeCommitmentUITests/testFastEditingOneToFiveLinesAndDeletion` y `HilantePresentationUITests/testComposerKeepsMultilineTextAndControlsAboveKeyboard`: aprobado. Evidencia `/tmp/focus-home-action-editing-settled.xcresult`.
- Computer Use: pegado real de cinco líneas, verificado en pantalla; captura `/tmp/focus-home-action-paste.png`. Sin duplicación visual del texto o placeholder. Revisión de los estados 0/1/3 prioridades, evento próximo y recomendación, con capturas en `/tmp/focus-home-action-screens`.
- Oscuro con movimiento normal: los cuatro recorridos UI focalizados aprobaron (`/tmp/focus-home-action-dark.xcresult`). En la revisión final se alineó el reloj de visibilidad del estado vacío con el de las respuestas, para no mostrar relleno junto a una recomendación; se repitió únicamente el test de estados de Home y pasó (`/tmp/focus-home-action-home-final.xcresult`).
- Release: `xcodebuild ... -configuration Release -destination 'generic/platform=iOS' build`. Instalación: `xcrun devicectl device install app --device 4F6149BC-79B3-5261-AB8F-A940C1E3CB60 /tmp/focus-home-polish-device/Build/Products/Release-iphoneos/Focus.app --timeout 60`, conservando datos del iPhone. Logs de entrega en `/tmp/focus-home-action-device-final.log` y `/tmp/focus-home-action-install-final.log`.
- Regresión final de sincronización: el representable recibe texto/foco como valores explícitos y devuelve cambios mediante callbacks; así SwiftUI invalida el editor al vaciar el draft. Se termina la edición antes de aplicar el borrado, incluido texto marcado. Se añadió una comprobación específica de campo vacío después de Enviar. La agenda relevante se sitúa antes de la confirmación, mientras pensamiento/error/propuesta siguen junto al composer. El caso exacto vuelve a probar evento visible sin desplazamiento y persistencia tras relanzar (`/tmp/focus-home-action-value-final.xcresult`).
- La suite de compromisos y el test existente que protege expresiones coloquiales ambiguas aprobaron: `/tmp/focus-home-action-routing-final.xcresult`. No se amplió esa autorización a referencias/destinos que requieren resolución semántica.

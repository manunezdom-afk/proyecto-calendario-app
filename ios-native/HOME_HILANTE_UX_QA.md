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

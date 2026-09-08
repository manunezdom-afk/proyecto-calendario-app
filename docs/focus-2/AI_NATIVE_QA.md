# Hilante: ejecución y pruebas nativas

Registro de la revisión del 8 de septiembre de 2026. Fuente iOS: `ios-native/Focus.xcodeproj`, scheme `Focus`. El nombre visible sigue siendo Hilante; los tipos, roles y claves `nova` conservan su compatibilidad.

## Cambios

- La captura y los accesos rápidos pasan por `FocusDataStore.sendNovaMessage`. El cliente comprueba consentimiento, cuenta, solicitud activa, modo, argumentos y referencias antes de ejecutar. Una respuesta sin acciones verificables no sirve de comprobante de guardado.
- Una propuesta de eliminación conserva IDs y versiones de los elementos revisados. Si cambian, exige otra revisión. Una respuesta remota tampoco puede sobrescribir una edición manual realizada durante la espera.
- El movimiento de un evento conserva su duración. El resolver usa calendario gregoriano y zona horaria: rechaza fechas imposibles y horas inexistentes o repetidas por DST. «De la mañana» es una franja, no el día siguiente. Los segmentos heredan el día anterior, nunca el de una instrucción posterior.
- La identidad de una solicitud pendiente se guarda por cuenta mediante UUID y hash del texto. El reintento ante resultado ambiguo conserva ese UUID. Un fallo terminal con `request_completed` y `request_retryable` confirmados permite otro UUID en el siguiente reintento explícito. Cambiar de objetivo o terminar/cancelar la solicitud lo invalida. El servidor recibe `X-Request-Id`.
- Los recibos `requestId:index` se guardan junto con los eventos, tareas y outbox. Las series recurrentes se preparan completas y se guardan en una sola transacción. `complete_task` expresa el estado final; se mantiene protección frente al replay de `toggle_task` legado.
- La memoria usa archivos atómicos por cuenta, con lectura de la copia anterior conservada. Los datos sensibles casuales no se aprenden automáticamente. Las credenciales y secretos no se guardan como memoria. El contexto remoto se limita a memorias pertinentes, no sensibles, hasta ocho entradas y 1.600 caracteres.

## Evidencia disponible

| Revisión | Resultado comprobado |
|---|---|
| Primer snapshot nativo | Compiló. 64 XCTest aprobados: 15 de datos, 8 de dictado y 41 de ejecución; 0 fallos, 1,740 s de ejecución de tests. |
| Batería anterior del parser | Se ejecuta desde XCTest y su lista de fallos hace fallar el test. Aprobada dentro de esos 64 tests. |
| Cuarto snapshot nativo | **78/78 XCTest aprobados**: 15 de datos, 8 de dictado y 55 de ejecución; 0 fallos, 2,819 s. Corrige la duración de un intervalo con AM/PM explícitos y evita mover fechas pasadas silenciosamente. |
| UI del tercer snapshot | **4/4 recorridos aprobados**, 193,966 s: captura compartida, aclaración sin duplicado, eliminación con revisión y relanzamiento, memoria consultable tras relanzar y borrable tras confirmar. |
| Repetición final de memoria | **1/1 aprobada**, 86,350 s, con el cuarto snapshot de producto. El helper de navegación comprueba la pestaña seleccionada y repite sólo un tap de navegación que el simulador frío puede perder; nunca repite envíos ni cambios. |

Evidencia local: `/tmp/focus-ai-native-v4.log` (78 XCTest), `/tmp/focus-ai-native-v3.log` (cuatro UI), `/tmp/focus-ai-memory-ui-final.log` (repetición aprobada). Los fallos intermedios se conservaron y motivaron regresiones: el segundo snapshot aún desplazaba una hora de mañana al día siguiente; el tercero encontró un intervalo AM/PM ignorado. La primera expectativa de borrado de memoria omitía la revisión requerida; otro intento mostró fallo de guardado que no se reprodujo en el test aislado ni en los dos recorridos posteriores. No se atribuye ese incidente a una causa no demostrada.

Capturas reales: [memoria consultable](qa/ai-native/memory-readable.png), [revisión antes de borrar](qa/ai-native/delete-review.png), [aclaración sin duplicado](qa/ai-native/clarification-no-duplicate.png).

## iPhone físico

El build Debug firmado **1.0 (28)** compiló y se instaló en el iPhone 16 conectado, conservando la instalación y sus datos. `devicectl device info apps` confirmó `me.usefocus.app`, versión 28. Se abrió `ios-native/Focus.xcodeproj` en Xcode. El lanzamiento remoto devolvió `Locked`: la instalación está verificada, pero el uso en el teléfono requiere desbloquearlo. No se acredita una conversación remota real por esta instalación; Vercel/Supabase aún requieren activar los cambios locales con autorización.

## Fixtures y cobertura

`FocusTests/NovaExecutionTests.swift` prueba el store real con directorios temporales, disco bloqueado o rechazo controlado de escritura y transportes de IA/sync falsos. No usa credenciales reales ni hace llamadas pagadas. Incluye:

- Persistencia tras relanzar; edición inválida que impide la primera mutación del lote.
- Eliminación revisada que no puede borrar un reemplazo ni una versión editada.
- Replay de tareas completadas; recibo atómico y ausencia de confirmación ante fallo de disco.
- Timeout con reintento y UUID estable; cancelación de respuesta tardía; edición manual mientras espera una respuesta.
- Franja de mañana, fecha absoluta, herencia entre instrucciones y hueco/repetición de hora en DST.
- Divulgación sensible casual, contexto de memoria pertinente y fallo de persistencia de memoria.
- Serie completa en una sola escritura; rechazo que deja cero ocurrencias y cero recibos.

`FocusDataStoreTests.swift` mantiene aislamiento de cuentas, recuperación explícita, outbox, revisiones de upload y conversión de fechas civiles. `NovaDictationLifecycleTests` mantiene los casos de permiso/cancelación y resultados obsoletos.

El dictado continúa en el dispositivo y entrega texto editable. Esta revisión no añade captura de fotos en iOS ni acredita servicios remotos de voz/fotos. Los resultados de calidad, latencia y coste de proveedores se registran aparte del XCTest local. Timeout, respuesta tardía, doble envío y disco bloqueado se prueban mediante transportes/fallos inyectados en XCTest; no se presentan como caídas reales de producción ni como todos los recorridos posibles de UI.

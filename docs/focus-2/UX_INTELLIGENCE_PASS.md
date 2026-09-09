# Focus — comprensión, dictado y agenda

Estado verificado: 8 de septiembre de 2026. La evaluación remota V8, las pruebas locales y el contrato de sincronización descritos abajo ya tienen resultados. V9 y la validación hablada en el iPhone siguen pendientes; producción conserva una versión anterior. Hilante es el nombre visible; Nova permanece en identificadores técnicos.

## Alcance y causa

El brief describe un evento con título «Salir como a la casa de un amigo» y descripción «20 min a la casa de un amigo». Las dos capturas mencionadas no están disponibles entre los adjuntos accesibles. No se ha inventado una comparación visual ni una atribución retrospectiva a un proveedor: sin el identificador o traza de ese envío original, no puede demostrarse qué rama lo procesó.

La inspección local sí identificó mecanismos concretos capaces de producir el problema:

1. `FocusDataStore.sendNovaMessage` ejecutaba cualquier resultado del parser cuando no había credenciales, aceptaba creaciones locales cuando había una aclaración pendiente y reutilizaba ese resultado como fallback ante desconexión. Tener un `NovaIntent` no equivalía a comprender con certeza la frase.
2. `FocusDataStore.makeEvent` volvía a limpiar el título remoto mediante `cleanTitle`/`preferBetterTitle`. Si faltaba un subtítulo, extraía un detalle del mensaje original o dividía nuevamente el título. Podía reintroducir fragmentos temporales o redundantes después de la interpretación del modelo.
3. El recibo local usaba «Listo. Te dejé «…»…», amplificando la redacción mecánica. El modelo no era la única fuente del texto finalmente visible.

La transcripción de voz entrega texto al compositor; no elige el proveedor ni crea por sí sola un evento.

## Recorrido actual y comprensión

```text
Dictado local o teclado → compositor → sendNovaMessage
  → gramática local cerrada → validación/persistencia local → recibo
  → interpretación semántica requerida → sesión + consentimiento
    → GET /api/ai-capabilities → POST /api/focus-assistant + X-Request-Id
    → runtime OpenAI → router → admisión y reserva SQL → Responses
    → contrato y validación → respuesta durable/replay
    → validación nativa + persistencia/recibo de acción → confirmación visible
```

La política `NovaLocalRoutingPolicy` certifica una gramática, no una probabilidad calibrada. Permite capturas pequeñas y explícitas, como `gym mañana 18:00`, tareas sencillas sin hora y aclaraciones enlazadas con fecha/hora inequívocas. No acepta desplazamientos coloquiales, relativos, franjas vagas, varias intenciones ni resolución difusa de referencias como prueba suficiente para una creación local. Un borrado local exacto exige un único título coincidente y mantiene la revisión de la eliminación.

Frases como `en 20 minutos me voy a la casa de un amigo` pasan a la IA. Sin sesión o conexión, una interpretación incierta conserva el error y la entrada para reintento; no se ejecuta un parse mediocre como sustituto silencioso.

El runtime usa únicamente OpenAI para este chat: `gpt-5.6-luna` para lenguaje cotidiano, `gpt-5.6-terra` para planificación/contexto o recuperación autorizada y `gpt-5.6-sol` para complejidad objetiva suficiente. El largo del mensaje no decide por sí solo. Se conservan dos intentos máximos, reservas, límites y registro por intento; una recuperación no aporta nueva autoridad para modificar datos.

La normalización semántica ocurre al construir el plan del modelo: el título representa la actividad y conserva personas/nombres, mientras el tiempo va a sus campos. `sourceText` sigue siendo una cita literal del usuario para validar evidencia; no es una plantilla obligatoria del título. No se introdujo una sustitución especial para «casa de un amigo».

En persistencia, `semanticPresentation` conserva el título/subtítulo del plan validado, recorta espacios exteriores y omite un subtítulo exactamente repetido. No vuelve a extraer descripciones del dictado. Los detalles útiles, como «Llevar la pelota», siguen siendo posibles. El recibo individual elimina las comillas angulares y la fórmula «Te dejé»; solo aparece tras guardar.

### Trazabilidad y privacidad

- `NovaRouteTrace` registra en DEBUG la rama y el motivo; la comparación antes/después informa cambios de título y presencia de subtítulo, sin registrar su contenido.
- El backend devuelve `processing.route`, `model` y `reason`, generados por el runtime. Los intentos conservan modelo, motivo, coste y validación en la telemetría existente.
- El UUID de la petición relaciona cliente, respuesta y ledger. No se registran tokens, audio, títulos, nombres ni mensajes privados en estas trazas de producción.
- Los fixtures sintéticos permiten comparar el texto antes/después explícitamente. La telemetría del proveedor no demuestra por sí sola persistencia en el iPhone.

### Correcciones temporales y evaluación remota V8

La revisión posterior a V5 detectó cuatro bordes: sumar minutos al reloj civil falla en cambios DST; una cita parcial no puede eludir una negación; una salida `create_task` no debe descartar un desplazamiento con hora relativa; y un primer relativo no debe imponerse a todo un lote con varios horarios.

V6, commit `94b578a`, introdujo cálculo desde el instante `nowISO`, validación de fecha/hora esperadas, autoridad del mensaje y recuperación acotada del plan incorrecto. La respuesta inválida se rechaza; no se convierte automáticamente en un evento para hacer pasar una prueba. V5 se conserva como evidencia histórica de 9/13 expectativas, sin atribuirle correcciones posteriores.

La [evaluación remota final V8](qa/ai-experience-remote-final.json) ejecutó los 13 casos contra la preview `https://focus-ayuywqslb-manunezdom-9658s-projects.vercel.app`: **13/13 expectativas objetivas**, 13 respuestas HTTP 200, 13 intentos Luna y 13 replays comprobados. Las dos cuentas sintéticas de esa batería se eliminaron y verificaron. Es una prueba del backend con corpus y contexto sintéticos; no demuestra por sí sola que el iPhone haya guardado los resultados ni aporta una valoración humana de naturalidad.

## Dictado implementado

`VoiceDictationSheet` es una hoja compacta de 390 puntos, ampliable al editar y con presentación grande para tamaños de accesibilidad. Integra transcripción progresiva, terminar, corregir, dictar más, volver al texto y enviar por el mismo compositor/consentimiento. El usuario puede cancelar sin enviar.

Build 35 elimina el `minHeight: 44` duplicado dentro de las etiquetas Terminar/Enviar; `FocusPrimaryButtonStyle` mantiene su mínimo de 54 puntos. La [captura revisada](qa/native-ux-build35/voice-compact-denied-dark.png) muestra «Volver al texto» completo con margen inferior en el detent original de 390, incluso con permiso denegado y borrador. No se amplió la hoja a 440 ni a pantalla grande para corregirlo.

`NovaLiveService` calcula RMS del buffer del micrófono y publica un historial de 24 muestras a unos 14 Hz; SwiftUI interpola las barras entre medidas, sin oscilador decorativo. Reduce Motion usa un indicador estático. La transcripción exige reconocimiento en el dispositivo; no se sustituye silenciosamente por envío de audio a un servicio remoto.

Se manejan permisos, silencio, finalización, cancelación, background, interrupción de audio, cambios de ruta y reinicio del servicio de audio. La generación de sesión descarta callbacks antiguos. Los haptics se limitan a transiciones puntuales. Los estados de interpretación/resultado posteriores siguen el flujo existente del compositor, no una segunda ejecución dentro de la hoja.

Esto describe implementación y cobertura automática. No certifica todavía rendimiento sostenido a 60/120 Hz, calidad acústica real, una llamada entrante real ni todos los cambios de ruta en hardware.

## Colores y borrado implementados

La agenda utiliza `EventSection` persistida: foco, reunión, personal, estudio, descanso, entrenamiento y recordatorio. La paleta de `Theme` ofrece variantes claras/oscuras; no hay selección aleatoria por evento. La barra lateral y el icono usan el acento, mientras título, hora y etiquetas siguen siendo legibles sin depender exclusivamente del color. No se afirma una categoría «salud» separada que el modelo nativo todavía no posee.

`SystemCalendarService` conserva el color RGB del calendario de EventKit cuando está disponible. `FocusEvent.accentColor` adapta su luminosidad a la superficie y al contraste aumentado; si falta o es inválido, usa la sección. Es metadata local compatible con snapshots anteriores, no una nueva integración de escritura al calendario.

La misma selección de acento se usa en `CalendarioView` y Home. Build 34 incorpora la hora de Home en una línea y el botón Eliminar con rojo explícito. Tres eventos creados desde el formulario, con Tipo elegido como Estudio, Entrenamiento y Reunión, conservaron su categoría después de reiniciar y mostraron colores coherentes en ambas pantallas, en claro y oscuro. No se atribuye esa selección manual al modelo.

La fila tiene `swipeActions` nativa hacia la izquierda. Los eventos de Focus permiten swipe completo y ofrecen `Deshacer` durante diez segundos. El borrado persiste evento y outbox antes de anunciar éxito, cancela avisos y no emite otro recibo si ya no existe. Deshacer restaura el mismo ID con una revisión posterior del outbox; exige la misma cuenta/generación y un recibo vigente.

Los eventos externos conservan su tarjeta. Su acción explica la limitación y permite abrir Calendario; no simula una eliminación externa. El gesto completo destructivo queda reservado a eventos locales. El recorrido de eventos locales sí pasó en el simulador: swipe parcial, Eliminar, Deshacer, restauración, swipe completo sin pulsar Eliminar y ausencia en Hoy/Agenda después de reiniciar. La interacción con eventos externos todavía necesita QA específico.

### Contrato de sincronización real

La [prueba REST nativa remota](qa/native-sync-remote.json) usó exclusivamente un UUID nuevo de `public.focus_events` y una cuenta sintética verificada por ID, email y marcador. El payload se comparó con `RemoteFocusEvent.encode`; el POST envía `deleted_at: null` y omite los timestamps gestionados por el servidor. Todas las lecturas/escrituras REST, incluido el DELETE físico final, usaron el JWT del usuario bajo RLS. La clave de servicio sólo comprobó el ownership del usuario antes del login.

Se verificó `upsert → tombstone → upsert del mismo ID → borrado y replay`: los conteos activos fueron **1 → 0 → 1 → 0**, sin duplicados; la lectura que incluye tombstones mantuvo una fila hasta la limpieza. Después, DELETE filtrado por UUID, usuario y marcador confirmó cero filas. Hubo 19 HTTP exitosos, cuatro estados comprobados y cero llamadas de IA. No se accedió a `public.events`, `tasks`, `suggestions` ni al ledger. Las tablas web y nativas son distintas: este resultado no prueba sincronización web ni equivale a swipe E2E con nube o concurrencia entre dispositivos.

## Evidencia verificada

| Área | Evidencia | Alcance y límite |
|---|---|---|
| Backend remoto V8 final | [ai-experience-remote-final.json](qa/ai-experience-remote-final.json): 13/13 expectativas, 13 HTTP 200, 13 intentos Luna, 13 replays; cleanup de 2/2 cuentas | Preview identificada en el reporte, no producción ni persistencia del cliente. |
| Coste V8 | **US$0,00319246** de cargo contable del ledger; US$0,003191 de telemetría redondeada; uso conocido en 13/13 intentos | No es factura. No sumar ledger y telemetría. |
| Latencia V8 | HTTP p50 2.863 ms; p95 7.250 ms, población de 13 HTTP 200 | Incluye tres aclaraciones. No mide tiempo hasta guardar en iPhone. |
| Backend local | **560/560 Node**, cero fallos; `/tmp/focus-final-node-v17.log`; commit `6f23993`; build local PASS | Cobertura determinista distinta de la evaluación del modelo remoto. Cambios posteriores requieren evidencia propia. |
| XCTest nativo | 95/95, cero fallos; `/tmp/focus-ux-native-tests-v3.log` | Simulador y fixtures; no prueba de audio hablado ni gesto completo en dispositivo físico. |
| UI build 34 | [native-ux-build34.json](qa/native-ux-build34.json): **5 ejecuciones PASS, 0 fallos, 3 casos distintos** | Swipe/deshacer/reinicio y categorías en claro/oscuro; dictado denegado/cancelación/borrador intacto. Capturas originales sólo sintéticas. |
| Ajuste visual build 35 | [native-voice-build35.json](qa/native-voice-build35.json): UI de dictado **1/1 PASS**; `/tmp/focus-voice-compact-build35.log` | Footer inspeccionado completo en 390 puntos; cancelar conserva el borrador. No se repitieron los 95 XCTest ni las otras UI por estas dos líneas de layout. |
| Permiso de voz | Log inicial `/tmp/focus-ux-ui-tests-v1.log`: No permitir y caso de voz PASS; repetición build 34 `/tmp/focus-voice-compact-final-v1.log`: PASS | La suite inicial también tuvo un fallo independiente del helper de swipe, corregido y validado después. No es prueba de voz humana. |
| Contrato Supabase nativo | [native-sync-remote.json](qa/native-sync-remote.json): cuatro estados remotos y cleanup confirmados; 8/8 pruebas offline del harness | REST real con JWT/RLS en `focus_events`, separado de `events` web; no prueba E2E dentro de la app. |
| iPhone físico | Build **1.0 (35)** firmado e instalado; `/tmp/focus-ux-iphone-build35.log` y `/tmp/focus-ux-iphone-install35.json`; inventario `/tmp/focus-ux-iphone-app35.json` confirmó versión 1.0/build 35 | El lanzamiento de 35 a las **20:59:46** fue rechazado por `SBMainWorkspace` con motivo `Locked`, según `/tmp/focus-ux-iphone-launch35.json`. Sin reset ni desinstalación. No se afirma QA manual ni voz hablada. |

Los logs `/tmp` son evidencia local transitoria; los JSON del directorio `qa` conservan corpus, hashes, respuestas, replays y denominadores. No contienen una puntuación inventada de naturalidad: `humanConversationScore` y las valoraciones humanas de presentación permanecen `null`.

V5 falló UX1/UX8 porque Luna preguntó si `en N` era minutos u hora del reloj. UX9/UX12 llegaron como tareas sin la intención requerida: JSON estructuralmente válido, plan inválido que el kernel rechazó. En V8 pasaron las 13 expectativas, pero UX3/UX5/UX13 aceptan aclaración cuando falta precisión: un PASS no demuestra naturalidad perfecta ni ausencia de preguntas innecesarias.

Capturas finales de build 34: [Home claro](qa/native-ux-build34/home-light.png), [Home oscuro](qa/native-ux-build34/home-dark.png), [Agenda](qa/native-ux-build34/agenda-dark.png), [swipe rojo](qa/native-ux-build34/swipe-dark.png) y [Deshacer](qa/native-ux-build34/undo-dark.png). El [dictado build 35](qa/native-ux-build35/voice-compact-denied-dark.png) sustituye la evidencia visual anterior del footer apretado. Todas son sintéticas; no contienen datos de la cuenta real del iPhone.

## Trabajo pendiente para aceptar la pasada

- Probar eventos externos y swipe/undo conectado a la nube dentro del iPhone; el gesto local del simulador y el contrato REST remoto ya pasaron por separado.
- Probar dictado hablado, edición, envío, cancelación repetida, denegaciones e interrupciones en el iPhone conectado.
- Completar contraste aumentado, tamaños grandes, VoiceOver y evaluación humana; categorías, claro/oscuro y reinicio con tamaño estándar ya tienen capturas y pruebas.
- Registrar una pasada real de intención→ruta→OpenAI→validación→persistencia→recibo en el dispositivo. Instalar/arrancar y un benchmark HTTP son evidencias distintas.

### V9 pendiente, sin mezclar con V8

La siguiente preview V9 incorpora correcciones web posteriores, incluida la restauración de sesión. Necesita su propio recorrido de continuidad de seis turnos y verificación de persistencia/recibos sobre la cuenta sintética. No se anuncian aquí resultados de V9 ni promoción de estos cambios a producción. El bloqueo del iPhone sigue siendo un impedimento distinto de la validación del backend.

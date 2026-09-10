# Focus iOS — cierre de Home y voz, build 36

Alcance: misión de cierre (1–11) y sus puntos 12–13. Base `4d80e67`; checkpoint `codex/focus-rc-home-voice-checkpoint-20260910`. Sin cambios de backend, modelos o proveedores. Solo los cambios de esta misión entran al commit; la build procede de una copia aislada.

## Resultado

- Causa del rebote: `NovaFeedbackView` reiniciaba su contexto y descarte temporal con `@State` al reconstruirse, incluido al mover el feedback debajo de Agenda. Ahora el store conserva un recibo de presentación por cuenta con UUID del mensaje, contexto estable, plazos y motivo terminal de ocultación.
- Vigencia: recibos de acciones, 90 s; otras respuestas, hasta 10 min; límite adicional de medianoche. Cambios semánticos, nuevo turno y descarte invalidan la tarjeta. El historial antiguo no se promociona al arrancar. Reordenar arrays o actualizar metadatos de sincronización no invalida la respuesta.
- Swipe izquierdo → **Quitar**, con transición y acción accesible/menú contextual. Escribe exclusivamente `focus.v1.homeReply`: no borra eventos, tareas, outbox ni conversación, ni deshace acciones. Un fallo al guardar el descarte se informa y mantiene la tarjeta visible. Un UUID nuevo puede mostrar otra tarjeta.
- Home: extracto máximo de tres líneas, enlace a Hilante y sin repetir etiquetas de ejecución de Agenda. En días sin actividades, símbolo ambiental, composer y una sugerencia local editable; composición más compacta en el SE y con texto accesible. Se conserva el diseño de los eventos.
- Voz: dos trazos de Focus responden a energía real del micrófono; movimiento autónomo solo al procesar; marca de revisión al terminar. Sheet ajustada al contenido, transcripción de 1–5 líneas, edición y controles compactos. Reduce Motion detiene transformaciones y ofrece un indicador estático. No se cambió el motor de reconocimiento ni se llamó a IA para rellenar Home.
- Corregidos durante QA: recorte de “Dictar” y del placeholder con texto máximo; espacio excesivo del estado vacío en el SE. Los tests de lista desplazan las filas antes de interactuar con elementos fuera del viewport. Fixtures aislados en `Focus/UITests`, fuera de la partición real del usuario y sin publicar notificaciones ni snapshots del widget.

## Verificación y evidencia local

Directorio de resultados: `/tmp/focus-rc-20260910`. Destino de simulador: `9D4A1CB5-E19C-4303-9F9B-15B5B820AB06`, iPhone SE (3.ª generación), iOS 26.5.

- `unit-clean.xcresult`: **113/113 FocusTests**, incluidos descarte/reinicio, evento a las 17, historial/outbox intactos, identidad nueva, contexto, caducidad y aislamiento por cuenta; también lifecycle de dictado con permisos, silencio y callbacks atrasados.
- Nueve casos únicos de interfaz aprobados entre `ui-retry.xcresult`, `ui-focused.xcresult` y `ui-ax-final.xcresult`: compositor multilínea/teclado, Markdown e historial, procesamiento/cancelación, texto máximo, ciclo completo fresco/expirado, swipe con relanzamiento, matriz de Home light/dark, revisar/editar/cancelar/enviar dictado y sus estados visuales/denegación.
- `final-check.xcresult`: 10 regresiones de presentación/persistencia y 2 recorridos de interfaz (texto máximo y matriz de Home), todos aprobados tras los ajustes finales.
- Inspección directa de capturas exportadas en `sim-shots`, `final-sim-shots` y `ax-shots`; incluye vacío, solo respuesta, solo evento, varias actividades y agenda sin prioridades. Las capturas son sintéticas.
- iPhone 16, iOS 26.6.1: compilación Debug firmada correcta y swipe “Quitar” observado. `iphone-ui.xcresult` se interrumpió con **Not authorized for performing UI testing actions**; la repetición `iphone-final.xcresult` no inició los casos: **Autenticación cancelada / Canceled by user**. No se cuenta ese recorrido como aprobado.
- No se observaron crashes en las pruebas aprobadas. Único warning de compilación: omisión de metadatos App Intents al no existir dependencia del framework. El primer intento sufrió falta de disco; se descartaron esas ejecuciones incompletas y se reutilizó caché tras liberar temporales/cachés regenerables.

Comandos base ejecutados desde la copia aislada (cada selección/ruta de resultados figura completa en su `.log`):

```sh
xcodebuild -project ios-native/Focus.xcodeproj -scheme Focus -destination 'platform=iOS Simulator,id=9D4A1CB5-E19C-4303-9F9B-15B5B820AB06' -derivedDataPath /tmp/focus-home-polish-build -parallel-testing-enabled NO -resultBundlePath /tmp/focus-rc-20260910/unit-clean.xcresult -only-testing:FocusTests test
xcodebuild -project ios-native/Focus.xcodeproj -scheme Focus -destination 'platform=iOS,id=00008140-00161D6122E9801C' -derivedDataPath /tmp/focus-home-polish-device -allowProvisioningUpdates build-for-testing
```

## Límite de la entrega

**No se certifica aún como release candidate completa.** Falta autorizar y completar el QA físico: hablar/pausar/continuar, transcripción real, editar/enviar/recibir y silencio/interrupciones; comprobar VoiceOver y Reduce Motion en el dispositivo y movimiento en hardware de 120 Hz. Se solicitaron disponibilidad y autorización del iPhone durante la sesión. El acceso de Computer Use a Simulator también agotó tiempo; no se presenta esa comprobación como realizada. Sin publicación en App Store.

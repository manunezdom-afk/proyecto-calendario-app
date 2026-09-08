# Preparación de release — Focus 2.0

Actualizado: 2026-09-08. Reemplaza la ficha antigua de App Store y el QA de Capacitor. Fuente iOS: **ios-native/Focus.xcodeproj**, scheme **Focus**. Decisiones y registro de validación: [README.md](README.md).

## Producto actual

Focus convierte lo que tienes en mente en un siguiente paso: **capturar → organizar → actuar → completar**.

- **Hoy:** captura, pendientes que necesitan atención y agenda del día.
- **Pendientes:** tareas con prioridad y fecha/hora límite opcionales; completar, editar y eliminar.
- **Agenda:** día, semana y mes; eventos con inicio, término opcional y avisos.
- **Hilante:** entrada natural y seguimiento, con el mismo ejecutor que Hoy.
- **Ajustes:** cuenta, sincronización, memoria, consentimiento de IA, permisos y apariencia.

Se empieza sin cuenta, con listas vacías y datos en este iPhone. Los ejemplos se identifican y no se guardan automáticamente. Las peticiones sencillas pueden interpretarse en el dispositivo; las que necesitan el servicio de IA requieren cuenta, conexión y consentimiento. El dictado exige reconocimiento disponible en el dispositivo y permite revisar el texto.

El calendario del iPhone se consulta con permiso y se modifica en Calendario. Una fecha límite de tarea no programa automáticamente un aviso: los avisos se configuran en los eventos.

No anunciar importación desde fotos, recordatorios geográficos, voz conversacional continua, conexiones directas con Google/Outlook ni planificación autónoma.

## Texto provisional de presentación

**Nombre:** Focus

**Subtítulo:** De pendiente a hecho

> Focus reúne tus pendientes y tu agenda para ayudarte a decidir qué hacer ahora.
>
> Escribe lo que necesitas, guarda una tarea o crea un evento. Añade una fecha si hace falta y marca lo que vas terminando. También puedes crear y editar todo a mano.
>
> Hoy reúne lo que necesita atención. En Pendientes puedes revisar tus tareas; en Agenda, ver tus eventos por día, semana o mes. Hilante permite continuar y corregir tus peticiones.
>
> Puedes empezar sin una cuenta y guardar tus datos en este iPhone. Las funciones de IA externa requieren conexión, cuenta y tu permiso.

Revisar contra la build final y los recorridos remotos antes de publicar. Copyright, precio, territorios y clasificación por edad los confirma el titular.

## Evidencia y validación local

Inspección local: iOS mínimo 17, destino iPhone, versión **1.0 (34)**, permisos micrófono/voz/calendario, manifest de privacidad y App Group del widget. Los cinco plist de app/widget, privacidad y entitlements pasan plutil. El build 34 se compiló y firmó para desarrollo y se instaló sin borrar datos; iOS rechazó su lanzamiento porque el dispositivo estaba bloqueado. El build 33 anterior sí abrió. Esto no verifica distribución TestFlight/App Store ni dictado hablado.

Validación confirmada el 8 de septiembre: **95/95 XCTest** (`/tmp/focus-ux-native-tests-v3.log`), build físico (`/tmp/focus-ux-iphone-build-v3.log`) y **14/14 E2E Chrome** con IA simulada, más **560/560 pruebas Node** (`/tmp/focus-final-node-v17.log`). La prueba nativa de cancelar/denegar dictado pasó; borrar con swipe parcial/completo, Deshacer y relanzar pasó en claro y oscuro. Ver [evidencia y límites de UX](UX_INTELLIGENCE_PASS.md). Estos resultados locales no miden calidad ni latencia de OpenAI remoto.

QA visual web del arreglo `d627293`: selector de acceso y formulario de contraseña completos dentro de **753×657** y **390×844**, sin recortes; Volver y Cerrar operativos. El centrado usa un contenedor independiente de la animación. Se revisó el consentimiento OpenAI/chat y Anthropic/fotos en el preview, se canceló y no se envió el mensaje sintético. Las tres promesas generales de Deshacer/confirmación se sustituyeron por la distinción entre peticiones claras y propuestas que requieren revisión. Esta comprobación local no afirma que el arreglo esté publicado en producción.

Targets disponibles: FocusTests y FocusUITests. Desde el repositorio:

~~~sh
xcodebuild -project ios-native/Focus.xcodeproj -scheme Focus \
  -destination 'platform=iOS Simulator,name=Focus 2.0 QA' test
npm run test:unit
~~~

Registrar resultado exacto, fecha, revisión y dispositivo; la existencia de un target no demuestra que pase. Evidencia de la reconstrucción: [README.md](README.md) y [qa/](qa/).

Criterios de aceptación:

- Primer inicio → Empezar → Hoy vacío, sin permisos; reinicio conserva acceso local.
- Crear/editar/completar/deshacer/eliminar tareas; comprobar persistencia tras reinicio.
- Editar evento conserva avisos, notas, subtítulo y estado. Evento 23:30–00:30 del día siguiente dura 60 minutos; término anterior al inicio no se guarda.
- Envío repetido, cancelación, propuesta, fallo de API y reintento no duplican acciones ni anuncian cambios inexistentes.
- Fallo de almacenamiento conserva formulario/borrador; eliminación fallida conserva el registro visible.
- Rechazo/revocación de consentimiento y permisos ofrecen recuperación; recuperar datos anteriores exige confirmar cantidad y destino.
- Cambio de cuenta no mezcla datos ni aplica respuestas pendientes.
- Verificar teclado, iPhone pequeño, texto grande, VoiceOver y claro/oscuro. Los controles principales siguen accesibles.

## Antes de distribuir

Pendiente de validación de distribución y recorridos externos:

1. Archivo Release firmado, entitlements efectivos de distribución y App Group/widget. Comprobar el siguiente número disponible en App Store Connect; el build 34 verificado aquí es de desarrollo.
2. OTP real: llegada, código incorrecto/expirado, reenvío, relanzamiento y renovación. No usar códigos fijos ni desactivar autenticación para revisión.
3. Cuenta de revisión válida y acceso que el titular pueda proporcionar y comprobar. El recorrido sin cuenta verifica la función local, no la IA externa.
4. Sincronización entre dispositivos, offline/reconexión y separación de cuentas. Eliminar una cuenta de prueba autorizada y confirmar el borrado.
5. Avisos locales y APNs en dispositivo: segundo plano, permisos denegados y desactivación en Ajustes. Verificar entorno APNs de distribución.
6. Política, términos y soporte disponibles; declaraciones de datos coherentes con build y proveedores.
7. Capturas reales con datos sintéticos de Hoy, Pendientes, Agenda, resultado de Hilante y modo oscuro. Retirar capturas antiguas.

No se certifican requisitos de Apple con estas comprobaciones locales; deben contrastarse con su documentación oficial vigente. Subir builds o publicar requiere autorización del titular.

## Privacidad: contraste local del 7 de septiembre de 2026

- `Focus/PrivacyInfo.xcprivacy` declara `CA92.1` para UserDefaults privados y `1C8F.1` para el snapshot App Group. `FocusWidget/PrivacyInfo.xcprivacy` declara `1C8F.1` y está en Resources del widget. Apple distingue [datos privados y datos del mismo App Group](https://developer.apple.com/documentation/bundleresources/app-privacy-configuration/nsprivacyaccessedapitypes/nsprivacyaccessedapitype) y explica la [inclusión del manifiesto en el target](https://developer.apple.com/documentation/bundleresources/adding-a-privacy-manifest-to-your-app-or-third-party-sdk).
- La app declara `DeviceID` por el token APNs persistido con `user_id` en `api/push.js`, y `ProductInteraction` por las peticiones de IA persistidas con cuenta, función, modelo y uso en `api/_lib/aiUsageTracking.js`. Clasificación basada en las [categorías oficiales de datos](https://developer.apple.com/documentation/bundleresources/app-privacy-configuration/nsprivacycollecteddatatypes/nsprivacycollecteddatatype): vinculadas a la cuenta, para funcionamiento, sin tracking. Los contadores de `FocusTelemetry` y el snapshot del widget permanecen en el dispositivo; Apple distingue ese procesamiento de la [recolección fuera del dispositivo](https://developer.apple.com/app-store/app-privacy-details/).
- La política local distingue iOS/web, modo sin cuenta, recuperación explícita, memoria local, dictado en el dispositivo, contexto enviado a IA, consentimiento revocable y el snapshot con títulos/horarios de eventos Focus y EventKit. El widget no hace peticiones de red; Nova no incluye los eventos EventKit en su contexto remoto actual. Modificar `public/privacidad.html` no publica la política.
- La fuente de entitlements conserva `aps-environment=development`. Verificar el valor **efectivo del archivo firmado** y el entorno comunicado al backend: Apple indica que el [perfil de distribución y TestFlight usan production](https://developer.apple.com/documentation/bundleresources/entitlements/aps-environment). El App Group coincide entre app y widget, pero aquí no se verificó su registro ni su firma.
- Antes de distribuir faltan corroborar los proveedores realmente habilitados, regiones/retención y condiciones aplicables a las cuentas de servicio, ajustes de entrenamiento o retención, logs del hosting, y las respuestas de privacidad de App Store Connect. Las afirmaciones contractuales preexistentes de la política no se certifican con una lectura de código. Validar la eliminación con una cuenta de prueba autorizada y el esquema desplegado; no se ejecutó contra una cuenta real.

## Revisión de IA y privacidad — 8 de septiembre de 2026

La migración de chat de esta rama está preparada para OpenAI exclusivamente: Luna, Terra y Sol, con Hilante como nombre visible. Actualizar `.env.example`, la política HTML o el consentimiento no modifica por sí solo Vercel ni publica el backend. Antes de distribuir, comprobar las migraciones de admisión y presupuestos de la versión, los secretos canónicos y el runtime efectivo en el destino. Anthropic se conserva únicamente para fotos. DeepSeek y Google/Gemini no participan en solicitudes de chat de esta versión; los adaptadores de investigación no habilitan proveedores en producción.

- Fotos web: Anthropic, con consentimiento antes del envío, vista previa y confirmación de importación; 4 imágenes y 4 millones de caracteres base64 en total. Admisión, reserva y conciliación del gasto usan el presupuesto compartido. No se guarda la foto original en la base de datos de Focus.
- La transcripción de audio del servidor permanece pausada hasta poder verificar duración y reservar su coste. El dictado nativo exige reconocimiento en el dispositivo. El dictado web usa SpeechRecognition del navegador, por lo que no se presenta como procesamiento necesariamente local.
- El servidor conserva temporalmente respuestas y propuestas para recuperar un resultado sin volver a cobrar una llamada o aplicar cambios repetidos. Esto puede incluir texto o memorias propuestas; la política ya lo distingue del historial local y del registro numérico de costes.
- El replay caduca lógicamente a las 24 horas. El borrado físico ocurre al admitir nuevas solicitudes o ejecutar `focus_ai_purge_replays()`. No hay garantía de borrado físico a las 24 horas durante periodos sin tráfico; programar/verificar la limpieza operativa antes de anunciar esa garantía.
- Las condiciones efectivas de retención, regiones y uso de datos de las cuentas de OpenAI (chat) y Anthropic (fotos) siguen pendientes de corroboración operativa. `store: false` no certifica ausencia de registros del proveedor. No se certificó cumplimiento legal ni se desplegó esta revisión mediante cambios de documentación.
- El consentimiento se presenta de nuevo con `focus_ai_consent_v2` en web y `novaAIConsent.v3` por cuenta en iOS. El aviso distingue OpenAI para chat de Anthropic para fotos web. La hoja iOS describe únicamente su chat con OpenAI y su dictado local. Los permisos anteriores se conservan en sus claves antiguas sin habilitar la nueva versión del aviso.
- El widget web aplica creaciones y ediciones validadas directamente, con comprobación del elemento vigente y recibo de persistencia local. Las propuestas explícitas, los borrados y los cambios de memoria siguen en revisión. Verificación local: `node --test tests/assistant-web-contract.test.js` (14/14) y `FOCUS_PLAYWRIGHT_CHANNEL=chrome npx playwright test tests/e2e/nova.spec.js --project=chromium-desktop --workers=1 --max-failures=1` (10/10, 49 s). Chrome instalado con perfil temporal, respuestas de IA simuladas y HTTP externo bloqueado. Incluye creación→edición directa→borrado confirmado, fallo de almacenamiento sin falso recibo y consentimiento anterior insuficiente para el nuevo aviso y rechazo del backend antiguo antes de enviar el chat; no verifica APIs remotas ni persistencia de Supabase.

Fuentes técnicas del límite de fotos y contrato de salida: [visión de Anthropic](https://platform.claude.com/docs/en/build-with-claude/vision) y [salidas estructuradas](https://platform.claude.com/docs/en/build-with-claude/structured-outputs), consultadas el 8 de septiembre de 2026. El formato estricto requiere igualmente validar fechas, tipos, número de resultados, rechazos y truncamientos en Focus.

### Consolidación de fotos y voz — decisión del 8 de septiembre de 2026

Se mantiene el análisis de fotos con `claude-haiku-4-5-20251001` y el dictado iOS en el dispositivo. Esto conserva las rutas existentes mientras se migra el chat. No se ha demostrado que una alternativa OpenAI mejore la extracción de horarios españoles ni la transcripción de voz de Focus: no se ejecutó una comparativa pagada de estas modalidades en esta revisión.

| Criterio | Fotos: Haiku actual / Luna candidata | Voz: iOS actual / transcripción OpenAI candidata |
|---|---|---|
| Capacidad | Ambas APIs admiten imágenes. Luna admite salida estructurada; esto permite evaluar el mismo contrato de vista previa, sin cambiarlo por texto libre. | Luna no admite audio. La consolidación de voz requeriría un modelo y endpoint de transcripción adicionales. |
| Calidad | Falta medir títulos, fechas, horas omitidas, texto pequeño y capturas inclinadas con las mismas imágenes sintéticas. No se deduce calidad de la marca ni del precio. | Falta medir español chileno, ruido, nombres propios y correcciones frente al reconocimiento del dispositivo. |
| Coste | Luna publica US$0,20 de entrada y US$1,20 de salida por millón de tokens de texto; la reserva de imágenes exige su cálculo de tokens específico. No es un coste medido por foto. | El dictado actual no genera llamadas pagadas de IA. OpenAI añade coste de audio y reserva por duración; no se ha calculado un ahorro frente a una ruta local. |
| Latencia y privacidad | P50/P95 no medidos. Consolidar eliminaría un destinatario de imágenes, pero exige comprobar las condiciones de la cuenta y la retención de la API. | P50/P95 no medidos. Sustituir reconocimiento local añadiría transferencia de audio y dependencia de red. |
| Complejidad y siguiente paso | Comparar Luna y Haiku con iguales límites, validador, presupuesto y corpus antes de cambiar el proveedor. Mantener consentimiento de Anthropic mientras fotos lo use. | Mantener SFSpeech con reconocimiento local obligatorio. No reabrir `/api/transcribe` hasta tener admisión, duración acotada y evidencia de utilidad. |

Fuentes oficiales consultadas: [modelo GPT-5.6 Luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna), [imágenes y visión de OpenAI](https://developers.openai.com/api/docs/guides/images-vision), [GPT-4o Mini Transcribe](https://developers.openai.com/api/docs/models/gpt-4o-mini-transcribe), [controles de datos de OpenAI](https://developers.openai.com/api/docs/guides/your-data), [visión de Anthropic](https://platform.claude.com/docs/en/build-with-claude/vision) y [reconocimiento en el dispositivo de Apple](https://developer.apple.com/documentation/speech/sfspeechrecognitionrequest/requiresondevicerecognition). Capacidad publicada no equivale a acceso de la cuenta, calidad comparada ni verificación en producción.

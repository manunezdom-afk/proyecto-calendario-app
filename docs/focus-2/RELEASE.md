# Preparación de release — Focus 2.0

Actualizado: 2026-09-07. Reemplaza la ficha antigua de App Store y el QA de Capacitor. Fuente iOS: **ios-native/Focus.xcodeproj**, scheme **Focus**. Decisiones y registro de validación: [README.md](README.md).

## Producto actual

Focus convierte lo que tienes en mente en un siguiente paso: **capturar → organizar → actuar → completar**.

- **Hoy:** captura, pendientes que necesitan atención y agenda del día.
- **Pendientes:** tareas con prioridad y fecha/hora límite opcionales; completar, editar y eliminar.
- **Agenda:** día, semana y mes; eventos con inicio, término opcional y avisos.
- **Nova:** entrada natural y seguimiento, con el mismo ejecutor que Hoy.
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
> Hoy reúne lo que necesita atención. En Pendientes puedes revisar tus tareas; en Agenda, ver tus eventos por día, semana o mes. Nova permite continuar y corregir tus peticiones.
>
> Puedes empezar sin una cuenta y guardar tus datos en este iPhone. Las funciones de IA externa requieren conexión, cuenta y tu permiso.

Revisar contra la build final y los recorridos remotos antes de publicar. Copyright, precio, territorios y clasificación por edad los confirma el titular.

## Evidencia y validación local

Inspección local: iOS mínimo 17, destino iPhone, versión 1.0 (25), permisos micrófono/voz/calendario, manifest de privacidad y App Group del widget. Los cinco plist de app/widget, privacidad y entitlements pasan plutil. Esto no verifica firma ni servicios externos.

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

Pendiente de dispositivo real y configuración externa:

1. Archivo Release firmado, entitlements efectivos de distribución y App Group/widget. Incrementar build si 25 ya fue usada.
2. OTP real: llegada, código incorrecto/expirado, reenvío, relanzamiento y renovación. No usar códigos fijos ni desactivar autenticación para revisión.
3. Cuenta de revisión válida y acceso que el titular pueda proporcionar y comprobar. El recorrido sin cuenta verifica la función local, no la IA externa.
4. Sincronización entre dispositivos, offline/reconexión y separación de cuentas. Eliminar una cuenta de prueba autorizada y confirmar el borrado.
5. Avisos locales y APNs en dispositivo: segundo plano, permisos denegados y desactivación en Ajustes. Verificar entorno APNs de distribución.
6. Política, términos y soporte disponibles; declaraciones de datos coherentes con build y proveedores.
7. Capturas reales con datos sintéticos de Hoy, Pendientes, Agenda, resultado de Nova y modo oscuro. Retirar capturas antiguas.

No se certifican requisitos de Apple con estas comprobaciones locales; deben contrastarse con su documentación oficial vigente. Subir builds o publicar requiere autorización del titular.

## Privacidad: contraste local del 7 de septiembre de 2026

- `Focus/PrivacyInfo.xcprivacy` declara `CA92.1` para UserDefaults privados y `1C8F.1` para el snapshot App Group. `FocusWidget/PrivacyInfo.xcprivacy` declara `1C8F.1` y está en Resources del widget. Apple distingue [datos privados y datos del mismo App Group](https://developer.apple.com/documentation/bundleresources/app-privacy-configuration/nsprivacyaccessedapitypes/nsprivacyaccessedapitype) y explica la [inclusión del manifiesto en el target](https://developer.apple.com/documentation/bundleresources/adding-a-privacy-manifest-to-your-app-or-third-party-sdk).
- La app declara `DeviceID` por el token APNs persistido con `user_id` en `api/push.js`, y `ProductInteraction` por las peticiones de IA persistidas con cuenta, función, modelo y uso en `api/_lib/aiUsageTracking.js`. Clasificación basada en las [categorías oficiales de datos](https://developer.apple.com/documentation/bundleresources/app-privacy-configuration/nsprivacycollecteddatatypes/nsprivacycollecteddatatype): vinculadas a la cuenta, para funcionamiento, sin tracking. Los contadores de `FocusTelemetry` y el snapshot del widget permanecen en el dispositivo; Apple distingue ese procesamiento de la [recolección fuera del dispositivo](https://developer.apple.com/app-store/app-privacy-details/).
- La política local distingue iOS/web, modo sin cuenta, recuperación explícita, memoria local, dictado en el dispositivo, contexto enviado a IA, consentimiento revocable y el snapshot con títulos/horarios de eventos Focus y EventKit. El widget no hace peticiones de red; Nova no incluye los eventos EventKit en su contexto remoto actual. Modificar `public/privacidad.html` no publica la política.
- La fuente de entitlements conserva `aps-environment=development`. Verificar el valor **efectivo del archivo firmado** y el entorno comunicado al backend: Apple indica que el [perfil de distribución y TestFlight usan production](https://developer.apple.com/documentation/bundleresources/entitlements/aps-environment). El App Group coincide entre app y widget, pero aquí no se verificó su registro ni su firma.
- Antes de distribuir faltan corroborar los proveedores realmente habilitados, regiones/retención y condiciones aplicables a las cuentas de servicio, ajustes de entrenamiento o retención, logs del hosting, y las respuestas de privacidad de App Store Connect. Las afirmaciones contractuales preexistentes de la política no se certifican con una lectura de código. Validar la eliminación con una cuenta de prueba autorizada y el esquema desplegado; no se ejecutó contra una cuenta real.

## Revisión de IA y privacidad — 8 de septiembre de 2026

Los cambios de esta rama describen la versión preparada localmente. Actualizar `.env.example`, la política HTML o el consentimiento no modifica la configuración de Vercel ni publica el backend. Antes de distribuir, comprobar la migración `021_ai_admission.sql`, los secretos canónicos y el proveedor habilitado en el entorno de destino. El runtime usa Anthropic Haiku por defecto; DeepSeek y OpenAI son alternativas configurables ya nombradas en el consentimiento. Google/Gemini solo tiene un adaptador de benchmark separado: no participa en solicitudes de usuarios.

- Fotos web: Anthropic, con consentimiento antes del envío, vista previa y confirmación de importación; 4 imágenes y 4 millones de caracteres base64 en total. Admisión, reserva y conciliación del gasto usan el presupuesto compartido. No se guarda la foto original en la base de datos de Focus.
- La transcripción de audio del servidor permanece pausada hasta poder verificar duración y reservar su coste. El dictado nativo exige reconocimiento en el dispositivo.
- El servidor conserva temporalmente respuestas y propuestas para recuperar un resultado sin volver a cobrar una llamada o aplicar cambios repetidos. Esto puede incluir texto o memorias propuestas; la política ya lo distingue del historial local y del registro numérico de costes.
- El replay caduca lógicamente a las 24 horas. El borrado físico ocurre al admitir nuevas solicitudes o ejecutar `focus_ai_purge_replays()`. No hay garantía de borrado físico a las 24 horas durante periodos sin tráfico; programar/verificar la limpieza operativa antes de anunciar esa garantía.
- Las condiciones efectivas de retención, regiones y uso de datos de las cuentas de Anthropic, DeepSeek y OpenAI siguen pendientes de corroboración operativa. `store: false` no certifica ausencia de registros del proveedor. No se certificó cumplimiento legal ni se desplegó esta revisión.

Fuentes técnicas del límite de fotos y contrato de salida: [visión de Anthropic](https://platform.claude.com/docs/en/build-with-claude/vision) y [salidas estructuradas](https://platform.claude.com/docs/en/build-with-claude/structured-outputs), consultadas el 8 de septiembre de 2026. El formato estricto requiere igualmente validar fechas, tipos, número de resultados, rechazos y truncamientos en Focus.

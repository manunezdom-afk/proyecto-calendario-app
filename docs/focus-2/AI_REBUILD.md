# Hilante: reconstrucción de la IA

Revisión local del 8 de septiembre de 2026. El nombre visible permanece **Hilante**. Este documento describe código y pruebas locales; no acredita un despliegue de Vercel ni una migración aplicada a Supabase.

## Auditoría y decisión

| Conservar | Mejorar | Reemplazar / retirar |
|---|---|---|
| App SwiftUI, parser local, dictado editable, sincronización por cuenta, cuotas del producto, batería de 211 frases | Fechas civiles/DST, continuidad de conversación, memoria pertinente, recibos durables, confirmación de borrados, costes y privacidad | Prompts distintos por proveedor, defaults que inventaban parámetros, reintentos ocultos de SDK, confirmaciones basadas en texto del modelo, presupuestos consultados sin reservar |

El modelo prepara un **plan**, no modifica directamente la agenda. Flujo remoto: autenticar → limitar entrada → reservar cuota/coste atómicamente → proveedor → validar esquema, intención, referencias y fechas → entregar plan/propuesta → cliente guarda y devuelve un comprobante local. La respuesta del modelo nunca sustituye al comprobante de ejecución. El modo local sigue disponible para capturas compatibles sin llamadas pagadas.

`api/focus-assistant.js` delega al único runtime activo, `api/_lib/novaRuntime.js`. Los tres adaptadores usan el mismo esquema y prompt. `novaContract.js` convierte el plan al contrato compatible de Focus y puede rechazar todo el lote, pedir datos o proponer una revisión. Una fuente citada no da autoridad para ejecutar texto externo; el servidor cruza intención, IDs y parámetros con el mensaje/contexto. Las propuestas destructivas no son ejecución.

## Modelos y límites

El candidato predeterminado local es `claude-haiku-4-5-20251001`, el único económico al que esta sesión consiguió acceso real. **No es un ganador demostrado entre proveedores.** La clave disponible de OpenAI devolvió 401; no se repitió ese error. Faltan claves utilizables para comparar DeepSeek y Google. Los ocho candidatos, precios exactos, caché, capacidades y fuentes están en [AI_MODEL_RESEARCH.md](AI_MODEL_RESEARCH.md).

El runtime permite OpenAI Luna, DeepSeek Flash o Haiku como base. Los fallbacks de proveedor y premium están apagados por defecto. Un fallo técnico puede consumir un reintento del mismo modelo previamente reservado; activar un fallback permite usar el segundo intento para esa alternativa. Nunca hay un tercero. Las aclaraciones semánticas no se convierten automáticamente en más gasto. El escalamiento por planificación compleja necesita comparación adicional antes de habilitarse. La compatibilidad opcional de Sonnet 4.6 no es una recomendación frente al candidato investigado Sonnet 5.

Entrada: máximo de 4.000 caracteres de mensaje, cuerpo de 80 KB, seis mensajes recientes cuando caben y techo conservador de 12.000 tokens estimado por bytes UTF-8 incluyendo esquema. Se recorta contexto antes que intención. Salida: 1.600 tokens por intento por defecto, máximo configurable 2.048. La batería midió 1.024: 400–600 pueden truncar lotes JSON con numerosos campos, aunque la frase visible sea breve. Timeout por intento 18 s y total aproximado 43 s; la plataforma conserva margen para terminar la contabilidad. No se transmite JSON parcial a la ejecución. La UI muestra actividad antes de confirmar.

## Economía, idempotencia y datos

La migración [021_ai_admission.sql](../../supabase/migrations/021_ai_admission.sql) incorpora reserva y liquidación con bloqueo transaccional breve. Cuenta todas las reservas abiertas, los intentos de facturación desconocida y los cargos anteriores. Une telemetría y reservas mediante un lease emitido por el servidor; un ID elegido por el cliente no oculta un cargo antiguo.

Defaults del código: 5 peticiones/minuto/usuario, una simultánea, US$0,10 por solicitud, US$0,25/día y US$5/mes por usuario, US$5/día y US$50/mes global. `.env.example` muestra estos mismos límites; los del entorno prevalecen. Un importe explícito cero, negativo o inválido bloquea el gasto, sin restaurar el valor por defecto. Al proyectar 75% se marca alerta; al 90% sólo se permite intento económico; al 100% se rechaza la admisión. `AI_PAID_CALLS_ENABLED=false` corta llamadas pagadas de chat y fotos; cualquier valor explícito distinto de `true` también bloquea. Si la variable falta, el runtime conserva `true` por compatibilidad. Las cuotas no sustituyen a los presupuestos y viceversa. El reporte sólo convierte a CLP si el operador proporciona `CLP_PER_USD`; no presupone una cotización.

Cada intento registra proveedor/modelo, tokens de entrada/salida/caché, precio aplicado, coste, duración y resultado sin mensaje, respuesta, imagen, email ni credencial. Si el proveedor no devuelve contadores válidos se conserva la reserva completa: eso es una **estimación conservadora**, no consumo medido ni cero. La pérdida de tracking/liquidación impide entregar acciones ejecutables. `scripts/ai-cost-report.mjs` distingue intentos de solicitudes lógicas, reintentos, premium, aclaraciones y coste. Las métricas de persistencia requieren recibos del cliente y figuran como desconocidas si no existen; no se infieren de un 200 del proveedor.

El replay guarda temporalmente una respuesta que puede contener datos personales en una tabla privada accesible sólo por el servicio. Expira lógicamente a las 24 h; la limpieza física ocurre con admisiones posteriores o `focus_ai_purge_replays()`. No se ha creado un cron externo y no se promete borrado físico exactamente a las 24 h. Borrar una cuenta elimina el contenido y la huella, conservando coste anónimo. Los IDs consumidos permanecen como tombstones para impedir otra llamada con el mismo envío.

El consentimiento identifica a **Anthropic, DeepSeek y OpenAI**; se solicita antes de transmitir texto/contexto o fotos. Anthropic procesa las fotos y es el proveedor predeterminado de chat de esta rama; las alternativas requieren configuración. Google/Gemini no procesa solicitudes de usuarios y su adaptador de benchmark no cambia ese consentimiento. La política local distingue historial y memorias guardados en iOS, registros numéricos de uso y respuestas temporales del servidor que pueden contener actividades o memorias propuestas. Retirar el permiso detiene nuevos envíos, pero no retira datos ya recibidos por un proveedor. Las condiciones efectivas de retención y uso de datos de las cuentas de servicio requieren corroboración antes de activar el despliegue; la revisión local no certifica cumplimiento legal ni publicación de la política.

En iOS se guarda la identidad de la solicitud por cuenta y los recibos junto a eventos/tareas/outbox. Se conserva el UUID ante respuesta ambigua o timeout. Sólo un fallo terminal confirmado por el servidor permite que el siguiente reintento explícito use otro UUID. La memoria se guarda por cuenta, excluye secretos y sólo aporta contexto pertinente y acotado. Véase [AI_NATIVE_QA.md](AI_NATIVE_QA.md).

Fotos: Haiku entrega una vista previa validada, nunca dice haber importado eventos. Límite de cuatro imágenes, 4 millones de caracteres base64 en total, tamaño/dimensiones comprobados, una llamada, 25 s, salida 2.048 y reserva máxima US$0,05. Comparte admisión/contabilidad y consentimiento. La importación web permite corregir la fecha de cada fila y bloquea el guardado si falta una fecha válida; no transforma una fecha ausente en hoy. El endpoint remoto de transcripción queda temporalmente cerrado porque la duración declarada por el cliente no permitía reservar gasto de audio con fiabilidad; el dictado nativo de texto editable se conserva.

## Benchmark reproducible y resultados

Se seleccionaron 100 frases de las 211 existentes alternando 25 categorías. Fecha fija `2026-09-08T15:00:00Z`, zona `America/Santiago`, mismo modelo y selección, cero retries. Los informes contienen entrada sintética, expectativas, plan original, validación, resultado, tokens, coste, latencia y estado de terminación. El segundo registra hashes del prompt, validador, tarifas y casos.

| Medición real | Acierto objetivo | JSON parseable | Aclaraciones | Coste total | Media/petición | P50 / P95 |
|---|---:|---:|---:|---:|---:|---:|
| Primera batería, Haiku, 100 | 60/100 | 100/100 | 48 | US$0,348056 | US$0,003481 | 3.817 / 9.546 ms |
| Segunda batería, Haiku, 100 | 86/100 | 100/100 | 18 | US$0,448466 | US$0,004485 | 5.883 / 6.819 ms |

Después de esas correcciones se repitieron **12 de los 14 casos fallidos** con el modelo real: **10/12** pasaron, coste US$0,056017, P50 3.812 ms y P95 12.886 ms. El runner se detuvo por su reserva presupuestaria antes de los dos restantes. Es una muestra dirigida a fallos y pequeña: no se mezcla con los 100 anteriores para anunciar una tasa nueva. En H74 la expectativa antigua exige un aviso en una franja sin hora; pedir hora conserva la garantía del producto, aunque ese grader lo marque fallido. X174 sigue preguntando de más por medianoche.

El validador final también reprocesó **las mismas 100 respuestas guardadas**, sin API: **90/100** frente a 86 originales, cinco mejoras y una regresión segura (X177, aviso fechado sin hora que antes perdía su intención al convertirse en tarea). [Informe offline V4](qa/ai-haiku-v4-revalidation.json). Esa cifra no mide una nueva versión del modelo ni el efecto de los cambios del prompt. **No se ha demostrado ≥99%** y sigue pendiente repetir la batería completa con el código final y completar la evaluación humana.

Los costes de ambas baterías tienen contadores para las 100 llamadas. Una aclaración permitida por la expectativa cuenta como acierto: 17 casos en la primera y 11 en la segunda. JSON parseable **no equivale a herramienta válida**, y un plan propuesto **no equivale a dato guardado**. La segunda corrigió además el paso de IDs discutidos al validador del runner: no es una comparación exclusivamente del prompt. El 86% mide toda la muestra; los cuatro casos de la categoría básica pasaron, pero cuatro casos no demuestran 99% de fiabilidad general.

Son tiempos cliente del runner → proveedor → validación local, no latencia de Vercel ni del iPhone. El 401 de OpenAI sólo acredita una credencial rechazada, no calidad ni latencia del modelo. Las primeras pruebas de compilación del esquema descubrieron límites reales de Anthropic (uniones y enum anulable) y llevaron a una sola lista de acciones en el esquema. Sus errores no se presentan como inferencias gratuitas ni aciertos.

```sh
# Sin red: inventario de casos y reservas.
npm run ai:benchmark -- --provider anthropic --limit 100 --report /tmp/hilante-inventory.json
# Requiere autorización de gasto y clave sólo de servidor.
npm run ai:benchmark -- --live --provider anthropic --limit 100 --budget 0.55 --report /tmp/hilante-live.json
# Formulario de evaluación y ponderación del brief; no inventa notas humanas.
node scripts/ai-benchmark-review.mjs --report docs/focus-2/qa/ai-haiku-100-v2.json --template /tmp/hilante-review.json
node scripts/ai-benchmark-review.mjs --report docs/focus-2/qa/ai-haiku-100-v2.json --reviews /tmp/hilante-review-completed.json
```

El score exige revisión identificada de comprensión, plan correcto, naturalidad, brevedad y aclaración necesaria. Pondera fiabilidad 50%, coste 20%, P95 15% y conversación 15%, con anclas fijas documentadas de US$0,01 y 10 s. El formulario de 12 casos sigue sin puntuaciones humanas: el score compuesto permanece pendiente. El adaptador Google está preparado y probado offline, pero su ejecución pagada sigue bloqueada hasta verificar un límite conjunto de pensamiento/salida además de la credencial.

## Verificación y activación

Los tests de contrato/runtime incluyen proveedor caído, timeout, rechazo 401/429, JSON/esquema/IDs inválidos, fecha imposible/DST, negaciones, prompt injection, caída de DB, tracking fallido, replay, cuota, concurrencia, presupuesto y límite de intentos. El script SQL aplica/reaplica migraciones a PostgreSQL WASM y verifica **21 invariantes reales**; no acredita contención multiproceso porque PGlite usa una conexión.

Última verificación local: **386/386 pruebas JavaScript** (incluido el adaptador Google offline), build Vite aprobado, **78/78 XCTest** y cuatro recorridos UI aprobados; memoria repetida después con éxito. Las pruebas web ejecutan hooks con un scheduler determinista y comprueban identidad de memoria, fallo de caché, cuenta anterior, replay, recibos y revisión. iOS Debug **1.0 (28)** compilado e instalado en el iPhone 16 conectado; lanzamiento bloqueado por teléfono cerrado. Xcode quedó abierto. [Evidencia nativa](AI_NATIVE_QA.md).

La interfaz web completó **7/7 E2E en Chrome**, 47 s, con perfil temporal y HTTP externo bloqueado: consentimiento previo, propuesta→aprobación→recibo y persistencia única, rechazo de afirmaciones sin acciones, reintento de fallo terminal, doble envío, historial y entrada vacía. El widget web conserva su modo de propuestas revisables; las capturas locales compatibles de iOS ejecutan directamente. Para repetir usando el Chrome instalado: `FOCUS_PLAYWRIGHT_CHANNEL=chrome npx playwright test nova.spec.js --project=chromium-desktop --workers=1`. Las respuestas del proveedor en esa prueba están simuladas y no añaden evidencia de calidad del modelo.

Commits locales de implementación: `035f10d` (iOS), `f7a2695` (backend, SQL y herramientas), `13df261` (compatibilidad web). Los cambios preexistentes de caché y carpetas legacy no están incluidos. La repetición completa adicional del benchmark está pendiente de autorización de hasta US$0,60.

Para activar remotamente, con autorización: aplicar migraciones hasta 021 en Supabase; revisar roles/privilegios y contención en staging; configurar límites e interruptor; desplegar backend y web juntos; probar una petición autenticada y su replay contra el destino. Publicar la política local actualizada junto a esas rutas. Hasta entonces el backend público no recibe estas correcciones por compilar o instalar iOS. Los builds, tests y commits locales se registran al cierre de esta revisión.

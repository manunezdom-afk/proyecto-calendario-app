# Hilante con OpenAI

Documento operativo de la migración solicitada el 8 de septiembre de 2026. El nombre visible sigue siendo Hilante. Los resultados de Haiku y las decisiones anteriores quedan archivados en [AI_REBUILD.md](AI_REBUILD.md); no son resultados del nuevo router.

## Estado y checkpoint

Checkpoint previo: `ebbc41c` en `focus-os-dev`; `git fetch origin` y `git pull --ff-only origin main` completados sin cambios. Proyecto Vercel existente `focus-app`, `prj_v6oZp1tXD69I0IJmN0MBAMq64ZHx`; Supabase configurado `hvwqeemtfoyvfmongwzo`. No se crea otro proyecto ni se cambia facturación.

La implementación está en esta rama; los resultados comprobados se detallan más abajo. **Supabase 020/021/022 aplicadas y verificadas remotamente. Preview OpenAI desplegado y autenticado; producción aún no actualizada mientras se cierra la validación final de conversación, sincronización y planificación.**

Revisión de acceso: `OPENAI_API_KEY` local devuelve HTTP 401 `invalid_api_key` en lectura del catálogo; no se hizo una inferencia con esa clave. La clave sensible existente en Vercel funcionó en inferencias reales sin revelar su valor; la CLI fue autorizada después de que el titular iniciara sesión. La variable sensible mantiene su valor oculto y se amplió a Preview para probarla en el servidor. Supabase ya permitió inspección, migraciones y verificación con cuentas propias. Se retiraron de Preview y Production `AI_PROVIDER_PRIMARY`, `AI_ENABLE_PROVIDER_FALLBACK`, `AI_ENABLE_PREMIUM_FALLBACK`, `OPENAI_NOVA_MODEL` y `API_DE_DEEPSEEK`; la consulta de metadatos confirmó que no queda ninguna. Anthropic permanece únicamente para fotos y los adaptadores históricos desacoplados no se seleccionan en chat.

## Runtime

Un solo runtime de chat, `api/_lib/novaRuntime.js`, llama únicamente a la Responses API de OpenAI. Los tres modelos son identificadores exactos permitidos; ninguna variable antigua selecciona DeepSeek, Anthropic o Astra. Las claves de otros proveedores no activan rutas de chat.

| Tier | Uso | Razonamiento | Techo entrada | Salida inicial |
|---|---|---|---:|---:|
| Luna | Captura cotidiana, consultas, memoria sencilla y referencias simples | none | 12.000 | 1.600 |
| Terra | Planificación del día, varias instrucciones, conflictos y recuperación justificable | low | 18.000 | 2.400 |
| Sol | Semana con restricciones y recuperación de planificación realmente compleja | medium | 24.000 | 3.200 |

La longitud por sí sola nunca selecciona Sol. Los porcentajes 75–90 / 8–20 / 1–5 son objetivos posteriores de medición, no distribución forzada. Máximo dos intentos por solicitud y Sol una sola vez. HTTP 401/403/429 no escala a modelos más caros. Una aclaración por información ausente no autoriza inventar datos. Los límites de salida incluyen reasoning; el input es una cota conservadora por bytes UTF-8 del mensaje, historial, schema e instrucciones.

Responses usa `store:false`, `service_tier:default`, schema estricto y salida acotada. El esquema describe herramientas tipadas del dominio; el servidor valida tipos, IDs, intención, fechas y acciones. El cliente persiste y emite el recibo. Una propuesta del modelo no prueba que se haya guardado nada. Crear y editar inequívocamente puede ser directo; planificación con horarios nuevos y borrados requieren revisión cuando corresponde.

Las instrucciones estables preceden al contexto variable. Caché explícita solo tras el bloque estable; agenda, memorias e historial quedan fuera del segmento solicitado para cachear. Se registran lectura/escritura y ahorro neto con los contadores del proveedor, sin atribuir un cache hit no observado. [Guía oficial de caché](https://developers.openai.com/api/docs/guides/prompt-caching).

## Economía y SQL

`021_ai_admission.sql` conserva admisión atómica, cuotas, concurrencia, replay y anonimización al borrar cuentas. `022_openai_model_admission.sql` añade un registro por intento OpenAI, límites Sol y alertas deduplicadas. Admitir reserva el coste máximo; `focus_ai_begin_attempt` debe devolver `started` antes de llamar; `focus_ai_settle_attempt` liquida cada intento; `focus_ai_finish` guarda el resultado antes de entregarlo. Uso desconocido conserva reserva. Un fallo de persistencia contable no entrega acciones ejecutables.

| Protección | Default |
|---|---:|
| Global diario UTC / últimos 30 días | US$5 / US$20 |
| Usuario diario UTC / últimos 30 días | US$0,25 / US$5 |
| Por solicitud, incluidos reintentos | US$0,25 |
| Sol global diario UTC / últimos 30 días | US$0,50 / US$3 |
| Sol por usuario diario / últimos 30 días | 2 / 10 solicitudes |
| Rate / concurrencia por usuario | 5 por minuto / 1 |
| Alertas / economía | 50%,75%,90% / 90% |

El techo por solicitud permite una recuperación Terra→Sol bajo reserva; una solicitud compleja puede retener gran parte del presupuesto diario de su usuario hasta liquidarse. Al 90% Sol queda bloqueado y Terra requiere una razón; al agotarse se rechaza gasto nuevo. `AI_PAID_CALLS_ENABLED=false` corta chat y fotos. El control de base de datos `focus_ai_set_control(false)` bloquea inmediatamente admisiones e intentos nuevos, incluso con una reserva anterior, y conserva el replay válido. Es una RPC exclusiva de `service_role`; `focus_ai_get_control()` consulta su estado y `focus_ai_set_control(true)` restablece admisión. No cancela una llamada que ya salió al proveedor. Reaplicar la migración conserva el estado del interruptor. Los valores están en [`.env.example`](../../.env.example). La ventana monetaria de 30 días es móvil; los reportes de mes calendario UTC se etiquetan separadamente.

Si la reserva inicial no cabe, hay una sola readmisión con el mismo UUID y una reserva menor: se retira el respaldo opcional o se baja de Sol a Terra. Un rechazo de cuota, concurrencia o estado incierto no abre ese camino.

Sol registra porcentaje de solicitudes, coste, razón y aviso por frecuencia a partir de 20 solicitudes y 5%. Alertas persistidas privadas y logs estructurados permiten revisión operativa sin enviar contenido ni notificaciones externas automáticas.

Precios verificados el 8 de septiembre de 2026, USD/MTok entrada/caché/salida: [Luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna) 0,20/0,02/1,20; [Terra](https://developers.openai.com/api/docs/models/gpt-5.6-terra) 2/0,20/12; [Sol](https://developers.openai.com/api/docs/models/gpt-5.6-sol) 4/0,40/20. Escritura caché 1,25×entrada. Sol promocional hasta al menos el 21 de noviembre; el código exige revisar antes del 20 de noviembre. Las tarifas desconocidas o caducadas bloquean nuevas reservas.

Los clientes consultan `/api/ai-capabilities` antes de enviar cada conversación, sin contenido, autenticación ni caché. Un despliegue antiguo, un rollback o una respuesta desconocida conserva el borrador y bloquea el envío. El endpoint confirma la identidad del código OpenAI, no la validez de la clave ni la disponibilidad del proveedor.

## Validación reproducible

```sh
# Inventario sin red; selección de 100 casos alternando 25 categorías de 211.
npm run ai:benchmark -- --limit 100 --report /tmp/hilante-router-inventory.json
# Runtime+SQL reales en PostgreSQL WASM; proveedor sintético, sin gasto.
FOCUS_PGLITE_MODULE=/tmp/focus-ai-sql-validation/node_modules/@electric-sql/pglite/dist/index.js npm run ai:test:router-sql
# Solo con clave válida de servidor: mismo runtime+SQL+adaptador OpenAI reales.
FOCUS_PGLITE_MODULE=/tmp/focus-ai-sql-validation/node_modules/@electric-sql/pglite/dist/index.js npm run ai:benchmark -- --live --limit 100 --budget 1
```

Los cinco escenarios de conversación en `tests/nova-battery/openai-conversations.json` tienen calificaciones humanas pendientes; no se han puntuado automáticamente como si fueran evaluación humana.

El runner conserva el grader original, hashes, modelos, reintentos, costes, planes sintéticos y replay. No equipara SQL local con Supabase remoto ni un plan con persistencia del cliente. Los criterios conversacionales siguen requiriendo revisión humana identificada. La primera ejecución remota de 100 casos aprobó **86/100** con el grader original. Hubo 103 intentos de proveedor y 100 replays sin intentos adicionales. El cargo contable fue US$0,0621128, incluyendo una reserva con uso no observado; por ello el coste observado total y medio son desconocidos. P50/P95 HTTP exitoso: 5.817/9.486 ms, incluyendo transporte por Vercel CLI. Se corrigieron los fallos reproducibles y está en curso la batería ampliada de 211 casos; no se ha demostrado 99%. [Baseline completo](qa/ai-openai-remote-100.json).

Pruebas del checkpoint `6f23993`: **560/560 Node, 34/34 SQL PostgreSQL WASM, 6/6 integración router+SQL, 95/95 XCTest y 14/14 E2E Chrome**. Las pruebas locales de IA usan proveedor sintético. La interfaz nativa pasó cinco ejecuciones de tres tests: categorías y swipe/borrado/Deshacer/reinicio en claro y oscuro, y cancelación del dictado con permiso denegado. Build **1.0 (34)** compilada, firmada e instalada sin borrar datos; el lanzamiento fue rechazado por el bloqueo del teléfono. El build 33 sí había abierto. Ninguna de esas comprobaciones equivale a dictado hablado ni conversación OpenAI desde el iPhone. [Evidencia nativa](qa/native-ux-build34.json); Node: `/tmp/focus-final-node-v17.log`.

QA visual web del commit `d627293`, sin cuenta personal ni envío de IA: selector de acceso y formulario de contraseña dentro del viewport a 753×657 y 390×844, navegación Volver/Cerrar correcta. Se eliminó la colisión entre la animación del panel y su centrado CSS. El consentimiento visible distingue OpenAI/chat de Anthropic/fotos y pudo cancelarse conservando el borrador. Las frases de bienvenida ya no prometen Deshacer para todas las acciones ni revisión adicional para cada edición. La validación del arreglo fue local y no implica publicación en producción.

Supabase remoto: aplicadas 020/021/022 con checkpoint de metadatos; RLS, RPC privadas, control de gasto, 8 solicitudes simultáneas con mismo ID, 6 IDs concurrentes, cuotas, presupuesto, replay y borrado de la cuenta sintética pasaron. Tres registros contables de coste cero quedaron anónimos. [Evidencia remota](qa/ai-openai-supabase-remote.json).

## Activación y comprobaciones remotas

- Supabase: inspección previa, checkpoint, aplicación 020/021/022 y verificación remota completadas, sin reset ni datos reales borrados.
- Vercel: CLI autorizada por el titular; clave OpenAI sensible compartida con Preview sin leerla; límites nuevos configurados para ambos entornos y overrides obsoletos retirados.
- Preview inicial `dpl_HgLfsJJgePu88qnpXY82JoUim183` (commit `353d1e5`): capabilities 200, POST capabilities 405, chat sin sesión 401, smoke autenticado y baseline 100. El primer intento de deploy excedió las 12 funciones del plan; se corrigió reutilizando la función de chat para capabilities, sin cambiar el plan.
- El preview V8 `dpl_FKEX3bDSfoZNtyJ5qEZQJnvxnwTx`, commit `e43b315`, aprobó las **13/13** frases informales y sus comprobaciones de presentación, con 13 intentos Luna y 13 replays. Cargo contable US$0,00319246; p50/p95 HTTP 2.863/7.250 ms. Las dos cuentas sintéticas se eliminaron y verificaron. [Reporte](qa/ai-experience-remote-final.json).
- Los cuatro escenarios independientes V6 aprobaron **3/4**. Hubo dos Luna, un Terra y un Sol; el caso semanal respondió pero el kernel rechazó el plan. Cargo contable US$0,06129674, de los que US$0,049469 fueron Sol; todas las cuentas propias se eliminaron. [Reporte V6](qa/ai-openai-conversations-v6.json). La reproducción determinista posterior encontró errores de alias y cuantificación; no se atribuye retrospectivamente todo el rechazo a una causa sin el plan crudo.
- La conversación real de seis turnos en la web V6 completó los seis envíos y verificó SQL, pero falló la corrección «mejor a las 11AM». El cliente omitía la referencia al evento recién guardado. Se corrigió con un vínculo de un solo uso respaldado por recibo, cuenta, historial y snapshot vigentes; el servidor mantiene la validación de autoridad. [Reporte V6](qa/ai-openai-web-continuity-v6.json).
- Durante la recarga de esa cuenta, el callback asíncrono de Supabase esperaba peticiones REST que necesitaban el mismo bloqueo de sesión. La corrección difiere el trabajo fuera del callback e invalida sesiones tardías. Tres regresiones con el SDK real fallaron contra la versión anterior y pasan con el arreglo; el flujo real se repetirá en el preview corregido.
- El primer intento final V8 de 211 se detuvo en el caso 12: respuesta inicial 200 y replay 503, sin otro intento de proveedor. Quedan conservados los 12 casos, el fallo y las 24 limpiezas verificadas. [Intento V8](qa/ai-openai-remote-final-211-v8-attempt1.json). La causa del 503 no quedó registrada; no se afirma que fuese un timeout.
- `6f23993` permite recuperar una respuesta terminal sólo mediante una lectura de hasta 1,5 segundos, filtrada por propietario, UUID, contenido exacto, tipo y caducidad. No repite admisión ni llamadas al modelo; una denegación explícita no abre este camino. Los diagnósticos sólo incluyen operación, resultado y duración.
- El runner conserva como fallo cualquier replay 503. Sólo continúa al siguiente caso cuando SQL prueba que todos los intentos siguen liquidados e idénticos y no cambió la contabilidad. No repite el caso, no cambia su UUID, no añade una llamada pagada ni modifica el grader original.
- Pendientes de esta ficha: resultados del nuevo preview, batería completa de 211, candidato Production, promoción y comprobación del dominio público. El deployment anterior se conserva como checkpoint. Un push no demuestra producción.

```sh
# Sin red por defecto. El modo live usa solamente cuentas sintéticas propias,
# conserva costes al eliminarlas y deja US$0,25 libres antes de cada request.
npm run ai:benchmark:remote -- --limit 211
npm run ai:benchmark:remote -- --live --vercel-cli --limit 211 --users 24 --budget 1 --base-url <preview-verificado> --env-file <archivo-privado-600> --report <reporte.json>
node scripts/ai-conversation-benchmark.mjs --live --vercel-cli --budget .50 --base-url <preview-verificado> --env-file <archivo-privado-600> --report <conversaciones.json>
```

El fichero privado contiene credenciales Supabase de servidor; nunca se imprime ni se incluye en git, frontend o iOS. Las puntuaciones humanas permanecen pendientes. Los cuatro escenarios independientes no sustituyen la prueba de continuidad/persistencia en un cliente real.

Fotos permanecen Anthropic Haiku: no hay una comparación equivalente que demuestre que migrarlas mejora calidad/coste/latencia. iOS mantiene dictado local; el endpoint pagado de audio sigue pausado hasta poder reservar según duración verificada. El consentimiento web v2 / iOS v3 y [privacidad](../../public/privacidad.html) reflejan estas rutas. [Detalle de fotos, voz y disclosures](RELEASE.md).

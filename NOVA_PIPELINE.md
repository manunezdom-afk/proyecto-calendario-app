# Nova — ejecución y límites (Focus 2.0)

## Contrato del producto

La captura de Inicio y la conversación llaman a `FocusDataStore.sendNovaMessage`.
Una tarea puede tener fecha límite sin hora. Un compromiso necesita hora; si falta
la de una cita, Nova pregunta y conserva el contexto para la respuesta siguiente.
Los avisos por ubicación todavía no existen: se explica la limitación y se pide hora.

El mensaje del modelo es una interpretación, no un recibo. El store valida modo,
confianza, tipos y referencias antes de aplicar cambios. `chat_only`, aclaración
explícita y confianza insuficiente nunca ejecutan acciones. El resumen visible de
una mutación proviene de los elementos que efectivamente se guardaron. Los errores
ofrecen reintento; el estado publicado se comparte entre ambas superficies.

Las eliminaciones y propuestas requieren revisión con los elementos concretos.
Una confirmación se consume una sola vez. El store permite una solicitud activa;
un cambio de cuenta o cancelación invalida su identidad y descarta respuestas tardías.
Los eventos y tareas repetidos se detectan por título/fecha. Esto es una defensa de
repetición local, no una clave de idempotencia distribuida.

`follow_up_question` es opcional: conserva la pregunta por otra instrucción después
del resumen verificado. Una acción malformada invalida todo el lote; una aclaración
independiente puede acompañar acciones claras. Los clientes anteriores pueden ignorar
el campo adicional.

## Proveedores y privacidad

OpenAI usa Responses con JSON Schema estricto y `store:false`. DeepSeek normaliza su
JSON y pasa por el mismo adaptador. Ambos reciben el mensaje, historial y agenda
acotados; el adaptador recibe `userMessage` e historial en ambos caminos. Los datos
de agenda contienen fechas límite, duración explícita y avisos para no planificar
sobre un contexto incompleto.

`novaSafety.js` limita mensajes a 4.000 caracteres, historial a 12 entradas de 1.000,
eventos a 80, tareas a 50 y memorias a 20 de 200 caracteres. La captura no necesita
enviar la libreta de contactos ni un perfil de comportamiento. Las memorias no se
aprenden ni se envían cuando el usuario las desactiva; su almacenamiento usa el
namespace de la cuenta. Los logs no incluyen prompts, títulos ni cuerpos de errores
del proveedor. La telemetría local registra únicamente nombres de eventos cerrados.

Cada intento de OpenAI/DeepSeek registra modelo, tokens disponibles, costo estimado,
latencia y éxito/fallo, incluso si la respuesta pagada no contiene JSON válido. Una
falla HTTP sin datos de uso se registra como uso desconocido, no como consumo probado
cero. El cambio automático entre proveedores exige `AI_ENABLE_PROVIDER_FALLBACK=true`.
Los modelos actuales se conservan; sus precios en `aiPricing.js` son estimaciones
configuradas y deben verificarse antes de tomar decisiones comerciales.

## Presupuesto y despliegue

`AI_DAILY_BUDGET_USD` y `AI_MONTHLY_BUDGET_USD` activan el corte de gasto acumulado.
El periodo mensual es una ventana móvil de 30 días. Cuando un presupuesto está
configurado y su consulta falla, Nova responde temporalmente indisponible y permite
continuar con creación manual. Sin variables de presupuesto, este corte no está activo.
No se cachean decisiones de presupuesto aprobado. Los cargos se suman con agregado
SQL o páginas completas, sin el truncamiento habitual de 1.000 filas de PostgREST.

La migración **020_atomic_ai_usage.sql está preparada, no aplicada**. Habilita dos
RPC exclusivas de `service_role`: incremento atómico del contador y suma de costos.
Hasta aplicarla, la API conserva compatibilidad mediante actualización condicionada
por el valor anterior (compare-and-swap) y lectura paginada del presupuesto. Solo un
RPC inequívocamente ausente usa fallback; un timeout de escritura no se reintenta,
porque podría haberse confirmado y contar dos veces.

La comprobación de cuota y el inicio de una llamada siguen siendo operaciones
separadas: solicitudes simultáneas ya autorizadas pueden superar ligeramente el
umbral. El costo desconocido de un timeout y cargos todavía en curso también limitan
la precisión del corte. Antes de producción debe verificarse la migración, los topes
y permisos del proveedor con la cuenta del dueño; no se cambiaron ni se desplegaron.

## Verificación local

- `npm run test:unit`: adaptadores, payloads, privacidad, costos de parse fallido,
  presupuestos de más de 1.000 cargos y fallas de páginas, contador RPC y colisiones.
- `FocusTests/NovaExecutionTests.swift`: modo/confianza, revisión, reintento, repetición,
  referencias obsoletas, fecha sin hora, múltiples instrucciones y aclaración local.
- Fixtures Swift en directorios temporales, sin restaurar cuenta ni programar avisos.

Las pruebas usan respuestas sintéticas y no consumen APIs pagadas. No equivalen a una
medición de calidad con el proveedor real ni a una verificación de la configuración
en producción. Referencia del contrato de OpenAI: https://developers.openai.com/api/docs/guides/function-calling.

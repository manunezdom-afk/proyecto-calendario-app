# Modelos para Hilante: evidencia documental

Revisado el **8 de septiembre de 2026**. Precios en USD por millón de tokens, API directa, procesamiento estándar y texto; sin impuestos, descuentos negociados, batch, prioridad ni herramientas alojadas. Esta investigación no ha enviado inferencias pagadas ni inspeccionado credenciales. La presencia de un modelo en el catálogo no demuestra acceso desde la cuenta de Focus.

## Ocho candidatos para medir

La pareja por proveedor cubre una opción económica y otra de mayor capacidad declarada. No es un ranking de calidad en español: las descripciones del fabricante sirven para formar la muestra; los resultados de Focus deben decidir el proveedor predeterminado y cuándo escalar.

| Proveedor / ID de API | Entrada | Salida | Entrada en caché | Contexto / salida máxima | Esquema / herramientas / streaming | Estado y fuente oficial |
|---|---:|---:|---:|---|---|---|
| DeepSeek `deepseek-v4-flash` | 0.44 pico; 0.22 valle | 1.32 pico; 0.66 valle | 0.014 pico; 0.007 valle | 1M / 384K | JSON; herramientas estrictas beta; sí / sí | Catálogo actual; alias de Flash-0731. [Tarifas y capacidades](https://api-docs.deepseek.com/quick_start/pricing/) |
| DeepSeek `deepseek-v4-pro` | 1.32 pico; 0.66 valle | 3.96 pico; 1.98 valle | 0.044 pico; 0.022 valle | 1M / 384K | JSON; herramientas estrictas beta; sí / sí | GA 13-08-2026; alias Pro-0813. [Anuncio](https://api-docs.deepseek.com/news/news260813/), [tarifas](https://api-docs.deepseek.com/quick_start/pricing/) |
| OpenAI `gpt-5.6-luna` | 0.20 | 1.20 | 0.02 | 1,050,000 / 128,000 | JSON Schema estricto; sí / sí | Disponible en catálogo. [Ficha](https://developers.openai.com/api/docs/models/gpt-5.6-luna) |
| OpenAI `gpt-5.6-terra` | 2.00 | 12.00 | 0.20 | 1,050,000 / 128,000 | JSON Schema estricto; sí / sí | Disponible en catálogo. [Ficha](https://developers.openai.com/api/docs/models/gpt-5.6-terra) |
| Anthropic `claude-haiku-4-5-20251001` | 1.00 | 5.00 | 0.10 | 200K / 64K | JSON Schema y herramientas estrictas GA; sí / sí | ID fechado; alias `claude-haiku-4-5`. [Modelos](https://platform.claude.com/docs/en/models/overview), [tarifas](https://platform.claude.com/docs/en/about-claude/pricing) |
| Anthropic `claude-sonnet-5` | 2.00 | 10.00 | 0.20 | 1M / 128K | JSON Schema y herramientas estrictas GA; sí / sí | Disponible en catálogo. [Modelos](https://platform.claude.com/docs/en/models/overview), [tarifas](https://platform.claude.com/docs/en/about-claude/pricing) |
| Google `gemini-3.5-flash-lite` | 0.30 | 2.50 | 0.03 | 1,048,576 / 65,536 | JSON Schema parcial; tool choice validado; sí / sí | Estable; ficha 30-07-2026. [Ficha](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite), [tarifas](https://ai.google.dev/gemini-api/docs/pricing) |
| Google `gemini-3.8-flash` | 0.75 | 3.75 | 0.075 | 1,048,576 / 65,536 | JSON Schema parcial; tool choice validado; sí / sí | Estable; ficha 02-09-2026. [Ficha](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash), [tarifas](https://ai.google.dev/gemini-api/docs/pricing) |

Todos los precios fueron consultados el 08-09-2026. Donde no hay fecha de entrada en vigor publicada, esa es fecha de verificación, no de lanzamiento.

## Condiciones que cambian el coste

- **DeepSeek:** el nuevo tarifario rige desde 16-08-2026, 16:00 UTC. Pico: lunes a viernes, 01:00–04:00 y 06:00–10:00 UTC; el resto es valle. Reservar a tarifa pico evita depender de la hora exacta de facturación. [Anuncio](https://api-docs.deepseek.com/news/news260813/), [horarios](https://api-docs.deepseek.com/quick_start/pricing/).
- **OpenAI:** Luna/Terra cobran escrituras de caché a 0.25/2.50. Por encima de 272K tokens de entrada, entrada/caché/escritura cuestan el doble y salida 1.5 veces para toda la solicitud. No aplicar ahorro de caché sin uso reportado. [Tarifario](https://developers.openai.com/api/docs/pricing).
- **Claude:** crear caché de 5 minutos cuesta 1.25/2.50 para Haiku/Sonnet; de una hora, 2/4. Sonnet 5 mantiene 2/10: el aumento anunciado para septiembre fue cancelado. El procesamiento `inference_geo: "us"` de modelos compatibles añade 10%. [Tarifario](https://platform.claude.com/docs/en/about-claude/pricing).
- **Gemini:** desde **01-01-2027**, Flash 3.8 pasa a entrada 1.50, salida 7.50 y caché 0.15. Almacenar caché cuesta 0.50 por millón de tokens/hora hasta diciembre y 1.00 después; Flash-Lite 3.5 cuesta 1.00. La salida incluye pensamiento. El nivel gratuito tiene condiciones distintas de uso de datos para mejorar productos; no sustituye al nivel pagado sin revisar consentimiento. [Tarifario](https://ai.google.dev/gemini-api/docs/pricing).

No son precios por mensaje. El coste depende también del esquema, historial, resultados de herramientas, pensamiento, reintentos y escrituras de caché. La reserva debe cubrir la entrada completa y el máximo de salida de cada intento autorizado; el registro posterior debe reconciliar los contadores reales del proveedor sin duplicar pensamiento incluido en salida.

## Diferencias de API que requieren adaptadores

**DeepSeek.** `strict: true` para herramientas requiere el endpoint `/beta` y un subconjunto de JSON Schema: propiedades obligatorias y objetos cerrados. `json_object` garantiza formato JSON, no el contrato de Focus; puede llegar vacío o truncado. [Herramientas](https://api-docs.deepseek.com/guides/tool_calls/), [JSON](https://api-docs.deepseek.com/guides/json_mode/).

Su Responses API es sin estado: no admite `previous_response_id`/`conversation`, `store` es falso y hay que reenviar contexto. Trata `developer` como `user`; ignora `parallel_tool_calls` y permite paralelo siempre. El streaming termina con eventos Responses, sin `[DONE]`. No reutilizar a ciegas el adaptador OpenAI. [Compatibilidad Responses](https://api-docs.deepseek.com/guides/responses_api/).

**OpenAI.** Declarar `strict: true` explícitamente: omitirlo en Responses puede acabar en modo no estricto si la normalización falla. Cerrar objetos y declarar todos los campos; representar los opcionales con `null`. Separar rechazos (`refusal`) y respuestas incompletas del resultado válido. La conformidad al esquema no prueba que una fecha o una acción sean correctas. [Herramientas](https://developers.openai.com/api/docs/guides/function-calling), [salidas estructuradas](https://developers.openai.com/api/docs/guides/structured-outputs).

En GPT-5.6, `usage.input_tokens` incluye `input_tokens_details.cached_tokens` y `cache_write_tokens`: restar ambos antes de cobrar entrada normal. `prompt_cache_options` reemplaza los controles de retención anteriores; el modo explícito sin puntos de caché permite evitar escrituras. [Caché y fórmula oficial](https://developers.openai.com/api/docs/guides/prompt-caching).

**Claude.** La interfaz GA usa `output_config.format`; herramientas usan `strict: true`. No requiere la cabecera beta antigua. El compilador tiene límites de complejidad de esquema y puede añadir latencia inicial. [Salidas estructuradas](https://platform.claude.com/docs/en/build-with-claude/structured-outputs).

Sonnet 5 usa pensamiento adaptativo por defecto y esfuerzo alto; `budget_tokens`, prefill y parámetros de muestreo no predeterminados producen error. `max_tokens` incluye pensamiento. Seleccionar bloques de respuesta por tipo; conservar bloques de pensamiento en el ciclo de herramientas. El nuevo tokenizador puede producir aproximadamente 30% más tokens que modelos anteriores: comparar coste por caso resuelto, no solamente tarifa. [Migración Sonnet 5](https://platform.claude.com/docs/en/models/sonnet-5/migration-guide).

**Gemini.** Interactions es GA desde junio; `generateContent` sigue soportado. Interactions guarda solicitudes por defecto, 55 días en nivel pagado; usar `store: false` para la modalidad sin estado. Esta opción no certifica las demás condiciones de retención del servicio. [Interactions](https://ai.google.dev/gemini-api/docs/interactions-overview).

El esquema se expresa mediante `response_format` con MIME JSON y `schema`; `tool_choice: "validated"` es una modalidad propia, no un `strict: true` de OpenAI. Combinar salida estructurada y herramientas sigue marcado preview. Flash 3.8 no admite pensamiento `minimal`: usa low/medium/high. [Esquemas](https://ai.google.dev/gemini-api/docs/structured-output), [herramientas](https://ai.google.dev/gemini-api/docs/function-calling), [Flash 3.8](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash).

Interactions reporta `total_output_tokens` y `total_thought_tokens` por separado; ambos se cobran como salida. La referencia define `max_output_tokens` como límite de respuesta, pero no encontré una garantía explícita del techo conjunto de respuesta y pensamiento para estos modelos. El adaptador `scripts/ai-benchmark-google.mjs` prepara payloads sin estado y un intento con timeout, pero esta condición debe aclararse antes de una batería pagada con presupuesto estricto. Sus pruebas son offline; no validan acceso real. [Contadores](https://ai.google.dev/api/interactions-api), [pensamiento y facturación](https://ai.google.dev/gemini-api/docs/thinking).

## Decisión pendiente del benchmark

La primera comparación propuesta es Luna/Haiku: ambos tienen salida restringida y tarifas aptas para una batería acotada. Terra/Sonnet son candidatos de escalamiento, sujetos a mejora medible. DeepSeek y Gemini permanecen como alternativas documentadas hasta disponer de acceso autorizado, revisión de datos y adaptador correcto. Ninguna posición constituye una elección definitiva.

Medir al menos 100 casos reales de intención en español, incluyendo Chile, fechas relativas, cruces de medianoche, ambigüedad, instrucciones múltiples y entradas hostiles. Registrar exactitud semántica y de herramientas, errores de guardado, aclaraciones, reintentos, coste por caso correcto, p50/p95 y tiempo hasta primera respuesta útil. Aplicar la ponderación del brief: fiabilidad 50%, coste 20%, latencia 15%, conversación 15%; un éxito falso de persistencia es un fallo crítico aunque el promedio sea alto.

**No medido en esta investigación:** calidad en español, latencia desde Vercel, disponibilidad por cuenta/región, tasa real de caché y fiabilidad con el esquema de Focus. Los errores 401/403, falta de cuota y tiempos hasta rechazar credenciales no son latencia de inferencia ni evidencia sobre calidad del modelo. Los resultados de ejecución deben vivir en el informe del benchmark.

Se revisó la guía de [Netlify AI Gateway](https://docs.netlify.com/build/ai-gateway/overview/) por su orientación de selección. Focus mantiene su despliegue y APIs directas en Vercel; no se presupone compatibilidad del catálogo anterior con el gateway ni se propone migración.

## Registro local de tarifas

`api/_lib/aiPricing.js` conserva fecha/fuente, categorías de caché, períodos UTC y cambio anunciado de Gemini. `requireCurrent: true` rechaza modelos desconocidos, retirados o tarifas fuera de la ventana interna de revisión, que termina el 01-12-2026. Ese plazo es una política de Focus; no una promesa de estabilidad de precios de los proveedores. Los reportes pueden consultar tarifas conocidas fuera de la ventana con `stale: true`; no deben reutilizarlas para admisión. Las reservas usan pico DeepSeek y la siguiente tarifa conocida de Gemini; los reportes de consumo seleccionan `conservative: false` y la fecha de llamada.

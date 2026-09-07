# Focus 2.0 — Referencias visuales de asistentes

Investigación: 7 de septiembre de 2026. Alcance: materiales públicos oficiales de Gemini, Claude y Perplexity; recomendaciones para la app nativa Focus. Las medidas, colores propuestos y textos de Focus son decisiones de diseño propias, no especificaciones copiadas de estos productos.

## Dirección recomendada

**Una presencia cálida, con luz azul e índigo, que convierte una intención en algo concreto.** La expresividad debe concentrarse en la bienvenida, la marca de Nova y el campo de captura. La agenda y las acciones guardadas necesitan superficies tranquilas, buen contraste y jerarquía estable.

La pantalla inicial debe responder, en este orden: quién me acompaña, qué puedo quitarme de la cabeza y dónde escribo. Después de enviar, el protagonismo cambia del saludo al resultado: tarea, evento, pregunta necesaria o propuesta que se puede revisar.

## Qué respaldan las fuentes actuales

| Referencia | Evidencia oficial | Aplicación en Focus |
| --- | --- | --- |
| Gemini | Google presentó **Neural Expressive** el 19 de mayo de 2026: color más vivo, nueva tipografía, animación y respuesta háptica. Integra voz y texto, y presenta resultados con más estructura visual. El anuncio indica despliegue global en web, Android e iOS. [Anuncio oficial](https://blog.google/innovation-and-ai/products/gemini-app/next-evolution-gemini-app/) | Una bienvenida expresiva y un compositor protagonista; la respuesta toma la forma del resultado que necesita la persona. |
| Claude | Sus guías oficiales de interfaces conversacionales recomiendan jerarquía reducida, superficies del tema, iconos simples, espaciado generoso y tarjetas de acción compactas. Publican fondos cálidos claros y oscuros, incluido `#FAF9F5` y `#141413`. Estas son guías de MCP Apps dentro de Claude, no una medición de cada pantalla móvil. [Guía visual oficial](https://claude.com/docs/connectors/building/mcp-apps/design-guidelines) | Calma editorial: texto cómodo, pocos pesos tipográficos y acciones legibles. El contenido aporta valor sin depender de decoración intensa. |
| Claude en iOS | La documentación describe tarjetas y propuestas dentro de la conversación para revisar y actuar; también distingue las operaciones de calendario y recordatorios. [Uso con apps de iOS](https://support.claude.com/en/articles/11869619-use-claude-with-ios-apps) | Mostrar título, fecha y hora de lo que se va a aplicar. Una propuesta debe verse distinta de una acción ya guardada. |
| Perplexity | Su producto presenta búsqueda, conversación, voz, acciones y seguimiento de preguntas. Sus ajustes permiten tema claro/oscuro/sistema y preferencias de tipografía de respuesta. [Ficha oficial del desarrollador](https://apps.apple.com/us/app/perplexity-ai-search-chat/id1668000334), [Ajustes oficiales](https://www.perplexity.ai/help-center/en/articles/10352993-account-settings) | Priorizar contenido verificable y continuidad. En Focus, la prueba útil es la acción guardada y sus datos; no hace falta copiar un feed de descubrimiento. |

El anuncio de Gemini de mayo de 2026 tiene más relevancia para una dirección actual que las capturas de su lanzamiento en iPhone de noviembre de 2024. Ese [material histórico oficial](https://blog.google/products-and-platforms/products/gemini/gemini-iphone-app/) sigue siendo útil para estudiar el acceso directo a captura y voz, pero no debe presentarse como la UI actual.

## Bienvenida de Nova

Propuesta principal:

> Tu mente,  
> un poco más ligera.

Texto de apoyo: **“Dime qué tienes pendiente. Le damos un lugar en tu día.”**

La frase reconoce la carga mental y conduce a una capacidad real. Evitar promesas ilimitadas, “pregúntame cualquier cosa” y lenguaje de automatización técnica. El título usa peso medio, dos líneas cómodas y tamaño aproximado de 30–36 pt según ancho y accesibilidad. La marca orbital propia puede ocupar 40–44 pt; no necesita dominar media pantalla.

Mostrar tres intenciones breves con icono simple y ejemplo:

- **Guardar un pendiente** — “Estudiar economía mañana”.
- **Hacer espacio** — “Reunión mañana a las 10”.
- **Ordenar lo que sigue** — “Ayúdame a ordenar mis pendientes”.

Tocar una sugerencia completa el borrador; la persona conserva la decisión de enviarlo. Las tarjetas no deben simular que organizar implica mover automáticamente eventos. En un iPhone pequeño, priorizar filas compactas de una o dos líneas sobre grandes mosaicos.

El aviso de funcionamiento local para invitados debe ser breve y secundario. No debe competir con el campo principal. La modalidad de red, el consentimiento y las limitaciones reales siguen funcionando.

## Compositor

Usar una superficie amplia de esquinas suaves, con separación sutil respecto al fondo. Dos filas permiten que escribir siga siendo cómodo:

1. Texto multilínea con un placeholder concreto: **“¿Qué tienes en mente?”** o **“Escribe una tarea, un plan o una idea…”**.
2. Dictado a la izquierda; envío circular o compacto a la derecha, con objetivos táctiles de al menos 44 pt. Una etiqueta discreta puede orientar a capturar una intención.

La entrada puede crecer hasta unas cinco líneas antes de hacer scroll interno. Mantener el compositor anclado sobre el teclado, con safe area y margen lateral uniforme. El halo de foco indica dónde se está trabajando: borde azul suave y luz ambiental difusa. No colocar degradado detrás del texto editable.

Estados que deben seguir siendo inequívocos:

- Vacío: envío deshabilitado y superficie estable.
- Escribiendo: entrada enfocada, envío disponible.
- Procesando: una sola petición en curso, posibilidad de cancelar.
- Propuesta pendiente: confirmación o descarte visibles; no enviar otra acción por accidente.
- Error: explicación útil, borrador o reintento recuperable.
- Dictado: acceso a la revisión del texto antes de enviarlo; no representar una conversación de voz continua si sólo hay transcripción local.

## Conversación y resultados

**Usuario:** bloque corto sobre superficie suave, margen interior suficiente y etiqueta discreta. **Nova:** respuesta sobre el fondo, con firma pequeña y texto editorial. Evitar envolver todos los párrafos en burbujas grandes o tarjetas duplicadas.

Después de ejecutar, una línea de éxito debe representar datos reales. Ejemplos de presentación:

- Tarea: “Estudiar economía” + “Mañana · Sin hora”.
- Evento: “Dentista” + “Vie 10 · 11:00”.
- Recordatorio: “Aviso 30 min antes”, sólo si ese aviso fue guardado.

Para propuestas, separar tres piezas: **qué se propone**, **qué cambiará** y **Aplicar / Descartar**. Para aclaraciones, destacar una pregunta breve y mantener el compositor preparado. Una respuesta de confirmación no debe tener el mismo tratamiento cromático que una propuesta pendiente.

En Hoy, el resultado de captura debe enlazarse visualmente con la lista operativa. En Nova, el mismo resultado queda en su contexto conversacional. El diseño refuerza que ambos comparten un único ejecutor.

## Color, luz y jerarquía

Paleta propuesta propia para Focus, a adaptar a Theme:

| Función | Claro | Oscuro |
| --- | --- | --- |
| Fondo | Perla fría muy suave | Tinta azul casi negra |
| Superficie | Blanco con leve tinte | Azul grisáceo elevado |
| Texto principal | Tinta profunda | Blanco cálido |
| Acento | Azul nítido | Azul más luminoso |
| Segundo acento | Índigo/violeta contenido | Índigo/violeta luminoso |
| Éxito y error | Colores semánticos independientes | Colores semánticos con contraste adecuado |

Usar el degradado azul→índigo en la marca y el control principal. La luz ambiental ocupa una zona focal alta y se desvanece antes del contenido denso. La lectura debe seguir siendo clara si se elimina el halo por accesibilidad o rendimiento.

Escala visual propuesta: título 30–36 pt; cuerpo 16–17 pt; metadatos 12–14 pt. Preferir regular y medium/semibold; reservar bold para información realmente dominante. Mantener tres niveles claros, pocas variantes de radios y separaciones regulares de 8, 12, 16, 20 y 24 pt.

La sensación futurista viene de la precisión del compositor, una marca propia y transiciones cortas con propósito. Evitar destellos constantes, fondos con partículas, animación de toda la página, bordes neón en cada tarjeta y texto de bajo contraste. Respetar Reduce Motion, Dynamic Type y el tema del sistema.

## Referencias de imágenes y límites de observación

Galerías y piezas publicadas por los propios productos:

- [Gemini: anuncio visual Neural Expressive y collage de producto, mayo de 2026](https://blog.google/innovation-and-ai/products/gemini-app/next-evolution-gemini-app/).
- [Gemini: galería histórica del lanzamiento en iPhone, noviembre de 2024](https://blog.google/products-and-platforms/products/gemini/gemini-iphone-app/).
- [Claude: capturas oficiales en App Store](https://apps.apple.com/us/app/claude-by-anthropic/id6473753684).
- [Claude: ejemplos oficiales de tarjetas, jerarquía, tipografía y modo oscuro](https://claude.com/docs/connectors/building/mcp-apps/design-guidelines).
- [Perplexity: capturas oficiales en App Store](https://apps.apple.com/us/app/perplexity-ai-search-chat/id1668000334).

Se verificaron las fuentes y la existencia de sus galerías. El lector web no pudo renderizar varios recursos de imagen remotos: devolvió formato no compatible o rechazo de URL. No se descargaron esas imágenes para eludir la restricción ni se atribuyen mediciones de píxeles a capturas no inspeccionadas. Las recomendaciones de composición son una síntesis de las guías oficiales, capacidades documentadas y el objetivo de Focus. La dirección de halo azul/índigo también coincide con la observación de Gemini web realizada por el agente principal en esta sesión.

## Orden de aplicación

1. Bienvenida, fondo y compositor coherentes entre Nova y Hoy.
2. Jerarquía de conversación y tarjetas de acciones verificadas.
3. Propuestas, errores, dictado y estados de carga con la misma calidad visual.
4. Comprobación en pantalla pequeña, texto grande, teclado visible, tema claro y oscuro.

El cambio visual debe conservar todos los identificadores de accesibilidad, los bloqueos de envío, la revisión de propuestas, el consentimiento y la recuperación de errores existentes.

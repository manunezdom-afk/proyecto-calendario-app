# Referencias de productividad para Focus

Revisión: 7 de septiembre de 2026. Alcance: Things, Todoist, Structured y Notion Calendar; fuentes oficiales. Las propuestas siguientes son decisiones para Focus, no mediciones de rendimiento de esos productos. No se instalaron apps ni se reprodujeron sus onboardings. Los enlaces de imágenes fueron recuperados de sus páginas oficiales; el lector web no entregó sus píxeles, por lo que las afirmaciones de interacción y diseño se apoyan en la documentación, sin inventar observaciones visuales.

## Qué tomar de cada producto

| Referencia | Evidencia oficial | Aplicación concreta en Focus |
|---|---|---|
| **Things** | La actualización OS 26 describe más aire, curvas refinadas, vidrio en la navegación y respuesta táctil en controles. Su edición de tarea mantiene los detalles adicionales disponibles sin ocupar el centro. Today reúne agenda y pendientes. [Diseño OS 26](https://culturedcode.com/things/blog/2025/09/things-for-os-26/), [estructura y edición](https://culturedcode.com/things/features/). | Dar profundidad al encabezado y a la captura; mantener los títulos de tareas sobre superficies tranquilas. El círculo de completar debe ser reconocible y estable en todas las pantallas. Detalles de fecha, notas y prioridad aparecen al editar. |
| **Todoist** | Quick Add comienza por el nombre; muestra acciones mientras se escribe. Reconoce fechas y permite convertir una interpretación equivocada de fecha otra vez en texto. La descripción se revela cuando se necesita. [Quick Add](https://www.todoist.com/help/todoist/features/use-task-quick-add-in-todoist-va4Lhpzz). | Una única entrada de intención, con ejemplos breves. El usuario revisa los datos interpretados en una respuesta concreta. Mostrar fecha/hora legibles y una vía de corrección; conservar siempre el borrador. Los formularios manuales deben empezar por el título, con opciones progresivas. |
| **Structured** | La entrada principal es una línea temporal: horas a la izquierda, fechas arriba y creación mediante un botón reconocible. Inbox guarda tareas sin fecha ni hora, que después se pueden programar. [Primeros pasos](https://help.structured.app/en/articles/380546), [Inbox](https://help.structured.app/en/articles/338178). | Agenda debe exponer primero la hora y luego el título. Pendientes sin fecha tiene su propio lugar; no inventar una hora para hacerlos entrar en la agenda. Usar color para categoría/estado, con texto e icono como respaldo. |
| **Notion Calendar** | Ofrece una visión conjunta del tiempo, controles de calendario y acciones contextuales. En móvil la creación se abre con `+`; su experiencia no replica todas las capacidades del escritorio. [Producto](https://www.notion.com/product/calendar), [crear eventos](https://www.notion.com/help/manage-your-calendars-and-events), [límites móviles](https://www.notion.com/en-gb/help/notion-calendar-apps). | Separar los controles de fecha del contenido. Mantener el botón de crear estable y un detalle de evento con acciones obvias. Diseñar para el ancho del iPhone; no reducir una cuadrícula de escritorio hasta volver ilegibles los eventos. |

## Pantallas oficiales disponibles

Estas imágenes son referencias de composición, no assets para incorporar a Focus:

- Things: [captura iPhone OS 26](https://culturedcode.com/frozen/2025/09/things-os26-screenshot-ios-io75.jpg), enlazada desde su [blog oficial](https://culturedcode.com/things/blog/).
- Todoist: [pantalla iOS](https://www.todoist.com/_astro/ios.xuG67rxX.png) y las secciones Quick Add / Today de [Features](https://www.todoist.com/features). El CDN devolvió error al lector para algunas imágenes; no se considera inspección visual completada.
- Structured: [pantalla principal](https://structured.app/assets/hero-screenshot.webp) y [composición iPhone de la línea temporal](https://structured.app/assets/phone-mockup.webp), enlazadas desde [Structured](https://structured.app/).
- Notion Calendar: [composición móvil](https://www.notion.com/front-static/pages/calendar/notion-calendar-mobile-v3.png) y [producto con capturas de agenda y controles](https://www.notion.com/product/calendar).

## Dirección visual propuesta

El carácter de Focus puede aparecer en una luz ambiental azul/índigo, una marca propia y la superficie de captura. La información de tareas y eventos necesita una jerarquía constante. Esta combinación es una propuesta para Focus; la referencia de asistentes/Gemini se investiga por separado.

1. **Fondo:** tinta en oscuro y perla en claro, con luz suave cerca del encabezado. El fondo ambiental no debe convertirse en el soporte del texto pequeño ni desplazar el contenido.
2. **Tipografía:** título grande de peso medio para dar calidez; cuerpo del sistema para lectura. Tres niveles claros: título, contenido y metadatos. Dynamic Type sigue determinando tamaño y reflujo.
3. **Superficies:** radios coherentes alrededor de 24 pt, borde leve y profundidad contenida. Una superficie protagonista por pantalla; las filas internas se organizan mediante alineación y espacio.
4. **Color:** azul para actuar; índigo para identidad de Nova. Atrasos y errores llevan texto explícito y color semántico. Las categorías de agenda usan un detalle de color, sin llenar cada bloque de saturación.
5. **Movimiento:** respuesta breve al tocar, guardar o completar. El contenido queda visible inmediatamente. Reducir movimiento debe eliminar desplazamientos ambientales y animaciones ornamentales.
6. **Navegación:** conservar los cuatro destinos nativos. La identidad emerge dentro de las pantallas y de la captura, manteniendo gestos, teclado y accesibilidad predecibles.

## Bienvenida y primera captura

Los materiales de Things enseñan primero a descargar una idea y luego a organizarla; Structured enseña con la primera tarea. Se puede aplicar esa progresión a Focus sin replicar sus recorridos de registro. [Guía de Things](https://culturedcode.com/things/support/articles/6378414/), [guía de Structured](https://help.structured.app/en/articles/380546).

Propuesta de una sola pantalla:

- Marca de Focus, pequeña y propia.
- “Menos ruido. / Más espacio para ti.” como promesa emocional.
- Una frase funcional: “Convierte lo que tienes en mente en un siguiente paso.”
- Muestra rotulada **Ejemplo**: “Estudiar mañana y reunión el viernes a las 10” → dos filas diferenciadas, un pendiente y un evento. Es una ilustración; no se guarda.
- CTA dominante **Empezar**, seguido de “En este iPhone. Sin crear una cuenta.”
- Acción secundaria **Ya tengo una cuenta**. Los permisos se solicitan cuando se usa la función correspondiente.

Una vez dentro, el primer vacío conserva una invitación de captura y permite crear manualmente. El éxito debe enseñar el objeto real guardado y su ubicación. Cuando una interpretación necesita aclaración, se mantiene la intención original visible.

## Jerarquía por pantalla

| Pantalla | Orden recomendado |
|---|---|
| Bienvenida | Marca → promesa → ejemplo de transformación → Empezar → cuenta secundaria. |
| Login | Volver → título breve → correo o código → error si existe → CTA → alternativa local. Reducir espacio ornamental cuando aparece el teclado. |
| Hoy | Fecha/saludo → captura → siguiente pendiente accionable → atrasados/tareas → próximos eventos. |
| Pendientes | Título y crear → filtro simple → agrupación temporal → fila con completar/título/fecha. |
| Agenda | Fecha/volver a hoy → escala de vista → días → hora y eventos → crear estable. |
| Nova | Identidad discreta → conversación → resultados/propuestas → captura persistente. |

## Criterios para aprobar el rediseño

- En iPhone pequeño, el teclado no tapa el CTA, el error ni la vuelta atrás.
- El ejemplo se distingue de contenido real y no compite con Empezar.
- Claro y oscuro conservan jerarquía; la luz ambiental no reduce la legibilidad.
- A tamaño de accesibilidad, las filas y la muestra se apilan; no se cortan títulos para preservar una composición decorativa.
- La pulsación primaria se reconoce sin depender del color; todos los controles siguen siendo accesibles.
- El pulido visual conserva contratos, IDs de pruebas, persistencia, consentimiento y recuperación de errores.

No se propone incorporar las funciones de colaboración, pagos, calendarios remotos o automatización de los referentes. El objetivo de esta investigación es la composición y la reducción de esfuerzo dentro del producto actual.

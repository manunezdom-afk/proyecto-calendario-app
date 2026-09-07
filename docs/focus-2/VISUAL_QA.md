# Rediseño visual — validación

Fecha: 7 de septiembre de 2026. App nativa sobre `da588a9`, rama `focus-os-dev`.

## Cambio

- Bienvenida cálida antes de pedir correo, también al volver sin sesión. Empezar conserva el modo local y no inserta ejemplos.
- Entrada directa de cuenta desde Ajustes; volver del correo regresa a la bienvenida. Código, errores, reenvío y guardas de autenticación se conservan.
- Sistema perla/tinta, luz estática azul/índigo, marca orbital propia, tipografía Dynamic Type y superficies coherentes. No se agregaron dependencias ni assets de terceros.
- Hoy y Nova comparten un compositor más amplio y resultados/propuestas diferenciados. Hoy muestra también las propuestas y errores pendientes originados en Nova.
- Pendientes, Agenda y Ajustes conservan controles nativos. Eventos se apilan con tamaños de accesibilidad; el consentimiento permite desplazar el texto y mantiene sus acciones accesibles.
- Colores de texto semántico más legibles; el botón principal mantiene su contraste en ambos temas. El fondo ambiental desaparece con Aumentar contraste y no tiene animación permanente.

## Evidencia

| Verificación | Resultado |
|---|---|
| Compilación Debug del simulador | Correcta. |
| Build para iPhone | Compilación Debug y firma Apple Development correctas, bundle `me.usefocus.app`. El teléfono pasó a `unavailable` antes de instalar; la instalación de este rediseño queda pendiente de reconexión. |
| Siete recorridos existentes | 7/7 aprobados: captura/historial, bienvenida, correo inválido/local, eventos, tareas, teclado/Ajustes, eliminación persistente. |
| Acceso desde Ajustes y regreso | Nuevo recorrido aprobado. El correo inválido volvió a pasar en la misma ejecución: 2/2, `focus-visual-ui-2.xcresult`. |
| Regresión final de navegación | 2/2 aprobados tras integrar Cerrar en la barra nativa: teclado/Nova/Ajustes y acceso a cuenta/regreso. Resultado `focus-visual-ui-final.xcresult`. |
| Revisión visual real | Bienvenida clara/oscura, Hoy claro/oscuro, Nova oscuro, Nova con teclado y tamaño `accessibility-large`, Pendientes claro, Agenda clara/oscura y Ajustes con el título completo. |
| Contraste sRGB de tokens | Texto primario >14:1, secundario ≥5.7:1 sobre las bases de sus temas; blanco sobre extremos del degradado de acción ≥6:1. Son mediciones de los tokens, no certificación de toda combinación renderizada. |

La primera ejecución registró los siete casos aprobados y luego se atascó al finalizar su paquete de resultados con el disco lleno. Se detuvo el proceso después de terminar los tests, se conservó `/tmp/focus-visual-ui-1.log` y se retiró el paquete incompleto. Las ejecuciones posteriores desactivaron la recopilación de diagnósticos pesados; los cachés temporales antiguos de esta misma tarea se limpiaron. No se borraron datos del usuario.

Capturas del simulador: [bienvenida clara](qa/visual/welcome-light.png), [bienvenida oscura](qa/visual/welcome-dark.png), [Hoy claro](qa/visual/home-light.png), [Hoy oscuro](qa/visual/home-dark.png), [Nova oscuro](qa/visual/nova-dark.png), [teclado con texto grande](qa/visual/nova-large-keyboard.png), [Ajustes con título y cierre nativos](qa/visual/settings-light.png), [Pendientes](qa/visual/tasks-light.png), [Agenda clara](qa/visual/agenda-light.png), [Agenda oscura](qa/visual/agenda-dark.png).

## Alcance

Este cambio modifica la app nativa y su presentación. No publica backend, políticas ni migraciones. Las limitaciones remotas documentadas en [QA.md](QA.md) y [RELEASE.md](RELEASE.md) siguen vigentes. Las verificaciones del SE de la reconstrucción anterior no se presentan como pruebas de este rediseño: esta revisión visual usa el iPhone 17 simulado. El binario físico está compilado y firmado, pero no se verificó el rediseño en el teléfono porque dejó de estar disponible.

Fuentes y decisiones de diseño: [asistentes](VISUAL_RESEARCH_ASSISTANTS.md) y [productividad](VISUAL_RESEARCH_PRODUCTIVITY.md). La inspección visual de referencias incluyó la interfaz web de Gemini y la composición de dispositivos publicada en la portada oficial de Things; para los demás referentes se consultaron documentación y galerías oficiales según las limitaciones indicadas en esos documentos.

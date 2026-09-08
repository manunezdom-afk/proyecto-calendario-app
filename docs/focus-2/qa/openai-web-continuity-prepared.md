> Registro histórico de preparación. Las ejecuciones posteriores y el estado actual están en [AI_OPENAI_IMPLEMENTATION.md](../AI_OPENAI_IMPLEMENTATION.md). Las afirmaciones de «pendiente» que siguen corresponden al momento de preparar este protocolo.

# Recorrido web de seis turnos — preparado, no ejecutado

Preparado el 8 de septiembre de 2026. Alcance: cliente web real, cuenta exclusivamente sintética y respuestas reales futuras del preview corregido. **No se ha enviado ningún turno de IA ni asignado una calificación humana.** La URL final y el presupuesto de ejecución los confirma el responsable antes del primer envío.

El contrato proviene de `tests/nova-battery/openai-conversations.json`, conversación `continuity`. Este recorrido usa persistencia del cliente y lecturas del servidor de la cuenta propia; no sustituye respuestas reales por resultados esperados ni por recibos simulados.

## Preparación confirmada

- Cuenta creada con Admin API y `email_confirm:true`, sin correo, con identificador y marcador de ejecución propios. No se listaron cuentas existentes.
- Credenciales y checkpoint fuera del repositorio, directorio 0700 y archivos 0600. No se registran contraseñas, tokens ni claves en este documento.
- Un evento sintético Fútbol el **2026-09-09, 20:00–21:30**, y una tarea pendiente **Revisar las pantallas de Focus**, de prioridad alta para el mismo día. Ambos fueron leídos de nuevo usando filtro por el ID de la cuenta propia; no hay memorias ni conversación inicial.
- Los IDs de las entidades semilla son UUID nuevos de esta ejecución para evitar colisiones con otras cuentas. El checkpoint conserva su correspondencia con el fixture.
- Login pendiente de URL del preview corregido. No se modifica la protección de Vercel, la facturación, las cuotas ni la selección de modelos.

## Ejecución autorizada posterior

Abrir el preview en una pestaña Chrome separada. Entrar por el formulario de contraseña con esta cuenta sintética; pegar desde archivos privados, sin imprimir credenciales, conservando y restaurando el portapapeles. No extraer sesiones del navegador ni inyectar estado interno. Verificar Fútbol y la tarea semilla en la UI antes del primer turno.

Comprobar el aviso de OpenAI/chat y Anthropic/fotos. Aceptarlo únicamente cuando esté autorizado el primer envío. Mantener el mismo hilo y registrar las respuestas y recibos que realmente aparezcan. No enviar más de seis turnos ni repetir automáticamente errores. Si aparece cuota, presupuesto, bloqueo de proveedor, pérdida de sesión o un resultado incierto, detenerse y registrarlo; no aumentar límites ni crear otra cuenta para eludirlos.

| Turno | Texto exacto | Comprobación objetiva |
|---|---|---|
| 1 | pon gym mañana a las 10 AM | Un Gym para el 9 de septiembre a las 10. Observar el recibo de guardado del cliente y leer el evento de esta cuenta para conservar su ID real. |
| 2 | mejor a las 11 AM | El mismo ID pasa a las 11, sin segundo Gym ni cambio de fecha. Conservar duración si ya existía. Comprobar UI y fila persistida. |
| 3 | y recuérdame llevar agua | Conservar el detalle del agua o preguntar por el horario de aviso ausente. No inventar una hora/offset ni mover Gym. Registrar lo que ocurrió, sin completar por cuenta propia datos que faltan. |
| 4 | qué más tengo mañana | Respuesta coherente con Gym a las 11 y Fútbol a las 20. Ningún cambio en eventos/tareas; comparar estado propio antes y después. |
| 5 | organízame la tarde | Propuesta revisable a partir del contexto actual. Capturar fechas e intervalos ofrecidos en la bandeja, conservándolos pendientes; no aprobar todavía ni contarlos como guardados. Gym y Fútbol permanecen iguales. |
| 6 | no quiero estudiar después de las 8 PM | Refinar la propuesta pendiente o aclarar su objetivo. Ningún bloque de estudio puede terminar después de las 20 ni cruzar ese límite. No mover Fútbol ni convertir silenciosamente la propuesta anterior en eventos guardados. |

Los turnos 5 y 6 evalúan continuidad de propuesta, por lo que no se aprueba la propuesta intermedia. Una aprobación posterior es otro paso explícito del recorrido, no un resultado ya demostrado. Leer únicamente filas `events`, `tasks`, `suggestions` y contabilidad necesarias filtradas por esta cuenta. Cada lectura debe verificar el propietario; nunca obtener el conjunto de usuarios o eventos reales.

El cliente genera sus UUID lógicos. No modificar storage, inventar IDs de acciones ni reproducir HTTP por fuera del cliente durante esta prueba. El replay contable tiene una prueba independiente; seis solicitudes aisladas con contexto fabricado no prueban esta conversación.

## Evidencia y cierre

Registrar por turno: texto enviado, respuesta real, modo observado, recibo local, IDs propios afectados, estado persistido antes/después y resultado de cada comprobación. Mantener separados los fallos del modelo, validación, red, cuotas y persistencia. Screenshots únicamente de esta cuenta sintética; ninguna contraseña, sesión o dato personal en capturas.

La revisión de naturalidad y utilidad sigue **pendiente de un evaluador humano identificado**. No convertir un checklist automático o una inspección del agente en una puntuación humana, ni afirmar un 99% a partir de estos seis turnos.

Tras recoger evidencia, cerrar sesión y eliminar únicamente la cuenta temporal de esta ejecución verificando ID, email sintético y marcador de propiedad antes del borrado. Comprobar que sus respuestas privadas quedan purgadas y que el coste anónimo se conserva; no sumar telemetría al ledger ni tratar un coste desconocido como cero. Retirar credenciales temporales después de confirmar la limpieza, conservando sólo el reporte sin secretos.

# Focus — Beta cerrada (TestFlight)

> ARCHIVADO: instrucciones del build 25. Sus pantallas, proveedores y comportamientos son históricos. Para la versión actual y la migración de chat a OpenAI, ver [RELEASE.md](../docs/focus-2/RELEASE.md).

> Validación actual, 8 de septiembre de 2026: **95/95 XCTest**, gestos de borrado/Deshacer en claro y oscuro y build de desarrollo **1.0 (34)** firmado e instalado sin borrar datos. Su lanzamiento está pendiente de desbloquear el iPhone. Esto no anuncia TestFlight ni certifica dictado hablado en el dispositivo. Ver [pasada de UX](../docs/focus-2/UX_INTELLIGENCE_PASS.md). No seguir el procedimiento histórico de «Borrar todo» para cambiar de cuenta.

Build **1.0 (25)** — beta cerrada. 2–5 testers.

---

## 📲 Cómo instalar (testers)

1. Abre el link de invitación TestFlight que te llega por email.
2. Instala la app TestFlight si todavía no la tienes.
3. Acepta la invitación → "Instalar".
4. Abre Focus → completa el onboarding (4 pantallas) → continúa con tu correo.

**Login**: solo email + código de 6 dígitos. Llega en menos de un minuto. Si no llega: revisa spam, vuelve a pedir el código (botón "Reenviar" tras 30 s).

---

## ✅ Checklist obligatorio antes de mandar feedback

Marca cada uno cuando lo verifiques. Si algo falla, anota la frase exacta y la hora.

### Onboarding y login
- [ ] Onboarding pasa las 4 pantallas y abre la app sin pantallas duplicadas.
- [ ] Pides código → llega → ingresas → entras a Mi Día.
- [ ] Cierras sesión desde Ajustes → vuelves al login.
- [ ] Vuelves a iniciar sesión con el mismo email → tus eventos siguen ahí.

### Mi Día
- [ ] Creas un evento desde el FocusBar: escribe "agenda dentista mañana a las 10".
- [ ] El evento aparece en la timeline de Mi Día y en Calendario.
- [ ] Tocas el bloque y "Editar" funciona; al guardar, cambia.
- [ ] Deslizas el bloque a la izquierda y lo borras → confirma con toast.
- [ ] Cierras la app completamente, la reabres, el evento borrado **no** vuelve.

### Tareas (deshabilitadas en esta beta — SOLO-EVENTOS)
Las tareas están apagadas temporalmente: **todo se agenda como evento con hora**. Si le pides algo sin hora ("comprar pan"), Nova te pregunta "¿A qué hora lo agendo?" y con tu respuesta lo deja como bloque en Mi Día. No debe aparecer ninguna superficie de tareas ni mensajes tipo "Tarea agregada".

### Recordatorios / notificaciones locales
- [ ] Creas un recordatorio para dentro de 2 minutos: "acuérdame llamar a mamá en 2 min".
- [ ] Acepta el permiso de notificaciones cuando lo pida iOS.
- [ ] Sales de la app y esperas → llega una notificación push local en la hora prevista.
- [ ] La notificación trae el título limpio (no "Recordatorio: Acuérdame…").

### Recordatorios sobre eventos existentes
Esta es la funcionalidad nueva más importante a probar:

- [ ] **Caso A — añadir aviso**: tienes un evento de hoy llamado "Ducharme" 10:00. Escribes "acuérdame 10 minutos antes de ducharme". Resultado esperado:
  - Tarjeta Nova **corta**: "Listo. Añadí un aviso a «Ducharme»." + "🔔 10 min · 09:50".
  - El bloque de Mi Día ahora muestra debajo del título un chip ámbar pequeño: **🔔 Aviso 10 min antes**.
  - **No** se crea un evento aparte para el recordatorio.
  - Notificación local llega a las 09:50.
- [ ] **Caso B — fuzzy match**: tienes "Ir a buscar a mi hermano" 18:30. Escribes "acuérdame 40 min antes de ir a buscar a mi hermano". Mismo evento gana el chip; no se duplica.
- [ ] **Caso C — evento no existe**: borra el bloque y vuelve a pedir "acuérdame 10 min antes de ducharme". Nova debe preguntar con chips **"Crear como evento"** / **"Crear como tarea"** — **no** crea nada por su cuenta.
- [ ] **Caso D — aviso ya existía**: con el bloque de "Ducharme" ya con aviso, repite la misma frase. Nova debe decir "Ese aviso ya estaba agregado." sin duplicar el offset.

### Nova (texto) — frases obligatorias del usuario
- [ ] **"tengo que seguir trabajando a las 3:30 y comer a las 4"** → debe crear **dos** bloques: "Seguir trabajando" 15:30 y "Comer" 16:00. Ninguno marcado como "reunión".
- [ ] **"necesito ir a buscar a mi hermano a las tres"** → un bloque "Ir a buscar a mi hermano" hoy 15:00. **No** debe preguntar "¿Cuándo?".
- [ ] **"en una hora voy a jugar fútbol, en dos horas vuelvo y a las 12 me acuesto"** → tres bloques: jugar fútbol (+1 h), volver (+2 h), acostar (00:00 o pregunta noon/medianoche).
- [ ] **De noche** (≥19h), "ir a buscar a mi hermano a las 11" → 23:00 hoy (NO mañana 11:00 AM).

### Nova (voz) — micrófono inline
- [ ] En el FocusBar, tocas el micrófono → iOS pide permisos de mic y voz → acepta.
- [ ] Dictas "agenda almuerzo con Pedro mañana a la una" → el texto aparece en la barra.
- [ ] Revisas y envías → se crea el evento.
- [ ] Mientras dicta, cambias de tab → el mic se apaga solo.

### Calendario
- [ ] Vas a la pestaña Calendario y deslizas entre días.
- [ ] El día con evento muestra un punto/indicador.
- [ ] Tocas el evento → puedes editar o eliminar.

### Logout
- [ ] Ajustes → "Cerrar sesión" → vuelves al login.
- [ ] Vuelves a iniciar sesión → tus datos cargan desde la nube (sync).

### Identidad visual
- [ ] En home screen: el icono de Focus es un **diamante blanco con glow** sobre un cobalto profundo con tinte violeta en el borde inferior derecho. No engranaje, no target.
- [ ] El mismo diamante aparece dentro de la app: header de Mi Día, avatar de Nova en chat, NovaCard, Nova Live, FocusBar.
- [ ] **No** debe verse en ningún lado el viejo engranaje ni un sparkle de 4 puntas como identidad principal.

---

## 🔄 Cambiar de cuenta en este iPhone

Si quieres iniciar sesión con un correo distinto en el mismo iPhone (raro en beta, pero por si acaso):

1. **Ajustes → "Cerrar sesión"** (te saca al login pero **no** borra tus eventos/tareas locales).
2. **Ajustes → "Borrar todo"** (con la app aún sin sesión) — elimina TODOS los datos guardados en este iPhone: eventos, tareas, sugerencias, conversación con Nova y ajustes.
3. Login con el nuevo correo.

Si saltas el paso 2, vas a ver mezclados los datos del usuario anterior con los del nuevo (los REMOTOS están aislados por cuenta, pero los LOCALES en disco quedan hasta que los borres explícitamente). Solo importa si dos personas comparten device, lo cual no es lo esperado en esta beta.

---

## 🚫 Funciones ocultas en esta beta (a propósito)

Estas existen en el código pero **no se muestran** porque todavía no están listas:

| Función | Por qué oculta |
|---|---|
| **Continuar con Google** | Requiere el SDK GoogleSignIn-iOS + URL Scheme en Info.plist. Mientras eso no esté integrado, tocar el botón daba error. Solo OTP por email en beta. |
| **Importar Google Calendar / Apple Calendar / .ics** | Aparece en Ajustes como "Próximamente" sin acción real. La sincronización con calendarios externos llega en una versión siguiente. |
| **Abrir ubicación en Maps / Waze** | El campo "ubicación" guarda texto pero no abre apps externas. |
| **Tareas** | Modo SOLO-EVENTOS temporal: la creación de tareas está apagada; Nova convierte todo en eventos con hora (te pregunta la hora si falta). |

Si ves algo más que parezca "a medias" o "Próximamente", **no es bug, es ocultado a propósito** — confírmalo por mensaje y seguimos.

---

## 🐞 Bugs conocidos / fricción esperada

1. **Frases con muchas acciones encadenadas sin estar logueado**: en modo demo, si escribes algo tipo "en una hora X y en dos horas Y", Nova te pide que envíes una acción por mensaje. Es a propósito — sin sesión no podemos llamar al modelo fuerte.
2. **Hora ambigua "a las 12"**: Nova preguntará si te refieres a medianoche o mediodía. Es la conducta esperada.
3. **Verbos puntuales** ("despertarme", "levantarme") crean recordatorios con notificación. El título del bloque se normaliza ("dormirme" → "Dormir", "levantarme" → "Levantar"). Si no quieres alerta, di "agenda dormirme…" o desactiva el toggle de notificaciones del bloque.
4. **Edición en demo**: si modificas un evento ejemplo, ese cambio puede no persistir al cerrar la app (los ejemplos son read-only). Para probar persistencia, **inicia sesión**.
5. **El primer evento real reemplaza los ejemplos demo**: no es bug, así fue diseñado — apenas creas tu primer evento o tarea, los ejemplos desaparecen.
6. **Sin conexión, cambios pendientes de subir**: los eventos/tareas que crees offline se guardan en este iPhone, pero **no se reintenta** subirlos automáticamente cuando vuelves a tener red. Reabrir la app o cambiar de pestaña fuerza el sync. Si algo creado offline no aparece en otro device, abre Focus de nuevo.
7. **Notificación local vs evento existente**: si pides "acuérdame N min antes" de un evento que NO tiene esa hora aún visible en Mi Día (lo creaste hace segundos), espera un instante a que el bloque se renderice antes de pedir el aviso — si no, Nova puede no encontrarlo y te preguntará si crearlo.

---

## 🆘 Cómo reportar un problema

Por mensaje directo, con:
1. **Qué escribiste exactamente** (copy-paste de la frase).
2. **Qué esperabas que pasara**.
3. **Qué pasó realmente** (captura si puedes).
4. **Día y hora aprox** del incidente.

Si la app crashea: TestFlight te ofrece "Send Beta Feedback" con un screenshot — manda eso, incluye una nota corta.

**Especialmente útil reportar**:
- Cualquier mensaje técnico que se cuele a la UI ("Error 500", "modo local", "Nova avanzada", "backend", "status code"). Estos NO deberían aparecer en ninguna pantalla.
- Cualquier título de evento sucio (concatenado, con la hora pegada como "Comer a las 4", o categorizado como "Reunión" cuando no dijiste reunión).
- Cualquier notificación que llegue duplicada o con texto raro.

---

## 🔐 Privacidad y datos

- Tu correo y tus eventos se guardan en una base de datos Supabase con RLS (cada usuario ve solo lo suyo).
- El audio del micrófono **no** sale del iPhone — la transcripción la hace Apple en el dispositivo.
- Cuando escribes a Nova, el texto y el contexto de tu agenda van a un modelo de IA externo: **DeepSeek** (v4-flash para frases simples, v4-pro para complejas), con OpenAI/Anthropic como alternativa según configuración del backend. La app te pide consentimiento explícito antes del primer mensaje. Detalle completo en usefocus.me/privacidad.
- Para borrar todo lo local: **Ajustes → "Borrar todo"**. Para borrar la cuenta entera (cuenta + datos en la nube): **Ajustes → Privacidad → Eliminar cuenta** (inmediato, tipeando ELIMINAR).

---

## 🧠 Cómo decide Nova qué hacer (referencia rápida)

Para que entiendas qué esperar:

- **Frases simples** ("comprar pan", "comer a las 8", "reunión con Juan mañana 5"): parser local o DeepSeek v4-flash. Rápido y barato.
- **Frases complejas** (varias acciones, conectores "y/luego/después", múltiples horas, "en una hora", "a las tres"): DeepSeek v4-pro directo. Mejor razonamiento estructural.
- **Si Nova no está segura** (ambigüedad real): pregunta antes de crear. No adivina.
- **Si el backend falla** y la frase es compleja: te pide enviarlas por separado en vez de inventar un evento.
- **Si pides un aviso sobre un evento existente** ("acuérdame X min antes de Y"): se adjunta al evento como chip. No crea otro bloque.
- **Validador**: aunque Nova devuelva una acción, antes de guardarla se revisa que el título no esté concatenado, que la categoría no sea "Reunión" sin que lo hayas dicho, y que la hora no esté pegada al título. Si algo se ve sospechoso, Nova pregunta en vez de aplicar.

Esto es el comportamiento esperado. Si ves desviaciones, reporta.

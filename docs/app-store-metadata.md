# Ficha de App Store — Focus

Texto listo para pegar en App Store Connect cuando crees la app. Todo está en español neutral (la regla del proyecto). Si quieres versión en inglés también, traduce estas mismas piezas.

---

## Datos básicos

| Campo | Valor |
|---|---|
| Nombre de la app | `Focus` |
| Subtítulo (30 chars max) | `Tu calendario con asistente` |
| Bundle ID | `me.usefocus.app` |
| Categoría primaria | Productivity |
| Categoría secundaria | Lifestyle |
| Idioma principal | Español (España) |
| Edad recomendada | 4+ |
| Copyright | `2026 Martín Nuñez` |
| Precio | Gratis (o el modelo que decidas) |

---

## URLs

| Campo | Valor |
|---|---|
| Privacy Policy URL | `https://usefocus.me/privacidad` |
| Support URL | `https://usefocus.me/soporte` |
| Marketing URL (opcional) | `https://usefocus.me` |

---

## Promotional text (170 chars max — editable sin re-review)

```
Organiza tu día con Nova, tu asistente personal. Crea eventos por voz, importa fotos de tu agenda y recibe sugerencias inteligentes basadas en tus hábitos.
```

---

## Description (4000 chars max)

```
Focus es un calendario simple y rápido pensado para que organices tu día sin esfuerzo. En lugar de mil opciones y menús, te damos lo que necesitas: una vista clara de tus eventos y un asistente, Nova, que te ayuda a crear, mover y planificar.

CARACTERÍSTICAS

• Calendario en vista día, semana y mes — navegación fluida con gestos.
• Quick-add por voz: pulsa, habla y Nova convierte tu frase en un evento listo.
• Importa eventos desde fotos: saca una foto a tu agenda en papel o a una captura de pantalla y Nova extrae los eventos automáticamente.
• Tareas con prioridad y categoría junto a tu calendario.
• Notificaciones inteligentes que respetan tu ritmo.
• Sincronización en la nube entre todos tus dispositivos.
• Modo oscuro nativo y soporte completo para iPhone con notch.
• Funciona sin conexión: crea eventos offline y se sincronizan cuando vuelva la red.

NOVA, TU ASISTENTE

Nova es el asistente integrado en Focus. Aprende cómo trabajas, recuerda tus preferencias y te sugiere cómo organizar tu semana. Puedes hablar con Nova en lenguaje natural: "muéveme la reunión de mañana a las 4", "agéndame gimnasio tres veces por semana", "qué tengo el jueves". 

PRIVACIDAD COMO PRIORIDAD

• Tus datos son tuyos. No los vendemos ni los usamos para publicidad.
• Sin tracking entre apps ni sitios web.
• Cifrado en tránsito y aislamiento por usuario en la base de datos.
• Puedes pedir la eliminación de tu cuenta cuando quieras.

Lee la política completa en usefocus.me/privacidad.

SOPORTE

¿Necesitas ayuda? Escríbenos a manunezdom@gmail.com o visita usefocus.me/soporte. Respondemos en menos de 48 horas.
```

---

## Keywords (100 chars max, separadas por coma, sin espacios)

```
calendario,agenda,productividad,planner,tareas,recordatorio,asistente,nova,focus,organizar
```

(99 chars, contado.)

---

## What's New (release notes para v1.0)

```
Primera versión de Focus. Calendario, tareas y Nova, tu asistente, todo en una app rápida y sencilla.
```

---

## Screenshots — qué tomar

App Store Connect exige al menos uno de estos sizes (recomendado **6.9"** para iPhone 17 Pro Max, que cubre todos los modelos modernos):

- 6.9" iPhone 17 Pro Max / 16 Pro Max → 1320×2868 px
- 6.5" iPhone XS Max / 11 Pro Max → 1242×2688 px (opcional)

Mínimo 3, máximo 10. Recomendado 5–6 con título corto sobre la imagen:

1. **Calendario semana** — eventos coloridos en vista semana. Título: "Tu semana, clara".
2. **Quick-add por voz** — micrófono activo con frase transcrita. Título: "Crea eventos hablando".
3. **Nova respondiendo** — chat con sugerencia útil. Título: "Un asistente que te conoce".
4. **Importar foto** — antes/después de subir foto de agenda. Título: "Tu agenda en papel, en Focus".
5. **Vista día con detalle** — evento abierto con detalle. Título: "Todo el detalle, ningún ruido".
6. **Settings o personalización** (opcional). Título: "Hecho a tu manera".

Cómo tomarlas: Xcode → simulador iPhone 17 Pro Max → Cmd+S guarda al escritorio en el size correcto.

---

## Privacy Nutrition Labels — checklist exacto

Cuando App Store Connect te pida "Data the app collects", marca exactamente esto:

### Data Used to Track You
**No** se usa para tracking.

### Data Linked to You

| Categoría Apple | Tipo específico | Propósito |
|---|---|---|
| Contact Info | Email Address | App Functionality, Account |
| Location | Precise Location | App Functionality |
| User Content | Other User Content (eventos, tareas, memorias, mensajes a Nova) | App Functionality |
| Identifiers | User ID | App Functionality, Account |
| Identifiers | Device ID | App Functionality |
| Usage Data | Product Interaction (signals: tareas completadas, sugerencias aceptadas) | Analytics, App Functionality |

### Data Not Linked to You
Ninguno.

### Categorías que NO recolectas (responde "No" a todas)
Health & Fitness, Financial Info, Sensitive Info, Contacts (del teléfono), Browsing History, Search History, Purchases, Diagnostics, Other Data.

### Third Parties (a declarar)
- **Anthropic / Claude API** — recibe contenido de tus conversaciones con Nova y datos de contexto.
- **Supabase** — almacena tu cuenta y contenido (procesador, no terceros con sus propios fines).
- **Resend** — envía los OTP de email.
- **OpenStreetMap (Nominatim)** — geocoding de ubicación.

---

## App Review Information

Datos a darle a Apple para que pueda revisar la app:

- **Demo account email**: crea una cuenta dummy (ej. `apple-review@usefocus.me`) y dale los datos.
- **Demo account password**: si usas magic link OTP, déjale el último OTP válido o crea un workaround. Apple **necesita** poder entrar sin tu intervención.
- **Notes for Reviewer**: 
  ```
  Focus es un calendario con un asistente integrado (Nova) basado en Claude (Anthropic). 
  Para iniciar sesión usamos email + código OTP. Hemos preparado una cuenta de prueba 
  con código fijo para que el equipo de revisión pueda entrar.
  
  Las notificaciones push usan APNs (token nativo). Para probarlas: crear un evento con 
  recordatorio en 5 minutos y esperar la entrega.
  
  Nova requiere micrófono y, opcionalmente, ubicación. La cámara/foto-library se usan 
  solo para importar eventos desde imágenes.
  ```

### Solución a un rechazo común (Guideline 4.2 — "solo wrapper de web")

Apple rechaza apps que son solo un wrapper de una web. Focus tiene **funcionalidad nativa real**:
- Push notifications nativas APNs (no Web Push).
- Splash screen nativo.
- Manejo de safe-area, notch y status bar nativos.
- Acceso a foto library e cámara con prompts del sistema.

Si rechazan, responder en Resolution Center mencionando exactamente esto.

---

## Checklist final pre-Submit

Antes de pulsar "Submit for Review", verifica:

- [ ] Build subido vía Xcode Archive y aparece en App Store Connect (sección Build).
- [ ] 5 screenshots subidos para size 6.9".
- [ ] Icono 1024×1024 subido (ya está en `ios/App/App/Assets.xcassets/AppIcon.appiconset/`).
- [ ] Privacy Policy URL → `usefocus.me/privacidad` carga sin error.
- [ ] Support URL → `usefocus.me/soporte` carga sin error.
- [ ] Privacy Nutrition Labels respondidas según la tabla de arriba.
- [ ] Cuenta demo + notas para reviewer cargadas.
- [ ] Categoría: Productivity (primaria), Lifestyle (secundaria).
- [ ] Edad: 4+.
- [ ] Versión: 1.0, Build: 1.
- [ ] What's New: pegado.
- [ ] TestFlight tester (tú mismo) verificó que la app abre, login funciona, push llega.

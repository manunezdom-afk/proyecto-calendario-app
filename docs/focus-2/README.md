# Focus 2.0

Focus convierte intenciones en pendientes, eventos y recordatorios, y ayuda a decidir el siguiente paso. Primera audiencia: estudiantes y jóvenes profesionales con muchas cosas en mente y poco tiempo para administrar un sistema.

**Bucle:** capturar → organizar → actuar → completar. El valor inicial es guardar una primera intención útil sin crear una cuenta ni elegir un sistema de productividad.

## Decisiones

| Tratamiento | Sistema | Motivo |
|---|---|---|
| Conservar | SwiftUI nativo, modelos, Keychain, EventKit de lectura, APIs y RLS existentes | Base útil; no se necesita migrar de framework ni base de datos. |
| Mejorar | Sync, autenticación, recordatorios, DTO de fechas, coste y telemetría | Se detectaron pérdida de ediciones offline, contaminación entre cuentas, refresco destructivo y observabilidad incompleta. |
| Reconstruir | Navegación, Hoy, Nova/captura, formularios y onboarding | Las tareas estaban apagadas. Hoy y chat tenían ejecutores distintos. Editar un evento borraba metadatos. |
| Retirar del recorrido | Pager horizontal, segmentos Bandeja/Acciones/Chat, datos de ejemplo en listas reales, halos, tutoriales superpuestos, controles futuros | Aumentaban complejidad sin fortalecer el bucle. Los ejemplos solo ilustran el onboarding y nunca se guardan automáticamente. |
| Posponer | Kairos, Spark, expansión de ecosistema | Primero fiabilidad y utilidad individual. |

Navegación: **Hoy · Pendientes · Agenda · Nova**. Ajustes se abre desde el encabezado. Nova es una acción disponible en Hoy y una conversación de seguimiento; ambas comparten el mismo ejecutor. Una tarea no necesita hora. Un evento tiene un momento. Un aviso geográfico no se inventa si la app no puede ejecutarlo.

El diseño usa tipografía del sistema con Dynamic Type, superficies neutrales, un acento azul y controles nativos. La apariencia sigue el sistema o la preferencia del usuario. Ningún retraso de splash ni animación permanente forma parte del flujo principal.

## Arquitectura

- SwiftUI → `FocusDataStore` (MainActor) → almacenamiento local y outbox → `SupabaseSyncService`.
- Sesiones en Keychain. Datos y cola aislados por cuenta. Las respuestas en vuelo no pueden mutar otra sesión.
- Captura → `sendNovaMessage` → interpretación local o backend → validación del contrato → propuesta/ejecución → resultado construido con cambios reales.
- Los proveedores de IA se ejecutan en el servidor. No hay claves privadas en iOS. El consentimiento se solicita antes de transmitir mensajes/contexto.
- El dictado exige reconocimiento en el dispositivo; si no está disponible, permite continuar escribiendo.
- Telemetría de producto: contadores locales de un conjunto cerrado, sin títulos, mensajes, identificadores ni transmisión. El backend conserva mediciones técnicas de consumo.

## Entorno y verificación

Xcode 26.6, iOS mínimo 17, runtime QA iOS 26.4.1. Proyecto: `ios-native/Focus.xcodeproj`, scheme Focus. Dependencias SPM existentes: GoogleSignIn/AppAuth. Backend: Node, `npm run test:unit`. No se requieren nuevos paquetes para la reconstrucción.

Se usa un simulador separado llamado **Focus 2.0 QA**, sin cuentas reales. Los targets XCTest/UITest y evidencia visual viven junto al proyecto. El registro de pruebas distingue pruebas automatizadas, inspección visual y recorridos que requieren cuentas/servicios reales.

Resultados y comandos reproducibles: [QA.md](QA.md). Condiciones para distribución: [RELEASE.md](RELEASE.md). Pipeline y límites de IA: [NOVA_PIPELINE.md](../../NOVA_PIPELINE.md).

**Base verificada:** `fc09049`; compilación Debug correcta y 223 pruebas JavaScript aprobadas antes de modificar. `focus-os-dev` avanzó desde `7ff1d3d` a `fc09049` sin merge/rebase ni pérdida de cambios. Cachés y carpetas legacy preexistentes no forman parte de los commits de reconstrucción.

No se despliega ni se publica en App Store en esta ejecución. La disponibilidad de un servicio remoto y la revisión de App Store no se infieren de que compile.

Checkpoints locales: `ac59589` (contratos/costos Nova), `62e2cdf` (eliminación de cuenta y política), `93563cc` (reconstrucción iOS y pruebas). Las mejoras del servidor y la política todavía no están en producción. Cachés locales preexistentes y carpetas legacy se conservaron fuera de estos commits.

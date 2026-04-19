// Util compartida: infiere el icono Material Symbols más apropiado
// basándose en el texto del evento (título/descripción).
// Antes existía duplicado en parseEvent.js, parseScheduleText.js e icsImport.js
// con distintas listas de keywords — ahora todos usan esta versión única.

// Quita acentos y pasa a minúsculas para comparar keywords sin ambigüedad.
function norm(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

// Reglas ordenadas por especificidad: la primera que hace match gana.
// Mantener esto estable — tests dependen del output.
const RULES = [
  { icon: 'fitness_center',  re: /futbol|deporte|gym|gimnasio|ejercicio|entrena|yoga|correr|nadar|pilates|crossfit|pesas|spinning|box|escalada/ },
  { icon: 'groups',          re: /reunion|meeting|llamada|call|videollamada|sincro|junta|zoom|teams|google\s*meet|standup|daily|1on1|1:1/ },
  { icon: 'restaurant',      re: /almuerzo|comida|cena|desayuno|cafe|restaurante|brunch|pizza|sushi|aperitivo|merienda|onces/ },
  { icon: 'menu_book',       re: /estudio|estudiar|clase|tarea|libro|leer|examen|facultad|universidad|curso|parcial|quiz|prueba|ensayo|homework/ },
  { icon: 'work',            re: /trabajo|proyecto|informe|reporte|presentacion|oficina|cliente|demo|entrega|deadline/ },
  { icon: 'local_hospital',  re: /medico|doctor|cita|dentista|consulta|hospital|clinica|turno|terapia|psicologo|kine/ },
  { icon: 'shopping_cart',   re: /compras|supermercado|tienda|mercado|farmacia|mall/ },
  { icon: 'cake',            re: /cumpleanos|fiesta|celebracion|boda|festejo|aniversario/ },
  { icon: 'flight',          re: /viaje|vuelo|aeropuerto|hotel|vacaciones|pasaje|trip/ },
  { icon: 'account_balance', re: /banco|pago|factura|tramite|cobro|impuesto|tax/ },
  { icon: 'alarm',           re: /levantarme|despertarme|despertar|alarma/ },
]

export function guessIcon(text) {
  const t = norm(text)
  for (const { icon, re } of RULES) if (re.test(t)) return icon
  return 'event'
}

export { norm }

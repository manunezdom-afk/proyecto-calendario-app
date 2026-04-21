export function describeWeatherCode(code) {
  if (code === 0) return 'Despejado'
  if (code <= 3) return 'Parcialmente nublado'
  if (code <= 48) return 'Niebla'
  if (code <= 55) return 'Llovizna'
  if (code <= 65) return 'Lluvia'
  if (code <= 75) return 'Nieve'
  if (code === 77) return 'Granizo'
  if (code <= 82) return 'Chubascos'
  if (code <= 86) return 'Nieve'
  if (code <= 99) return 'Tormenta eléctrica'
  return 'Desconocido'
}

export async function fetchWeather(lat, lon) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code,wind_speed_10m,relative_humidity_2m&daily=temperature_2m_max,temperature_2m_min,weather_code,precipitation_probability_max&timezone=auto&forecast_days=3`
  const res = await fetch(url)
  if (!res.ok) throw new Error('weather fetch failed')
  return res.json()
}

export async function buildWeatherContext(location) {
  if (!location?.lat || !location?.lon) {
    return 'Ubicación no disponible — no puedes dar información del clima.'
  }
  try {
    const wData = await fetchWeather(location.lat, location.lon)
    const cur = wData.current
    const daily = wData.daily
    const cityLabel = location.city
      ? `${location.city}${location.country ? ', ' + location.country : ''}`
      : `${location.lat.toFixed(2)}, ${location.lon.toFixed(2)}`

    const forecast = daily.time
      .map((date, i) => {
        const label = i === 0 ? 'Hoy' : i === 1 ? 'Mañana' : date
        return `  ${label}: ${describeWeatherCode(daily.weather_code[i])}, ${daily.temperature_2m_min[i]}°C–${daily.temperature_2m_max[i]}°C, lluvia ${daily.precipitation_probability_max[i]}%`
      })
      .join('\n')

    return `Ubicación del usuario: ${cityLabel}
Clima actual: ${describeWeatherCode(cur.weather_code)}, ${cur.temperature_2m}°C, humedad ${cur.relative_humidity_2m}%, viento ${cur.wind_speed_10m} km/h
Pronóstico próximos 3 días:
${forecast}`
  } catch {
    return location.city
      ? `Ubicación: ${location.city}${location.country ? ', ' + location.country : ''}. Clima no disponible en este momento.`
      : 'Clima no disponible en este momento.'
  }
}

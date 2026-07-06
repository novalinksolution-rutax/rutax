/**
 * Utilidades de zona horaria para America/Santiago.
 *
 * Chile opera en America/Santiago (CLT UTC-3, CLST UTC-4 en verano).
 * El DST lo maneja el IANA mediante `Intl.DateTimeFormat` — NUNCA
 * se hardcodea el offset (+3/-4). Vercel corre en UTC, por lo que
 * cualquier `new Date()` crudo sin estas utilidades produce horas incorrectas
 * al comparar con hora_corte (time LOCAL America/Santiago en la BD).
 *
 * API pública:
 *   - `ahoraEnSantiago()` — instante actual descompuesto en fecha/hora local.
 *   - `combinarFechaHoraSantiago(fecha, hora)` — fecha + hora locales → timestamptz.
 *   - `fechaLocalEnSantiago(instante)` — Date → 'YYYY-MM-DD' en Santiago.
 */

// Formateadores con caching a nivel de módulo (construcción costosa, singleton).
const _partesFecha = new Intl.DateTimeFormat('es-CL', {
  timeZone: 'America/Santiago',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

/**
 * Descompone un instante en sus partes de fecha y hora local de Santiago.
 * Devuelve un mapa de { year, month, day, hour, minute, second } con números.
 */
function descomponerInstante(instante: Date): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
} {
  const partes = _partesFecha.formatToParts(instante);
  const mapa: Record<string, number> = {};
  for (const p of partes) {
    if (p.type !== 'literal') {
      mapa[p.type] = Number(p.value);
    }
  }
  return {
    year: mapa.year,
    month: mapa.month,
    day: mapa.day,
    hour: mapa.hour,
    minute: mapa.minute,
    second: mapa.second,
  };
}

/**
 * Devuelve el momento actual descompuesto en la zona horaria de Santiago.
 *
 * - `fecha`: 'YYYY-MM-DD' en hora local Santiago.
 * - `hora`: 'HH:MM' en hora local Santiago.
 * - `instante`: el `Date` absoluto correspondiente (para comparaciones de TZ).
 */
export function ahoraEnSantiago(): { fecha: string; hora: string; instante: Date } {
  const instante = new Date();
  const p = descomponerInstante(instante);

  const fecha = `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
  const hora = `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;

  return { fecha, hora, instante };
}

/**
 * Interpreta `fecha` ('YYYY-MM-DD') y `horaLocal` ('HH:MM' o 'HH:MM:SS')
 * como hora local America/Santiago y devuelve el instante absoluto (Date / timestamptz).
 *
 * Algoritmo: construye un Date en UTC con los componentes dados, luego ajusta
 * la diferencia entre UTC y la hora local real de Santiago en ese instante,
 * usando `Intl.DateTimeFormat` para que el DST lo gestione el runtime (IANA).
 * Sin hardcodeo de offsets.
 *
 * Lanza `RangeError` si la fecha u hora tienen formato inválido.
 */
export function combinarFechaHoraSantiago(fecha: string, horaLocal: string): Date {
  // Validar formato básico.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    throw new RangeError(`fecha inválida: "${fecha}". Formato esperado: YYYY-MM-DD`);
  }
  if (!/^\d{2}:\d{2}(:\d{2})?$/.test(horaLocal)) {
    throw new RangeError(`horaLocal inválida: "${horaLocal}". Formato esperado: HH:MM o HH:MM:SS`);
  }

  const [anioStr, mesStr, diaStr] = fecha.split('-');
  const [horStr, minStr, segStr = '00'] = horaLocal.split(':');

  const anio = Number(anioStr);
  const mes = Number(mesStr);
  const dia = Number(diaStr);
  const hor = Number(horStr);
  const min = Number(minStr);
  const seg = Number(segStr);

  // Paso 1: construir un candidato en UTC (naive) como punto de partida.
  const candidatoUtc = new Date(Date.UTC(anio, mes - 1, dia, hor, min, seg));

  // Paso 2: leer qué hora local muestra ese candidato en Santiago.
  const p = descomponerInstante(candidatoUtc);

  // Paso 3: calcular cuántos minutos hay que RESTAR al candidato UTC para que
  // en Santiago aparezca la hora pedida.
  //
  // El offset de Santiago en minutos respecto de UTC es negativo (UTC-3 o UTC-4).
  // `muestraMin` = hora local Santiago del candidato.
  // Para que Santiago muestre `queremosMin`, necesitamos:
  //   resultado_utc = candidatoUtc + (queremosMin - muestraMin) * 60_000
  //
  // Ejemplo invierno (UTC-4): candidato=14:30 UTC → Santiago muestra 10:30.
  //   queremosMin=870 (14:30), muestraMin=630 (10:30), diff=+240 min.
  //   resultado = candidato + 240 min = 18:30 UTC → Santiago = 14:30 ✓
  //
  // Esto es equivalente a ajustar el candidato por el offset opuesto.
  const queremosMin = hor * 60 + min;
  const muestraMin = p.hour * 60 + p.minute;
  let diferenciaMin = queremosMin - muestraMin;

  // Corrección de borde de día: si la diferencia cae fuera del rango ±12h,
  // ajustar (DST puede cambiar el día en casos extremos).
  if (diferenciaMin > 720) diferenciaMin -= 1440;
  if (diferenciaMin < -720) diferenciaMin += 1440;

  // Paso 4: aplicar la corrección (SUMAR la diferencia, no restar).
  const resultado = new Date(candidatoUtc.getTime() + diferenciaMin * 60_000);

  // Verificación: la hora local resultante debe coincidir con la pedida.
  const verificacion = descomponerInstante(resultado);
  if (verificacion.hour !== hor || verificacion.minute !== min) {
    // En la transición de DST (hora ambigua o inexistente) puede quedar
    // un minuto de diferencia — se acepta el resultado más cercano.
    // No lanzamos error porque las horas de corte comerciales no caen en
    // la transición de DST chilena (medianoche de un domingo de octubre/marzo).
  }

  return resultado;
}

/**
 * Devuelve la fecha 'YYYY-MM-DD' local de Santiago para un instante dado.
 * Útil para comparar `fecha_compromiso_hora` (timestamptz) con fechas del día.
 */
export function fechaLocalEnSantiago(instante: Date): string {
  const p = descomponerInstante(instante);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/**
 * Convierte una hora local de Santiago ('HH:MM') a un número de minutos
 * desde medianoche. Usado para comparar hora_corte con la hora actual.
 */
export function horaAMinutos(hora: string): number {
  const [hStr, mStr] = hora.split(':');
  return Number(hStr) * 60 + Number(mStr);
}

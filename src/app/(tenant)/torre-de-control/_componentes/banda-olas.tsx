/**
 * Banda de olas entrantes (F9) — lo único que mira hacia adelante.
 * =============================================================================
 *
 * **Banda de aviso, no región permanente**: si no hay ola dentro del horizonte,
 * no ocupa un píxel. Es la regla 1 —el silencio es el estado normal— aplicada a
 * la anticipación.
 *
 * Son VARIAS, no una. Con CyberMonday y Navidad los dos en horizonte, mostrar
 * solo la próxima escondía la que de verdad hay que preparar. La más cercana va
 * desplegada; el resto, una línea cada una.
 *
 * QUÉ SE MUESTRA Y POR QUÉ ESE RECORTE:
 * · **Arquetipo** — el campo más importante. En `venta` las entregas llegan
 *   DESPUÉS del evento (D+1 a D+5); en `regalo` llegan ANTES y el plazo es duro.
 *   Sin esto las fechas engañan.
 * · **Brecha de conductores + día crítico** — LA cifra accionable.
 * · **Fuente de la proyección** — letra chica, pero es señal de confianza: salir
 *   del histórico propio del courier se cree; salir de un catálogo genérico se
 *   toma con pinzas.
 *
 * Se retiraron la curva (es un gráfico y dice lo mismo que brecha + día crítico
 * en diez veces el espacio), la fecha límite de compra por zona (le sirve al
 * SELLER para su publicidad, no al courier para despachar) y los hitos (cuatro
 * textos genéricos sin dónde marcarlos hechos).
 */

import type { OlaEntrante } from '@/modules/contexto/contrato-torre';

const TEXTO_ARQUETIPO: Record<OlaEntrante['arquetipo'], string> = {
  venta: 'las entregas llegan después del evento',
  regalo: 'las entregas llegan antes; el plazo es duro',
};

function cuando(dias: number): string {
  if (dias < 0) return 'en curso';
  if (dias === 0) return 'hoy';
  if (dias === 1) return 'mañana';
  return `en ${dias} días`;
}

function fechaCorta(iso: string): string {
  // El payload trae fechas civiles de Santiago; se formatean sin volver a
  // interpretarlas como instante para no correrlas un día.
  const [anio, mes, dia] = iso.slice(0, 10).split('-');
  return `${Number(dia)}/${Number(mes)}/${anio.slice(2)}`;
}

export function BandaOlas({ olas }: { olas: readonly OlaEntrante[] }) {
  if (olas.length === 0) return null;

  const [principal, ...resto] = olas;

  return (
    <div className="rounded-lg border border-border bg-muted/40 px-4 py-3">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-sm font-semibold">{principal.nombre}</span>
        {principal.organizador ? (
          <span className="text-xs text-muted-foreground">{principal.organizador}</span>
        ) : null}
        <span className="text-sm text-muted-foreground">
          {cuando(principal.diasParaEvento)}
        </span>
        {principal.brechaConductores < 0 ? (
          // La brecha viene negativa cuando falta gente. Si alcanza no se dice
          // nada: anunciar «te sobran 0 conductores» es ruido.
          <span className="text-sm font-medium text-warning-subtle-foreground">
            · el {fechaCorta(principal.diaCritico)} te faltan{' '}
            {Math.abs(principal.brechaConductores)} conductores
          </span>
        ) : null}
      </div>

      <p className="mt-1 text-xs text-muted-foreground">
        {TEXTO_ARQUETIPO[principal.arquetipo]} · entregas del{' '}
        {fechaCorta(principal.ventanaEntregas.inicio)}
        {principal.ventanaEntregas.fin
          ? ` al ${fechaCorta(principal.ventanaEntregas.fin)}`
          : ''}{' '}
        · {principal.variacionEsperadaPct > 0 ? '+' : ''}
        {principal.variacionEsperadaPct}% esperado
        {principal.fuenteProyeccion === 'catalogo'
          ? ' · proyección de catálogo'
          : ' · proyección con tu histórico'}
      </p>

      {resto.length > 0 ? (
        <ul className="mt-2 space-y-0.5 border-t border-border pt-2">
          {resto.map((ola) => (
            <li key={ola.id} className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{ola.nombre}</span>{' '}
              {cuando(ola.diasParaEvento)}
              {ola.brechaConductores < 0
                ? ` · faltan ${Math.abs(ola.brechaConductores)} conductores`
                : ''}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

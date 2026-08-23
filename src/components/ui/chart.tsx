"use client"

/**
 * Charts de Rutax (Fase 5) — line + donut sobre Recharts, con el ADN de Retell
 * y las reglas de la skill `dataviz`:
 *
 * - **Orden categórico fijo, de alto contraste primero.** El validador reprobó
 *   la paleta cruda de Retell como set categórico (amarillo/cian muy claros;
 *   verde↔amarillo en banda-piso de CVD). Mitigación conforme a las reglas:
 *   asignar hues en orden fijo priorizando las bien separadas (azul·morado·
 *   verde) y dejando las flojas (cian·amarillo) al final, SIEMPRE con
 *   codificación secundaria (leyenda + tooltip + etiqueta directa). Nunca ciclar.
 * - **Una escala por eje** (nunca doble eje). Marcas finas (2px), grid punteado
 *   recesivo, ejes muted. El texto usa tokens de tinta, no el color de la serie.
 *
 * Los colores se leen de los tokens `--chart-*` (light/dark ya validados) vía
 * `var(--chart-n)`, así el tema los cambia solo.
 */

import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
} from "recharts"

/**
 * La paleta categórica, **en el orden en que está declarada**.
 *
 * ⚠️ Acá había una reordenación —1, 3, 5, 2, 4— con sus colores anotados como
 * «azul · morado · verde · cian · amarillo». Los dos datos quedaron falsos
 * cuando el sistema nuevo redefinió `--rx-chart-1..5`: hoy la serie 1 es teal
 * (`#00D6B4`), la 3 es gris y no hay ni morado ni amarillo. Un comentario que
 * miente sobre un color es peor que ninguno — el que lee cree que sabe.
 *
 * Y la reordenación tampoco corresponde. La justificaba la paleta anterior, que
 * el validador reprobó como set categórico (cian y amarillo muy claros; verde↔
 * amarillo en banda-piso de CVD). La del sistema nuevo se eligió ya resuelta:
 * **ninguna serie usa el matiz del rojo ni del ámbar**, para no chocar con los
 * tonos de estado, y su regla es explícita — «la serie 1 es siempre la serie 1».
 * Reordenarla acá rompía esa promesa en silencio.
 */
const ORDEN_CHART = [
  "var(--chart-1)", // teal, el acento
  "var(--chart-2)", // cian
  "var(--chart-3)", // gris medio
  "var(--chart-4)", // teal claro
  "var(--chart-5)", // gris
] as const

function colorSerie(indice: number, override?: string): string {
  return override ?? ORDEN_CHART[indice % ORDEN_CHART.length]
}

export interface SerieLinea {
  clave: string
  etiqueta: string
  color?: string
}

interface TooltipProps {
  active?: boolean
  payload?: Array<{ name?: string; value?: number; color?: string; dataKey?: string }>
  label?: string | number
  formato?: (v: number) => string
}

/** Tooltip temático (tokens de popover), value con formato de dominio. */
function TooltipTematico({ active, payload, label, formato }: TooltipProps) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg border border-border bg-popover px-3 py-2 text-xs shadow-dropdown">
      {label !== undefined ? <p className="mb-1 font-medium text-popover-foreground">{label}</p> : null}
      <ul className="space-y-0.5">
        {payload.map((p, i) => (
          <li key={i} className="flex items-center gap-2 text-muted-foreground">
            <span className="size-2 shrink-0 rounded-[3px]" style={{ backgroundColor: p.color }} aria-hidden="true" />
            <span>{p.name}</span>
            <span className="ml-auto font-mono tabular-nums text-popover-foreground">
              {formato && typeof p.value === "number" ? formato(p.value) : p.value}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

const EJE_COMUN = {
  // `--rx-chart-axis`, no el gris genérico del texto: el eje es cartografía del
  // dato, no prosa, y el sistema le da su propio token para poder moverlo sin
  // arrastrar cada texto secundario del producto.
  stroke: "var(--rx-chart-axis)",
  fontSize: 12,
  tickLine: false,
  axisLine: false,
} as const

/**
 * GraficoLinea — series de tiempo (p. ej. entregas por día). Grid punteado,
 * línea 2px, puntos ocultos salvo hover; leyenda si hay ≥2 series.
 */
export function GraficoLinea({
  datos,
  series,
  ejeX,
  formato,
  alto = 240,
}: {
  datos: Record<string, string | number>[]
  series: SerieLinea[]
  ejeX: string
  formato?: (v: number) => string
  alto?: number
}) {
  return (
    <ResponsiveContainer width="100%" height={alto}>
      <LineChart data={datos} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
        {/* La rejilla tiene su propio token y no es el borde de un contenedor:
            `--rx-chart-grid` es más tenue a propósito, porque una rejilla que
            compite con la serie deja de ser referencia y pasa a ser ruido. */}
        <CartesianGrid strokeDasharray="3 3" stroke="var(--rx-chart-grid)" vertical={false} />
        <XAxis dataKey={ejeX} {...EJE_COMUN} />
        <YAxis {...EJE_COMUN} width={44} tickFormatter={formato ? (v) => formato(Number(v)) : undefined} />
        <Tooltip
          cursor={{ stroke: "var(--rx-chart-axis)" }}
          content={<TooltipTematico formato={formato} />}
        />
        {series.length > 1 ? (
          <Legend
            iconType="plainline"
            wrapperStyle={{ fontSize: 12, color: "var(--muted-foreground)" }}
          />
        ) : null}
        {series.map((s, i) => (
          <Line
            key={s.clave}
            type="monotone"
            dataKey={s.clave}
            name={s.etiqueta}
            stroke={colorSerie(i, s.color)}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  )
}

export interface SegmentoDona {
  nombre: string
  valor: number
  color?: string
}

/**
 * GraficoDona — distribución (p. ej. paquetes por comuna, éxito vs fallo).
 * Donut con leyenda (identidad nunca solo por color) + tooltip con valor.
 */
export function GraficoDona({
  datos,
  formato,
  alto = 240,
}: {
  datos: SegmentoDona[]
  formato?: (v: number) => string
  alto?: number
}) {
  return (
    <ResponsiveContainer width="100%" height={alto}>
      <PieChart>
        <Pie
          data={datos}
          dataKey="valor"
          nameKey="nombre"
          innerRadius="58%"
          outerRadius="82%"
          paddingAngle={2}
          stroke="var(--card)"
          strokeWidth={2}
        >
          {datos.map((d, i) => (
            <Cell key={d.nombre} fill={colorSerie(i, d.color)} />
          ))}
        </Pie>
        <Tooltip content={<TooltipTematico formato={formato} />} />
        <Legend
          iconType="circle"
          wrapperStyle={{ fontSize: 12, color: "var(--muted-foreground)" }}
        />
      </PieChart>
    </ResponsiveContainer>
  )
}

export interface SerieBarra {
  clave: string
  etiqueta: string
  color?: string
}

/**
 * GraficoBarras — comparación entre categorías (entregas por comuna, cobros por
 * seller, pagos por conductor).
 *
 * POR QUÉ BARRAS Y NO LÍNEAS
 * ---------------------------------------------------------------------------
 * La línea afirma continuidad: dice que entre dos puntos hubo un camino. Entre
 * dos comunas no hay camino, y entre dos sellers tampoco. Usar línea ahí es
 * dibujar una relación que no existe.
 *
 * **Horizontal por defecto**, que es lo que casi siempre corresponde acá: las
 * categorías son nombres —«Puente Alto», «Comercializadora Los Almendros SpA»—
 * y en vertical se cortan o se giran 45°, que es la forma más rápida de hacer
 * ilegible un gráfico. En horizontal el nombre se lee de corrido.
 *
 * **Una escala por eje, y el cero siempre incluido**: una barra truncada
 * exagera la diferencia, y en un producto de dinero eso no es un descuido de
 * estilo.
 */
export function GraficoBarras({
  datos,
  series,
  ejeCategoria,
  formato,
  alto = 240,
  orientacion = "horizontal",
  destacarUltima = false,
}: {
  datos: Record<string, string | number>[]
  series: SerieBarra[]
  ejeCategoria: string
  formato?: (v: number) => string
  alto?: number
  orientacion?: "horizontal" | "vertical"
  /**
   * Pinta la última barra con la tinta del texto en vez del color de la serie.
   *
   * Es para las series temporales que terminan en HOY: el día en curso todavía
   * está creciendo y no es comparable con los cerrados, así que se distingue.
   * Solo aplica con una serie — con varias, el color ya significa otra cosa.
   */
  destacarUltima?: boolean
}) {
  const horizontal = orientacion === "horizontal"

  return (
    <ResponsiveContainer width="100%" height={alto}>
      <BarChart
        data={datos}
        layout={horizontal ? "vertical" : "horizontal"}
        margin={{ top: 8, right: 12, bottom: 4, left: 4 }}
      >
        <CartesianGrid
          strokeDasharray="3 3"
          stroke="var(--rx-chart-grid)"
          // La rejilla va SOLO en el eje de la magnitud. En el de categorías no
          // mide nada: separa nombres, y una línea entre dos nombres sugiere una
          // escala que no existe.
          vertical={horizontal}
          horizontal={!horizontal}
        />
        {horizontal ? (
          <>
            <XAxis
              type="number"
              {...EJE_COMUN}
              tickFormatter={formato ? (v) => formato(Number(v)) : undefined}
            />
            <YAxis type="category" dataKey={ejeCategoria} {...EJE_COMUN} width={110} />
          </>
        ) : (
          <>
            <XAxis type="category" dataKey={ejeCategoria} {...EJE_COMUN} />
            <YAxis
              type="number"
              {...EJE_COMUN}
              width={44}
              tickFormatter={formato ? (v) => formato(Number(v)) : undefined}
            />
          </>
        )}
        <Tooltip
          cursor={{ fill: "var(--rx-chart-grid)" }}
          content={<TooltipTematico formato={formato} />}
        />
        {series.length > 1 ? (
          <Legend wrapperStyle={{ fontSize: 12, color: "var(--muted-foreground)" }} />
        ) : null}
        {series.map((s, i) => (
          <Bar
            key={s.clave}
            dataKey={s.clave}
            name={s.etiqueta}
            fill={colorSerie(i, s.color)}
            // Radio 0: una barra es una magnitud medida desde el cero, y una
            // punta redondeada le quita exactitud justo donde se lee el valor.
            radius={0}
            maxBarSize={22}
          >
            {destacarUltima && series.length === 1
              ? datos.map((_, fila) => (
                  <Cell
                    key={fila}
                    fill={
                      fila === datos.length - 1
                        ? "var(--rx-fg)"
                        : colorSerie(i, s.color)
                    }
                  />
                ))
              : null}
          </Bar>
        ))}
      </BarChart>
    </ResponsiveContainer>
  )
}

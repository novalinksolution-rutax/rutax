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
} from "recharts"

// Orden categórico: alto contraste / mejor separación CVD primero (dataviz check 3/4).
const ORDEN_CHART = [
  "var(--chart-1)", // azul
  "var(--chart-3)", // morado
  "var(--chart-5)", // verde
  "var(--chart-2)", // cian  (bajo contraste → solo con leyenda/label)
  "var(--chart-4)", // amarillo (idem)
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
  stroke: "var(--muted-foreground)",
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
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
        <XAxis dataKey={ejeX} {...EJE_COMUN} />
        <YAxis {...EJE_COMUN} width={44} tickFormatter={formato ? (v) => formato(Number(v)) : undefined} />
        <Tooltip
          cursor={{ stroke: "var(--border)" }}
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

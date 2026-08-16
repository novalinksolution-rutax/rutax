"use client";

/**
 * PopoverSnapshotRegla — botón "¿Por qué este monto?" (§1.1 P1 del audit,
 * trazabilidad financiera bidireccional).
 *
 * Traduce el `snapshot_regla` (jsonb congelado por `construirSnapshotRegla` en
 * `src/modules/dinero/motor.ts`, LineaCobro/LineaLiquidacion.snapshotRegla) al
 * español, en un Popover. Solo lectura — no interpreta de más ni recalcula: si
 * un campo no viene en el snapshot, se omite o se muestra "—".
 *
 * Reutilizado en tres lugares: el panel de trazabilidad del pedido, la tabla
 * de líneas de un período de cobro, y la tabla de líneas de una liquidación.
 */

import { HelpCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatearCLP, formatearAjuste } from "@/lib/ui/formato-moneda";
import { traducirTipoIncidencia } from "@/lib/ui/traduccion-estados";
import { etiquetaTipoEntrega } from "@/lib/ui/etiqueta-fuente-pedido";
import type { TipoIncidencia } from "@/modules/operacion/tipos";
import { cn } from "@/lib/utils";
import { formatearFechaHora } from "@/lib/formato-cl";

const MODO_CALCULO_TEXTO: Record<string, string> = {
  monto_fijo: "Monto fijo",
  por_zona: "Por zona",
};

const TIPOS_INCIDENCIA_CONOCIDOS = new Set<string>([
  "destinatario_ausente",
  "direccion_erronea",
  "paquete_danado",
  "rechazo_destinatario",
  "problema_acceso",
  "reagendado",
  "otro",
]);

function esRecordJson(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor);
}

function textoTraducido(mapa: Record<string, string>, valor: unknown): string {
  if (typeof valor !== "string" || !valor) return "—";
  return mapa[valor] ?? valor;
}

function textoOGuion(valor: unknown): string {
  return typeof valor === "string" && valor ? valor : "—";
}

function montoONull(valor: unknown): string | null {
  return typeof valor === "number" ? formatearCLP(valor) : null;
}

function fechaHoraONull(valor: unknown): string | null {
  if (typeof valor !== "string" || !valor) return null;
  const fecha = new Date(valor);
  if (Number.isNaN(fecha.getTime())) return valor;
  return formatearFechaHora(fecha);
}

interface DatosSnapshot {
  tarifa: Record<string, unknown> | null;
  recargos: Record<string, unknown> | null;
  zona: Record<string, unknown> | null;
  incidencia: Record<string, unknown> | null;
  elegibilidad: Record<string, unknown> | null;
  generadoEn: string | null;
}

function extraerDatos(raw: unknown): DatosSnapshot | null {
  if (!esRecordJson(raw) || Object.keys(raw).length === 0) return null;
  return {
    tarifa: esRecordJson(raw.tarifa) ? raw.tarifa : null,
    recargos: esRecordJson(raw.recargos_descuentos) ? raw.recargos_descuentos : null,
    zona: esRecordJson(raw.zona) ? raw.zona : null,
    incidencia: esRecordJson(raw.incidencia) ? raw.incidencia : null,
    elegibilidad: esRecordJson(raw.elegibilidad) ? raw.elegibilidad : null,
    generadoEn: typeof raw.generado_en === "string" ? raw.generado_en : null,
  };
}

interface PopoverSnapshotReglaProps {
  snapshotRegla: unknown;
  className?: string;
  /**
   * true en columnas de tabla densas (período/liquidación): el trigger es solo
   * el ícono, sin el texto "¿Por qué este monto?" (que sigue disponible como
   * `aria-label`/`title` para lectores de pantalla y hover).
   */
  iconoSolo?: boolean;
}

export function PopoverSnapshotRegla({ snapshotRegla, className, iconoSolo = false }: PopoverSnapshotReglaProps) {
  const datos = extraerDatos(snapshotRegla);

  if (!datos) {
    return (
      <span title="Sin detalle disponible para esta línea." className="inline-block">
        <Button
          type="button"
          variant="ghost"
          size={iconoSolo ? "icon-xs" : "xs"}
          disabled
          aria-label="¿Por qué este monto? Sin detalle disponible para esta línea."
          className={cn("pointer-events-none text-muted-foreground", className)}
        >
          <HelpCircle className="size-3.5" aria-hidden="true" />
          {!iconoSolo && "¿Por qué este monto?"}
        </Button>
      </span>
    );
  }

  const { tarifa, recargos, zona, incidencia, elegibilidad, generadoEn } = datos;

  const ajusteIncidenciaClp =
    recargos && typeof recargos.ajuste_incidencia_clp === "number"
      ? recargos.ajuste_incidencia_clp
      : 0;
  const ajuste = formatearAjuste(ajusteIncidenciaClp);

  const tipoIncidenciaRaw =
    incidencia && typeof incidencia.tipo === "string" ? incidencia.tipo : null;
  const tipoIncidenciaTexto = tipoIncidenciaRaw
    ? TIPOS_INCIDENCIA_CONOCIDOS.has(tipoIncidenciaRaw)
      ? traducirTipoIncidencia(tipoIncidenciaRaw as TipoIncidencia)
      : tipoIncidenciaRaw
    : null;

  const minimoFacturacion = recargos ? montoONull(recargos.minimo_facturacion_clp) : null;
  const minimoRetiro = recargos ? montoONull(recargos.minimo_retiro_clp) : null;
  const recargoPactado = recargos ? montoONull(recargos.recargo_reprogramacion_pactado_clp) : null;
  const hayMinimosORecargos = !!(minimoFacturacion || minimoRetiro || recargoPactado);

  const motivoTexto =
    elegibilidad && typeof elegibilidad.motivo_texto === "string" ? elegibilidad.motivo_texto : null;

  const fechaGenerado = fechaHoraONull(generadoEn);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size={iconoSolo ? "icon-xs" : "xs"}
          aria-label="¿Por qué este monto?"
          title={iconoSolo ? "¿Por qué este monto?" : undefined}
          className={className}
        >
          <HelpCircle className="size-3.5" aria-hidden="true" />
          {!iconoSolo && "¿Por qué este monto?"}
        </Button>
      </PopoverTrigger>
      <PopoverContent>
        <div className="space-y-3">
          <p className="font-heading text-sm font-semibold">¿Por qué este monto?</p>
          <dl className="space-y-2.5 text-xs">
            {tarifa && (
              <div>
                <dt className="font-medium text-muted-foreground">Tarifa aplicada</dt>
                <dd className="mt-0.5">
                  {etiquetaTipoEntrega(typeof tarifa.tipo_entrega === "string" ? tarifa.tipo_entrega : null)} ·{" "}
                  {textoTraducido(MODO_CALCULO_TEXTO, tarifa.modo_calculo)} ·{" "}
                  <span className="font-medium tabular-nums">
                    {montoONull(tarifa.valor_base_clp) ?? "—"}
                  </span>
                </dd>
              </div>
            )}

            {zona && (
              <div>
                <dt className="font-medium text-muted-foreground">Zona</dt>
                <dd className="mt-0.5">
                  {textoOGuion(zona.zona_texto)}
                  {typeof zona.comuna_destinatario === "string" && zona.comuna_destinatario && (
                    <> · Comuna: {zona.comuna_destinatario}</>
                  )}
                </dd>
              </div>
            )}

            <div>
              <dt className="font-medium text-muted-foreground">Ajuste por incidencia</dt>
              <dd className="mt-0.5">
                <span
                  className={
                    ajuste.esNegativo
                      ? "font-medium text-destructive"
                      : ajuste.esPositivo
                        ? "font-medium text-success"
                        : ""
                  }
                >
                  {ajuste.texto}
                </span>
                {tipoIncidenciaTexto && <> — {tipoIncidenciaTexto}</>}
              </dd>
            </div>

            {hayMinimosORecargos && (
              <div>
                <dt className="font-medium text-muted-foreground">Mínimos y recargos pactados</dt>
                <dd className="mt-0.5 space-y-0.5">
                  {minimoFacturacion && <p>Mínimo de facturación: {minimoFacturacion}</p>}
                  {minimoRetiro && <p>Mínimo de retiro: {minimoRetiro}</p>}
                  {recargoPactado && <p>Recargo por reprogramación: {recargoPactado}</p>}
                </dd>
              </div>
            )}

            {motivoTexto && (
              <div>
                <dt className="font-medium text-muted-foreground">Motivo de elegibilidad</dt>
                <dd className="mt-0.5">{motivoTexto}</dd>
              </div>
            )}
          </dl>
          {fechaGenerado && (
            <p className="border-t border-border pt-2 text-[11px] text-muted-foreground">
              Calculado automáticamente por el motor el {fechaGenerado}.
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

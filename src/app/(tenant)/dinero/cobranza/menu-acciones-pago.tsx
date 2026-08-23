"use client";

/**
 * Menú de acciones por fila de la bandeja de revisión de pagos (cobranza Fintoc).
 *
 * Acciones disponibles según estado:
 * - sin_atribuir / sobrante / parcial / atribuido: "Atribuir manualmente" ·
 *   "Descartar".
 * - conciliado / descartado: solo lectura (no aparece el menú).
 *
 * "Atribuir manualmente" abre un panel que pide el seller y, opcionalmente, el
 * período facturado impago al que imputar (se cargan al elegir el seller).
 * "Descartar" pide un motivo (obligatorio). Patrón EXACTO del menú de
 * conciliación (`menu-acciones-conciliacion.tsx`).
 */

import { useState, useRef, useEffect, useTransition } from "react";
import { MoreHorizontal } from "lucide-react";
import type { EstadoMatchPago } from "@/modules/dinero/tipos";
import { Textarea } from "@/components/ui/textarea";
import { CalcePago } from "@/components/ui/calce-pago";
import { formatearCLP } from "@/lib/ui/formato-moneda";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  accionAtribuirPago,
  accionDescartarPago,
  listarPeriodosImpagosDeSeller,
} from "./actions";

/** Sentinela para "sin período específico" (valor "" real): Radix no admite value="". */
const SIN_PERIODO = "__sin_periodo__";

interface SellerOpcion {
  id: string;
  nombre: string;
}

interface PeriodoOpcion {
  id: string;
  etiqueta: string;
  montoTotalClp: number | null;
}

interface Props {
  pagoId: string;
  estadoActual: EstadoMatchPago;
  sellers: SellerOpcion[];
  /** Lo que entró al banco. Sin esto no hay resta que mostrar. */
  montoClp: number;
  /** Ya formateada: el cuadro de descartar nombra el movimiento por monto y día. */
  fechaCorta: string;
}

type Vista = "menu" | "atribuir" | "descartar";

export function MenuAccionesPago({
  pagoId,
  estadoActual,
  sellers,
  montoClp,
  fechaCorta,
}: Props) {
  const [menuAbierto, setMenuAbierto] = useState(false);
  const [vista, setVista] = useState<Vista>("menu");
  const [error, setError] = useState<string | null>(null);
  const [resuelto, setResuelto] = useState(false);
  const [isPending, startTransition] = useTransition();
  const menuRef = useRef<HTMLDivElement>(null);

  // Estado del sub-formulario de atribución.
  const [sellerSel, setSellerSel] = useState("");
  const [periodoSel, setPeriodoSel] = useState("");
  const [periodos, setPeriodos] = useState<PeriodoOpcion[]>([]);
  const [cargandoPeriodos, setCargandoPeriodos] = useState(false);

  // Estado del sub-formulario de descarte.
  const [motivo, setMotivo] = useState("");

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        cerrar();
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function cerrar() {
    setMenuAbierto(false);
    setVista("menu");
    setError(null);
  }

  // Estados terminales: el pago ya está resuelto, no se ofrece el menú.
  if (estadoActual === "conciliado" || estadoActual === "descartado" || resuelto) {
    return null;
  }

  async function alElegirSeller(id: string) {
    setSellerSel(id);
    setPeriodoSel("");
    setPeriodos([]);
    if (!id) return;
    setCargandoPeriodos(true);
    const resultado = await listarPeriodosImpagosDeSeller(id);
    setCargandoPeriodos(false);
    if (resultado.ok) setPeriodos(resultado.periodos);
  }

  function ejecutar(accion: () => Promise<{ ok: true } | { ok: false; mensaje: string }>) {
    setError(null);
    startTransition(async () => {
      const resultado = await accion();
      if (resultado.ok) {
        setResuelto(true);
        cerrar();
        window.location.reload();
      } else {
        setError(resultado.mensaje);
      }
    });
  }

  function confirmarAtribuir() {
    if (!sellerSel) {
      setError("Elige el seller al que corresponde este pago.");
      return;
    }
    ejecutar(() => accionAtribuirPago(pagoId, sellerSel, periodoSel || undefined));
  }

  function confirmarDescartar() {
    if (!motivo.trim()) {
      setError("Indica un motivo para descartar el pago.");
      return;
    }
    ejecutar(() => accionDescartarPago(pagoId, motivo));
  }

  return (
    <div className="relative" ref={menuRef}>
      <button
        type="button"
        onClick={() => {
          setMenuAbierto((prev) => !prev);
          setVista("menu");
          setError(null);
        }}
        disabled={isPending}
        aria-label="Acciones del pago"
        aria-haspopup="menu"
        aria-expanded={menuAbierto}
        className="inline-flex items-center justify-center rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors disabled:opacity-50"
      >
        {isPending ? (
          <span
            className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
            aria-hidden="true"
          />
        ) : (
          <MoreHorizontal className="size-4" />
        )}
      </button>

      {menuAbierto && (
        <div
          role="menu"
          className="absolute right-0 z-20 mt-1 w-72 rounded-lg border bg-card shadow-md"
        >
          {vista === "menu" && (
            <ul className="py-1">
              <li>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setVista("atribuir");
                    setError(null);
                  }}
                  className="w-full px-4 py-2 text-left text-sm text-foreground hover:bg-muted transition-colors"
                >
                  Atribuir manualmente
                </button>
              </li>
              <li>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setVista("descartar");
                    setError(null);
                  }}
                  className="w-full px-4 py-2 text-left text-sm text-destructive transition-colors hover:bg-destructive-subtle"
                >
                  Descartar
                </button>
              </li>
            </ul>
          )}

          {vista === "atribuir" && (
            <div className="space-y-3 p-4">
              <p className="text-sm font-medium">Atribuir pago a un seller</p>

              <div className="space-y-1">
                <label htmlFor={`seller-${pagoId}`} className="text-xs font-medium text-muted-foreground">
                  Seller
                </label>
                <Select
                  value={sellerSel || undefined}
                  onValueChange={(v) => alElegirSeller(v)}
                  disabled={isPending}
                >
                  <SelectTrigger id={`seller-${pagoId}`} size="default" className="h-9 w-full">
                    <SelectValue placeholder="Elige un seller…" />
                  </SelectTrigger>
                  <SelectContent>
                    {sellers.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.nombre}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <label htmlFor={`periodo-${pagoId}`} className="text-xs font-medium text-muted-foreground">
                  Período facturado impago (opcional)
                </label>
                <Select
                  value={periodoSel || SIN_PERIODO}
                  onValueChange={(v) => setPeriodoSel(v === SIN_PERIODO ? "" : v)}
                  disabled={isPending || !sellerSel || cargandoPeriodos}
                >
                  <SelectTrigger id={`periodo-${pagoId}`} size="default" className="h-9 w-full">
                    <SelectValue
                      placeholder={
                        cargandoPeriodos
                          ? "Cargando períodos…"
                          : sellerSel
                          ? "Sin período específico"
                          : "Elige primero el seller"
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={SIN_PERIODO}>Sin período específico</SelectItem>
                    {periodos.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.etiqueta}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {sellerSel && !cargandoPeriodos && periodos.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    Este seller no tiene períodos facturados impagos. Puedes atribuir el pago igualmente.
                  </p>
                )}
              </div>

              {/* El calce como RESTA. Antes se elegía un período y se apretaba
                  «Atribuir» a ciegas: si el monto no calzaba, uno se enteraba
                  después, por el estado que quedó. */}
              {periodoSel ? (
                <CalcePago
                  montoMovimiento={montoClp}
                  montoPeriodo={
                    periodos.find((p) => p.id === periodoSel)?.montoTotalClp ?? null
                  }
                  etiquetaPeriodo={periodos.find((p) => p.id === periodoSel)?.etiqueta}
                />
              ) : null}

              {error && (
                <p className="text-xs text-destructive" role="alert">
                  {error}
                </p>
              )}

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setVista("menu");
                    setError(null);
                  }}
                  disabled={isPending}
                  className="rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-muted transition-colors disabled:opacity-50"
                >
                  Volver
                </button>
                <button
                  type="button"
                  onClick={confirmarAtribuir}
                  disabled={isPending}
                  className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
                >
                  Atribuir
                </button>
              </div>
            </div>
          )}

          {vista === "descartar" && (
            <div className="space-y-3 p-4">
              {/* `cobranza.descartarMov.conf`. ⚠️ El texto anterior decía
                  **cuándo usarlo**, no **qué pasa**: «úsalo si el movimiento no
                  es una cobranza… quedará registrado en la bitácora». No decía
                  el monto, no decía que sale de la bandeja, y no decía que se
                  puede volver — porque hasta ahora no se podía. Ahora sí, y el
                  copy escrito entra tal cual. */}
              <p className="text-sm font-medium">
                Vas a descartar {formatearCLP(montoClp)} del {fechaCorta}
              </p>
              <p className="text-xs text-muted-foreground">
                Sale de los movimientos por atribuir y deja de aparecer.{" "}
                <strong className="font-medium text-foreground">No se borra</strong>: queda
                descartado con tu motivo, y se puede devolver a la bandeja desde el cajón
                «Descartados».
              </p>
              <div className="space-y-1">
                <label htmlFor={`motivo-${pagoId}`} className="text-xs font-medium text-muted-foreground">
                  Motivo
                </label>
                <Textarea
                  id={`motivo-${pagoId}`}
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value)}
                  rows={2}
                  disabled={isPending}
                  placeholder="Ej.: devolución de un seller, transferencia ajena…"
                />
              </div>

              {error && (
                <p className="text-xs text-destructive" role="alert">
                  {error}
                </p>
              )}

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setVista("menu");
                    setError(null);
                  }}
                  disabled={isPending}
                  className="rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-muted transition-colors disabled:opacity-50"
                >
                  Volver
                </button>
                <button
                  type="button"
                  onClick={confirmarDescartar}
                  disabled={isPending}
                  className="rounded-md bg-destructive px-3 py-1.5 text-xs font-semibold text-destructive-foreground transition-colors hover:bg-destructive/90 disabled:opacity-50"
                >
                  Descartar
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

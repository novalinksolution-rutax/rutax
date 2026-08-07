"use client";

/**
 * Formulario de creación de pedido same-day — modal/panel lateral.
 * Client Component — valida inline y envía la server action.
 */

import { useState, useTransition } from "react";
import { AlertTriangle, Plus, X } from "lucide-react";
import { actionCrearPedidoSameDay } from "./actions";
import type { AvisoCorte } from "@/modules/operacion/tipos";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { fechaLocalEnSantiago } from "@/lib/fecha-santiago";
import { etiquetaSellerConEstado } from "@/lib/ui/traduccion-estados";

interface Props {
  sellers: { id: string; nombre: string; estado?: string }[];
  tenantId: string;
  /** Si el creador es el propio seller: fijar sellerId y ocultarlo */
  sellerFijo?: string;
}

export function FormularioPedidoSameDay({ sellers, sellerFijo }: Props) {
  const [abierto, setAbierto] = useState(false);
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [errorServidor, setErrorServidor] = useState<string | null>(null);
  const [avisoCorte, setAvisoCorte] = useState<AvisoCorte | null>(null);
  const [sellerId, setSellerId] = useState("");
  const [pending, startTransition] = useTransition();

  /** Cierra el diálogo y limpia el estado transitorio (errores + aviso de corte).
   *  Resetear el aviso es clave: si no, al reabrir el modal el formulario
   *  seguiría oculto por un aviso de una creación anterior. */
  function cerrar() {
    setAbierto(false);
    setErrores({});
    setErrorServidor(null);
    setAvisoCorte(null);
  }

  function validar(data: FormData): Record<string, string> {
    const errs: Record<string, string> = {};
    if (!String(data.get("destinatarioNombre") ?? "").trim()) {
      errs.destinatarioNombre = "El nombre es obligatorio.";
    }
    if (!String(data.get("destinatarioDireccion") ?? "").trim()) {
      errs.destinatarioDireccion = "La dirección es obligatoria.";
    }
    if (!String(data.get("destinatarioComuna") ?? "").trim()) {
      errs.destinatarioComuna = "La comuna es obligatoria.";
    }
    if (!sellerFijo && !String(data.get("sellerId") ?? "").trim()) {
      errs.sellerId = "Debes seleccionar un seller.";
    }
    return errs;
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    if (sellerFijo) formData.set("sellerId", sellerFijo);

    const errs = validar(formData);
    if (Object.keys(errs).length > 0) {
      setErrores(errs);
      return;
    }
    setErrores({});
    setErrorServidor(null);
    setAvisoCorte(null);

    startTransition(async () => {
      const resultado = await actionCrearPedidoSameDay(formData);
      if (resultado.error) {
        setErrorServidor(resultado.error);
        return;
      }
      if (resultado.avisoCorte) {
        // El pedido YA se creó — el aviso es informativo, no bloqueante. Se deja
        // el modal abierto para que el operador lo vea, pero se oculta el
        // formulario (abajo) para que no pueda reenviarse y crear un duplicado.
        setAvisoCorte(resultado.avisoCorte);
        return;
      }
      cerrar();
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
      >
        <Plus className="size-4" aria-hidden="true" />
        Nuevo pedido same-day
      </button>

      {abierto && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="dialog-same-day-titulo"
          className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
        >
          {/* Fondo */}
          <div
            className="absolute inset-0 bg-black/10 supports-backdrop-filter:backdrop-blur-xs"
            onClick={() => !pending && cerrar()}
            aria-hidden="true"
          />

          {/* Panel — altura acotada al viewport. El panel NO scrollea (esquinas
              redondeadas limpias): solo el cuerpo interno hace overflow, con el
              encabezado y el pie fijos para que título y botones nunca se corten. */}
          <div className="relative z-10 flex max-h-[calc(100%-2rem)] w-full max-w-lg flex-col overflow-hidden rounded-t-xl bg-background ring-1 ring-foreground/10 sm:rounded-xl">
            <div className="flex shrink-0 items-center justify-between border-b border-border px-6 py-4">
              <h2 id="dialog-same-day-titulo" className="text-lg font-semibold">
                Nuevo pedido same-day
              </h2>
              <button
                type="button"
                onClick={cerrar}
                disabled={pending}
                className="rounded-md p-1 hover:bg-muted"
                aria-label="Cerrar"
              >
                <X className="size-5" />
              </button>
            </div>

            {/* El formulario se oculta una vez creado el pedido fuera de corte:
                el pedido ya existe, reenviarlo crearía un duplicado. */}
            {avisoCorte ? (
              /* Banner "pasaste el corte" — no bloqueante, el pedido ya se creó */
              <div className="flex-1 overflow-y-auto px-6 py-4">
                <div
                  role="alert"
                  className="rounded-lg border border-warning-subtle bg-warning-subtle px-4 py-3"
                >
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
                    <div className="space-y-1">
                      <p className="text-sm font-semibold text-warning-subtle-foreground">
                        Pedido creado fuera del horario de corte ({avisoCorte.horaCorte})
                      </p>
                      <p className="text-sm text-warning-subtle-foreground">
                        Este pedido no alcanzará a ser entregado hoy.{" "}
                        {avisoCorte.sugerencia}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={cerrar}
                    className="mt-3 rounded-md border border-warning/40 bg-background/60 px-3 py-1.5 text-xs font-medium text-warning-subtle-foreground hover:bg-background/80"
                  >
                    Entendido, cerrar
                  </button>
                </div>
              </div>
            ) : (
            <form onSubmit={handleSubmit} noValidate className="flex min-h-0 flex-1 flex-col">
              <div className="flex-1 space-y-4 overflow-y-auto px-6 py-4">
                <p className="rounded-lg bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
                  Este pedido se agrega al panel y queda disponible para asignarlo a un manifiesto.
                </p>

                {errorServidor && (
                  <p role="alert" className="rounded-lg bg-destructive-subtle px-3 py-2 text-sm text-destructive-subtle-foreground">
                    {errorServidor}
                  </p>
                )}
              {/* Bloque Destinatario */}
              <fieldset>
                <legend className="mb-2 text-sm font-semibold">Destinatario</legend>
                <div className="space-y-3">
                  <div>
                    <label htmlFor="destinatarioNombre" className="block text-sm font-medium">
                      Nombre <span aria-hidden="true">*</span>
                    </label>
                    <input
                      id="destinatarioNombre"
                      name="destinatarioNombre"
                      type="text"
                      required
                      disabled={pending}
                      aria-describedby={errores.destinatarioNombre ? "err-nombre" : undefined}
                      aria-invalid={!!errores.destinatarioNombre}
                      className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                    {errores.destinatarioNombre && (
                      <p id="err-nombre" role="alert" className="mt-1 text-xs text-destructive">
                        {errores.destinatarioNombre}
                      </p>
                    )}
                  </div>

                  <div>
                    <label htmlFor="destinatarioDireccion" className="block text-sm font-medium">
                      Dirección <span aria-hidden="true">*</span>
                    </label>
                    <input
                      id="destinatarioDireccion"
                      name="destinatarioDireccion"
                      type="text"
                      required
                      disabled={pending}
                      aria-describedby={errores.destinatarioDireccion ? "err-dir" : undefined}
                      aria-invalid={!!errores.destinatarioDireccion}
                      className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                    {errores.destinatarioDireccion && (
                      <p id="err-dir" role="alert" className="mt-1 text-xs text-destructive">
                        {errores.destinatarioDireccion}
                      </p>
                    )}
                  </div>

                  <div>
                    <label htmlFor="destinatarioComuna" className="block text-sm font-medium">
                      Comuna <span aria-hidden="true">*</span>
                    </label>
                    <input
                      id="destinatarioComuna"
                      name="destinatarioComuna"
                      type="text"
                      required
                      disabled={pending}
                      aria-describedby={errores.destinatarioComuna ? "err-comuna" : undefined}
                      aria-invalid={!!errores.destinatarioComuna}
                      className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                    {errores.destinatarioComuna && (
                      <p id="err-comuna" role="alert" className="mt-1 text-xs text-destructive">
                        {errores.destinatarioComuna}
                      </p>
                    )}
                  </div>

                  <div>
                    <label htmlFor="destinatarioTelefono" className="block text-sm font-medium">
                      Teléfono <span className="text-muted-foreground">(opcional)</span>
                    </label>
                    <input
                      id="destinatarioTelefono"
                      name="destinatarioTelefono"
                      type="tel"
                      disabled={pending}
                      className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </div>
                </div>
              </fieldset>

              {/* Bloque Entrega */}
              <fieldset>
                <legend className="mb-2 text-sm font-semibold">Entrega</legend>
                <div className="space-y-3">
                  <div>
                    <label htmlFor="instruccionesEntrega" className="block text-sm font-medium">
                      Instrucciones <span className="text-muted-foreground">(opcional)</span>
                    </label>
                    <textarea
                      id="instruccionesEntrega"
                      name="instruccionesEntrega"
                      rows={2}
                      disabled={pending}
                      className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </div>

                  <div>
                    <label htmlFor="fechaCompromiso" className="block text-sm font-medium">
                      Fecha de compromiso
                    </label>
                    <input
                      id="fechaCompromiso"
                      name="fechaCompromiso"
                      type="date"
                      defaultValue={fechaLocalEnSantiago(new Date())}
                      disabled={pending}
                      className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </div>
                </div>
              </fieldset>

              {/* Bloque Facturación */}
              <fieldset>
                <legend className="mb-2 text-sm font-semibold">Facturación</legend>
                {sellerFijo ? (
                  <p className="text-sm text-muted-foreground">
                    Pedido a facturar a tu cuenta de seller.
                  </p>
                ) : (
                  <div>
                    <label htmlFor="sellerId" className="block text-sm font-medium">
                      Seller a facturar <span aria-hidden="true">*</span>
                    </label>
                    <Select
                      name="sellerId"
                      required
                      value={sellerId}
                      onValueChange={setSellerId}
                      disabled={pending}
                    >
                      <SelectTrigger
                        id="sellerId"
                        className="mt-1 w-full"
                        aria-describedby={errores.sellerId ? "err-seller" : undefined}
                        aria-invalid={!!errores.sellerId}
                      >
                        <SelectValue placeholder="Seleccionar seller..." />
                      </SelectTrigger>
                      <SelectContent>
                        {/* El estado va colgado del nombre porque acá importa
                            todavía más que en el filtro: se está creando un
                            pedido para un cliente que quizá no puede verlo aún
                            en su portal. */}
                        {sellers.map((s) => (
                          <SelectItem key={s.id} value={s.id}>
                            {etiquetaSellerConEstado(s.nombre, s.estado)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {errores.sellerId && (
                      <p id="err-seller" role="alert" className="mt-1 text-xs text-destructive">
                        {errores.sellerId}
                      </p>
                    )}
                  </div>
                )}
              </fieldset>
              </div>

              <div className="flex shrink-0 justify-end gap-3 border-t border-border px-6 py-3">
                <button
                  type="button"
                  onClick={cerrar}
                  disabled={pending}
                  className="rounded-lg border px-4 py-2 text-sm font-medium hover:bg-muted transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={pending}
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
                >
                  {pending ? "Creando..." : "Crear pedido"}
                </button>
              </div>
            </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}

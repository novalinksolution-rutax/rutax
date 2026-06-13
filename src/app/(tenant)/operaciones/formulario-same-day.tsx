"use client";

/**
 * Formulario de creación de pedido same-day — modal/panel lateral.
 * Client Component — valida inline y envía la server action.
 */

import { useState, useTransition } from "react";
import { Plus, X } from "lucide-react";
import { actionCrearPedidoSameDay } from "./actions";

interface Props {
  sellers: { id: string; nombre: string }[];
  tenantId: string;
  /** Si el creador es el propio seller: fijar sellerId y ocultarlo */
  sellerFijo?: string;
}

export function FormularioPedidoSameDay({ sellers, sellerFijo }: Props) {
  const [abierto, setAbierto] = useState(false);
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [errorServidor, setErrorServidor] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

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

    startTransition(async () => {
      const resultado = await actionCrearPedidoSameDay(formData);
      if (resultado.error) {
        setErrorServidor(resultado.error);
        return;
      }
      setAbierto(false);
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
            className="absolute inset-0 bg-black/40"
            onClick={() => !pending && setAbierto(false)}
            aria-hidden="true"
          />

          {/* Panel */}
          <div className="relative z-10 w-full max-w-lg rounded-t-2xl bg-background p-6 shadow-xl sm:rounded-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 id="dialog-same-day-titulo" className="text-lg font-semibold">
                Nuevo pedido same-day
              </h2>
              <button
                type="button"
                onClick={() => setAbierto(false)}
                disabled={pending}
                className="rounded-md p-1 hover:bg-muted"
                aria-label="Cerrar"
              >
                <X className="size-5" />
              </button>
            </div>

            <p className="mb-4 rounded-lg bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
              Este pedido se agrega al panel y queda disponible para asignarlo a un manifiesto.
            </p>

            {errorServidor && (
              <p role="alert" className="mb-4 rounded-lg bg-destructive-subtle px-3 py-2 text-sm text-destructive-subtle-foreground">
                {errorServidor}
              </p>
            )}

            <form onSubmit={handleSubmit} noValidate className="space-y-4">
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
                      defaultValue={new Date().toISOString().split("T")[0]}
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
                    <select
                      id="sellerId"
                      name="sellerId"
                      required
                      disabled={pending}
                      aria-describedby={errores.sellerId ? "err-seller" : undefined}
                      aria-invalid={!!errores.sellerId}
                      className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    >
                      <option value="">Seleccionar seller...</option>
                      {sellers.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.nombre}
                        </option>
                      ))}
                    </select>
                    {errores.sellerId && (
                      <p id="err-seller" role="alert" className="mt-1 text-xs text-destructive">
                        {errores.sellerId}
                      </p>
                    )}
                  </div>
                )}
              </fieldset>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setAbierto(false)}
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
          </div>
        </div>
      )}
    </>
  );
}

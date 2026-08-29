"use client";

/**
 * El listado de destinatarios de WhatsApp, por seller, de todos los couriers.
 *
 * La columna que importa no es el teléfono: es **de dónde salió**. Un número
 * puesto por el propio seller vale como consentimiento suyo; uno que agregó
 * Rutax es una afirmación nuestra. Se distinguen a la vista porque la diferencia
 * es la que hay que poder explicarle a Meta.
 *
 * -----------------------------------------------------------------------------
 * 🔴 EN EL TELÉFONO LA FILA SE REACOMODA, NO SE RECORTA
 * -----------------------------------------------------------------------------
 * Cada destinatario usa `FichaFila390` (el arquetipo P1 que el resto del
 * producto ya tiene) en vez de la fila `flex-col` ad hoc de antes. Acá no hay
 * columnas en escritorio que esconder, así que el defecto no era truncamiento
 * sino inconsistencia: esta era una de las pocas filas del backstage sin la
 * pieza compartida.
 *
 * ⚠️ **En el teléfono va Revocar, pero NO Eliminar.** No es una concesión de
 * espacio: son dos acciones de peso distinto y el teléfono es justo donde se
 * necesita la primera. Revocar existe porque «si alguien reclama hay que poder
 * detenerlo sin depender del seller», y ese reclamo llega por WhatsApp, con el
 * teléfono en la mano — dejarlo solo en escritorio significaría no poder parar
 * los avisos hasta llegar a un computador. Es reversible (el seller vuelve a
 * consentir) y es un solo objeto tocable en una fila que no es enlace.
 * Eliminar borra la fila para siempre y no urge nunca: se queda en escritorio.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BadgeEstado } from "@/components/ui/badge-estado";
import { FichaFila390 } from "@/components/ui/ficha-fila-390";
import { formatearFecha } from "@/lib/formato-cl";
import {
  accionAgregarDestinatario,
  accionRevocarDestinatario,
  accionEliminarDestinatario,
} from "./acciones";
import type {
  SellerConDestinatarios,
  DestinatarioWhatsApp,
} from "@/modules/plataforma/whatsapp-destinatarios";

function formatearTelefono(e164: string): string {
  if (e164.startsWith("56") && e164.length === 11) {
    return `+56 ${e164[2]} ${e164.slice(3, 7)} ${e164.slice(7)}`;
  }
  return `+${e164}`;
}

function BadgeOrigen({ origen }: { origen: DestinatarioWhatsApp["origen"] }) {
  return origen === "perfil_seller" ? (
    <BadgeEstado variante="success" texto="Lo puso el seller" conPunto={false} />
  ) : (
    <BadgeEstado variante="info" texto="Lo agregó Rutax" conPunto={false} />
  );
}

function FilaDestinatario({ d, onCambio }: { d: DestinatarioWhatsApp; onCambio: () => void }) {
  const [pendiente, iniciar] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // El estado va con DOS badges a propósito: origen (¿quién lo puso?) y
  // consentimiento (¿le llegan avisos hoy?) son las dos preguntas que esta
  // pantalla de backstage viene a contestar, y ninguna manda sobre la otra.
  const estado = (
    <>
      <BadgeOrigen origen={d.origen} />
      {d.consentimiento === "otorgado" ? (
        <BadgeEstado variante="success" texto="Recibe avisos" />
      ) : d.consentimiento === "revocado" ? (
        <BadgeEstado variante="neutral" texto="Dado de baja" />
      ) : (
        <BadgeEstado variante="warning" texto="Sin consentimiento" />
      )}
    </>
  );
  const detalle = d.etiqueta
    ? `${d.etiqueta} · ${d.consintioEn ? `consintió el ${formatearFecha(d.consintioEn)}` : "sin fecha"}`
    : d.consintioEn
      ? `consintió el ${formatearFecha(d.consintioEn)}`
      : "sin fecha";

  const revocar = () =>
    iniciar(async () => {
      const r = await accionRevocarDestinatario(d.id);
      if (!r.ok) setError(r.mensaje);
      else onCambio();
    });

  return (
    <div className="border-t border-border py-2">
      {/* Teléfono: la ficha más Revocar, y nada más — ver el porqué en el
          comentario de cabecera del archivo. */}
      <div className="flex items-center gap-3 sm:hidden">
        <FichaFila390
          className="flex-1"
          estado={estado}
          titulo={formatearTelefono(d.telefono)}
          detalle={detalle}
        />
        {d.consentimiento === "otorgado" ? (
          <Button variant="outline" size="sm" className="shrink-0" disabled={pendiente} onClick={revocar}>
            Revocar
          </Button>
        ) : null}
      </div>
      {error ? <p className="mt-1 text-xs text-destructive sm:hidden">{error}</p> : null}

      <div className="hidden sm:flex sm:items-center sm:justify-between sm:gap-2">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm">{formatearTelefono(d.telefono)}</span>
            {estado}
          </div>
          <p className="text-xs text-muted-foreground">
            {d.etiqueta ? `${d.etiqueta} · ` : ""}
            {d.consintioEn ? `consintió el ${formatearFecha(d.consintioEn)}` : "sin fecha"}
          </p>
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
        </div>

        <div className="flex shrink-0 gap-2">
          {d.consentimiento === "otorgado" ? (
            <Button variant="outline" size="sm" disabled={pendiente} onClick={revocar}>
              Revocar
            </Button>
          ) : null}

          {/* Solo se elimina lo que Rutax agregó. El número propio del seller es
              su dato: para detenerlo está revocar, que deja rastro. */}
          {d.origen === "agregado_por_rutax" ? (
            <Button
              variant="ghost"
              size="icon"
              aria-label="Eliminar este número"
              disabled={pendiente}
              onClick={() =>
                iniciar(async () => {
                  const r = await accionEliminarDestinatario(d.id);
                  if (!r.ok) setError(r.mensaje);
                  else onCambio();
                })
              }
            >
              <Trash2 className="size-4" />
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function FormularioAgregar({
  seller,
  onAgregado,
}: {
  seller: SellerConDestinatarios;
  onAgregado: () => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const [telefono, setTelefono] = useState("");
  const [etiqueta, setEtiqueta] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pendiente, iniciar] = useTransition();

  if (!abierto) {
    return (
      <Button variant="ghost" size="sm" className="mt-2" onClick={() => setAbierto(true)}>
        <Plus className="size-4" /> Agregar un número
      </Button>
    );
  }

  return (
    <form
      className="mt-3 space-y-3 rounded-md border border-border bg-muted/30 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        iniciar(async () => {
          const r = await accionAgregarDestinatario({
            tenantId: seller.tenantId,
            sellerId: seller.sellerId,
            telefono,
            etiqueta: etiqueta || null,
          });
          if (!r.ok) {
            setError(r.mensaje);
            return;
          }
          setTelefono("");
          setEtiqueta("");
          setAbierto(false);
          onAgregado();
        });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`tel-${seller.sellerId}`}>Teléfono</Label>
          <Input
            id={`tel-${seller.sellerId}`}
            value={telefono}
            onChange={(e) => setTelefono(e.target.value)}
            placeholder="+56 9 1234 5678"
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`et-${seller.sellerId}`}>Quién es (opcional)</Label>
          <Input
            id={`et-${seller.sellerId}`}
            value={etiqueta}
            onChange={(e) => setEtiqueta(e.target.value)}
            placeholder="Su pareja, su jefe de bodega…"
          />
        </div>
      </div>

      {/* No es una casilla: es la advertencia de qué estás afirmando al
          guardar, y queda con tu nombre en la bitácora. */}
      <p className="text-xs text-muted-foreground">
        Al agregarlo estás declarando que esa persona aceptó recibir estos mensajes. Queda
        registrado a tu nombre.
      </p>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pendiente}>
          {pendiente ? "Agregando…" : "Agregar"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setAbierto(false)}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}

export function TablaDestinatarios({ sellers }: { sellers: SellerConDestinatarios[] }) {
  const router = useRouter();
  const [filtro, setFiltro] = useState("");
  const [soloSinAlcance, setSoloSinAlcance] = useState(false);

  const texto = filtro.trim().toLowerCase();
  const visibles = sellers.filter((s) => {
    if (soloSinAlcance && s.destinatarios.some((d) => d.consentimiento === "otorgado")) return false;
    if (!texto) return true;
    return (
      s.sellerNombre.toLowerCase().includes(texto) || s.courierNombre.toLowerCase().includes(texto)
    );
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Input
          value={filtro}
          onChange={(e) => setFiltro(e.target.value)}
          placeholder="Buscar por seller o courier…"
          className="max-w-sm"
        />
        <Button
          variant={soloSinAlcance ? "default" : "outline"}
          size="sm"
          onClick={() => setSoloSinAlcance((v) => !v)}
        >
          Solo los que no reciben avisos
        </Button>
      </div>

      {visibles.length === 0 ? (
        <p className="rounded-lg border border-border p-6 text-center text-sm text-muted-foreground">
          Ningún seller calza con ese filtro.
        </p>
      ) : (
        <ul className="space-y-3">
          {visibles.map((s) => (
            <li key={s.sellerId} className="rounded-lg border border-border p-4">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="font-medium">{s.sellerNombre}</span>
                <span className="text-sm text-muted-foreground">· {s.courierNombre}</span>
                {s.sellerEstado === "invitado" ? (
                  // El caso silencioso: nunca entró al portal, así que no ha
                  // tenido dónde dejar su número.
                  <BadgeEstado variante="warning" texto="No ha entrado al portal" conPunto={false} />
                ) : null}
              </div>

              {s.destinatarios.length === 0 ? (
                <p className="mt-2 text-sm text-muted-foreground">
                  Sin números. Sus retiros no van a avisar a nadie.
                </p>
              ) : (
                <div className="mt-2">
                  {s.destinatarios.map((d) => (
                    <FilaDestinatario key={d.id} d={d} onCambio={() => router.refresh()} />
                  ))}
                </div>
              )}

              <FormularioAgregar seller={s} onAgregado={() => router.refresh()} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

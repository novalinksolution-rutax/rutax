"use client";

/**
 * Panel de configuración de zonas, comunas y ventanas de corte (F7, ítem 1.2).
 *
 * Sigue el mismo patrón que PanelTarifas:
 *   - Estado local inicializado desde el server component.
 *   - Server actions para mutaciones.
 *   - Tres secciones: Zonas · Comunas por zona · Ventanas de corte por seller.
 *
 * Decisión UX: tres cards separadas y colapsables para no abrumar al operador
 * que solo quiere configurar el corte de un seller sin tocar zonas.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import type { Zona } from "@/modules/operacion/tipos";
import { actionToggleZona } from "./actions";
import type { EstadoZonas } from "./actions";
import { PanelZona } from "./panel-zona";


// =============================================================================
// Tipos locales
// =============================================================================

// =============================================================================
// Panel principal
// =============================================================================

interface Props {
  estadoInicial: EstadoZonas;
}

export function PanelZonas({ estadoInicial }: Props) {
  const router = useRouter();

  return (
    <div className="space-y-6">
      {/* ⚠️ **Se recarga del servidor en vez de reconciliar en memoria.**
          Crear una zona ahora toca DOS cosas —la zona y sus comunas—, así que
          mantener una copia local exigiría reconstruir también la cobertura de
          todas las demás zonas, que es de donde sale el «6 sin zona». Un
          `router.refresh()` deja los dos datos ciertos con una consulta. */}
      <SeccionZonas zonas={estadoInicial.zonas} onCambio={() => router.refresh()} />

      {/* 🔴 Acá vivía la ventana de corte, y se fue a la ficha del seller.
          B3b: «la ventana de corte no es un destino de configuración: es un
          campo del seller, porque cada seller tiene el plazo que su courier le
          prometió». Estaba detrás de un acordeón y un selector de seller, o sea
          que para cambiarle la hora a Vega Norte había que entrar a una
          pantalla llamada «Zonas» y volver a elegir el seller que uno ya estaba
          mirando. Ver `sellers/[sellerId]/ventanas-corte-seller.tsx`. */}
    </div>
  );
}

// =============================================================================
// Sección 1: Zonas
// =============================================================================

function SeccionZonas({
  zonas,
  onCambio,
}: {
  zonas: Zona[];
  onCambio: () => void;
}) {
  /**
   * 🔴 Una sola pantalla, no dos.
   *
   * Crear la zona era un formulario de un campo arriba, y asignarle comunas un
   * acordeón aparte con SU PROPIO selector de zona: creabas «Norte», bajabas, y
   * volvías a elegir «Norte» en un desplegable. Una zona sin comunas no hace
   * nada, así que las dos mitades eran la misma tarea partida en dos.
   *
   * Ahora el listado está siempre a la vista —es un listado, no un acordeón— y
   * el alta y la edición viven en el panel, con las 52 comunas dentro.
   */
  const [nuevaAbierta, setNuevaAbierta] = useState(false);
  const [editando, setEditando] = useState<Zona | null>(null);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-heading text-base font-semibold text-fg">Zonas de cobertura</h2>
          <p className="mt-0.5 text-sm text-fg-muted">
            Agrupa comunas para cobrar distinto según dónde entregas.
          </p>
        </div>
        <Button size="sm" className="shrink-0" onClick={() => setNuevaAbierta(true)}>
          Nueva zona
        </Button>
      </div>

      {zonas.length === 0 ? (
        <p className="border border-line bg-bg-sunken px-4 py-8 text-center text-sm text-fg-muted">
          Todavía no tienes zonas. Sin ellas, todas las comunas usan la misma tarifa.
        </p>
      ) : (
        <ul className="divide-y divide-line border border-line bg-bg-raised">
          {zonas.map((zona) => (
            <FilaZona key={zona.id} zona={zona} onEditar={() => setEditando(zona)} onCambio={onCambio} />
          ))}
        </ul>
      )}

      <PanelZona
        zonas={zonas}
        abierto={nuevaAbierta}
        onOpenChange={setNuevaAbierta}
        onGuardada={onCambio}
      />
      {/* `key` por zona: sin esto, abrir la segunda mostraría los campos de la
          primera — el panel conserva su estado entre aperturas. */}
      {editando && (
        <PanelZona
          key={editando.id}
          zona={editando}
          zonas={zonas}
          abierto
          onOpenChange={(a: boolean) => {
            if (!a) setEditando(null);
          }}
          onGuardada={onCambio}
        />
      )}
    </div>
  );
}

function FilaZona({
  zona,
  onEditar,
  onCambio,
}: {
  zona: Zona;
  onEditar: () => void;
  onCambio: () => void;
}) {
  const [pendiente, iniciarTransicion] = useTransition();

  return (
    <li
      onClick={onEditar}
      className="flex cursor-pointer items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-bg-sunken"
    >
      <span className="min-w-0">
        <span className="block font-medium text-fg">{zona.nombre}</span>
        {!zona.activa && <span className="block text-xs text-fg-subtle">Desactivada</span>}
      </span>

      {/* Para la propagación: el toggle no debe abrir además el panel. */}
      <span onClick={(e) => e.stopPropagation()}>
        <Button
          variant="ghost"
          size="sm"
          disabled={pendiente}
          onClick={() =>
            iniciarTransicion(async () => {
              const r = await actionToggleZona(zona.id, !zona.activa);
              if (r.ok) onCambio();
            })
          }
        >
          {pendiente ? "…" : zona.activa ? "Desactivar" : "Reactivar"}
        </Button>
      </span>
    </li>
  );
}

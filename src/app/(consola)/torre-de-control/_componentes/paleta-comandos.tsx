"use client";

import { useMemo, useRef } from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import type { CapaMapa, Horizonte, Zona } from "../_fixture/estado-torre";
import { HORIZONTES } from "../_lib/horizontes";

interface Comando {
  id: string;
  etiqueta: string;
  ejecutar: () => void;
}

interface Props {
  abierto: boolean;
  filtro: string;
  zonas: Zona[];
  capas: { id: CapaMapa; etiqueta: string }[];
  capasActivas: CapaMapa[];
  onCambiarFiltro: (filtro: string) => void;
  onCerrar: () => void;
  onIrAZona: (zonaId: string) => void;
  onCambiarHorizonte: (h: Horizonte) => void;
  onAlternarCapa: (capa: CapaMapa) => void;
  onAlternarLista: () => void;
  onActivarMarca: () => void;
}

/**
 * Paleta de comandos (README §6). Overlay + panel custom (no el `Dialog` de
 * shadcn: ese trae los tokens de `DESIGN_SYSTEM.md` — oklch, radios,
 * `bg-popover` — que este módulo no usa). Se construye directo sobre el
 * primitivo de Radix para quedarse solo con foco/escape/portal.
 */
export function PaletaComandos({
  abierto,
  filtro,
  zonas,
  capas,
  capasActivas,
  onCambiarFiltro,
  onCerrar,
  onIrAZona,
  onCambiarHorizonte,
  onAlternarCapa,
  onAlternarLista,
  onActivarMarca,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  const comandos = useMemo<Comando[]>(() => {
    const items: Comando[] = [];
    for (const zona of zonas) {
      items.push({ id: `zona-${zona.id}`, etiqueta: `Ir a ${zona.nombre}`, ejecutar: () => onIrAZona(zona.id) });
    }
    for (const h of HORIZONTES) {
      items.push({
        id: `horizonte-${h.valor}`,
        etiqueta: `Cambiar horizonte a ${h.etiqueta}`,
        ejecutar: () => onCambiarHorizonte(h.valor),
      });
    }
    for (const capa of capas) {
      if (capasActivas.includes(capa.id)) continue;
      items.push({
        id: `capa-${capa.id}`,
        etiqueta: `Encender capa ${capa.etiqueta}`,
        ejecutar: () => onAlternarCapa(capa.id),
      });
    }
    items.push({ id: "vista-lista", etiqueta: "Vista de lista", ejecutar: onAlternarLista });
    items.push({ id: "marcar-punto", etiqueta: "Marcar un punto", ejecutar: onActivarMarca });
    return items;
  }, [zonas, capas, capasActivas, onIrAZona, onCambiarHorizonte, onAlternarCapa, onAlternarLista, onActivarMarca]);

  const filtrados = useMemo(() => {
    const q = filtro.trim().toLowerCase();
    if (!q) return comandos;
    return comandos.filter((c) => c.etiqueta.toLowerCase().includes(q));
  }, [comandos, filtro]);

  const ejecutarYCerrar = (comando: Comando) => {
    comando.ejecutar();
    onCerrar();
  };

  return (
    <DialogPrimitive.Root open={abierto} onOpenChange={(v) => !v && onCerrar()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[rgba(45,43,43,.5)]" />
        <DialogPrimitive.Content
          className="fixed top-[120px] left-1/2 z-50 w-[560px] max-w-[calc(100vw-32px)] -translate-x-1/2 border-2 border-tc-tinta bg-tc-papel shadow-tc-lg outline-none"
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            inputRef.current?.focus();
          }}
        >
          <DialogPrimitive.Title className="sr-only">Paleta de comandos</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            Saltar a una zona, cambiar horizonte, encender una capa o marcar un punto.
          </DialogPrimitive.Description>
          <input
            ref={inputRef}
            value={filtro}
            onChange={(e) => onCambiarFiltro(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && filtrados[0]) ejecutarYCerrar(filtrados[0]);
            }}
            placeholder="Saltar a una zona, cambiar horizonte, encender una capa…"
            className="w-full border-b-2 border-tc-chasis bg-transparent px-4 py-3 text-[14px] text-tc-tinta outline-none placeholder:text-tc-ink-500 focus-visible:border-tc-senal"
          />
          <ul role="listbox" aria-label="Resultados" className="max-h-[360px] overflow-y-auto tc-rail">
            {filtrados.length === 0 ? (
              <li className="px-4 py-3 text-[12px] text-tc-ink-600">Sin resultados.</li>
            ) : (
              filtrados.map((comando) => (
                <li key={comando.id} role="option" aria-selected="false">
                  <button
                    type="button"
                    onClick={() => ejecutarYCerrar(comando)}
                    className="w-full px-4 py-2.5 text-left text-[12.5px] text-tc-tinta hover:bg-tc-tinta hover:text-tc-papel focus-visible:bg-tc-tinta focus-visible:text-tc-papel focus-visible:outline-none"
                  >
                    {comando.etiqueta}
                  </button>
                </li>
              ))
            )}
          </ul>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

"use client";

/**
 * Selección de comunas donde el courier trabaja — sin mapa y sin sub-sectores
 * (decisión del usuario, 2026-09-12). Al courier le importa "trabajo con estas
 * comunas", nada más; todas juntas son su cobertura.
 *
 * Patrón: buscador con typeahead + chips removibles + preset "Gran Santiago".
 * El preset precarga el área urbana continua donde el same-day tiene sentido;
 * el courier destilda lo que no atiende.
 */

import { useMemo, useState } from "react";
import { Check, Plus, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { COMUNAS_RM } from "@/lib/ui/comunas-rm";

/**
 * El "Gran Santiago": las 32 comunas urbanas de la Provincia de Santiago más las
 * dos cabeceras que operan same-day de forma continua (Puente Alto, San
 * Bernardo). Es el preset de un clic; no es una zona aparte, solo una selección.
 */
const GRAN_SANTIAGO: readonly string[] = [
  "Cerrillos", "Cerro Navia", "Conchalí", "El Bosque", "Estación Central",
  "Huechuraba", "Independencia", "La Cisterna", "La Florida", "La Granja",
  "La Pintana", "La Reina", "Las Condes", "Lo Barnechea", "Lo Espejo",
  "Lo Prado", "Macul", "Maipú", "Ñuñoa", "Pedro Aguirre Cerda", "Peñalolén",
  "Providencia", "Pudahuel", "Quilicura", "Quinta Normal", "Recoleta", "Renca",
  "San Joaquín", "San Miguel", "San Ramón", "Santiago", "Vitacura",
  "Puente Alto", "San Bernardo",
];

export function SelectorComunas({
  seleccionadas,
  onCambio,
}: {
  seleccionadas: string[];
  onCambio: (comunas: string[]) => void;
}) {
  const [busqueda, setBusqueda] = useState("");
  const elegidas = new Set(seleccionadas);

  const sugerencias = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return [];
    return COMUNAS_RM.filter(
      (c) => c.toLowerCase().includes(q) && !elegidas.has(c),
    ).slice(0, 6);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busqueda, seleccionadas]);

  function agregar(comuna: string) {
    if (elegidas.has(comuna)) return;
    onCambio([...seleccionadas, comuna].sort((a, b) => a.localeCompare(b, "es")));
    setBusqueda("");
  }

  function quitar(comuna: string) {
    onCambio(seleccionadas.filter((c) => c !== comuna));
  }

  function agregarGranSantiago() {
    const union = new Set([...seleccionadas, ...GRAN_SANTIAGO]);
    onCambio([...union].sort((a, b) => a.localeCompare(b, "es")));
  }

  const faltanDelPreset = GRAN_SANTIAGO.some((c) => !elegidas.has(c));

  return (
    <div className="space-y-4">
      <div className="relative">
        <Input
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Escribe una comuna…"
          aria-label="Buscar comuna"
          autoComplete="off"
        />
        {sugerencias.length > 0 ? (
          <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-md border border-border bg-popover shadow-md">
            {sugerencias.map((c) => (
              <li key={c}>
                <button
                  type="button"
                  onClick={() => agregar(c)}
                  className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-muted"
                >
                  {c}
                  <Plus className="size-4 text-muted-foreground" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={agregarGranSantiago}
          disabled={!faltanDelPreset}
        >
          {faltanDelPreset ? (
            <>
              <Plus className="mr-1.5 size-4" aria-hidden="true" />
              Agregar el Gran Santiago
            </>
          ) : (
            <>
              <Check className="mr-1.5 size-4" aria-hidden="true" />
              Gran Santiago agregado
            </>
          )}
        </Button>
        <span className="text-sm text-muted-foreground">
          {seleccionadas.length === 0
            ? "Ninguna comuna todavía"
            : `${seleccionadas.length} ${seleccionadas.length === 1 ? "comuna" : "comunas"}`}
        </span>
      </div>

      {seleccionadas.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {seleccionadas.map((c) => (
            <Badge key={c} variant="secondary" className="gap-1 py-1 pl-2.5 pr-1">
              {c}
              <button
                type="button"
                onClick={() => quitar(c)}
                aria-label={`Quitar ${c}`}
                className="ml-0.5 rounded-full p-0.5 hover:bg-background"
              >
                <X className="size-3" aria-hidden="true" />
              </button>
            </Badge>
          ))}
        </div>
      ) : null}
    </div>
  );
}

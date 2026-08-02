"use client";

/**
 * Paleta de comando (⌘K) — buscador global del backoffice del courier.
 * =====================================================================
 * Type-ahead sobre pedidos, sellers y conductores. Componente CONTROLADO
 * (`abierta`/`onAbrirCambio`) para que el disparador viva en el AppShell y el
 * atajo global ⌘K/Ctrl+K también la abra. La seguridad la impone el endpoint
 * `/api/buscar` (tenant-scope + RBAC); aquí solo se presenta y navega.
 *
 * Diseño alineado con las reglas de React del repo:
 *   - El contenido se monta SOLO cuando está abierta → estado fresco en cada
 *     apertura, sin efecto de "reset" (evita setState síncrono en efecto).
 *   - El atajo global vive en un efecto sin setState (llama a `onAbrirCambio`).
 *   - Todo cambio de estado de la búsqueda ocurre dentro del temporizador async.
 *
 * Teclado: ⌘K abre/cierra · Esc cierra · ↑/↓ mueven el resaltado · Enter navega.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, Package, Store, UserCheck, Wallet, Loader2, CornerDownLeft } from "lucide-react";
import type { GrupoResultado, RespuestaBusqueda, TipoResultado } from "@/lib/buscar/tipos";

const ICONO_TIPO: Record<TipoResultado, typeof Package> = {
  pedido: Package,
  seller: Store,
  conductor: UserCheck,
  liquidacion: Wallet,
};

export function PaletaComando({
  abierta,
  onAbrirCambio,
}: {
  abierta: boolean;
  onAbrirCambio: (v: boolean) => void;
}) {
  // Atajo global ⌘K / Ctrl+K. El listener se re-suscribe al cambiar `abierta`
  // (barato) para leer el valor actual sin refs durante el render.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        onAbrirCambio(!abierta);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [abierta, onAbrirCambio]);

  if (!abierta) return null;
  return <PaletaContenido onCerrar={() => onAbrirCambio(false)} />;
}

function PaletaContenido({ onCerrar }: { onCerrar: () => void }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [grupos, setGrupos] = useState<GrupoResultado[]>([]);
  const [cargando, setCargando] = useState(false);
  const [resaltado, setResaltado] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const q = query.trim();
  const busca = q.length >= 2;
  const gruposMostrados = useMemo(() => (busca ? grupos : []), [busca, grupos]);

  // Lista plana para navegación por teclado (se renderiza agrupada).
  const planos = useMemo(
    () =>
      gruposMostrados.flatMap((g) =>
        g.items.map((item) => ({ id: item.id, href: item.href, tipo: g.tipo })),
      ),
    [gruposMostrados],
  );

  // Foco al montar (el contenido se monta fresco en cada apertura).
  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 20);
    return () => clearTimeout(t);
  }, []);

  // Búsqueda con debounce + cancelación. Sin setState SÍNCRONO en el cuerpo del
  // efecto: todo cambio de estado ocurre dentro del temporizador (async).
  useEffect(() => {
    if (q.length < 2) return;
    const controlador = new AbortController();
    const t = setTimeout(async () => {
      setCargando(true);
      try {
        const resp = await fetch(`/api/buscar?q=${encodeURIComponent(q)}`, {
          signal: controlador.signal,
        });
        if (!resp.ok) throw new Error("busqueda");
        const data = (await resp.json()) as RespuestaBusqueda;
        setGrupos(data.grupos ?? []);
        setResaltado(0);
      } catch (e) {
        if (!(e instanceof DOMException && e.name === "AbortError")) setGrupos([]);
      } finally {
        setCargando(false);
      }
    }, 250);
    return () => {
      clearTimeout(t);
      controlador.abort();
    };
  }, [q]);

  function navegar(href: string) {
    onCerrar();
    router.push(href);
  }

  function onInputKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      onCerrar();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setResaltado((i) => Math.min(i + 1, Math.max(planos.length - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setResaltado((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = planos[resaltado];
      if (item) navegar(item.href);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[10vh]"
      role="dialog"
      aria-modal="true"
      aria-label="Buscar"
    >
      <div className="absolute inset-0 bg-black/10 supports-backdrop-filter:backdrop-blur-xs" onClick={onCerrar} aria-hidden="true" />
      <div className="relative z-10 w-full max-w-xl overflow-hidden rounded-xl bg-popover ring-1 ring-foreground/10">
        {/* Campo de búsqueda */}
        <div className="flex items-center gap-2 border-b border-border px-4">
          <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onInputKeyDown}
            placeholder="Buscar pedidos, sellers o conductores…"
            className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            aria-label="Término de búsqueda"
            autoComplete="off"
            spellCheck={false}
          />
          {cargando && (
            <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" aria-hidden="true" />
          )}
        </div>

        {/* Resultados */}
        <div className="max-h-[50vh] overflow-y-auto py-2">
          {!busca ? (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">
              Escribe al menos 2 letras para buscar.
            </p>
          ) : !cargando && planos.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">
              Sin resultados para “{q}”.
            </p>
          ) : (
            gruposMostrados.map((grupo) => {
              const Icono = ICONO_TIPO[grupo.tipo];
              return (
                <div key={grupo.tipo} className="mb-1">
                  <p className="px-4 py-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                    {grupo.titulo}
                  </p>
                  {grupo.items.map((item) => {
                    const idx = planos.findIndex((p) => p.tipo === grupo.tipo && p.id === item.id);
                    const activo = idx === resaltado;
                    return (
                      <button
                        key={`${grupo.tipo}-${item.id}`}
                        type="button"
                        onClick={() => navegar(item.href)}
                        onMouseMove={() => setResaltado(idx)}
                        className={`flex w-full items-center gap-3 px-4 py-2 text-left text-sm transition-colors ${
                          activo ? "bg-muted" : "hover:bg-muted/50"
                        }`}
                      >
                        <Icono className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">{item.titulo}</span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {item.subtitulo}
                          </span>
                        </span>
                        {activo && (
                          <CornerDownLeft
                            className="size-3.5 shrink-0 text-muted-foreground"
                            aria-hidden="true"
                          />
                        )}
                      </button>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

"use client";

/**
 * Paso 4 — Zonas y tarifas (docs/ux/puesta-en-marcha-v2.md §3.7 y §14).
 * =============================================================================
 * Es el primer contacto con el motor entrega→dinero, y la única pantalla ancha.
 * Los montos son NETOS, sin IVA (§14 Q3); los sugeridos salen de UNA constante
 * (`ZONAS_SUGERIDAS`).
 *
 * Reparto de trabajo:
 *   · Escritorio: mapa/lista a la izquierda, tarjetas de zona a la derecha.
 *   · Móvil: primero las tarjetas; `Ver comunas` abre una hoja con la Lista. No
 *     se pinta sobre un mapa de 320 px, y el mapa ni siquiera se monta (no gasta
 *     datos en cargar un plano que no se va a ver).
 *   · La Lista es la vía por teclado y la única en móvil.
 *
 * El guardado (zonas + comunas + tarifas + avance del paso) es una sola
 * operación atómica en el servidor; ver `guardarPasoTarifas`.
 */

import { useId, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { HojaInferior } from "@/components/ui/hoja-inferior";
import { Input } from "@/components/ui/input";
import { Interruptor } from "@/components/ui/interruptor";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import type { FuentePedido } from "@/modules/operacion/tipos";
import { guardarPasoTarifas } from "./actions";
import { coloresDeZona, MapaZonas } from "./mapa-zonas";
import { PieDePaso } from "./pie-de-paso";
import {
  alternarZona,
  asignarZona,
  calcularMargen,
  comunasDe,
  construirEntrada,
  filtrarComunas,
  ETIQUETA_PLATAFORMA,
  miles,
  montosDeExcepcion,
  parsearMonto,
  pesos,
  validarPaso4,
  zonaOpuesta,
  type EstadoPaso4,
  type ErroresPaso4,
  type NumeroZona,
} from "./zonas-tarifas";

const MEDIA_ESCRITORIO = "(min-width: 1024px)";

function useEscritorio(): boolean {
  return useSyncExternalStore(
    (avisar) => {
      const mq = window.matchMedia(MEDIA_ESCRITORIO);
      mq.addEventListener("change", avisar);
      return () => mq.removeEventListener("change", avisar);
    },
    () => window.matchMedia(MEDIA_ESCRITORIO).matches,
    () => false,
  );
}

// -----------------------------------------------------------------------------
// Piezas
// -----------------------------------------------------------------------------

function Muestra({ color }: { color: string }) {
  return <span aria-hidden="true" className="inline-block size-3 shrink-0 rounded-[2px]" style={{ backgroundColor: color }} />;
}

function CampoMonto({
  etiqueta,
  valor,
  onCambio,
  error,
  describedBy,
  compacto = false,
}: {
  etiqueta: string;
  valor: number | null;
  onCambio: (v: number | null) => void;
  error?: string;
  describedBy?: string;
  compacto?: boolean;
}) {
  const id = useId();
  return (
    <div className="min-w-0 space-y-1">
      <Label htmlFor={id} className={cn(compacto && "text-xs text-fg-muted")}>
        {etiqueta}
      </Label>
      <div className="relative">
        <span aria-hidden="true" className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-fg-muted">
          $
        </span>
        <Input
          id={id}
          inputMode="numeric"
          autoComplete="off"
          value={miles(valor)}
          onChange={(e) => onCambio(parsearMonto(e.target.value))}
          aria-invalid={error ? true : undefined}
          aria-describedby={cn(describedBy, error && `${id}-error`) || undefined}
          className={cn("pl-6 tabular-nums pointer-coarse:h-12", compacto && "h-7")}
        />
      </div>
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-xs text-fault-fg">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function TeQueda({ cobro, pago, compacto = false }: { cobro: number | null; pago: number | null; compacto?: boolean }) {
  const margen = calcularMargen(cobro, pago);
  const atencion = margen !== null && margen.monto <= 0;
  return (
    <div className="min-w-0 space-y-1">
      <div className={cn("text-sm font-medium", compacto && "text-xs font-normal text-fg-muted")}>Te queda</div>
      <div
        className={cn(
          "flex min-h-8 flex-wrap items-baseline gap-x-1.5 tabular-nums pointer-coarse:min-h-12 pointer-coarse:items-center",
          compacto ? "text-sm" : "text-base font-medium",
          atencion && "text-attention-fg",
        )}
      >
        {margen === null ? (
          <span aria-label="Sin cálculo">—</span>
        ) : (
          <>
            <span>{pesos(margen.monto)}</span>
            {margen.porcentaje !== null ? (
              <span className="text-xs font-normal">({margen.porcentaje} %)</span>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

function AvisoPerdida({ cobro, pago }: { cobro: number | null; pago: number | null }) {
  const margen = calcularMargen(cobro, pago);
  const texto = margen !== null && margen.monto < 0 ? `Pierdes ${pesos(-margen.monto)} por entrega.` : null;
  // La región queda montada siempre: un aviso que aparece en una región nueva no
  // se anuncia; en una región que ya existe, sí.
  return (
    <p aria-live="polite" className={cn("text-sm text-attention-fg", !texto && "sr-only")}>
      {texto}
    </p>
  );
}

function TarjetaZona({
  n,
  estado,
  plataformas,
  errores,
  colores,
  onNombre,
  onMonto,
  onMontoExcepcion,
}: {
  n: NumeroZona;
  estado: EstadoPaso4;
  plataformas: readonly FuentePedido[];
  errores: ErroresPaso4;
  colores: Record<NumeroZona, string>;
  onNombre: (n: NumeroZona, v: string) => void;
  onMonto: (n: NumeroZona, campo: "cobro" | "pago", v: number | null) => void;
  onMontoExcepcion: (n: NumeroZona, f: FuentePedido, campo: "cobro" | "pago", v: number | null) => void;
}) {
  const idTitulo = useId();
  const zona = n === 1 ? estado.zona1 : estado.zona2;
  const cantidad = comunasDe(estado.asignacion, n).length;

  return (
    <section aria-labelledby={idTitulo} className="border border-line bg-bg p-4">
      <div className="flex items-center gap-2">
        <Muestra color={colores[n]} />
        <h2 id={idTitulo} className="shrink-0 text-sm font-medium">
          Zona {n} ·
        </h2>
        <Input
          value={zona.nombre}
          onChange={(e) => onNombre(n, e.target.value)}
          aria-label={`Nombre de la zona ${n}`}
          aria-invalid={errores.nombre[n] ? true : undefined}
          className="h-8 min-w-0 flex-1 border-transparent px-1.5 text-sm font-medium hover:border-input pointer-coarse:h-12"
        />
        <span className="shrink-0 text-sm tabular-nums text-fg-muted" aria-label={`${cantidad} comunas`}>
          {cantidad}
        </span>
      </div>
      {errores.nombre[n] ? (
        <p role="alert" className="mt-1 text-xs text-fault-fg">
          {errores.nombre[n]}
        </p>
      ) : null}
      {errores.comunas[n] ? (
        <p role="alert" className="mt-1 text-xs text-fault-fg">
          {errores.comunas[n]}
        </p>
      ) : null}

      <div className="mt-4 grid grid-cols-3 gap-3">
        <CampoMonto
          etiqueta="Cobras"
          valor={zona.cobro}
          onCambio={(v) => onMonto(n, "cobro", v)}
          error={errores.cobro[n]}
          describedBy={idTitulo}
        />
        <CampoMonto
          etiqueta="Pagas"
          valor={zona.pago}
          onCambio={(v) => onMonto(n, "pago", v)}
          error={errores.pago[n]}
          describedBy={idTitulo}
        />
        <TeQueda cobro={zona.cobro} pago={zona.pago} />
      </div>
      <AvisoPerdida cobro={zona.cobro} pago={zona.pago} />

      {estado.diferenciar ? (
        <div className="mt-4 space-y-3 border-t border-line pt-3">
          {plataformas.map((f) => {
            const m = montosDeExcepcion(estado, n, f);
            const e = errores.excepciones[`${n}:${f}`];
            return (
              <div key={f} role="group" aria-label={`${ETIQUETA_PLATAFORMA[f]}, zona ${n}`}>
                <div className="mb-1.5 text-sm">{ETIQUETA_PLATAFORMA[f]}</div>
                <div className="grid grid-cols-3 gap-3">
                  <CampoMonto
                    compacto
                    etiqueta="Cobras"
                    valor={m.cobro}
                    onCambio={(v) => onMontoExcepcion(n, f, "cobro", v)}
                    error={e?.cobro}
                    describedBy={idTitulo}
                  />
                  <CampoMonto
                    compacto
                    etiqueta="Pagas"
                    valor={m.pago}
                    onCambio={(v) => onMontoExcepcion(n, f, "pago", v)}
                    error={e?.pago}
                    describedBy={idTitulo}
                  />
                  <TeQueda compacto cobro={m.cobro} pago={m.pago} />
                </div>
                <AvisoPerdida cobro={m.cobro} pago={m.pago} />
              </div>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}

/**
 * Lista de comunas: buscador arriba y una fila por comuna, en orden alfabético
 * estable. Cada fila lleva su selector Zona 1 | Zona 2; cambiarlo NO mueve la
 * fila, así que el foco y la posición de lectura se quedan donde están.
 */
function SelectorZona({
  comuna,
  zona,
  colores,
  onElegir,
}: {
  comuna: string;
  zona: NumeroZona;
  colores: Record<NumeroZona, string>;
  onElegir: (comuna: string, zona: NumeroZona) => void;
}) {
  const refs = useRef<Record<NumeroZona, HTMLButtonElement | null>>({ 1: null, 2: null });

  function alTeclear(e: React.KeyboardEvent) {
    const paso =
      e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!paso) return;
    e.preventDefault();
    const destino = zonaOpuesta(zona);
    onElegir(comuna, destino);
    refs.current[destino]?.focus();
  }

  return (
    <div
      role="radiogroup"
      aria-label={`Zona de ${comuna}`}
      onKeyDown={alTeclear}
      className="inline-flex shrink-0 overflow-hidden rounded-[3px] border border-line"
    >
      {([1, 2] as const).map((n) => {
        const activa = zona === n;
        return (
          <button
            key={n}
            ref={(el) => {
              refs.current[n] = el;
            }}
            type="button"
            role="radio"
            aria-checked={activa}
            tabIndex={activa ? 0 : -1}
            onClick={() => onElegir(comuna, n)}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 px-2.5 text-xs outline-none focus-visible:relative focus-visible:ring-3 focus-visible:ring-ring/50 pointer-coarse:h-11 pointer-coarse:px-3.5",
              n === 2 && "border-l border-line",
              activa ? "bg-bg-sunken font-medium text-fg" : "text-fg-muted hover:bg-bg-sunken",
            )}
          >
            <Muestra color={activa ? colores[n] : "transparent"} />
            Zona {n}
          </button>
        );
      })}
    </div>
  );
}

function ListaComunas({
  estado,
  colores,
  onElegir,
}: {
  estado: EstadoPaso4;
  colores: Record<NumeroZona, string>;
  onElegir: (comuna: string, zona: NumeroZona) => void;
}) {
  const [consulta, setConsulta] = useState("");
  const idBusqueda = useId();
  const visibles = filtrarComunas(consulta);

  return (
    <div>
      <div className="sticky top-0 z-10 space-y-2 bg-bg pb-2">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          {([1, 2] as const).map((n) => {
            const zona = n === 1 ? estado.zona1 : estado.zona2;
            return (
              <span key={n} className="inline-flex min-w-0 items-center gap-2">
                <Muestra color={colores[n]} />
                <span className="truncate font-medium">
                  Zona {n} · {zona.nombre}
                </span>
                <span className="tabular-nums text-fg-muted">{comunasDe(estado.asignacion, n).length}</span>
              </span>
            );
          })}
        </div>
        <Label htmlFor={idBusqueda} className="sr-only">
          Buscar comuna
        </Label>
        <Input
          id={idBusqueda}
          type="search"
          value={consulta}
          onChange={(e) => setConsulta(e.target.value)}
          placeholder="Buscar comuna"
          autoComplete="off"
          className="pointer-coarse:h-12"
        />
      </div>

      {visibles.length === 0 ? (
        <p role="status" className="py-6 text-center text-sm text-fg-muted">
          Sin resultados.
        </p>
      ) : (
        <ul>
          {visibles.map((c) => {
            const zona = estado.asignacion[c] ?? 2;
            return (
              <li
                key={c}
                className="flex min-h-11 items-center justify-between gap-3 border-b border-line py-1 pl-2.5"
                style={{ boxShadow: `inset 3px 0 0 ${colores[zona]}` }}
              >
                <span className="min-w-0 truncate text-sm">{c}</span>
                <SelectorZona comuna={c} zona={zona} colores={colores} onElegir={onElegir} />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Paso
// -----------------------------------------------------------------------------

export function PasoTarifas({
  inicial,
  plataformas,
}: {
  inicial: EstadoPaso4;
  plataformas: readonly FuentePedido[];
}) {
  const router = useRouter();
  const { resolvedTheme } = useTheme();
  const colores = coloresDeZona(resolvedTheme === "dark" ? "oscuro" : "claro");
  const escritorio = useEscritorio();
  const formRef = useRef<HTMLDivElement>(null);

  const [estado, setEstado] = useState<EstadoPaso4>(inicial);
  const [anuncio, setAnuncio] = useState("");
  const [vista, setVista] = useState<"mapa" | "lista">("mapa");
  const [hojaAbierta, setHojaAbierta] = useState(false);
  const [mapaFallo, setMapaFallo] = useState(false);
  const [intentado, setIntentado] = useState(false);
  const [errorGuardado, setErrorGuardado] = useState<string | null>(null);
  const [pendiente, iniciar] = useTransition();

  const validacion = validarPaso4(estado, plataformas);
  const errores: ErroresPaso4 = intentado
    ? validacion.errores
    : { nombre: {}, cobro: {}, pago: {}, comunas: {}, excepciones: {} };

  function elegirZona(comuna: string, zona: NumeroZona) {
    if (estado.asignacion[comuna] === zona) return;
    setEstado((e) => ({ ...e, asignacion: asignarZona(e.asignacion, comuna, zona) }));
    setAnuncio(`${comuna}: Zona ${zona}`);
  }
  function alternar(comuna: string) {
    const actual = estado.asignacion[comuna];
    if (actual === undefined) return;
    setEstado((e) => ({ ...e, asignacion: alternarZona(e.asignacion, comuna) }));
    setAnuncio(`${comuna}: Zona ${zonaOpuesta(actual)}`);
  }
  function cambiarNombre(n: NumeroZona, valor: string) {
    setEstado((e) => (n === 1 ? { ...e, zona1: { ...e.zona1, nombre: valor } } : { ...e, zona2: { ...e.zona2, nombre: valor } }));
  }
  function cambiarMonto(n: NumeroZona, campo: "cobro" | "pago", valor: number | null) {
    setEstado((e) => (n === 1 ? { ...e, zona1: { ...e.zona1, [campo]: valor } } : { ...e, zona2: { ...e.zona2, [campo]: valor } }));
  }
  function cambiarMontoExcepcion(n: NumeroZona, f: FuentePedido, campo: "cobro" | "pago", valor: number | null) {
    setEstado((e) => {
      const actual = montosDeExcepcion(e, n, f);
      return { ...e, excepciones: { ...e.excepciones, [`${n}:${f}`]: { ...actual, [campo]: valor } } };
    });
  }

  function continuar() {
    if (pendiente) return;
    setErrorGuardado(null);
    setIntentado(true);
    if (!validacion.ok) {
      // Foco al primer campo con error, cuando el DOM ya lo marcó.
      requestAnimationFrame(() => {
        formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
      });
      // Si lo que falta son comunas en una zona, el aviso está a la vista en la tarjeta.
      return;
    }
    iniciar(async () => {
      const r = await guardarPasoTarifas(construirEntrada(estado, plataformas));
      if (!r.ok) {
        setErrorGuardado(r.mensaje);
        return;
      }
      router.push("/puesta-en-marcha?paso=5");
    });
  }

  const leyenda = ([1, 2] as const).map((n) => ({
    n,
    nombre: (n === 1 ? estado.zona1 : estado.zona2).nombre,
    cantidad: comunasDe(estado.asignacion, n).length,
  }));

  return (
    <>
      <h1 className="font-heading text-2xl font-semibold">Zonas y tarifas</h1>

      <div ref={formRef} className="mt-7 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
        {/* Izquierda: solo escritorio. En móvil ni se monta el mapa. */}
        <div className="hidden lg:order-first lg:block">
          {escritorio ? (
            <Tabs value={mapaFallo ? "lista" : vista} onValueChange={(v) => setVista(v as "mapa" | "lista")}>
              <TabsList variant="line" className="w-fit">
                <TabsTrigger value="mapa" disabled={mapaFallo}>
                  Mapa
                </TabsTrigger>
                <TabsTrigger value="lista">Lista</TabsTrigger>
              </TabsList>
              <TabsContent value="mapa" className="space-y-3 pt-2">
                <MapaZonas
                  asignacion={estado.asignacion}
                  leyenda={leyenda}
                  onAlternar={alternar}
                  onError={() => setMapaFallo(true)}
                  altura={440}
                  etiqueta="Mapa de comunas por zona"
                />
              </TabsContent>
              <TabsContent value="lista" className="max-h-[520px] overflow-y-auto pt-3 pr-1">
                {mapaFallo ? <p className="mb-3 text-sm text-fg-muted">No pudimos cargar el mapa.</p> : null}
                <ListaComunas estado={estado} colores={colores} onElegir={elegirZona} />
              </TabsContent>
            </Tabs>
          ) : (
            <Skeleton className="h-[480px] w-full rounded-md" />
          )}
        </div>

        {/* Derecha (y primero en móvil): las dos zonas y sus cifras. */}
        <div className="min-w-0 space-y-4">
          <TarjetaZona
            n={1}
            estado={estado}
            plataformas={plataformas}
            errores={errores}
            colores={colores}
            onNombre={cambiarNombre}
            onMonto={cambiarMonto}
            onMontoExcepcion={cambiarMontoExcepcion}
          />
          <TarjetaZona
            n={2}
            estado={estado}
            plataformas={plataformas}
            errores={errores}
            colores={colores}
            onNombre={cambiarNombre}
            onMonto={cambiarMonto}
            onMontoExcepcion={cambiarMontoExcepcion}
          />

          <Interruptor
            etiqueta="Diferenciar por plataforma"
            checked={estado.diferenciar}
            onCheckedChange={(v) => setEstado((e) => ({ ...e, diferenciar: v }))}
            disabled={pendiente}
            className="items-center"
          />

          <Button
            type="button"
            variant="outline"
            className="w-full lg:hidden pointer-coarse:h-12"
            onClick={() => setHojaAbierta(true)}
          >
            Ver comunas
          </Button>

          {errorGuardado ? (
            <p role="alert" className="text-sm text-fault-fg">
              {errorGuardado}
            </p>
          ) : null}
        </div>
      </div>

      <HojaInferior abierta={hojaAbierta && !escritorio} onOpenChange={setHojaAbierta} titulo="Comunas">
        <div className="px-4 pb-6">
          <ListaComunas estado={estado} colores={colores} onElegir={elegirZona} />
        </div>
      </HojaInferior>

      <p aria-live="polite" className="sr-only">
        {anuncio}
      </p>

      <PieDePaso volverAPaso={3} etiqueta="Continuar" cargando={pendiente} onClick={continuar} />
    </>
  );
}

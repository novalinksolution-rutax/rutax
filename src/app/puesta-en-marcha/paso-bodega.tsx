"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { COMUNAS_RM } from "@/lib/ui/comunas-rm";
import { guardarPasoBodega, previsualizarUbicacion } from "./actions";
import { MapaPin, type PuntoMapa } from "./mapa-pin";
import { PieDePaso } from "./pie-de-paso";
import { dentroDeLaRegion } from "./region";

type EstadoUbicacion =
  | "vacio"
  | "ubicando"
  | "resuelto"
  | "no_resuelto"
  | "fuera_de_region"
  | "error";

const MS_TARDANZA = 4000;
const CLASE_SELECT =
  "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm pointer-coarse:h-12";

export function PasoBodega({
  inicial,
}: {
  inicial: { direccion: string; comuna: string; punto: PuntoMapa | null };
}) {
  const router = useRouter();
  const id = useId();
  const [direccion, setDireccion] = useState(inicial.direccion);
  const [comuna, setComuna] = useState(inicial.comuna);
  const [punto, setPunto] = useState<PuntoMapa | null>(inicial.punto);
  const [estado, setEstado] = useState<EstadoUbicacion>(inicial.punto ? "resuelto" : "vacio");
  const [tarda, setTarda] = useState(false);
  const [errorGuardado, setErrorGuardado] = useState<string | null>(null);
  const [guardando, iniciarGuardado] = useTransition();
  const peticion = useRef(0);
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ultimaConsulta = useRef(`${inicial.direccion}|${inicial.comuna}`);

  useEffect(
    () => () => {
      if (temporizador.current) clearTimeout(temporizador.current);
    },
    [],
  );

  async function ubicar(dir: string, com: string) {
    if (!dir.trim() || !com) return;
    const clave = `${dir.trim()}|${com}`;
    if (clave === ultimaConsulta.current && estado !== "error") return;
    ultimaConsulta.current = clave;

    const mia = ++peticion.current;
    setEstado("ubicando");
    setTarda(false);
    setErrorGuardado(null);
    if (temporizador.current) clearTimeout(temporizador.current);
    temporizador.current = setTimeout(() => {
      if (peticion.current === mia) setTarda(true);
    }, MS_TARDANZA);

    const r = await previsualizarUbicacion(dir, com);
    if (peticion.current !== mia) return; // llegó tarde: otra consulta la reemplazó
    if (temporizador.current) clearTimeout(temporizador.current);
    setTarda(false);
    if (r.estado === "resuelto") {
      // Re-geocodificar descarta el ajuste manual (§3.5).
      setPunto({ lat: r.lat, long: r.long });
      setEstado("resuelto");
    } else {
      setPunto(null);
      setEstado(r.estado);
    }
  }

  function moverPin(p: PuntoMapa) {
    if (!dentroDeLaRegion(p.lat, p.long)) {
      setEstado("fuera_de_region");
      return;
    }
    peticion.current++; // cancela cualquier geocoding en vuelo
    setTarda(false);
    setPunto(p);
    setEstado("resuelto");
  }

  function confirmar() {
    if (!punto || guardando) return;
    setErrorGuardado(null);
    iniciarGuardado(async () => {
      const r = await guardarPasoBodega({ direccion, comuna, lat: punto.lat, long: punto.long });
      if (!r.ok) {
        setErrorGuardado(r.mensaje);
        return;
      }
      router.push("/puesta-en-marcha?paso=3");
    });
  }

  const mensaje =
    estado === "no_resuelto"
      ? "No encontramos esa dirección. Toca el mapa para ubicarla."
      : estado === "fuera_de_region"
        ? "Esa dirección está fuera de la Región Metropolitana."
        : estado === "error"
          ? "No pudimos ubicarla. Reintenta o toca el mapa."
          : tarda
            ? "Está tardando."
            : null;

  return (
    <>
      <h1 className="font-heading text-2xl font-semibold">Tu bodega</h1>
      <form
        className="mt-7 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (estado === "resuelto") confirmar();
          else void ubicar(direccion, comuna);
        }}
      >
        <div className="grid gap-4 sm:grid-cols-[1fr_180px]">
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-direccion`}>Dirección</Label>
            <div className="relative">
              <Input
                id={`${id}-direccion`}
                autoFocus
                autoComplete="street-address"
                enterKeyHint="next"
                value={direccion}
                onChange={(e) => setDireccion(e.target.value)}
                onBlur={() => void ubicar(direccion, comuna)}
                className="pr-8 pointer-coarse:h-12"
              />
              {estado === "ubicando" ? (
                <Loader2
                  className="absolute top-1/2 right-2 size-4 -translate-y-1/2 animate-spin text-fg-muted"
                  aria-hidden="true"
                />
              ) : null}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-comuna`}>Comuna</Label>
            <select
              id={`${id}-comuna`}
              value={comuna}
              onChange={(e) => {
                setComuna(e.target.value);
                void ubicar(direccion, e.target.value);
              }}
              className={CLASE_SELECT}
            >
              <option value="" disabled />
              {COMUNAS_RM.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        </div>

        <MapaPin punto={punto} onMover={moverPin} etiqueta="Mapa de la bodega" altura={280} />

        <div aria-live="polite" className="min-h-5 text-sm">
          {mensaje ? (
            <p role={estado === "ubicando" ? undefined : "alert"} className={estado === "ubicando" ? "text-fg-muted" : "text-fault-fg"}>
              {mensaje}
            </p>
          ) : estado === "resuelto" ? (
            <p className="text-fg-muted">Arrastra el pin si no está exacto.</p>
          ) : null}
        </div>

        {estado === "error" ? (
          <Button type="button" variant="outline" size="sm" onClick={() => { ultimaConsulta.current = ""; void ubicar(direccion, comuna); }}>
            Reintentar
          </Button>
        ) : null}

        {errorGuardado ? (
          <p role="alert" className="text-sm text-fault-fg">
            {errorGuardado}
          </p>
        ) : null}
      </form>
      <PieDePaso
        volverAPaso={1}
        etiqueta="Confirmar ubicación"
        cargando={guardando}
        deshabilitado={estado !== "resuelto" || !punto}
        onClick={confirmar}
      />
    </>
  );
}

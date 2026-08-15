"use client";

/**
 * Orquestador de pantalla del punto de término — las cuatro pantallas de
 * `docs/ux/copy-consentimiento-punto-termino.md` (§1 consentimiento, §2
 * guardado, §3 confirmación de borrado, §5 rechazo) en un solo componente
 * cliente con estado local, sin rutas nuevas por paso.
 *
 * El texto es LITERAL del documento de copy — no se reescribe. Si algo suena
 * raro, el arreglo va en el documento, no acá.
 *
 * Estado y flujo:
 *   consentimiento (§1) → "Marcar mi punto" → mapa → guarda → guardado (§2)
 *                       → "Mejor no"        → rechazado (§5)
 *   guardado (§2) → "Marcar otro punto" → mapa → guarda → guardado (§2)
 *                 → "Quitar mi punto de término" → diálogo (§3) → consentimiento
 *
 * "Marcar otro punto" NO vuelve a mostrar el consentimiento completo: el
 * conductor ya lo vio y ya lo aceptó una vez (así lo pide §2 del copy — el
 * botón "Cambiar" lleva directo al mapa). En el servidor, redefinir el punto
 * **no** vuelve a registrar consentimiento si ya hay uno vigente: consintió una
 * vez, después solo cambió de casa (el porqué, con la trampa que evita, está en
 * `actions.ts`).
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { MapPinOff } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { TemaMapa } from "@/app/(tenant)/torre-de-control/_lib/mapa/paleta";
import type { PuntoTerminoConductor } from "@/modules/operacion/punto-termino-conductor";
import { accionGuardarPuntoTermino, accionQuitarPuntoTermino } from "../actions";
import { MapaPuntoTermino, type CoordenadaPin } from "./mapa-punto-termino";

type Paso = "consentimiento" | "mapa" | "guardado" | "rechazado";

interface Props {
  puntoInicial: PuntoTerminoConductor | null;
}

export function FlujoPuntoTermino({ puntoInicial }: Props) {
  const router = useRouter();
  const { resolvedTheme } = useTheme();
  const tema: TemaMapa = resolvedTheme === "dark" ? "oscuro" : "claro";

  const [paso, setPaso] = useState<Paso>(puntoInicial ? "guardado" : "consentimiento");
  const [puntoActual, setPuntoActual] = useState<PuntoTerminoConductor | null>(puntoInicial);
  const [pinCandidato, setPinCandidato] = useState<CoordenadaPin | null>(
    puntoInicial ? { lat: puntoInicial.lat, long: puntoInicial.long } : null,
  );
  const [error, setError] = useState<string | null>(null);
  const [dialogoQuitarAbierto, setDialogoQuitarAbierto] = useState(false);
  const [pendingGuardar, startGuardar] = useTransition();
  const [pendingQuitar, startQuitar] = useTransition();

  function irAlMapa() {
    setError(null);
    setPinCandidato(puntoActual ? { lat: puntoActual.lat, long: puntoActual.long } : null);
    setPaso("mapa");
  }

  function handleGuardar() {
    if (!pinCandidato) return;
    setError(null);
    startGuardar(async () => {
      const resultado = await accionGuardarPuntoTermino(pinCandidato.lat, pinCandidato.long);
      if (!resultado.ok || !resultado.punto) {
        setError(resultado.mensaje ?? "No pudimos guardar tu punto de término. Inténtalo de nuevo.");
        return;
      }
      setPuntoActual(resultado.punto);
      setPaso("guardado");
      // El estado corto vive en el menú de cuenta (Server Component del
      // layout): sin esto, el header seguiría mostrando "No configurado"
      // hasta la próxima navegación completa.
      router.refresh();
    });
  }

  function handleQuitar() {
    setError(null);
    startQuitar(async () => {
      const resultado = await accionQuitarPuntoTermino();
      setDialogoQuitarAbierto(false);
      if (!resultado.ok) {
        setError(resultado.mensaje ?? "No pudimos quitar tu punto de término. Inténtalo de nuevo.");
        return;
      }
      setPuntoActual(null);
      setPinCandidato(null);
      setPaso("consentimiento");
      router.refresh();
    });
  }

  const avisoError = error ? (
    <p role="alert" className="rounded-lg bg-destructive-subtle px-3 py-2 text-sm text-destructive-subtle-foreground">
      {error}
    </p>
  ) : null;

  // ---------------------------------------------------------------------------
  // §5 — Flujo de rechazo
  // ---------------------------------------------------------------------------
  if (paso === "rechazado") {
    return (
      <div className="flex flex-col items-center gap-4 pb-8 pt-4 text-center">
        <div className="flex size-11 items-center justify-center rounded-full bg-muted">
          <MapPinOff className="size-5 text-muted-foreground" aria-hidden="true" />
        </div>
        <p className="max-w-xs text-sm text-muted-foreground">
          Tu ruta simplemente terminará en la última parada. Puedes cambiar de idea cuando quieras
          desde aquí.
        </p>
        <Button type="button" variant="outline" onClick={() => router.back()}>
          Volver
        </Button>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // §1 — Consentimiento
  // ---------------------------------------------------------------------------
  if (paso === "consentimiento") {
    return (
      <div className="space-y-5 pb-8">
        <h1 className="font-heading text-xl font-semibold text-foreground">
          Termina tu ruta más cerca de tu casa
        </h1>

        <div className="space-y-4 text-sm text-foreground">
          <p>
            Cuando acabas la jornada, ¿siempre quedas lejos de tu casa? Si nos dices dónde vives
            aproximadamente, ordenamos tus entregas para que termines por tu sector.
          </p>

          <Seccion titulo="Qué guardamos">
            Un punto aproximado en el mapa, sin dirección exacta. Nada de historial de dónde
            anduviste.
          </Seccion>

          <Seccion titulo="Quién lo ve">
            Solo tú. Tu jefe no lo ve, el dueño del courier tampoco, nadie.
          </Seccion>

          <Seccion titulo="Es opcional, y nadie sabe si dijiste que no">
            Si no lo defines, tu ruta simplemente termina en la última parada.{" "}
            <strong className="font-semibold">
              Tu jefe no puede ver quiénes lo marcaron y quiénes no
            </strong>
            : para él, las dos rutas se ven igual. Y lo puedes quitar cuando quieras, en un toque,
            sin que pase nada.
          </Seccion>

          <Seccion titulo="Lo que va a pasar con el tiempo">
            Tu jefe puede notar, después de varias rutas, que tiendes a terminar por tu sector. No
            la dirección exacta, la comuna o la zona. Es el costo de esta funcionalidad y no hay
            forma de evitarlo. Pero solo si alguien mira muchas rutas tuyas a lo largo de semanas.
          </Seccion>

          <Seccion titulo="Cuánto dura">
            Se borra automáticamente después de 90 días sin trabajar. Tú lo puedes borrar cuando
            quieras, y borra de verdad.
          </Seccion>
        </div>

        <div className="flex flex-col gap-2 pt-2">
          <Button type="button" size="lg" className="min-h-13 w-full text-base font-semibold" onClick={irAlMapa}>
            Marcar mi punto
          </Button>
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="min-h-12 w-full"
            onClick={() => setPaso("rechazado")}
          >
            Mejor no
          </Button>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Pantalla del mapa (lleva a §2 al guardar). No es una de las 4 pantallas
  // autoradas del copy — es la transición que §1 y §2 dan por hecha ("lleva a
  // la pantalla del mapa"). El texto acá es puramente instructivo, sin
  // ninguna promesa nueva de privacidad.
  // ---------------------------------------------------------------------------
  if (paso === "mapa") {
    return (
      <div className="flex flex-col gap-4 pb-8">
        <button
          type="button"
          onClick={() => setPaso(puntoActual ? "guardado" : "consentimiento")}
          className="w-fit text-sm text-muted-foreground hover:text-foreground hover:underline"
        >
          ← Volver
        </button>

        <div>
          <h1 className="font-heading text-lg font-semibold text-foreground">
            Marca tu punto de término
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Toca el mapa donde vives, o cerca. Puedes moverlo después.
          </p>
        </div>

        <div className="relative h-80 w-full overflow-hidden rounded-lg border border-border bg-card">
          <MapaPuntoTermino
            tema={tema}
            puntoInicial={pinCandidato}
            interactivo
            onCambiarPin={setPinCandidato}
          />
        </div>

        {avisoError}

        <Button
          type="button"
          size="lg"
          className="min-h-13 w-full text-base font-semibold"
          onClick={handleGuardar}
          disabled={!pinCandidato}
          loading={pendingGuardar}
        >
          Guardar este punto
        </Button>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // §2 — Guardado
  // ---------------------------------------------------------------------------
  if (paso === "guardado" && puntoActual) {
    return (
      <div className="space-y-5 pb-8">
        <h1 className="font-heading text-xl font-semibold text-foreground">
          Tu punto de término está guardado
        </h1>

        <div className="space-y-2">
          <p className="text-sm font-medium text-foreground">Dónde termina tu ruta</p>
          <div className="relative h-56 w-full overflow-hidden rounded-lg border border-border bg-card">
            <MapaPuntoTermino
              tema={tema}
              puntoInicial={{ lat: puntoActual.lat, long: puntoActual.long }}
              interactivo={false}
              onCambiarPin={() => undefined}
            />
          </div>
          <p className="text-sm text-muted-foreground">
            {puntoActual.comuna ?? "Tu sector (comuna no identificada)"}
          </p>
        </div>

        <p className="text-sm text-muted-foreground">
          Se usará para ordenar tus entregas de modo que termines por acá.
        </p>

        {avisoError}

        <div className="flex flex-col gap-2 pt-1">
          <Button type="button" variant="outline" size="lg" className="min-h-12 w-full" onClick={irAlMapa}>
            Marcar otro punto
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="lg"
            className="min-h-12 w-full"
            onClick={() => setDialogoQuitarAbierto(true)}
          >
            Quitar mi punto de término
          </Button>
        </div>

        <div className="space-y-1 rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
          <p>Después de 90 días sin trabajar, este punto se borra automáticamente.</p>
          <p>Si cambias de domicilio, vuelve a marcar tu nuevo punto.</p>
        </div>

        {/* §3 — Confirmación de borrado. Sin confirmación en cadena: un
            diálogo, dos botones, ningún "¿estás seguro?" de más. */}
        <Dialog open={dialogoQuitarAbierto} onOpenChange={pendingQuitar ? undefined : setDialogoQuitarAbierto}>
          <DialogContent showCloseButton={!pendingQuitar} className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>¿Quitar tu punto de término?</DialogTitle>
              <DialogDescription>
                Una vez lo borres, se olvida todo. Tu ruta volverá a terminar en la última parada
                normal, sin ajuste hacia tu sector.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setDialogoQuitarAbierto(false)}
                disabled={pendingQuitar}
              >
                Mejor no
              </Button>
              <Button type="button" variant="destructive" onClick={handleQuitar} loading={pendingQuitar}>
                Sí, borrar
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  // Estado inalcanzable en la práctica (guardado sin punto): se resuelve
  // cayendo al consentimiento en vez de dejar la pantalla en blanco.
  return (
    <div className="pb-8">
      <Button type="button" variant="outline" onClick={() => setPaso("consentimiento")}>
        Volver
      </Button>
    </div>
  );
}

function Seccion({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="font-medium text-foreground">{titulo}</p>
      <p className="mt-0.5 text-muted-foreground">{children}</p>
    </div>
  );
}

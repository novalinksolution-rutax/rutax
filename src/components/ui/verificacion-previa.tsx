"use client";

/**
 * VerificacionPrevia — la verificación es una PANTALLA, no una validación.
 *
 * Es la primera de las seis decisiones que el tablero `P4` fija para todo el
 * producto, y la que más consecuencias tiene: la verificación corre **antes** y
 * decide si el botón de la acción existe. Sus tres desenlaces tienen
 * tratamiento propio y ninguno se puede confundir con otro:
 *
 *   A · TODO EN ORDEN          → se ve lo que se comprobó, no un silencio.
 *   B · CON REPAROS            → se puede seguir, **dejando registro**.
 *   C · BLOQUEADO              → no hay cómo seguir; el botón se deshabilita
 *                                con su motivo al lado, nunca se esconde.
 *
 * Y un cuarto estado que no es un desenlace del negocio sino de la máquina:
 * **no se pudo verificar** (falló la lectura). Ahí también se puede continuar
 * bajo responsabilidad declarada, y también queda registro.
 *
 * POR QUÉ ESTE ARCHIVO EXISTE
 * ---------------------------------------------------------------------------
 * Los tres cuadros de acciones financieras irreversibles —emitir factura,
 * emitir nota de crédito, emitir pago— llevaban **la misma copia literal de 96
 * líneas** cada uno: 288 líneas que solo se diferenciaban en una cadena para
 * lectores de pantalla («antes de emitir» / «antes de anular» / «antes de
 * pagar»). Tres copias de la misma regla son tres oportunidades de que una se
 * quede atrás — y la que se quede atrás es la que gobierna si se emite un DTE.
 *
 * EL DESENLACE DEL MEDIO ERA EL QUE FALTABA
 * ---------------------------------------------------------------------------
 * Antes, con reparos —entregas sin tarifa, un mínimo de facturación que no se
 * alcanzó— se podía emitir sin fricción y **sin que quedara nada anotado**. El
 * único registro de omisión existía para el caso degradado. Ahora los reparos
 * exigen un acto explícito y ese acto queda en la bitácora con los códigos de
 * lo que se pasó por alto (regla 20: la causa viaja con el hecho).
 */

import * as React from "react";
import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { ItemPreflight, ResultadoPreflight } from "@/modules/dinero/preflight";

/** El estado de la verificación, del lado del cliente. */
export type EstadoVerificacion = "verificando" | "listo" | "no_verificable";

/** El verbo de la acción, para lo que solo oye un lector de pantalla. */
export type VerboAccion = "emitir" | "anular" | "pagar";

/**
 * El acto del desenlace del medio, en primera persona.
 *
 * Sale de `excepciones.omitirVerif.conf` del sistema de mensajes: «queda
 * registrado que omitiste la verificación, con tu nombre». Ahí está escrito
 * como ceremonia aparte de peldaño 3; acá vive dentro del mismo cuadro porque
 * la verificación previa también vive adentro. Ver el anexo E del checklist.
 */
const VOY_A: Record<VerboAccion, string> = {
  emitir: "voy a emitir",
  anular: "voy a anular",
  pagar: "voy a pagar",
}

const GERUNDIO: Record<VerboAccion, string> = {
  emitir: "Verificando antes de emitir…",
  anular: "Verificando antes de anular…",
  pagar: "Verificando antes de pagar…",
};

/**
 * ¿Hay que impedir el acto? Una sola respuesta para los tres cuadros.
 *
 * Estaba escrita tres veces con tres formas distintas de decir lo mismo, que es
 * la manera más silenciosa de que una diverja.
 */
export function actoBloqueadoPorVerificacion({
  estado,
  resultado,
  aceptado,
}: {
  estado: EstadoVerificacion;
  resultado: ResultadoPreflight | null;
  /** El usuario marcó que continúa igual (reparos o falla de verificación). */
  aceptado: boolean;
}): boolean {
  if (estado === "verificando") return true;
  if (estado === "no_verificable") return !aceptado;
  if (!resultado) return true;
  // Bloqueos: no hay acto explícito que los levante.
  if (!resultado.ok) return true;
  // Reparos: sí se puede seguir, pero hay que decirlo.
  if (resultado.advertencias.length > 0) return !aceptado;
  return false;
}

/** ¿Este desenlace deja constancia de que se siguió igual? */
export function laVerificacionQuedaOmitida({
  estado,
  resultado,
  aceptado,
}: {
  estado: EstadoVerificacion;
  resultado: ResultadoPreflight | null;
  aceptado: boolean;
}): boolean {
  if (!aceptado) return false;
  if (estado === "no_verificable") return true;
  return estado === "listo" && (resultado?.advertencias.length ?? 0) > 0;
}

export function VerificacionPrevia({
  estado,
  resultado,
  verbo,
  mensajeError,
  onReintentar,
  deshabilitado,
  aceptado,
  onAceptadoChange,
  /** Códigos informativos que la pantalla ya muestra en otro lado. */
  informativosOmitidos = [],
}: {
  estado: EstadoVerificacion;
  resultado: ResultadoPreflight | null;
  verbo: VerboAccion;
  mensajeError?: string | null;
  onReintentar: () => void;
  deshabilitado: boolean;
  aceptado: boolean;
  onAceptadoChange: (v: boolean) => void;
  informativosOmitidos?: string[];
}) {
  if (estado === "verificando") {
    return (
      <div className="flex flex-col gap-2" role="status" aria-live="polite">
        <span className="sr-only">{GERUNDIO[verbo]}</span>
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-4 w-1/3" />
      </div>
    );
  }

  if (estado === "no_verificable") {
    return (
      <div className="flex flex-col gap-3">
        <div className="rounded-md bg-muted px-3 py-2.5 text-sm text-muted-foreground">
          <p className="font-medium text-foreground">No se pudo verificar automáticamente</p>
          {mensajeError && <p className="mt-1 text-xs">{mensajeError}</p>}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-2"
            onClick={onReintentar}
            disabled={deshabilitado}
          >
            Reintentar
          </Button>
        </div>
        <ActoDeSeguirIgual
          marcado={aceptado}
          onMarcadoChange={onAceptadoChange}
          deshabilitado={deshabilitado}
          texto="El sistema no pudo verificar. Continúo igualmente bajo mi responsabilidad."
        />
      </div>
    );
  }

  if (!resultado) return null;

  const informativos = resultado.informativos.filter(
    (i) => !informativosOmitidos.includes(i.codigo),
  );

  // C · BLOQUEADO. No hay acto explícito que lo levante: lo único que
  // corresponde es decir qué lo bloquea.
  if (!resultado.ok) {
    return (
      <div className="flex flex-col gap-3">
        <BandaItems items={resultado.bloqueos} tono="bloquea" />
        {resultado.advertencias.length > 0 && (
          <BandaItems items={resultado.advertencias} tono="advierte" />
        )}
      </div>
    );
  }

  // B · CON REPAROS. Se puede seguir, y seguir deja registro.
  if (resultado.advertencias.length > 0) {
    return (
      <div className="flex flex-col gap-3">
        <BandaItems items={resultado.advertencias} tono="advierte" />
        {informativos.length > 0 && <LineasInformativas items={informativos} />}
        <ActoDeSeguirIgual
          marcado={aceptado}
          onMarcadoChange={onAceptadoChange}
          deshabilitado={deshabilitado}
          texto={
            <>
              La verificación encontró{" "}
              {resultado.advertencias.length === 1
                ? "un problema"
                : `${resultado.advertencias.length} problemas`}{" "}
              y {VOY_A[verbo]} igual. <strong>Queda registrado que omití la verificación</strong>,
              con mi nombre.
            </>
          }
        />
      </div>
    );
  }

  // A · TODO EN ORDEN. Se muestra lo que se comprobó: un silencio no distingue
  // «verificado y correcto» de «no se verificó nada».
  return (
    <div className="flex flex-col gap-3">
      <div
        className="rounded-md bg-success-subtle px-3 py-2.5 text-sm text-success-subtle-foreground"
        role="status"
        aria-live="polite"
      >
        <span className="flex items-start gap-2">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span className="font-medium">La verificación no encontró reparos.</span>
        </span>
      </div>
      {informativos.length > 0 && <LineasInformativas items={informativos} />}
    </div>
  );
}

/**
 * El acto explícito del desenlace del medio.
 *
 * Es una casilla y no un botón porque acá el peldaño de fricción sigue siendo
 * el del acto principal: esto solo levanta el bloqueo, no lo reemplaza.
 */
function ActoDeSeguirIgual({
  marcado,
  onMarcadoChange,
  deshabilitado,
  texto,
}: {
  marcado: boolean;
  onMarcadoChange: (v: boolean) => void;
  deshabilitado: boolean;
  texto: React.ReactNode;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-border p-3 text-sm text-foreground">
      <Checkbox
        checked={marcado}
        onCheckedChange={(v) => onMarcadoChange(v === true)}
        disabled={deshabilitado}
        className="mt-0.5"
      />
      <span>{texto}</span>
    </label>
  );
}

function LineasInformativas({ items }: { items: ItemPreflight[] }) {
  return (
    <div className="flex flex-col gap-1 text-xs text-muted-foreground">
      {items.map((item, i) => (
        <p key={`${item.codigo}-${i}`}>
          {item.titulo}
          {item.detalle ? ` ${item.detalle}` : ""}
        </p>
      ))}
    </div>
  );
}

function BandaItems({
  items,
  tono,
}: {
  items: ItemPreflight[];
  tono: "bloquea" | "advierte";
}) {
  const Icono = tono === "bloquea" ? XCircle : AlertTriangle;
  const lista = (
    <ul className="flex flex-col gap-1.5">
      {items.map((item, i) => (
        <li key={`${item.codigo}-${i}`} className="flex items-start gap-2">
          <Icono className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>
            <span className="font-medium">{item.titulo}</span>
            {item.detalle && <span className="block text-xs opacity-90">{item.detalle}</span>}
          </span>
        </li>
      ))}
    </ul>
  );

  return (
    <div
      className={cn(
        "rounded-md p-3 text-sm",
        tono === "bloquea"
          ? "bg-destructive-subtle text-destructive-subtle-foreground"
          : "bg-warning-subtle text-warning-subtle-foreground",
      )}
    >
      {tono === "advierte" && items.length > 2 ? (
        <details>
          <summary className="cursor-pointer font-medium">
            {items.length} reparos — ver detalle
          </summary>
          <div className="mt-2">{lista}</div>
        </details>
      ) : (
        lista
      )}
    </div>
  );
}

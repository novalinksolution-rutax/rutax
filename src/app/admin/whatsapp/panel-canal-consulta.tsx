"use client";

/**
 * Submódulo «Consultas» de `/admin/whatsapp` — el freno de mano del canal de
 * consulta por WhatsApp (RX-código → estado, retiro del día). El canal nace
 * APAGADO para todos los couriers (migración `20260920000002`); esta es la
 * ÚNICA pantalla donde se enciende. Lo administra Rutax, no el courier —
 * mismo criterio que el resto de `/admin/whatsapp`.
 *
 * -----------------------------------------------------------------------------
 * 🔴 AMBIGUOS Y CANAL APAGADO VAN ARRIBA, CON EL MISMO PESO QUE «N SELLERS SIN
 * AVISOS» DE LA SECCIÓN DE DESTINATARIOS
 * -----------------------------------------------------------------------------
 * Un teléfono que resuelve a más de un contacto queda SIN canal, para siempre,
 * y en silencio (§5.1 del documento de alcance): el job de Inngest sigue en
 * verde. `cortadasPorCanalApagado` es el mismo agujero por courier: el seller
 * escribe, nadie le responde y nada falla. Los dos se cuentan y se muestran
 * igual de arriba, no como una fila más de una tabla.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Users, Power } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BadgeEstado } from "@/components/ui/badge-estado";
import { EmptyState } from "@/components/ui/empty-state";
import { formatearFechaHora } from "@/lib/formato-cl";
import { accionGuardarConfigCanalConsulta } from "./canal-acciones";
import type { FilaCanalConsultaCourier, ContadoresCanalConsultaGlobales } from "@/modules/conversacion";

function FilaCourier({ fila, onCambio }: { fila: FilaCanalConsultaCourier; onCambio: () => void }) {
  const [pendiente, iniciar] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editando, setEditando] = useState(false);
  const [topeConsultas, setTopeConsultas] = useState(String(fila.config.topeConsultasHora));
  const [topeSinMatch, setTopeSinMatch] = useState(String(fila.config.topeIntentosSinMatchHora));
  const [nota, setNota] = useState(fila.config.nota ?? "");

  const guardar = (canalActivo: boolean) => {
    setError(null);
    const consultas = Number(topeConsultas);
    const sinMatch = Number(topeSinMatch);
    if (!Number.isInteger(consultas) || !Number.isInteger(sinMatch)) {
      setError("Los topes tienen que ser números enteros.");
      return;
    }
    iniciar(async () => {
      const r = await accionGuardarConfigCanalConsulta({
        tenantId: fila.tenantId,
        canalActivo,
        topeConsultasHora: consultas,
        topeIntentosSinMatchHora: sinMatch,
        nota: nota.trim() || null,
      });
      if (!r.ok) {
        setError(r.mensaje);
        return;
      }
      setEditando(false);
      onCambio();
    });
  };

  return (
    <li className="border-t border-border py-3 first:border-t-0">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{fila.nombreCourier}</span>
            {fila.config.canalActivo ? (
              <BadgeEstado variante="success" texto="Encendido" />
            ) : (
              <BadgeEstado variante="neutral" texto="Apagado" />
            )}
            {!fila.config.configurado ? (
              <BadgeEstado variante="neutral" texto="Nunca configurado" conPunto={false} />
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground">
            {fila.contadores.respondidas} respondidas · {fila.contadores.cortadasPorTopeConsultas} por tope ·{" "}
            {fila.contadores.cortadasPorBarrido} por barrido · {fila.contadores.sondeosNumericosSinMatch} sin
            match, últimas 24 h
          </p>
          {fila.contadores.cortadasPorCanalApagado > 0 ? (
            <p className="text-xs font-medium text-warning">
              {fila.contadores.cortadasPorCanalApagado}{" "}
              {fila.contadores.cortadasPorCanalApagado === 1
                ? "consulta sin responder por canal apagado"
                : "consultas sin responder por canal apagado"}
            </p>
          ) : null}
          {fila.config.actualizadoEn ? (
            <p className="text-xs text-muted-foreground">
              Último cambio: {formatearFechaHora(fila.config.actualizadoEn)}
              {fila.config.nota ? ` · ${fila.config.nota}` : ""}
            </p>
          ) : null}
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
        </div>

        <div className="flex shrink-0 gap-2">
          <Button
            variant={fila.config.canalActivo ? "outline" : "default"}
            size="sm"
            disabled={pendiente}
            onClick={() => guardar(!fila.config.canalActivo)}
          >
            <Power className="size-4" />
            {fila.config.canalActivo ? "Apagar" : "Encender"}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={pendiente}
            onClick={() => setEditando((v) => !v)}
          >
            Topes
          </Button>
        </div>
      </div>

      {editando ? (
        <form
          className="mt-3 space-y-3 rounded-md border border-border bg-muted/30 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            guardar(fila.config.canalActivo);
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor={`consultas-${fila.tenantId}`}>Consultas por hora</Label>
              <Input
                id={`consultas-${fila.tenantId}`}
                type="number"
                min={1}
                max={200}
                value={topeConsultas}
                onChange={(e) => setTopeConsultas(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`sinmatch-${fila.tenantId}`}>Intentos sin match por hora</Label>
              <Input
                id={`sinmatch-${fila.tenantId}`}
                type="number"
                min={1}
                max={100}
                value={topeSinMatch}
                onChange={(e) => setTopeSinMatch(e.target.value)}
                required
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`nota-${fila.tenantId}`}>Nota (opcional)</Label>
            <Input
              id={`nota-${fila.tenantId}`}
              value={nota}
              onChange={(e) => setNota(e.target.value)}
              maxLength={500}
            />
          </div>
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={pendiente}>
              {pendiente ? "Guardando…" : "Guardar"}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setEditando(false)}>
              Cancelar
            </Button>
          </div>
        </form>
      ) : null}
    </li>
  );
}

function ContadorGlobal({
  valor,
  etiqueta,
  destacado = false,
}: {
  valor: number;
  etiqueta: string;
  destacado?: boolean;
}) {
  return (
    <div
      className={
        destacado
          ? "rounded-lg border border-warning/50 bg-warning/5 px-4 py-3"
          : "rounded-lg border border-border px-4 py-3"
      }
    >
      <p className="text-2xl font-semibold">{valor}</p>
      <p className="text-xs text-muted-foreground">{etiqueta}</p>
    </div>
  );
}

export function PanelCanalConsulta({
  couriers,
  globales,
}: {
  couriers: FilaCanalConsultaCourier[];
  globales: ContadoresCanalConsultaGlobales;
}) {
  const router = useRouter();

  return (
    <section className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <ContadorGlobal
          valor={globales.contactosAmbiguos}
          etiqueta="Números que resuelven a más de un contacto, sin canal"
          destacado={globales.contactosAmbiguos > 0}
        />
        <ContadorGlobal valor={globales.sinContacto} etiqueta="Números sin contacto registrado" />
        <ContadorGlobal valor={globales.ilegibles} etiqueta="Mensajes con teléfono ilegible" />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <ContadorGlobal valor={globales.respondidasSinTenant} etiqueta="Avisos neutros enviados" />
        <ContadorGlobal valor={globales.avisoNeutroOmitido} etiqueta="Avisos neutros omitidos (ya avisado en 24 h)" />
        <ContadorGlobal valor={globales.sinAlcance} etiqueta="Mensajes sin alcance" />
      </div>

      {couriers.length === 0 ? (
        <EmptyState
          icon={Users}
          tono="arranque"
          titulo="Sin couriers con suscripción"
          descripcion="El canal de consulta aparece acá cuando exista al menos un courier."
        />
      ) : (
        <ul className="rounded-lg border border-border px-4">
          {couriers.map((f) => (
            <FilaCourier key={f.tenantId} fila={f} onCambio={() => router.refresh()} />
          ))}
        </ul>
      )}
    </section>
  );
}

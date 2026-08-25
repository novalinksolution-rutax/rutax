"use client";

/**
 * La hora de corte del seller — un campo suyo, no un destino de configuración.
 * =============================================================================
 *
 * -----------------------------------------------------------------------------
 * 🔴 POR QUÉ VIVE ACÁ Y NO EN CONFIGURACIÓN
 * -----------------------------------------------------------------------------
 * B3b lo dice con todas las letras en su versión de agosto: **«la ventana de
 * corte no es un destino de configuración: es un campo del seller, porque cada
 * seller tiene el plazo que su courier le prometió»**.
 *
 * Vivía dentro de `/configuracion/zonas`, detrás de un acordeón y un selector de
 * seller — o sea, para cambiarle la hora a Vega Norte había que ir a una
 * pantalla que se llama «Zonas», desplegar una sección y volver a elegir el
 * seller que ya se estaba mirando. Acá el seller ya está elegido: es la ficha en
 * la que uno está parado.
 *
 * Con esto el destino «Zonas» queda haciendo una sola cosa —agrupar comunas—,
 * que es la otra corrección del tablero.
 *
 * -----------------------------------------------------------------------------
 * QUÉ GOBIERNA ESTA HORA, PARA QUE EL COPY NO LA SUBESTIME
 * -----------------------------------------------------------------------------
 * La hora de corte y el objetivo de SLA **deciden si una entrega llegó a
 * tiempo**: de acá sale el semáforo de cumplimiento del seller y el cálculo de
 * riesgo del día. No es una preferencia de visualización.
 *
 * -----------------------------------------------------------------------------
 * ⚠️ EL ACUSE VIVE EN LA SECCIÓN Y NO EN EL FORMULARIO
 * -----------------------------------------------------------------------------
 * El formulario se cierra al guardar, así que un acuse renderizado dentro de él
 * no lo lee nadie: se muestra acá, junto a la fila que acaba de cambiar. Es la
 * regla 25 —guardado explícito con acuse— resuelta donde la persona queda.
 */

import { useEffect, useState, useTransition, type FormEvent } from "react";
import {
  Clock,
  RefreshCw,
  ShieldAlert,
} from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { etiquetaTipoEntrega } from "@/lib/ui/etiqueta-fuente-pedido";
import type { Zona, VentanaCorte } from "@/modules/operacion/tipos";
import {
  actionObtenerVentanasSeller,
  actionGuardarVentanaCorte,
  actionToggleVentanaCorte,
} from "@/app/(tenant)/configuracion/zonas/actions";

export function VentanasCorteSeller({
  sellerId,
  zonas,
}: {
  sellerId: string;
  zonas: Zona[];
}) {
  const [ventanas, setVentanas] = useState<VentanaCorte[]>([]);
  // Arranca cargando: el seller ya está elegido, así que la lectura empieza sola.
  const [cargando, setCargando] = useState(true);
  const [mostrarFormulario, setMostrarFormulario] = useState(false);
  // Cuál ventana se está editando. `null` = una nueva. Se pasa al formulario
  // como valor inicial Y como `key`, para que React lo remonte al cambiar de
  // ventana: sin eso, abrir la segunda mostraría los campos de la primera.
  const [editando, setEditando] = useState<VentanaCorte | null>(null);
  /** El acuse del último guardado. Ver `onVentanaGuardada`. */
  const [acuse, setAcuse] = useState<string | null>(null);

  function onEditar(v: VentanaCorte) {
    setEditando(v);
    // Al reabrir el formulario el acuse anterior deja de ser cierto sobre lo que
    // hay en pantalla: se borra, como en `SeccionConfiguracion`.
    setAcuse(null);
    setMostrarFormulario(true);
  }

  const [errorCarga, setErrorCarga] = useState<string | null>(null);

  // ⚠️ No se toca el estado en el cuerpo del efecto —`cargando` ya nace en
  // `true` y `errorCarga` en `null`—: solo dentro de la respuesta. Un
  // `setCargando(true)` acá dispara un render extra por cada montaje y la regla
  // `react-hooks/set-state-in-effect` lo señala con razón.
  useEffect(() => {
    let vigente = true;
    actionObtenerVentanasSeller(sellerId).then((resultado) => {
      if (!vigente) return;
      setCargando(false);
      // ⚠️ El fallo se dice. Antes se descartaba en silencio y la sección
      // quedaba mostrando «este seller aún no tiene ventanas» — que es una
      // afirmación, no una lectura fallida, y manda a crear una que ya existe.
      if (resultado.ok) setVentanas(resultado.datos);
      else setErrorCarga(resultado.mensaje);
    });
    return () => {
      vigente = false;
    };
  }, [sellerId]);

  /**
   * ⚠️ **El acuse vive acá y no en el formulario, porque el formulario se
   * cierra al guardar.** Es la regla 25 —guardado explícito con acuse de
   * recibo— resuelta donde la persona queda: junto a la fila que acaba de
   * cambiar. Un acuse dentro de un árbol que se desmonta no lo lee nadie.
   */
  function onVentanaGuardada(v: VentanaCorte, acuseNuevo: string) {
    setAcuse(acuseNuevo);
    setVentanas((prev) => {
      const idx = prev.findIndex(
        (x) =>
          x.sellerId === v.sellerId &&
          x.tipoEntrega === v.tipoEntrega &&
          x.zonaId === v.zonaId,
      );
      if (idx >= 0) {
        const copia = [...prev];
        copia[idx] = v;
        return copia;
      }
      return [...prev, v];
    });
    setMostrarFormulario(false);
    setEditando(null);
  }

  return (
    <div className="space-y-4">
      {errorCarga && (
        <p
          role="alert"
          className="border border-fault-line bg-fault-bg px-3 py-2 text-sm text-fault-fg"
        >
          {errorCarga}
        </p>
      )}

      {cargando ? (
        <p className="text-sm text-fg-muted">Cargando su hora de corte…</p>
      ) : (
        <>
          {/* El acuse del último guardado, junto a la fila que cambió.
                      `role="status"` y no `alert`: es una buena noticia, y
                      `alert` interrumpe al lector de pantalla. */}
          {acuse && (
            <p
              role="status"
              className="border border-balanced-line bg-balanced-bg px-3 py-2 text-sm text-balanced-fg"
            >
              {acuse}
            </p>
          )}

          {/* Ventanas existentes */}
          {ventanas.length > 0 ? (
            <div className="overflow-hidden rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/40">
                    <th className="px-4 py-2 text-left font-medium text-muted-foreground">
                      Tipo
                    </th>
                    <th className="px-4 py-2 text-left font-medium text-muted-foreground">
                      Zona
                    </th>
                    <th className="px-4 py-2 text-left font-medium text-muted-foreground">
                      Corte
                    </th>
                    <th className="px-4 py-2 text-left font-medium text-muted-foreground">
                      SLA objetivo
                    </th>
                    <th className="px-4 py-2 text-left font-medium text-muted-foreground">
                      Estado
                    </th>
                    <th className="px-4 py-2 text-right font-medium text-muted-foreground">
                      <span className="sr-only">Acciones</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {ventanas.map((v) => (
                    <tr key={v.id}>
                      <td className="px-4 py-2 font-medium">
                        {etiquetaTipoEntrega(v.tipoEntrega)}
                      </td>
                      <td className="px-4 py-2 text-muted-foreground">
                        {v.zonaId
                          ? (zonas.find((z) => z.id === v.zonaId)?.nombre ??
                            "Zona")
                          : "Por defecto"}
                      </td>
                      <td className="px-4 py-2 tabular-nums">
                        <span className="flex items-center gap-1">
                          <Clock
                            className="size-3.5 text-muted-foreground"
                            aria-hidden="true"
                          />
                          {v.horaCorte}
                        </span>
                      </td>
                      <td className="px-4 py-2 tabular-nums">
                        {v.slaObjetivoPct}%
                      </td>
                      <td className="px-4 py-2">
                        <Badge variant={v.activa ? "success" : "neutral"}>
                          {v.activa ? "Activa" : "Inactiva"}
                        </Badge>
                      </td>
                      {/* 🐞 «Editar» no existía: el único camino al
                                  formulario era un botón «Agregar / editar» que
                                  lo abría EN BLANCO, con 14:00/30/60/97, y
                                  guardarlo pisaba la ventana vigente con esos
                                  valores. Ahora cada fila abre la suya. */}
                      <td className="px-4 py-2 text-right">
                        <div className="flex flex-wrap items-center justify-end gap-3">
                          <button
                            type="button"
                            onClick={() => onEditar(v)}
                            className="text-xs font-medium text-accent-text hover:underline"
                          >
                            Editar
                          </button>
                          <BotonToggleVentana
                            ventana={v}
                            onCambiada={onVentanaGuardada}
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Este seller aún no tiene ventanas de corte configuradas.
            </p>
          )}

          <Button
            variant="outline"
            onClick={() => {
              setEditando(null);
              setMostrarFormulario((v) => !v);
            }}
          >
            {mostrarFormulario ? "Cancelar" : "Agregar una ventana de corte"}
          </Button>

          {mostrarFormulario && (
            <FormularioVentanaCorte
              key={editando?.id ?? "nueva"}
              sellerId={sellerId}
              zonas={zonas}
              ventana={editando}
              onGuardada={onVentanaGuardada}
            />
          )}
        </>
      )}
    </div>
  );
}

// =============================================================================
// Formulario ventana de corte
// =============================================================================

/**
 * El formulario de ventana de corte.
 *
 * -----------------------------------------------------------------------------
 * 🐞 EL BUG QUE CORROMPÍA CONFIGURACIÓN
 * -----------------------------------------------------------------------------
 * Los cinco campos arrancaban en constantes literales —`useState("14:00")`,
 * `"30"`, `"60"`, `"97"`— y el mismo formulario servía para crear y para
 * «editar». Como `guardarVentanaCorte` hace un upsert por
 * `(tenant, seller, zona, tipo)`, **abrir «editar» y guardar sobrescribía la
 * ventana vigente con esos valores por defecto**, sin avisar.
 *
 * No es cosmético: la hora de corte y el objetivo de SLA gobiernan el semáforo
 * de cumplimiento y el cálculo de riesgo del día. Un courier que cortaba a las
 * 17:30 y entraba a mirar su configuración salía cortando a las 14:00.
 *
 * Ahora el formulario recibe la ventana que edita y arranca en ella. Cuando
 * `ventana` es `null` es una nueva, y ahí sí los valores por defecto son lo
 * correcto.
 */
function FormularioVentanaCorte({
  sellerId,
  zonas,
  ventana,
  onGuardada,
}: {
  sellerId: string;
  zonas: Zona[];
  /** La ventana que se está editando, o `null` para una nueva. */
  ventana: VentanaCorte | null;
  /** El segundo argumento es el acuse: lo muestra la sección, no el formulario. */
  onGuardada: (v: VentanaCorte, acuse: string) => void;
}) {
  const [tipoEntrega, setTipoEntrega] = useState<"flex" | "same_day">(
    ventana ? (ventana.tipoEntrega as "flex" | "same_day") : "same_day",
  );
  const [horaCorte, setHoraCorte] = useState(ventana?.horaCorte ?? "14:00");
  const [minutosPreparacion, setMinutosPreparacion] = useState(
    ventana ? String(ventana.minutosPreparacion) : "30",
  );
  const [minutosRutaEstimado, setMinutosRutaEstimado] = useState(
    ventana ? String(ventana.minutosRutaEstimado) : "60",
  );
  const [slaObjetivoPct, setSlaObjetivoPct] = useState(
    ventana ? String(ventana.slaObjetivoPct) : "97",
  );
  const [zonaId, setZonaId] = useState<string>(ventana?.zonaId ?? "");

  const [error, setError] = useState<string | null>(null);
  const [pendiente, iniciarTransicion] = useTransition();

  /**
   * ⚠️ **Este formulario NO usa `SeccionConfiguracion`, y la razón es que se
   * cierra al guardar.** El componente compartido rinde el acuse dentro del
   * formulario, y acá el formulario ya no está cuando llega la respuesta: lo
   * desmonta `onGuardada`. Un acuse renderizado en un árbol que se va no lo lee
   * nadie.
   *
   * La regla 25 igual se cumple —guardado explícito, con acuse— pero el acuse
   * lo pone la SECCIÓN, que es donde queda la persona después de guardar, junto
   * a la fila que acaba de cambiar. Ver `SeccionVentanasCorte`.
   *
   * ⚠️ Y arma su propio `FormData`: los seis campos son controlados —llega
   * precargado con la ventana vigente, que es la regla 26— y algunos son
   * `Select` de shadcn, que no emiten un campo nativo.
   */
  function manejarEnvio(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const fd = new FormData();
    fd.set("sellerId", sellerId);
    fd.set("tipoEntrega", tipoEntrega);
    fd.set("horaCorte", horaCorte);
    fd.set("minutosPreparacion", minutosPreparacion);
    fd.set("minutosRutaEstimado", minutosRutaEstimado);
    fd.set("slaObjetivoPct", slaObjetivoPct);
    if (zonaId) fd.set("zonaId", zonaId);

    iniciarTransicion(async () => {
      const resultado = await actionGuardarVentanaCorte(fd);
      if (!resultado.ok) {
        setError(resultado.mensaje);
        return;
      }
      // El acuse dice la CONSECUENCIA y no el trámite: la hora de corte gobierna
      // el semáforo de cumplimiento del seller, así que lo que hay que confirmar
      // es a qué hora corta desde ahora, no que «se guardó».
      const nombreZona = zonaId
        ? (zonas.find((z) => z.id === zonaId)?.nombre ?? "la zona elegida")
        : "todas las zonas";
      onGuardada(
        resultado.datos,
        `${etiquetaTipoEntrega(tipoEntrega)} en ${nombreZona} corta a las ${horaCorte} desde ahora, con ${slaObjetivoPct}% de objetivo.`,
      );
    });
  }

  return (
    <form
      onSubmit={manejarEnvio}
      className="space-y-4 rounded-lg border border-border bg-muted/30 p-4"
    >
      {/* Qué se está editando, con nombre. Antes decía «Nueva ventana de corte»
          también al editar una existente — el título mentía sobre lo que iba a
          pasar al guardar. */}
      <p className="text-sm font-medium text-foreground">
        {ventana
          ? `Ventana vigente · ${etiquetaTipoEntrega(ventana.tipoEntrega)}${
              ventana.zonaId
                ? ` · ${zonas.find((z) => z.id === ventana.zonaId)?.nombre ?? "zona"}`
                : " · todas las zonas"
            }`
          : "Nueva ventana de corte"}
      </p>
      {ventana ? (
        <p className="text-xs leading-relaxed text-muted-foreground">
          Estás editando la ventana que está rigiendo hoy. Al guardar, el cambio
          aplica a los pedidos que entren desde ese momento — los que ya están
          en curso conservan su corte.
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="ventana-tipo">Tipo de entrega</Label>
          <Select
            value={tipoEntrega}
            onValueChange={(v) => setTipoEntrega(v as "flex" | "same_day")}
          >
            <SelectTrigger id="ventana-tipo" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="same_day">Same-day</SelectItem>
              <SelectItem value="flex">Flex</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="ventana-hora">Hora de corte</Label>
          <Input
            id="ventana-hora"
            type="time"
            value={horaCorte}
            onChange={(e) => setHoraCorte(e.target.value)}
            required
          />
          {/* Cada campo dice qué produce, no qué es. «Hora local» no explica
              qué pasa con un pedido que entra a las 14:05. */}
          <p className="text-xs text-muted-foreground">
            Hora de Santiago. Después de esta hora el pedido se crea igual y
            sale mañana.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="ventana-prep">Minutos de preparación</Label>
          <Input
            id="ventana-prep"
            type="number"
            min="0"
            max="240"
            value={minutosPreparacion}
            onChange={(e) => setMinutosPreparacion(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Lo que toma retirar y clasificar antes de salir. Entra en el cálculo
            de si una entrega llega a tiempo.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="ventana-ruta">Minutos de ruta estimado</Label>
          <Input
            id="ventana-ruta"
            type="number"
            min="0"
            max="480"
            value={minutosRutaEstimado}
            onChange={(e) => setMinutosRutaEstimado(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Cuánto dura la ruta desde que sale la flota. Con la preparación,
            define a qué hora se compromete la entrega.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="ventana-sla">Objetivo de SLA (%)</Label>
          <Input
            id="ventana-sla"
            type="number"
            min="0"
            max="100"
            value={slaObjetivoPct}
            onChange={(e) => setSlaObjetivoPct(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            El porcentaje de entregas a tiempo que te propones. Es contra esto
            que se pinta el semáforo de cumplimiento del seller. 97% es lo
            recomendado para Flex.
          </p>
        </div>

        {zonas.length > 0 && (
          <div className="space-y-2">
            <Label htmlFor="ventana-zona">Override por zona (opcional)</Label>
            <Select value={zonaId} onValueChange={setZonaId}>
              <SelectTrigger id="ventana-zona" className="w-full">
                <SelectValue placeholder="Por defecto (todas las zonas)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">Por defecto</SelectItem>
                {zonas.map((z) => (
                  <SelectItem key={z.id} value={z.id}>
                    {z.nombre}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Deja vacío para aplicar a todas las zonas del seller.
            </p>
          </div>
        )}
      </div>

      {error && (
        <Alert variant="destructive">
          <ShieldAlert />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Button type="submit" disabled={pendiente}>
        {pendiente ? (
          <RefreshCw className="size-4 animate-spin" aria-hidden="true" />
        ) : null}
        {pendiente
          ? "Guardando…"
          : ventana
            ? "Guardar los cambios"
            : "Crear la ventana"}
      </Button>
    </form>
  );
}

// =============================================================================
// Activar / desactivar una ventana de corte
// =============================================================================

/**
 * La transición que le faltaba al estado «Inactiva».
 *
 * La tabla pintaba el distintivo y **ninguna acción llevaba a ese estado ni
 * salía de él**. La única salida era accidental: `guardarVentanaCorte` fuerza
 * `activa: true` en su upsert, así que volver a guardar la reactivaba de
 * rebote — algo que nadie va a adivinar.
 */
function BotonToggleVentana({
  ventana,
  onCambiada,
}: {
  ventana: VentanaCorte;
  /** El segundo argumento es el acuse: lo muestra la sección. */
  onCambiada: (v: VentanaCorte, acuse: string) => void;
}) {
  const [pendiente, iniciarTransicion] = useTransition();

  return (
    <button
      type="button"
      disabled={pendiente}
      onClick={() =>
        iniciarTransicion(async () => {
          const r = await actionToggleVentanaCorte(ventana.id, !ventana.activa);
          // También acusa recibo, y también con la consecuencia: desactivar una
          // ventana no es un interruptor decorativo — deja a ese seller sin hora
          // de corte, y con eso su semáforo de cumplimiento deja de significar
          // nada.
          if (r.ok) {
            onCambiada(
              r.datos,
              r.datos.activa
                ? `${etiquetaTipoEntrega(ventana.tipoEntrega)} vuelve a cortar a las ${r.datos.horaCorte}.`
                : `${etiquetaTipoEntrega(ventana.tipoEntrega)} queda sin hora de corte: sus pedidos dejan de contarse contra un plazo.`,
            );
          }
        })
      }
      aria-label={
        ventana.activa
          ? `Desactivar la ventana de ${etiquetaTipoEntrega(ventana.tipoEntrega)}`
          : `Reactivar la ventana de ${etiquetaTipoEntrega(ventana.tipoEntrega)}`
      }
      className="text-xs font-medium text-muted-foreground hover:text-foreground hover:underline disabled:opacity-50"
    >
      {pendiente ? "…" : ventana.activa ? "Desactivar" : "Reactivar"}
    </button>
  );
}

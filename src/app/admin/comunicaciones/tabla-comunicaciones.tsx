"use client";

/**
 * Publicación de comunicaciones (backstage de plataforma, F3 · Gap 7).
 *
 * Un único dialog de alta (`DialogNuevaComunicacion`) — a diferencia del CRUD
 * de planes, esta pantalla NO edita comunicaciones existentes (el backend solo
 * expone `crearComunicacion`/`activarDesactivarComunicacion`, ver
 * `modules/plataforma/comunicaciones.ts`): una vez publicada, lo único que se
 * puede hacer es activarla/desactivarla (baja lógica).
 *
 * El envío por email es un BROADCAST a los dueños de todos los couriers
 * activos (`jobs/notificar-comunicacion.ts`) — irreversible una vez enviado,
 * por eso pasa por `DialogConfirmacionDinero` (mismo componente que usan las
 * acciones irreversibles de dinero; es un confirmador genérico, no exclusivo
 * de ese módulo — ver `configuracion/plan/cambiar-plan.tsx`) antes de publicar.
 *
 * -----------------------------------------------------------------------------
 * 🔴 EN EL TELÉFONO LA FILA SE REACOMODA, NO SE RECORTA
 * -----------------------------------------------------------------------------
 * La tabla escondía **Tipo, Vigencia y Quién/cuándo** con `hidden sm:table-cell`
 * / `md:table-cell` / `lg:table-cell` — el arquetipo P1 que el resto del producto
 * ya tiene (`FichaFila390`, ver nómina, incidencias y reportería) y que este
 * backstage nunca recibió. De 640 px para arriba ahora se ven las seis columnas;
 * si no caben, la tabla scrollea dentro de su propia caja, nunca la página.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Megaphone, Mail } from "lucide-react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { DialogConfirmacionDinero } from "@/components/ui/dialog-confirmacion-dinero";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState } from "@/components/ui/empty-state";
import { DistintivoEstado } from "@/components/ui/distintivo-estado";
import { FichaFila390 } from "@/components/ui/ficha-fila-390";
import {
  formatearFecha as formatearFechaCl,
  formatearFechaHora as formatearFechaHoraCl,
} from "@/lib/formato-cl";
import { TooltipSoloLectura } from "../tooltip-solo-lectura";
import type { Comunicacion, TipoComunicacion } from "@/modules/plataforma/comunicaciones";
import type { UrgenciaAviso } from "@/lib/avisos/obtener-avisos";
import { accionCrearComunicacion, accionActivarDesactivar } from "./acciones";
import { ModalActoExplicito } from "@/components/ui/modal-acto-explicito";

export interface ComunicacionConAutor extends Comunicacion {
  creadoPorNombre: string | null;
}

const ETIQUETA_TIPO: Record<TipoComunicacion, string> = {
  info: "Información",
  mantencion: "Mantención",
  novedad: "Novedad",
  alerta: "Alerta",
};

const ETIQUETA_NIVEL: Record<UrgenciaAviso, string> = {
  informativo: "Informativo",
  importante: "Importante",
  urgente: "Urgente",
};

const VARIANTE_BADGE_NIVEL: Record<UrgenciaAviso, "info" | "warning" | "error"> = {
  informativo: "info",
  importante: "warning",
  urgente: "error",
};

/**
 * Fechas por el helper compartido, no por formateadores propios.
 *
 * Los dos que vivian aqui repetian `timeZone: "America/Santiago"` y a
 * `FORMATEADOR_FECHA_HORA` le faltaba `hour12: false`: imprimia
 * "28-08-2026, 10:09 p. m." donde el resto del producto dice "28-08-2026 22:09".
 * La red mecanica del repo solo exige `timeZone`, asi que este se le colaba.
 */
function formatearFechaHora(iso: string): string {
  return formatearFechaHoraCl(iso);
}

function formatearFecha(iso: string): string {
  return formatearFechaCl(iso);
}

// =============================================================================
// Alta — formulario + confirmación de broadcast por email
// =============================================================================

function DialogNuevaComunicacion({
  onPublicada,
  trigger,
}: {
  onPublicada: () => void;
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enviarEmail, setEnviarEmail] = useState(false);
  const [confirmandoEnvio, setConfirmandoEnvio] = useState(false);
  const [formDataPendiente, setFormDataPendiente] = useState<FormData | null>(null);
  const [isPending, startTransition] = useTransition();

  function publicar(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const resultado = await accionCrearComunicacion(formData);
      if (!resultado.ok) {
        setError((resultado as { mensaje?: string }).mensaje ?? "Error al publicar la comunicación.");
        setConfirmandoEnvio(false);
        return;
      }
      setOpen(false);
      setConfirmandoEnvio(false);
      setFormDataPendiente(null);
      onPublicada();
    });
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);

    // El envío por email es un broadcast irreversible a todos los couriers
    // activos: pasa por un paso de confirmación explícito antes de publicar.
    if (formData.get("enviar_email") === "on") {
      setFormDataPendiente(formData);
      setConfirmandoEnvio(true);
      return;
    }
    publicar(formData);
  }

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(v) => {
          if (!v) {
            setError(null);
            setEnviarEmail(false);
          }
          setOpen(v);
        }}
      >
        <DialogTrigger asChild>{trigger}</DialogTrigger>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Nueva comunicación</DialogTitle>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="rounded-lg border border-info-subtle bg-info-subtle/40 px-3 py-2 text-xs text-info-subtle-foreground">
              Se publica de inmediato como banner para <strong>todos los couriers</strong> (alcance
              global) — no se puede dirigir a uno solo.
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="titulo">Título</Label>
              <Input
                id="titulo"
                name="titulo"
                required
                maxLength={140}
                placeholder="Ej: Mantención programada este sábado"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="cuerpo">Mensaje</Label>
              <Textarea
                id="cuerpo"
                name="cuerpo"
                required
                rows={4}
                maxLength={600}
                placeholder="Se muestra como banner — mantenlo breve y concreto."
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="tipo">Tipo</Label>
                <Select name="tipo" defaultValue="info" required>
                  <SelectTrigger id="tipo" className="h-9 w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(ETIQUETA_TIPO) as TipoComunicacion[]).map((t) => (
                      <SelectItem key={t} value={t}>
                        {ETIQUETA_TIPO[t]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="nivel">Nivel</Label>
                <Select name="nivel" defaultValue="informativo" required>
                  <SelectTrigger id="nivel" className="h-9 w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(ETIQUETA_NIVEL) as UrgenciaAviso[]).map((n) => (
                      <SelectItem key={n} value={n}>
                        {ETIQUETA_NIVEL[n]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">Define el color del banner.</p>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="vigente_hasta">Vigente hasta</Label>
              <Input id="vigente_hasta" name="vigente_hasta" type="date" className="h-9 w-full sm:w-48" />
              <p className="text-xs text-muted-foreground">Vacío = sin expiración (queda vigente hasta que la desactives).</p>
            </div>

            <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-border p-3 text-sm">
              <Checkbox
                name="enviar_email"
                checked={enviarEmail}
                onCheckedChange={(v) => setEnviarEmail(v === true)}
                className="mt-0.5"
              />
              <span className="flex flex-col gap-0.5">
                <span className="font-medium text-foreground">Enviar también por email</span>
                <span className="text-xs text-muted-foreground">
                  Se manda al dueño de cada courier activo en Rutax, además del banner in-app.
                </span>
              </span>
            </label>

            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}

            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="outline" disabled={isPending}>
                  Cancelar
                </Button>
              </DialogClose>
              <Button type="submit" disabled={isPending}>
                {isPending ? "Publicando..." : "Publicar comunicación"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <DialogConfirmacionDinero
        open={confirmandoEnvio}
        onOpenChange={(v) => {
          if (!v) setFormDataPendiente(null);
          setConfirmandoEnvio(v);
        }}
        titulo="Confirmar envío por email"
        consecuencia="Esta comunicación se enviará por correo al dueño de cada courier activo en Rutax, además de publicarse como banner in-app. El envío no se puede deshacer."
        onConfirmar={() => formDataPendiente && publicar(formDataPendiente)}
        cargando={isPending}
        textoConfirmar="Publicar y enviar"
        requiereConfirmacionExplicita
        etiquetaConfirmacion="Entiendo que esto envía un correo a todos los couriers activos."
      />
    </>
  );
}

function BotonNuevaComunicacion({
  puedeEscribir,
  onPublicada,
}: {
  puedeEscribir: boolean;
  onPublicada: () => void;
}) {
  if (!puedeEscribir) {
    return (
      <TooltipSoloLectura>
        <Button size="sm" disabled>
          <Megaphone className="size-3.5" aria-hidden="true" />
          Nueva comunicación
        </Button>
      </TooltipSoloLectura>
    );
  }
  return (
    <DialogNuevaComunicacion
      onPublicada={onPublicada}
      trigger={
        <Button size="sm">
          <Megaphone className="size-3.5" aria-hidden="true" />
          Nueva comunicación
        </Button>
      }
    />
  );
}

// =============================================================================
// Activar / desactivar
// =============================================================================

function BotonActivarDesactivar({
  comunicacion,
  puedeEscribir,
  onCambiado,
}: {
  comunicacion: ComunicacionConAutor;
  puedeEscribir: boolean;
  onCambiado: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // La ceremonia solo aparece al DESACTIVAR: activar es reversible en un clic,
  // y pedir confirmación para encender algo gasta la fricción.
  const [confirmando, setConfirmando] = useState(false);

  if (!puedeEscribir) {
    return (
      <TooltipSoloLectura>
        <Button variant="ghost" size="sm" disabled>
          {comunicacion.activa ? "Desactivar" : "Reactivar"}
        </Button>
      </TooltipSoloLectura>
    );
  }

  function ejecutar() {
    setError(null);
    startTransition(async () => {
      const resultado = await accionActivarDesactivar(comunicacion.id, !comunicacion.activa);
      if (!resultado.ok) {
        setError((resultado as { mensaje?: string }).mensaje ?? "Error.");
        return;
      }
      onCambiado();
    });
  }

  return (
    <>
      <div className="flex flex-col items-end gap-1">
        <Button
          variant={comunicacion.activa ? "ghost" : "outline"}
          size="sm"
          className={comunicacion.activa ? "text-destructive hover:text-destructive" : ""}
          disabled={isPending}
          onClick={() => (comunicacion.activa ? setConfirmando(true) : ejecutar())}
        >
          {isPending ? "..." : comunicacion.activa ? "Desactivar" : "Reactivar"}
        </Button>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>

      <ModalActoExplicito
        open={confirmando}
        onOpenChange={(o) => {
          if (isPending) return;
          setConfirmando(o);
        }}
        peldano={2}
        titulo={`Vas a desactivar "${comunicacion.titulo}"`}
        consecuencia={
          <>
            Deja de mostrarse como banner a los couriers <strong>de inmediato</strong>. No
            reenvía ni cancela ningún correo ya despachado.
          </>
        }
        variante="destructive"
        cargando={isPending}
        textoConfirmar="Desactivar el aviso"
        onConfirmar={() => {
          setConfirmando(false);
          ejecutar();
        }}
      />
    </>
  );
}

// =============================================================================
// Tabla
// =============================================================================

interface Props {
  comunicaciones: ComunicacionConAutor[];
  /** `false` para `soporte_lectura` — oculta los controles de escritura (el gate real vive en el servidor). */
  puedeEscribir: boolean;
}

export function TablaComunicaciones({ comunicaciones, puedeEscribir }: Props) {
  const router = useRouter();
  const activas = comunicaciones.filter((c) => c.activa).length;
  const inactivas = comunicaciones.length - activas;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-2">
          {activas > 0 && (
            <Badge variant="success">
              {activas} activa{activas !== 1 ? "s" : ""}
            </Badge>
          )}
          {inactivas > 0 && (
            <Badge variant="neutral">
              {inactivas} inactiva{inactivas !== 1 ? "s" : ""}
            </Badge>
          )}
          {comunicaciones.length === 0 && (
            <span className="text-sm text-muted-foreground">Sin comunicaciones publicadas</span>
          )}
        </div>
        <BotonNuevaComunicacion puedeEscribir={puedeEscribir} onPublicada={() => router.refresh()} />
      </div>

      {comunicaciones.length === 0 ? (
        <EmptyState
          icon={Megaphone}
          tono="arranque"
          titulo="Sin comunicaciones publicadas"
          descripcion="Publica la primera comunicación (mantención, novedad o alerta) para que aparezca como banner en el área interna de todos los couriers."
          accion={<BotonNuevaComunicacion puedeEscribir={puedeEscribir} onPublicada={() => router.refresh()} />}
        />
      ) : (
        <>
          {/* Teléfono: una ficha por comunicación. Nada se esconde.
              No es un enlace (esta pantalla no tiene detalle propio), así que
              va sin chevron y con la acción principal —activar/desactivar—
              a la vista, en vez de escondida en la ficha. */}
          <ul className="divide-y divide-border overflow-hidden rounded-lg border bg-card shadow-sm sm:hidden">
            {comunicaciones.map((c) => (
              <li key={c.id} className="flex items-center gap-3 px-4 py-2">
                <FichaFila390
                  className="flex-1"
                  estado={
                    <>
                      <DistintivoEstado
                        tono={c.activa ? "neutral" : "inert"}
                        etiqueta={c.activa ? "Activa" : "Inactiva"}
                      />
                      {/* El nivel sube junto al estado, no al tipo: es la
                          señal de urgencia («Urgente» pinta error) y compite
                          por atención con la actividad, no con la
                          clasificación neutra de abajo. */}
                      <Badge variant={VARIANTE_BADGE_NIVEL[c.nivel]}>{ETIQUETA_NIVEL[c.nivel]}</Badge>
                    </>
                  }
                  clasificacion={ETIQUETA_TIPO[c.tipo]}
                  titulo={c.titulo}
                  // El cuerpo del mensaje no entra acá: no es una columna que
                  // se esconde (vive siempre junto al título, en la misma
                  // celda «Comunicación»), y es prosa larga que no cabe en la
                  // línea mono de una sola línea. Lo que sí se recupera es lo
                  // que las columnas Vigencia y Quién/cuándo se llevaban.
                  detalle={`${c.vigenteHasta ? `Hasta ${formatearFecha(c.vigenteHasta)}` : "Sin expiración"} · ${c.creadoPorNombre ?? "—"} · ${formatearFechaHora(c.creadoEn)}`}
                />
                <BotonActivarDesactivar
                  comunicacion={c}
                  puedeEscribir={puedeEscribir}
                  onCambiado={() => router.refresh()}
                />
              </li>
            ))}
          </ul>

          <div className="hidden overflow-hidden rounded-lg border bg-card shadow-sm sm:block">
            <div className="overflow-x-auto">
              <table className="w-full text-sm" aria-label="Comunicaciones publicadas a los couriers">
                <thead>
                  <tr className="border-b bg-muted/40 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    <th scope="col" className="px-4 py-2">Comunicación</th>
                    <th scope="col" className="px-4 py-2">Tipo</th>
                    <th scope="col" className="px-4 py-2">Nivel</th>
                    <th scope="col" className="px-4 py-2">Estado</th>
                    <th scope="col" className="px-4 py-2">Vigencia</th>
                    <th scope="col" className="px-4 py-2">Quién / cuándo</th>
                    <th scope="col" className="px-4 py-2 text-right">
                      <span className="sr-only">Acciones</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {comunicaciones.map((c) => (
                    <tr key={c.id} className="hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-start gap-2">
                          <div className="min-w-0">
                            <p className="font-medium">{c.titulo}</p>
                            <p className="max-w-xs truncate text-xs text-muted-foreground">{c.cuerpo}</p>
                          </div>
                          {c.enviarEmail && (
                            <Mail
                              className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
                              aria-label="Enviada también por email"
                            />
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {ETIQUETA_TIPO[c.tipo]}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={VARIANTE_BADGE_NIVEL[c.nivel]}>{ETIQUETA_NIVEL[c.nivel]}</Badge>
                      </td>
                      <td className="px-4 py-3">
                        <DistintivoEstado
                          tono={c.activa ? "neutral" : "inert"}
                          etiqueta={c.activa ? "Activa" : "Inactiva"}
                        />
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {c.vigenteHasta ? `Hasta ${formatearFecha(c.vigenteHasta)}` : "Sin expiración"}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col">
                          <span className="text-foreground">{c.creadoPorNombre ?? "—"}</span>
                          <span className="text-xs text-muted-foreground">{formatearFechaHora(c.creadoEn)}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end">
                          <BotonActivarDesactivar
                            comunicacion={c}
                            puedeEscribir={puedeEscribir}
                            onCambiado={() => router.refresh()}
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

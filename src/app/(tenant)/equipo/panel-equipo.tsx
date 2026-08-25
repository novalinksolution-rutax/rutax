"use client";

/**
 * Pantalla H — Lista de usuarios e invitaciones: panel de cliente.
 *
 * Una sola tabla con dos grupos visuales (§2.2): "Usuarios activos" e
 * "Invitaciones", con pestañas "Todos · Activos · Invitaciones pendientes"
 * para que el dueño se enfoque en "qué necesita seguimiento" sin scrollear
 * una lista mezclada. El botón primario "Invitar persona" abre la Pantalla I
 * en un panel lateral (Sheet) — nunca página completa, para no romper el
 * contexto de "estoy viendo mi equipo".
 */

import { useMemo, useState, useTransition } from "react";
import { UserPlus, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { BadgeEstado } from "@/components/ui/badge-estado";
import {
  BADGE_INVITACION,
  traducirEstadoInvitacion,
  type EstadoInvitacionEquipo,
} from "@/lib/ui/traduccion-estados";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DistintivoEstado } from "@/components/ui/distintivo-estado";
import { EstadoError, EstadoVacio } from "@/components/onboarding/estado-pantalla";
import { formatearFecha, formatearTiempoRelativo } from "@/lib/formato-cl";
import { DESCRIPCIONES_ROLES_INTERNOS } from "@/modules/identidad/descripciones-roles";
import { DialogoCambiarRol } from "./dialogo-cambiar-rol";
import type { RolInterno } from "@/modules/identidad/roles";
import { FormularioInvitacion } from "./formulario-invitacion";
import {
  reenviarInvitacion,
  reinvitarUsuario,
  revocarInvitacionDeEquipo,
  type EstadoEquipo,
  type EstadoInvitacion,
  type InvitacionEnviada,
  type InvitacionEquipo,
  type UsuarioEquipo,
} from "./actions";

type Filtro = "todos" | "activos" | "pendientes";

interface Props {
  estadoInicial: EstadoEquipo | null;
  errorInicial: string | null;
  puedeInvitar: boolean;
  puedeRevocar: boolean;
  /** `gestionar_usuarios_y_roles`: cambiar el rol y suspender. */
  puedeGestionar: boolean;
}

export function PanelEquipo({
  estadoInicial,
  errorInicial,
  puedeInvitar,
  puedeRevocar,
  puedeGestionar,
}: Props) {
  const [estado, setEstado] = useState<EstadoEquipo | null>(estadoInicial);
  const [errorCarga, setErrorCarga] = useState<string | null>(errorInicial);
  const [recargando, setRecargando] = useState(false);
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [formularioAbierto, setFormularioAbierto] = useState(false);

  function actualizarUsuario(u: UsuarioEquipo) {
    setEstado((prev) =>
      prev
        ? { ...prev, usuarios: prev.usuarios.map((x) => (x.id === u.id ? u : x)) }
        : prev,
    );
  }

  async function recargar() {
    setRecargando(true);
    try {
      const { obtenerEstadoEquipo } = await import("./actions");
      const resultado = await obtenerEstadoEquipo();
      if (resultado.ok) {
        setEstado(resultado.estado);
        setErrorCarga(null);
      } else {
        setErrorCarga(resultado.mensaje);
      }
    } finally {
      setRecargando(false);
    }
  }

  function alInvitar(invitacion: InvitacionEnviada) {
    setEstado((anterior) =>
      anterior
        ? {
            ...anterior,
            invitaciones: [{ ...invitacion, ...SIN_ESTADO_DE_ENTREGA }, ...anterior.invitaciones],
          }
        : anterior,
    );
    setFormularioAbierto(false);
  }

  function actualizarInvitacion(id: string, cambios: Partial<InvitacionEquipo>) {
    setEstado((anterior) =>
      anterior
        ? { ...anterior, invitaciones: anterior.invitaciones.map((inv) => (inv.id === id ? { ...inv, ...cambios } : inv)) }
        : anterior,
    );
  }

  function reemplazarInvitacionPorNueva(idAnterior: string, nueva: InvitacionEnviada) {
    setEstado((anterior) =>
      anterior
        ? {
            ...anterior,
            invitaciones: [
              { ...nueva, ...SIN_ESTADO_DE_ENTREGA },
              ...anterior.invitaciones.map((inv) => (inv.id === idAnterior ? { ...inv } : inv)),
            ],
          }
        : anterior,
    );
  }

  const totalPendientes = estado?.invitaciones.filter((inv) => inv.estado === "pendiente").length ?? 0;

  const filas = useMemo(() => construirFilas(estado, filtro), [estado, filtro]);

  const encabezado = (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <Tabs value={filtro} onValueChange={(valor) => setFiltro(valor as Filtro)}>
        <TabsList>
          <TabsTrigger value="todos">Todos</TabsTrigger>
          <TabsTrigger value="activos">Activos</TabsTrigger>
          <TabsTrigger value="pendientes">
            Invitaciones pendientes{totalPendientes > 0 ? ` (${totalPendientes})` : ""}
          </TabsTrigger>
        </TabsList>
      </Tabs>
      {puedeInvitar ? (
        <Button onClick={() => setFormularioAbierto(true)} className="w-fit">
          <UserPlus className="size-4" aria-hidden="true" />
          Invitar persona
        </Button>
      ) : null}
    </div>
  );

  let contenido: React.ReactNode;
  if (errorCarga && !estado) {
    contenido = <EstadoError descripcion={errorCarga} onReintentar={recargar} reintentando={recargando} />;
  } else if (!estado) {
    contenido = (
      <div className="space-y-2">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  } else if (estado.usuarios.length === 0 && estado.invitaciones.length === 0) {
    contenido = (
      <EstadoVacio
        icono={<Users className="size-8" aria-hidden="true" />}
        titulo="Aún no has invitado a nadie de tu equipo"
        descripcion="Empieza por dar acceso a la primera persona — podrás ajustar su rol cuando quieras."
        accion={
          puedeInvitar ? (
            <Button onClick={() => setFormularioAbierto(true)}>
              <UserPlus className="size-4" aria-hidden="true" />
              Invitar a tu primera persona
            </Button>
          ) : undefined
        }
      />
    );
  } else if (filas.length === 0) {
    contenido = (
      <EstadoVacio
        titulo="No hay nada que mostrar con este filtro"
        descripcion="Prueba con otra pestaña — por ejemplo, 'Todos'."
      />
    );
  } else {
    contenido = (
      <div className="overflow-x-auto rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Persona</TableHead>
              <TableHead>Rol</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead>Detalle</TableHead>
              <TableHead className="text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filas.map((fila) =>
              fila.tipo === "usuario" ? (
                <FilaUsuario
                  key={`usuario-${fila.usuario.id}`}
                  usuario={fila.usuario}
                  puedeGestionar={puedeGestionar}
                  onActualizado={actualizarUsuario}
                />
              ) : (
                <FilaInvitacion
                  key={`invitacion-${fila.invitacion.id}`}
                  invitacion={fila.invitacion}
                  puedeInvitar={puedeInvitar}
                  puedeRevocar={puedeRevocar}
                  onActualizar={(cambios) => actualizarInvitacion(fila.invitacion.id, cambios)}
                  onReemplazarPorNueva={(nueva) => reemplazarInvitacionPorNueva(fila.invitacion.id, nueva)}
                />
              ),
            )}
          </TableBody>
        </Table>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {encabezado}
      {contenido}
      <FormularioInvitacion abierto={formularioAbierto} onCerrar={() => setFormularioAbierto(false)} onInvitada={alInvitar} />
    </div>
  );
}

// -----------------------------------------------------------------------------
// Construcción de filas combinadas, según el filtro activo
// -----------------------------------------------------------------------------

type FilaCombinada =
  | { tipo: "usuario"; usuario: UsuarioEquipo; orden: number }
  | { tipo: "invitacion"; invitacion: InvitacionEquipo; orden: number };

function construirFilas(estado: EstadoEquipo | null, filtro: Filtro): FilaCombinada[] {
  if (!estado) return [];

  const usuarios: FilaCombinada[] = estado.usuarios.map((usuario) => ({
    tipo: "usuario",
    usuario,
    orden: new Date(usuario.creadoEn).getTime(),
  }));
  // Las invitaciones "aceptadas" ya tienen su usuario en la otra lista — no se
  // duplican aquí (§2.2: "ya es un usuario activo, aparece en la lista de usuarios").
  const invitaciones: FilaCombinada[] = estado.invitaciones
    .filter((inv) => inv.estado !== "aceptada")
    .map((invitacion) => ({
      tipo: "invitacion",
      invitacion,
      orden: new Date(invitacion.creadoEn).getTime(),
    }));

  let combinadas: FilaCombinada[];
  if (filtro === "activos") {
    combinadas = usuarios;
  } else if (filtro === "pendientes") {
    combinadas = invitaciones.filter((fila) => fila.tipo === "invitacion" && fila.invitacion.estado === "pendiente");
  } else {
    combinadas = [...invitaciones, ...usuarios];
  }

  return combinadas.sort((a, b) => b.orden - a.orden);
}

// -----------------------------------------------------------------------------
// Fila — usuario activo
// -----------------------------------------------------------------------------

function FilaUsuario({
  usuario,
  puedeGestionar,
  onActualizado,
}: {
  usuario: UsuarioEquipo;
  puedeGestionar: boolean;
  onActualizado: (u: UsuarioEquipo) => void;
}) {
  const descripcionRol = DESCRIPCIONES_ROLES_INTERNOS[usuario.rol];

  /**
   * 🔴 La fila entera abre el panel, como en Pedidos, Tarifas y Bodegas.
   *
   * Solo la persona ACTIVA: la suspendida tiene su propia acción —reactivarla—
   * y abrirle un cambio de rol daría un formulario que no se puede aplicar.
   */
  const [panelRolAbierto, setPanelRolAbierto] = useState(false);
  const abrible = puedeGestionar && usuario.estado === "activo";

  return (
    <TableRow
      onClick={abrible ? () => setPanelRolAbierto(true) : undefined}
      className={abrible ? "cursor-pointer" : undefined}
    >
      <TableCell>
        <div className="space-y-0.5">
          <p className="font-medium text-foreground">{usuario.nombreCompleto}</p>
          <p className="text-xs text-muted-foreground">{usuario.email ?? "Sin correo registrado"}</p>
        </div>
      </TableCell>
      <TableCell>
        <Badge variant="outline">{descripcionRol?.etiqueta ?? usuario.rol}</Badge>
      </TableCell>
      <TableCell>
        {/* Mismo render que las invitaciones de la columna de al lado: con
            `outline` + colores a mano, "Activo" salía como texto suelto junto a
            chips ("Pendiente", "Expirada"), dos lenguajes en una misma columna. */}
        <DistintivoEstado
          tono={usuario.estado === "activo" ? "neutral" : "inert"}
          etiqueta={usuario.estado === "activo" ? "Activo" : "Suspendido"}
        />
      </TableCell>
      <TableCell className="text-sm text-muted-foreground">Miembro desde el {formatearFecha(usuario.creadoEn)}</TableCell>
      {/* 🐞 ACÁ DECÍA «Gestión de rol próximamente». Era la única ocurrencia de
          esa palabra en todo `src/`, y el estado «Suspendido» de la celda de al
          lado se pintaba sin que nada llevara a él ni saliera de él. Las tres
          acciones existen ahora, con su bitácora. */}
      {/* ⚠️ La celda para la propagación: sin esto, «Suspender» abriría además
          el panel de cambio de rol por debajo. */}
      <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
        {puedeGestionar ? (
          <div className="flex flex-wrap items-center justify-end gap-3">
            {usuario.estado === "activo" ? (
              <DialogoCambiarRol
                usuarioId={usuario.id}
                nombre={usuario.nombreCompleto}
                rolActual={usuario.rol as RolInterno}
                onCambiado={(rol) => onActualizado({ ...usuario, rol })}
                abierto={panelRolAbierto}
                onOpenChange={setPanelRolAbierto}
              />
            ) : null}
            <BotonSuspender usuario={usuario} onActualizado={onActualizado} />
          </div>
        ) : (
          <span className="text-xs text-fg-muted">Solo el dueño puede cambiarlo</span>
        )}
      </TableCell>
    </TableRow>
  );
}

// -----------------------------------------------------------------------------
// Fila — invitación, con acciones contextuales según estado (tabla §2.2)
// -----------------------------------------------------------------------------

function FilaInvitacion({
  invitacion,
  puedeInvitar,
  puedeRevocar,
  onActualizar,
  onReemplazarPorNueva,
}: {
  invitacion: InvitacionEquipo;
  puedeInvitar: boolean;
  puedeRevocar: boolean;
  onActualizar: (cambios: Partial<InvitacionEquipo>) => void;
  onReemplazarPorNueva: (nueva: InvitacionEnviada) => void;
}) {
  const [pendiente, setPendiente] = useState<"reenviar" | "reinvitar" | "revocar" | null>(null);
  const [mensaje, setMensaje] = useState<{ tipo: "exito" | "error"; texto: string } | null>(null);
  const descripcionRol = DESCRIPCIONES_ROLES_INTERNOS[invitacion.rol];

  async function manejarReenviar() {
    setPendiente("reenviar");
    setMensaje(null);
    const resultado = await reenviarInvitacion(invitacion.id);
    setPendiente(null);
    if (!resultado.ok) {
      setMensaje({ tipo: "error", texto: resultado.mensaje });
      return;
    }
    setMensaje(
      resultado.emailEnviado
        ? { tipo: "exito", texto: `Correo reenviado a ${invitacion.email}.` }
        : {
            tipo: "error",
            texto: "No pudimos enviar el correo. El envío de correos no está habilitado en este entorno.",
          },
    );
  }

  async function manejarReinvitar() {
    setPendiente("reinvitar");
    setMensaje(null);
    const resultado = await reinvitarUsuario(invitacion.id);
    setPendiente(null);
    if (!resultado.ok) {
      setMensaje({ tipo: "error", texto: resultado.mensaje });
      return;
    }
    onReemplazarPorNueva({
      id: crypto.randomUUID(),
      email: invitacion.email,
      rol: invitacion.rol,
      estado: "pendiente",
      expiraEn: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      creadoEn: new Date().toISOString(),
    });
    setMensaje(
      resultado.emailEnviado
        ? { tipo: "exito", texto: `Invitación nueva enviada a ${invitacion.email}.` }
        : {
            tipo: "error",
            texto: "Creamos la invitación nueva, pero no pudimos enviar el correo.",
          },
    );
  }

  async function manejarRevocar() {
    setPendiente("revocar");
    setMensaje(null);
    const resultado = await revocarInvitacionDeEquipo(invitacion.id);
    setPendiente(null);
    if (!resultado.ok) {
      setMensaje({ tipo: "error", texto: resultado.mensaje });
      return;
    }
    onActualizar({ estado: "revocada" });
  }

  return (
    <TableRow>
      <TableCell>
        <div className="space-y-0.5">
          <p className="font-medium text-foreground">{invitacion.email}</p>
          {mensaje ? (
            <p className={mensaje.tipo === "error" ? "text-xs text-destructive" : "text-xs text-success"}>
              {mensaje.texto}
            </p>
          ) : null}
        </div>
      </TableCell>
      <TableCell>
        <Badge variant="outline">{descripcionRol?.etiqueta ?? invitacion.rol}</Badge>
      </TableCell>
      <TableCell>
        <BadgeEstadoInvitacion estado={invitacion.estado} />
      </TableCell>
      <TableCell className="text-sm text-muted-foreground">
        {copyDeApoyo(invitacion)}
        <AvisoEntrega estado={invitacion.emailEstado} motivo={invitacion.emailMotivo} />
      </TableCell>
      <TableCell className="text-right">
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          {invitacion.estado === "pendiente" ? (
            <>
              {puedeInvitar ? (
                <Button variant="outline" size="sm" disabled={pendiente !== null} onClick={manejarReenviar}>
                  {pendiente === "reenviar" ? "Reenviando…" : "Reenviar correo"}
                </Button>
              ) : null}
              {puedeRevocar ? (
                <Button variant="ghost" size="sm" disabled={pendiente !== null} onClick={manejarRevocar}>
                  {pendiente === "revocar" ? "Revocando…" : "Revocar"}
                </Button>
              ) : null}
            </>
          ) : null}
          {(invitacion.estado === "expirada" || invitacion.estado === "revocada") && puedeInvitar ? (
            <Button variant="outline" size="sm" disabled={pendiente !== null} onClick={manejarReinvitar}>
              {pendiente === "reinvitar" ? "Reinvitando…" : "Reinvitar"}
            </Button>
          ) : null}
        </div>
      </TableCell>
    </TableRow>
  );
}

/**
 * El vocabulario de invitación vive en `traduccion-estados.ts` desde el bloque
 * 0.3 del rediseño. Con el eje declarado, `expirada` y `revocada` pasan a
 * `inert` —existen, no sirven y no se borran— y `pendiente` deja el ámbar: una
 * invitación recién enviada tiene 7 días por delante y no es una advertencia.
 */
function BadgeEstadoInvitacion({ estado }: { estado: EstadoInvitacion }) {
  return (
    <BadgeEstado
      variante={BADGE_INVITACION[estado as EstadoInvitacionEquipo] ?? "neutral"}
      texto={traducirEstadoInvitacion(estado)}
      eje="invitacion"
      valor={estado}
    />
  );
}

/**
 * Una invitación recién creada nace SIN estado de entrega, y eso es correcto:
 * el webhook de Resend tarda segundos en volver con "entregado" o "rebotado".
 * `null` significa "todavía no se sabe", NO "llegó bien" — por eso `AvisoEntrega`
 * se queda callado hasta que hay algo que decir.
 */
const SIN_ESTADO_DE_ENTREGA = { emailEstado: null, emailMotivo: null } as const;

/**
 * Qué pasó con el correo después de enviarlo — lo cuenta el webhook de Resend.
 *
 * Va junto al "Enviada hace un minuto" y no en su lugar: son dos hechos
 * distintos y los dos importan. Rutax entregó el correo al proveedor (eso es
 * "enviada"), y el proveedor del destinatario lo aceptó o lo rechazó (esto).
 * Hasta el 2026-08-16 esta pantalla solo mostraba el primero, así que una
 * dirección mal escrita se veía idéntica a una que llegó.
 *
 * Silencioso cuando llegó bien o cuando todavía no se sabe: una fila que dice
 * "entregado" en cada invitación exitosa es ruido que entrena a no mirar la
 * columna. Solo habla cuando hay algo que hacer.
 *
 * Mismo criterio y mismos textos que `avisoEntrega` en `(tenant)/sellers/page.tsx`
 * — si cambia uno, cambia el otro.
 */
function AvisoEntrega({ estado, motivo }: { estado: string | null; motivo: string | null }) {
  if (estado === "rebotado") {
    return (
      <span className="mt-1 block text-xs font-medium text-destructive">
        El correo rebotó — no llegó
        {motivo ? <span className="block font-normal text-muted-foreground">{motivo}</span> : null}
      </span>
    );
  }
  if (estado === "marcado_spam") {
    return (
      <span className="mt-1 block text-xs font-medium text-warning">
        Llegó, pero lo marcaron como spam
      </span>
    );
  }
  return null;
}

/** Copy de apoyo por estado — exactamente lo que pide la tabla de §2.2. */
function copyDeApoyo(invitacion: InvitacionEquipo): string {
  switch (invitacion.estado) {
    case "pendiente": {
      const enviada = formatearTiempoRelativo(invitacion.creadoEn);
      const vence = formatearFecha(invitacion.expiraEn);
      return `Enviada ${enviada} · vence el ${vence}`;
    }
    case "expirada":
      return `Venció el ${formatearFecha(invitacion.expiraEn)}`;
    case "revocada":
      // El esquema actual no guarda quién ni cuándo se revocó (solo queda en
      // bitácora de auditoría) — el copy no inventa ese dato; ver bitácora
      // para el detalle completo si se necesita investigar.
      return "Esta invitación fue cancelada";
    default:
      return "—";
  }
}


// -----------------------------------------------------------------------------
// Suspender / reactivar
// -----------------------------------------------------------------------------
/**
 * Las dos transiciones del estado que la tabla ya pintaba sin tener ninguna.
 *
 * Suspender NO borra: la persona conserva su historial —sus manifiestos, sus
 * líneas en la bitácora— y deja de poder entrar. `capacidadesDe` devuelve el
 * conjunto vacío para quien no está activo, así que el corte vale en toda la
 * app y no depende de que cada pantalla se acuerde de comprobarlo.
 */
function BotonSuspender({
  usuario,
  onActualizado,
}: {
  usuario: UsuarioEquipo;
  onActualizado: (u: UsuarioEquipo) => void;
}) {
  const [pendiente, iniciarTransicion] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const activo = usuario.estado === "activo";

  return (
    <span className="inline-flex flex-col items-end gap-0.5">
      <button
        type="button"
        disabled={pendiente}
        onClick={() =>
          iniciarTransicion(async () => {
            setError(null);
            const { cambiarEstadoDePersona } = await import("./actions");
            const r = await cambiarEstadoDePersona(usuario.id, !activo);
            if (!r.ok) {
              setError(r.mensaje);
              return;
            }
            onActualizado({ ...usuario, estado: activo ? "suspendido" : "activo" });
          })
        }
        className={
          activo
            ? "text-xs font-medium text-fault-fg hover:underline disabled:opacity-50"
            : "text-xs font-medium text-accent-text hover:underline disabled:opacity-50"
        }
      >
        {pendiente ? "…" : activo ? "Suspender" : "Reactivar"}
      </button>
      {error ? <span className="text-xs text-destructive">{error}</span> : null}
    </span>
  );
}

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
import { cn } from "@/lib/utils";
import { DESCRIPCIONES_ROLES_INTERNOS } from "@/modules/identidad/descripciones-roles";
import { PermisosPorRol } from "./permisos-por-rol";
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
          {/* En teléfono «Invitaciones pendientes» empuja la fila de pestañas
              contra el borde. El contexto ya lo da el grupo: las otras dos
              pestañas son «Todos» y «Activos». */}
          <TabsTrigger value="pendientes">
            <span className="sm:hidden">Pendientes</span>
            <span className="hidden sm:inline">Invitaciones pendientes</span>
            {totalPendientes > 0 ? ` (${totalPendientes})` : ""}
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
      <div className="rounded-lg border border-border">
        {/* ─────────────────────────────────────────────────────────────
            A 375 px la fila deja de ser una fila.
            ──────────────────────────────────────────────────────────────
            Mismo patrón que `/sellers` y `/operaciones`: se renderizan LAS
            DOS formas y CSS elige. Decidirlo en JavaScript midiendo el ancho
            sería peor — el servidor no sabe el ancho, así que la primera
            pintura saldría con la forma equivocada y cambiaría delante del
            usuario.

            🔴 Sin esto, en teléfono había que arrastrar la tabla de lado para
            llegar a la columna «Acciones» —la única accionable—, y nada en
            pantalla delataba que estaba ahí.
            ───────────────────────────────────────────────────────────── */}
        <ul className="divide-y divide-border md:hidden">
          {filas.map((fila) =>
            fila.tipo === "usuario" ? (
              <TarjetaUsuario
                key={`tarjeta-usuario-${fila.usuario.id}`}
                usuario={fila.usuario}
                puedeGestionar={puedeGestionar}
                onActualizado={actualizarUsuario}
              />
            ) : (
              <TarjetaInvitacion
                key={`tarjeta-invitacion-${fila.invitacion.id}`}
                invitacion={fila.invitacion}
                puedeInvitar={puedeInvitar}
                puedeRevocar={puedeRevocar}
                onActualizar={(cambios) => actualizarInvitacion(fila.invitacion.id, cambios)}
                onReemplazarPorNueva={(nueva) => reemplazarInvitacionPorNueva(fila.invitacion.id, nueva)}
              />
            ),
          )}
        </ul>

        <div className="hidden overflow-x-auto md:block">
        <Table>
          <TableHeader>
            <TableRow>
              {/* ⚠️ **Cuatro columnas, como el tablero B3b: Persona · Rol ·
                  Estado · Acciones.** Había una quinta, «Detalle», gastando el
                  ancho de una columna entera en una fecha de alta — que ahora va
                  bajo el correo, donde no compite con nada. Ese ancho es
                  justamente el que necesitaba el rol para dejar de ser una
                  etiqueta muda. */}
              <TableHead>Persona</TableHead>
              <TableHead>Rol</TableHead>
              <TableHead>Estado</TableHead>
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
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {encabezado}
      {contenido}
      {/* Va DESPUÉS del listado: se viene a mirar a las personas, y la
          referencia de roles es la pregunta de al lado. Plegado ocupa un
          renglón. */}
      <PermisosPorRol />
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
          <p className="text-xs text-muted-foreground">
            {usuario.email ?? "Sin correo registrado"}
            <span className="text-fg-subtle"> · desde el {formatearFecha(usuario.creadoEn)}</span>
          </p>
        </div>
      </TableCell>
      {/* 🔴 Solo la etiqueta del rol, sin el párrafo de capacidades.
          Acá se listaba `describirRol()` —«Dar de alta gente y cambiarle el
          rol, … y 21 cosas más»— repetido en CADA fila. Era el texto más largo
          de la tabla para el dato menos urgente, y ya está contestado, mejor y
          completo, en «Qué puede hacer cada rol» al pie de la pantalla: los
          cuatro roles con su «Puede» y su «No puede», derivados del mismo
          catálogo. Repetirlo por fila obligaba a `max-w-72 whitespace-normal`
          para que la tinta no se pintara sobre la columna de al lado. */}
      <TableCell className="align-top">
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
// Tarjeta — persona (teléfono)
// -----------------------------------------------------------------------------
/**
 * La misma información que la fila, apilada y con las acciones como botones de
 * verdad.
 *
 * ⚠️ En la tabla, cambiar el rol se abre **tocando la fila entera** — un gesto
 * que en teléfono no se descubre y que compite con el scroll. Acá hay un botón
 * «Cambiar rol» explícito.
 */
function TarjetaUsuario({
  usuario,
  puedeGestionar,
  onActualizado,
}: {
  usuario: UsuarioEquipo;
  puedeGestionar: boolean;
  onActualizado: (u: UsuarioEquipo) => void;
}) {
  const descripcionRol = DESCRIPCIONES_ROLES_INTERNOS[usuario.rol];
  const [panelRolAbierto, setPanelRolAbierto] = useState(false);
  const activo = usuario.estado === "activo";

  return (
    <li className="space-y-2.5 px-4 py-3">
      {/* El nombre y el correo mandan a lo ancho; los dos distintivos —rol y
          estado— comparten su propia fila debajo. Ponerlos al lado del título
          le robaba ancho justo al dato más largo: un correo de 34 caracteres
          se partía a mitad de palabra. */}
      <p className="break-words font-medium text-foreground">{usuario.nombreCompleto}</p>

      <p className="break-words text-xs text-muted-foreground">
        {usuario.email ?? "Sin correo registrado"}
        <span className="text-fg-subtle"> · desde el {formatearFecha(usuario.creadoEn)}</span>
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">{descripcionRol?.etiqueta ?? usuario.rol}</Badge>
        <DistintivoEstado
          tono={activo ? "neutral" : "inert"}
          etiqueta={activo ? "Activo" : "Suspendido"}
        />
      </div>

      {puedeGestionar ? (
        <div className="flex flex-wrap items-center gap-2">
          {activo ? (
            <>
              <Button
                variant="outline"
                size="sm"
                className="min-h-11 flex-1"
                onClick={() => setPanelRolAbierto(true)}
              >
                Cambiar rol
              </Button>
              <DialogoCambiarRol
                usuarioId={usuario.id}
                nombre={usuario.nombreCompleto}
                rolActual={usuario.rol as RolInterno}
                onCambiado={(rol) => onActualizado({ ...usuario, rol })}
                abierto={panelRolAbierto}
                onOpenChange={setPanelRolAbierto}
              />
            </>
          ) : null}
          <BotonSuspender usuario={usuario} onActualizado={onActualizado} presentacion="boton" />
        </div>
      ) : (
        <p className="text-xs text-fg-muted">Solo el dueño puede cambiarlo</p>
      )}
    </li>
  );
}

// -----------------------------------------------------------------------------
// Acciones de una invitación — compartidas por la tarjeta (teléfono) y la fila
// (escritorio).
// -----------------------------------------------------------------------------
/**
 * Las dos formas se renderizan SIEMPRE y CSS elige cuál se ve, así que cada
 * invitación tiene dos instancias montadas. La lógica vive acá una sola vez para
 * que no se dupliquen los manejadores ni se desincronicen los textos.
 *
 * El estado local (`pendiente`, `mensaje`) sí queda por instancia, y está bien:
 * es transitorio y solo una de las dos está a la vista. Lo que tiene que
 * sobrevivir —el estado de la invitación— sube al padre por `onActualizar`.
 */
function useAccionesInvitacion({
  invitacion,
  onActualizar,
  onReemplazarPorNueva,
}: {
  invitacion: InvitacionEquipo;
  onActualizar: (cambios: Partial<InvitacionEquipo>) => void;
  onReemplazarPorNueva: (nueva: InvitacionEnviada) => void;
}) {
  const [pendiente, setPendiente] = useState<"reenviar" | "reinvitar" | "revocar" | null>(null);
  const [mensaje, setMensaje] = useState<{ tipo: "exito" | "error"; texto: string } | null>(null);

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

  return { pendiente, mensaje, manejarReenviar, manejarReinvitar, manejarRevocar };
}

/**
 * Los botones que corresponden al estado de la invitación, en el mismo orden en
 * las dos formas. En teléfono se estiran (`flex-1`) y respetan el alto mínimo de
 * toque; en la tabla van compactos y alineados a la derecha.
 */
function AccionesInvitacion({
  invitacion,
  puedeInvitar,
  puedeRevocar,
  pendiente,
  onReenviar,
  onReinvitar,
  onRevocar,
  claseBoton,
}: {
  invitacion: InvitacionEquipo;
  puedeInvitar: boolean;
  puedeRevocar: boolean;
  pendiente: "reenviar" | "reinvitar" | "revocar" | null;
  onReenviar: () => void;
  onReinvitar: () => void;
  onRevocar: () => void;
  claseBoton?: string;
}) {
  if (invitacion.estado === "pendiente") {
    return (
      <>
        {puedeInvitar ? (
          <Button
            variant="outline"
            size="sm"
            className={claseBoton}
            disabled={pendiente !== null}
            onClick={onReenviar}
          >
            {pendiente === "reenviar" ? "Reenviando…" : "Reenviar correo"}
          </Button>
        ) : null}
        {puedeRevocar ? (
          <Button
            variant="ghost"
            size="sm"
            className={claseBoton}
            disabled={pendiente !== null}
            onClick={onRevocar}
          >
            {pendiente === "revocar" ? "Revocando…" : "Revocar"}
          </Button>
        ) : null}
      </>
    );
  }

  if ((invitacion.estado === "expirada" || invitacion.estado === "revocada") && puedeInvitar) {
    return (
      <Button
        variant="outline"
        size="sm"
        className={claseBoton}
        disabled={pendiente !== null}
        onClick={onReinvitar}
      >
        {pendiente === "reinvitar" ? "Reinvitando…" : "Reinvitar"}
      </Button>
    );
  }

  return null;
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
  const descripcionRol = DESCRIPCIONES_ROLES_INTERNOS[invitacion.rol];
  const { pendiente, mensaje, manejarReenviar, manejarReinvitar, manejarRevocar } =
    useAccionesInvitacion({ invitacion, onActualizar, onReemplazarPorNueva });

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
      {/* Solo la etiqueta, igual que en la fila de persona — ver el porqué allá
          arriba. */}
      <TableCell className="align-top">
        <Badge variant="outline">{descripcionRol?.etiqueta ?? invitacion.rol}</Badge>
      </TableCell>
      {/* 🔴 UNA sola celda de Estado, no dos.
          Hasta el 26-08-2026 esta fila tenía CINCO celdas contra los CUATRO
          encabezados de la tabla —y contra las cuatro de `FilaUsuario`—. La
          quinta columna «Detalle» se retiró del encabezado y **se olvidó acá**.

          El navegador no se queja: dibuja la columna huérfana igual, más ancha
          que el encabezado, y el resultado en producción era el texto del
          estado impreso ENCIMA de la descripción del rol, con el motivo del
          rebote saliéndose de la tabla. Se veía como un problema de CSS y era
          un desajuste de estructura.

          El ancho máximo no es decoración: el motivo que manda Resend viene
          recortado a 300 caracteres (`webhook-resend.ts`), y 300 caracteres sin
          tope estiran la tabla entera hasta obligar a scroll horizontal. */}
      <TableCell className="max-w-64 whitespace-normal align-top text-sm text-muted-foreground">
        <BadgeEstadoInvitacion estado={invitacion.estado} />
        <p className="mt-1 leading-snug">{copyDeApoyo(invitacion)}</p>
        <AvisoEntrega estado={invitacion.emailEstado} motivo={invitacion.emailMotivo} />
      </TableCell>
      <TableCell className="text-right">
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          <AccionesInvitacion
            invitacion={invitacion}
            puedeInvitar={puedeInvitar}
            puedeRevocar={puedeRevocar}
            pendiente={pendiente}
            onReenviar={manejarReenviar}
            onReinvitar={manejarReinvitar}
            onRevocar={manejarRevocar}
          />
        </div>
      </TableCell>
    </TableRow>
  );
}

// -----------------------------------------------------------------------------
// Tarjeta — invitación (teléfono)
// -----------------------------------------------------------------------------
/**
 * Lo mismo que la fila, apilado. El motivo del rebote —que en la tabla obligaba
 * a acotar la celda a `max-w-64` para no estirarla— acá dispone del ancho
 * completo de la tarjeta, que es justo donde se quiere leer.
 */
function TarjetaInvitacion({
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
  const descripcionRol = DESCRIPCIONES_ROLES_INTERNOS[invitacion.rol];
  const { pendiente, mensaje, manejarReenviar, manejarReinvitar, manejarRevocar } =
    useAccionesInvitacion({ invitacion, onActualizar, onReemplazarPorNueva });

  return (
    <li className="space-y-2.5 px-4 py-3">
      {/* Misma estructura que la tarjeta de persona: el correo a lo ancho, y
          rol + estado juntos debajo. */}
      <p className="break-words font-medium text-foreground">{invitacion.email}</p>

      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">{descripcionRol?.etiqueta ?? invitacion.rol}</Badge>
        <BadgeEstadoInvitacion estado={invitacion.estado} />
      </div>

      <div className="text-sm text-muted-foreground">
        <p className="leading-snug">{copyDeApoyo(invitacion)}</p>
        <AvisoEntrega estado={invitacion.emailEstado} motivo={invitacion.emailMotivo} />
      </div>

      {mensaje ? (
        <p className={mensaje.tipo === "error" ? "text-xs text-destructive" : "text-xs text-success"}>
          {mensaje.texto}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 empty:hidden">
        <AccionesInvitacion
          invitacion={invitacion}
          puedeInvitar={puedeInvitar}
          puedeRevocar={puedeRevocar}
          pendiente={pendiente}
          onReenviar={manejarReenviar}
          onReinvitar={manejarReinvitar}
          onRevocar={manejarRevocar}
          claseBoton="min-h-11 flex-1"
        />
      </div>
    </li>
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
        {/* El motivo lo escribe el PROVEEDOR: viene en inglés, dirigido a
            nosotros y no al courier («we recommend removing the recipient from
            your list»), y puede traer 300 caracteres. Se muestra porque a veces
            dice lo único útil —«The recipient does not exist»— pero acotado a
            dos líneas, con el texto completo al pasar el cursor. Lo accionable
            ya lo dijo la línea de arriba. */}
        {motivo ? (
          <span
            /* Sin `block`: `line-clamp-2` necesita `display:-webkit-box` y una
               utilidad de `display` puesta después lo pisa — el recorte deja de
               recortar y no avisa. Pasó acá: cuatro líneas en vez de dos. */
            className="mt-0.5 line-clamp-2 font-normal text-muted-foreground"
            title={motivo}
          >
            {motivo}
          </span>
        ) : null}
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
  presentacion = "enlace",
}: {
  usuario: UsuarioEquipo;
  onActualizado: (u: UsuarioEquipo) => void;
  /**
   * «enlace» en la tabla, donde convive con otras acciones de texto; «boton» en
   * la tarjeta de teléfono, donde tiene que ser un objetivo de toque de verdad
   * al lado de «Cambiar rol». Un enlace de 16 px de alto no se acierta con el
   * pulgar.
   */
  presentacion?: "enlace" | "boton";
}) {
  const [pendiente, iniciarTransicion] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const activo = usuario.estado === "activo";

  function alternar() {
    iniciarTransicion(async () => {
      setError(null);
      const { cambiarEstadoDePersona } = await import("./actions");
      const r = await cambiarEstadoDePersona(usuario.id, !activo);
      if (!r.ok) {
        setError(r.mensaje);
        return;
      }
      onActualizado({ ...usuario, estado: activo ? "suspendido" : "activo" });
    });
  }

  const etiqueta = pendiente ? "…" : activo ? "Suspender" : "Reactivar";

  if (presentacion === "boton") {
    return (
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={pendiente}
          onClick={alternar}
          className={cn("min-h-11 w-full", activo ? "text-fault-fg" : "text-accent-text")}
        >
          {etiqueta}
        </Button>
        {error ? <span className="text-xs text-destructive">{error}</span> : null}
      </span>
    );
  }

  return (
    <span className="inline-flex flex-col items-end gap-0.5">
      <button
        type="button"
        disabled={pendiente}
        onClick={alternar}
        className={
          activo
            ? "text-xs font-medium text-fault-fg hover:underline disabled:opacity-50"
            : "text-xs font-medium text-accent-text hover:underline disabled:opacity-50"
        }
      >
        {etiqueta}
      </button>
      {error ? <span className="text-xs text-destructive">{error}</span> : null}
    </span>
  );
}

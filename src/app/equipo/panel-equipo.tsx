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

import { useMemo, useState } from "react";
import { UserPlus, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EstadoError, EstadoVacio } from "@/components/onboarding/estado-pantalla";
import { formatearFecha, formatearTiempoRelativo } from "@/lib/formato-cl";
import { DESCRIPCIONES_ROLES_INTERNOS } from "./descripciones-roles";
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
}

export function PanelEquipo({ estadoInicial, errorInicial, puedeInvitar, puedeRevocar }: Props) {
  const [estado, setEstado] = useState<EstadoEquipo | null>(estadoInicial);
  const [errorCarga, setErrorCarga] = useState<string | null>(errorInicial);
  const [recargando, setRecargando] = useState(false);
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [formularioAbierto, setFormularioAbierto] = useState(false);

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
        ? { ...anterior, invitaciones: [{ ...invitacion }, ...anterior.invitaciones] }
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
              { ...nueva },
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
                <FilaUsuario key={`usuario-${fila.usuario.id}`} usuario={fila.usuario} />
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

function FilaUsuario({ usuario }: { usuario: UsuarioEquipo }) {
  const descripcionRol = DESCRIPCIONES_ROLES_INTERNOS[usuario.rol];

  return (
    <TableRow>
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
        {usuario.estado === "activo" ? (
          <Badge variant="outline" className="border-emerald-300 text-emerald-700 dark:text-emerald-400">
            Activo
          </Badge>
        ) : (
          <Badge variant="outline" className="border-muted-foreground/30 text-muted-foreground">
            Suspendido
          </Badge>
        )}
      </TableCell>
      <TableCell className="text-sm text-muted-foreground">Miembro desde el {formatearFecha(usuario.creadoEn)}</TableCell>
      <TableCell className="text-right text-xs text-muted-foreground">
        {/* Cambiar rol / suspender es una acción de mayor riesgo — se deja para
            una iteración posterior con su propio diálogo de confirmación; no
            se improvisa aquí un botón sin el flujo de confirmación que una
            acción sobre el acceso de otra persona amerita. */}
        Gestión de rol próximamente
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
    setMensaje({ tipo: "exito", texto: `Invitación reenviada a ${invitacion.email}.` });
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
    setMensaje({ tipo: "exito", texto: `Invitación nueva enviada a ${invitacion.email}.` });
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
            <p className={mensaje.tipo === "error" ? "text-xs text-destructive" : "text-xs text-emerald-700 dark:text-emerald-400"}>
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
      <TableCell className="text-sm text-muted-foreground">{copyDeApoyo(invitacion)}</TableCell>
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

function BadgeEstadoInvitacion({ estado }: { estado: EstadoInvitacion }) {
  switch (estado) {
    case "pendiente":
      return (
        <Badge variant="outline" className="border-amber-300 text-amber-700 dark:text-amber-400">
          Pendiente
        </Badge>
      );
    case "aceptada":
      return (
        <Badge variant="outline" className="border-emerald-300 text-emerald-700 dark:text-emerald-400">
          Aceptada
        </Badge>
      );
    case "expirada":
      return (
        <Badge variant="outline" className="border-muted-foreground/30 text-muted-foreground">
          Expirada
        </Badge>
      );
    case "revocada":
      return (
        <Badge variant="outline" className="border-muted-foreground/30 text-muted-foreground">
          Revocada
        </Badge>
      );
    default:
      return <Badge variant="outline">{estado}</Badge>;
  }
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

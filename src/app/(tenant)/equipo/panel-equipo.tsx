"use client";

/**
 * Pantalla H — Lista de usuarios e invitaciones: panel de cliente.
 *
 * Una sola lista con dos grupos visuales (§2.2): "Usuarios activos" e
 * "Invitaciones", con pestañas "Todos · Activos · Invitaciones pendientes"
 * para que el dueño se enfoque en "qué necesita seguimiento" sin scrollear
 * una lista mezclada. El botón primario "Invitar persona" abre la Pantalla I
 * en un panel lateral (Sheet) — nunca página completa, para no romper el
 * contexto de "estoy viendo mi equipo".
 *
 * -----------------------------------------------------------------------------
 * 🔴 ESTO ES UN PADRÓN DE PERSONAS, NO UN MURO DE ACCIONES
 * -----------------------------------------------------------------------------
 * Cada fila tiene entre una y dos acciones. Pintadas como botones dentro de la
 * fila, un equipo de 15 personas son 30 botones apilados: la pantalla se lee
 * como una botonera y la pregunta que de verdad se viene a responder —quién
 * tiene acceso, con qué rol, y qué invitaciones están en el aire— queda debajo
 * del ruido.
 *
 * Por eso las acciones se recogen en un **menú de desbordamiento (`⋯`)** por
 * fila, igual que en la bandeja de conciliación (`menu-acciones-conciliacion`).
 * La fila muestra SOLO información; el `⋯` está a un toque y no compite. Es el
 * patrón de cualquier lista de miembros que tenga que escalar.
 *
 * Dos consecuencias que se heredan de ese menú y conviene no deshacer:
 *   · **El éxito va por notificación temporal; el error se queda DENTRO del
 *     menú.** Si el fallo se fuera en cuatro segundos, el usuario vería la fila
 *     igual que antes sin saber que su acción no ocurrió.
 *   · La fila **ya no se abre al tocarla**. Antes, cambiar el rol era un clic
 *     sobre la fila entera: un gesto invisible que en teléfono además compite
 *     con el scroll. Ahora toda acción entra por el mismo sitio.
 */

import { useMemo, useState, useTransition } from "react";
import { Loader2, MoreHorizontal, UserPlus, Users } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { BadgeEstado } from "@/components/ui/badge-estado";
import {
  BADGE_INVITACION,
  traducirEstadoInvitacion,
  type EstadoInvitacionEquipo,
} from "@/lib/ui/traduccion-estados";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DistintivoEstado } from "@/components/ui/distintivo-estado";
import { EstadoError, EstadoVacio } from "@/components/estado/estado-pantalla";
import { formatearFecha, formatearTiempoRelativo } from "@/lib/formato-cl";
import { DESCRIPCIONES_ROLES_INTERNOS } from "@/modules/identidad/descripciones-roles";
import { PermisosPorRol } from "./permisos-por-rol";
import { DialogoCambiarRol } from "./dialogo-cambiar-rol";
import { ROLES_INTERNOS, type RolInterno } from "@/modules/identidad/roles";
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

  /** Archivada en base: se va de la lista sin recargar la pantalla. */
  function quitarInvitacion(id: string) {
    setEstado((anterior) =>
      anterior
        ? { ...anterior, invitaciones: anterior.invitaciones.filter((inv) => inv.id !== id) }
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

  const grupos = useMemo(() => construirGrupos(estado, filtro), [estado, filtro]);

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
        titulo="Aún no has invitado a nadie"
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
  } else if (grupos.length === 0) {
    contenido = (
      <EstadoVacio titulo="Nadie en esta pestaña" />
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
          {grupos.map((grupo) => (
            <li key={grupo.clave}>
              <EncabezadoGrupoTarjeta titulo={grupo.titulo} total={grupo.filas.length} />
              <ul className="divide-y divide-border border-t border-border">
                {grupo.filas.map((fila) =>
                  fila.tipo === "usuario" ? (
                    <TarjetaUsuario
                      key={`tarjeta-usuario-${fila.usuario.id}`}
                      usuario={fila.usuario}
                      mostrarRol={grupo.clave === GRUPO_SIN_ACCESO}
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
                      onArchivar={() => quitarInvitacion(fila.invitacion.id)}
                    />
                  ),
                )}
              </ul>
            </li>
          ))}
        </ul>

        <div className="hidden overflow-x-auto md:block">
          <Table>
            <TableHeader>
              <TableRow>
                {/* 🔴 NO hay columna «Rol», y su ausencia es la consecuencia de
                    agrupar: el rol lo dice el encabezado del grupo, así que la
                    columna habría quedado vacía en casi todas las filas — y una
                    columna vacía se lee como dato que falta, que es peor que la
                    redundancia que venía a resolver. El rol aparece junto al
                    nombre solo donde el grupo NO lo dice: en «Sin acceso» y en
                    las invitaciones.

                    La de acciones va sin rótulo: es una columna de iconos, y
                    titularla la haría pesar más de lo que vale. */}
                <TableHead>Persona</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="w-12">
                  <span className="sr-only">Acciones</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            {grupos.map((grupo) => (
              <TableBody key={grupo.clave}>
                <EncabezadoGrupoFila titulo={grupo.titulo} total={grupo.filas.length} />
                {grupo.filas.map((fila) =>
                  fila.tipo === "usuario" ? (
                    <FilaUsuario
                      key={`usuario-${fila.usuario.id}`}
                      usuario={fila.usuario}
                      mostrarRol={grupo.clave === GRUPO_SIN_ACCESO}
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
                      onArchivar={() => quitarInvitacion(fila.invitacion.id)}
                    />
                  ),
                )}
              </TableBody>
            ))}
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
  | { tipo: "usuario"; usuario: UsuarioEquipo }
  | { tipo: "invitacion"; invitacion: InvitacionEquipo };

interface GrupoFilas {
  clave: string;
  titulo: string;
  filas: FilaCombinada[];
}

/**
 * El único grupo de personas cuyo encabezado NO dice un rol, así que es el
 * único donde la fila tiene que mostrarlo.
 */
const GRUPO_SIN_ACCESO = "sin-acceso";

/** Orden alfabético de personas, con las reglas del español (tildes, ñ). */
const porNombre = (a: UsuarioEquipo, b: UsuarioEquipo) =>
  a.nombreCompleto.localeCompare(b.nombreCompleto, "es");

/**
 * El padrón, agrupado.
 * =============================================================================
 *
 * 🔴 **Antes esto era una sola lista ordenada por fecha de alta, descendente.**
 * Desde el ojo de quien mira, ese orden es azar: el dueño podía aparecer en
 * medio, entre dos coordinadores. La lista no se sentía larga, se sentía un
 * montón — y de ahí salía el impulso de filtrar por rol.
 *
 * Agrupar responde esa necesidad SIN esconder a nadie y sin agregar un control:
 * se ve el equipo completo y su estructura de un vistazo, y «¿cuántos
 * coordinadores tengo?» se contesta sin hacer clic. Un desplegable por rol
 * obligaría a preguntar rol por rol, y con solo cuatro roles cada bolsa sería
 * diminuta.
 *
 * Tres decisiones del orden que no son obvias:
 *   · **Las invitaciones van primero** porque son lo único que pide acción.
 *   · **Los roles van en orden de jerarquía**, no alfabético: Dueño ·
 *     Supervisor · Coordinador · Administración, tal como los declara
 *     `ROLES_INTERNOS`. Alfabéticamente, «Administración» abriría la lista.
 *   · **Quien está suspendido sale de su grupo de rol** y baja a «Sin acceso».
 *     Si contara dentro de «Coordinador · 3», ese 3 mentiría: no son tres
 *     coordinadores que puedan trabajar hoy. El recuento por rol es justamente
 *     lo que da valor a agrupar, así que tiene que ser cierto.
 */
function construirGrupos(estado: EstadoEquipo | null, filtro: Filtro): GrupoFilas[] {
  if (!estado) return [];

  const grupos: GrupoFilas[] = [];

  // 1. Invitaciones. Las "aceptadas" ya tienen su usuario en la otra lista y no
  //    se duplican aquí (§2.2). Las pendientes primero: son las accionables.
  if (filtro !== "activos") {
    const invitaciones = estado.invitaciones
      .filter((inv) => inv.estado !== "aceptada")
      .filter((inv) => filtro !== "pendientes" || inv.estado === "pendiente")
      .sort((a, b) => {
        if (a.estado !== b.estado) return a.estado === "pendiente" ? -1 : 1;
        return new Date(b.creadoEn).getTime() - new Date(a.creadoEn).getTime();
      })
      .map((invitacion): FilaCombinada => ({ tipo: "invitacion", invitacion }));

    if (invitaciones.length > 0) {
      grupos.push({ clave: "invitaciones", titulo: "Invitaciones", filas: invitaciones });
    }
  }

  if (filtro !== "pendientes") {
    // 2. Las personas con acceso, por rol y en orden de jerarquía.
    for (const rol of ROLES_INTERNOS) {
      const delRol = estado.usuarios
        .filter((u) => u.estado === "activo" && u.rol === rol)
        .sort(porNombre)
        .map((usuario): FilaCombinada => ({ tipo: "usuario", usuario }));

      if (delRol.length > 0) {
        grupos.push({
          clave: `rol-${rol}`,
          titulo: DESCRIPCIONES_ROLES_INTERNOS[rol]?.etiqueta ?? rol,
          filas: delRol,
        });
      }
    }

    // 3. Y al final quien ya no entra.
    const suspendidos = estado.usuarios
      .filter((u) => u.estado !== "activo")
      .sort(porNombre)
      .map((usuario): FilaCombinada => ({ tipo: "usuario", usuario }));

    if (suspendidos.length > 0) {
      grupos.push({ clave: GRUPO_SIN_ACCESO, titulo: "Sin acceso", filas: suspendidos });
    }
  }

  return grupos;
}

// -----------------------------------------------------------------------------
// Encabezados de grupo
// -----------------------------------------------------------------------------
/**
 * En teléfono el encabezado es **pegajoso**, y el `top-14` no es un número
 * suelto: es el alto exacto de la barra superior del `AppShell`
 * (`sticky top-0 z-20 h-14`, oculta desde `lg`). Sin ese desplazamiento el
 * título del grupo se metería debajo de la barra; con un `z` de 20 o más, se le
 * pondría encima. Si esa barra cambia de alto, este valor cambia con ella.
 *
 * Sirve justo cuando hace falta: desplazando un equipo largo, siempre se sabe
 * de qué rol es la persona que se está mirando.
 */
function EncabezadoGrupoTarjeta({ titulo, total }: { titulo: string; total: number }) {
  return (
    <div className="sticky top-14 z-10 flex items-center justify-between gap-2 bg-bg-sunken px-4 py-2">
      <span className="text-xs font-semibold uppercase tracking-wide text-fg-muted">{titulo}</span>
      <span className="text-xs text-fg-muted tabular-nums">{total}</span>
    </div>
  );
}

/**
 * En la tabla cada grupo es su propio `<tbody>` — no una fila suelta dentro de
 * uno compartido—, que es la forma que HTML ya tiene para decir "esto es una
 * sección". No es pegajoso: en escritorio la lista entra casi siempre completa.
 */
function EncabezadoGrupoFila({ titulo, total }: { titulo: string; total: number }) {
  return (
    <TableRow className="bg-bg-sunken hover:bg-bg-sunken">
      <TableCell colSpan={3} className="py-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-fg-muted">{titulo}</span>
        <span className="ml-2 text-xs text-fg-muted tabular-nums">{total}</span>
      </TableCell>
    </TableRow>
  );
}

// -----------------------------------------------------------------------------
// El disparador del menú — mismo objeto en tarjeta y en fila
// -----------------------------------------------------------------------------
/**
 * `size-11` (44 px) en teléfono y `size-8` en escritorio: el pulgar necesita el
 * objetivo grande, el puntero no, y una columna de iconos de 44 px en la tabla
 * engordaría cada fila sin motivo.
 */
function DisparadorMenu({ ocupado, etiqueta }: { ocupado: boolean; etiqueta: string }) {
  return (
    <DropdownMenuTrigger asChild>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        disabled={ocupado}
        aria-label={etiqueta}
        className="size-11 md:size-8"
      >
        {ocupado ? (
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        ) : (
          <MoreHorizontal className="size-4" aria-hidden="true" />
        )}
      </Button>
    </DropdownMenuTrigger>
  );
}

/**
 * Una opción del menú. En teléfono el alto mínimo de toque manda (44 px) y el
 * menú se ensancha para que «Reenviar correo» no se parta en dos renglones; en
 * escritorio vuelve a la densidad compacta del resto de la aplicación.
 */
const CLASE_ITEM_MENU = "min-h-11 md:min-h-0";
const CLASE_CONTENIDO_MENU = "min-w-44";

/** El error de una acción, dentro del menú. Ver la cabecera del archivo. */
function ErrorEnMenu({ children }: { children: React.ReactNode }) {
  return (
    <div
      role="alert"
      className="mb-1 max-w-64 border-b border-fault-line bg-fault-bg px-2 py-2 text-xs leading-relaxed text-fault-fg"
    >
      {children}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Menú de acciones — persona
// -----------------------------------------------------------------------------
/**
 * Cambiar el rol y suspender/reactivar. Se monta una vez por persona y lo usan
 * las dos formas (tarjeta y fila), así que la lógica no se duplica.
 *
 * Suspender NO borra: la persona conserva su historial —sus manifiestos, sus
 * líneas en la bitácora— y deja de poder entrar. `capacidadesDe` devuelve el
 * conjunto vacío para quien no está activo, así que el corte vale en toda la
 * app y no depende de que cada pantalla se acuerde de comprobarlo.
 */
function MenuAccionesPersona({
  usuario,
  onActualizado,
}: {
  usuario: UsuarioEquipo;
  onActualizado: (u: UsuarioEquipo) => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const [panelRolAbierto, setPanelRolAbierto] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendiente, iniciarTransicion] = useTransition();
  const activo = usuario.estado === "activo";

  function alternarEstado() {
    iniciarTransicion(async () => {
      setError(null);
      const { cambiarEstadoDePersona } = await import("./actions");
      const r = await cambiarEstadoDePersona(usuario.id, !activo);
      if (!r.ok) {
        setError(r.mensaje);
        return;
      }
      setAbierto(false);
      onActualizado({ ...usuario, estado: activo ? "suspendido" : "activo" });
      toast.success(
        activo
          ? `${usuario.nombreCompleto} ya no puede entrar.`
          : `${usuario.nombreCompleto} vuelve a tener acceso.`,
      );
    });
  }

  return (
    <>
      <DropdownMenu
        open={abierto}
        onOpenChange={(v) => {
          setAbierto(v);
          if (!v) setError(null);
        }}
      >
        <DisparadorMenu ocupado={pendiente} etiqueta={`Acciones de ${usuario.nombreCompleto}`} />
        <DropdownMenuContent align="end" className={CLASE_CONTENIDO_MENU}>
          {error ? (
            <ErrorEnMenu>
              <strong>No se pudo aplicar el cambio.</strong> {error}
            </ErrorEnMenu>
          ) : null}
          {/* Cambiar el rol solo tiene sentido sobre alguien activo: a quien
              está suspendido el rol no le habilita nada. */}
          {activo ? (
            <DropdownMenuItem
              className={CLASE_ITEM_MENU}
              disabled={pendiente}
              onSelect={() => {
                setAbierto(false);
                setPanelRolAbierto(true);
              }}
            >
              Cambiar rol
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem
            className={CLASE_ITEM_MENU}
            variant={activo ? "destructive" : "default"}
            disabled={pendiente}
            onSelect={(e) => {
              // Sin esto el menú se cierra antes de que vuelva el servidor, y
              // el error no tendría dónde aparecer.
              e.preventDefault();
              alternarEstado();
            }}
          >
            {activo ? "Suspender" : "Reactivar"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {activo ? (
        <DialogoCambiarRol
          usuarioId={usuario.id}
          nombre={usuario.nombreCompleto}
          rolActual={usuario.rol as RolInterno}
          onCambiado={(rol) => onActualizado({ ...usuario, rol })}
          abierto={panelRolAbierto}
          onOpenChange={setPanelRolAbierto}
        />
      ) : null}
    </>
  );
}

// -----------------------------------------------------------------------------
// Menú de acciones — invitación
// -----------------------------------------------------------------------------
/** Las opciones dependen del estado: pendiente reenvía o revoca; expirada y
 *  revocada solo se pueden reinvitar. */
function MenuAccionesInvitacion({
  invitacion,
  puedeInvitar,
  puedeRevocar,
  onActualizar,
  onReemplazarPorNueva,
  onArchivar,
}: {
  invitacion: InvitacionEquipo;
  puedeInvitar: boolean;
  puedeRevocar: boolean;
  onActualizar: (cambios: Partial<InvitacionEquipo>) => void;
  onReemplazarPorNueva: (nueva: InvitacionEnviada) => void;
  /** Ya está archivada en base: sacarla también de la lista en pantalla. */
  onArchivar: () => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const [pendiente, setPendiente] = useState<"reenviar" | "reinvitar" | "revocar" | "archivar" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const esPendiente = invitacion.estado === "pendiente";
  const esReinvitable = invitacion.estado === "expirada" || invitacion.estado === "revocada";

  const puedeReenviar = esPendiente && puedeInvitar;
  const puedeRevocarla = esPendiente && puedeRevocar;
  const puedeReinvitar = esReinvitable && puedeInvitar;
  /**
   * Quitar del listado. Solo sobre una invitación ya muerta: esconder una
   * PENDIENTE dejaría su enlace sirviendo para entrar, sin nada en pantalla
   * desde donde revocarla. La base impone la misma regla con un CHECK.
   */
  const puedeArchivarla = esReinvitable && puedeRevocar;

  // Sin una sola opción, el `⋯` sería un botón que no hace nada.
  if (!puedeReenviar && !puedeRevocarla && !puedeReinvitar && !puedeArchivarla) return null;

  async function manejarReenviar() {
    setPendiente("reenviar");
    setError(null);
    const resultado = await reenviarInvitacion(invitacion.id);
    setPendiente(null);
    if (!resultado.ok) {
      setError(resultado.mensaje);
      return;
    }
    setAbierto(false);
    if (resultado.emailEnviado) {
      toast.success(`Correo reenviado a ${invitacion.email}.`);
    } else {
      toast.error("No pudimos enviar el correo.");
    }
  }

  async function manejarReinvitar() {
    setPendiente("reinvitar");
    setError(null);
    const resultado = await reinvitarUsuario(invitacion.id);
    setPendiente(null);
    if (!resultado.ok) {
      setError(resultado.mensaje);
      return;
    }
    setAbierto(false);
    onReemplazarPorNueva({
      id: crypto.randomUUID(),
      email: invitacion.email,
      rol: invitacion.rol,
      estado: "pendiente",
      expiraEn: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      creadoEn: new Date().toISOString(),
    });
    if (resultado.emailEnviado) {
      toast.success(`Invitación nueva enviada a ${invitacion.email}.`);
    } else {
      toast.error("Creamos la invitación nueva, pero no pudimos enviar el correo.");
    }
  }

  async function manejarArchivar() {
    setPendiente("archivar");
    setError(null);
    const { archivarInvitacionDeEquipo } = await import("./actions");
    const resultado = await archivarInvitacionDeEquipo(invitacion.id);
    setPendiente(null);
    if (!resultado.ok) {
      setError(resultado.mensaje);
      return;
    }
    setAbierto(false);
    onArchivar();
    toast.success(`Invitación de ${invitacion.email} quitada de la lista.`);
  }

  async function manejarRevocar() {
    setPendiente("revocar");
    setError(null);
    const resultado = await revocarInvitacionDeEquipo(invitacion.id);
    setPendiente(null);
    if (!resultado.ok) {
      setError(resultado.mensaje);
      return;
    }
    setAbierto(false);
    onActualizar({ estado: "revocada" });
    toast.success(`Invitación de ${invitacion.email} cancelada.`);
  }

  return (
    <DropdownMenu
      open={abierto}
      onOpenChange={(v) => {
        setAbierto(v);
        if (!v) setError(null);
      }}
    >
      <DisparadorMenu ocupado={pendiente !== null} etiqueta={`Acciones de la invitación a ${invitacion.email}`} />
      <DropdownMenuContent align="end" className={CLASE_CONTENIDO_MENU}>
        {error ? (
          <ErrorEnMenu>
            <strong>No se pudo completar.</strong> {error}
          </ErrorEnMenu>
        ) : null}
        {puedeReenviar ? (
          <DropdownMenuItem
            className={CLASE_ITEM_MENU}
            disabled={pendiente !== null}
            onSelect={(e) => {
              e.preventDefault();
              void manejarReenviar();
            }}
          >
            Reenviar correo
          </DropdownMenuItem>
        ) : null}
        {puedeReinvitar ? (
          <DropdownMenuItem
            className={CLASE_ITEM_MENU}
            disabled={pendiente !== null}
            onSelect={(e) => {
              e.preventDefault();
              void manejarReinvitar();
            }}
          >
            Reinvitar
          </DropdownMenuItem>
        ) : null}
        {puedeRevocarla ? (
          <DropdownMenuItem
            className={CLASE_ITEM_MENU}
            variant="destructive"
            disabled={pendiente !== null}
            onSelect={(e) => {
              e.preventDefault();
              void manejarRevocar();
            }}
          >
            Revocar
          </DropdownMenuItem>
        ) : null}
        {/* Va separada y SIN el rojo de «Revocar»: no es una acción sobre el
            acceso —esa invitación ya está muerta— sino sobre la lista. Pintarla
            como destructiva sugeriría que borra algo, y no borra nada. */}
        {puedeArchivarla ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className={CLASE_ITEM_MENU}
              disabled={pendiente !== null}
              onSelect={(e) => {
                e.preventDefault();
                void manejarArchivar();
              }}
            >
              Quitar de la lista
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// -----------------------------------------------------------------------------
// Fila — usuario activo (escritorio)
// -----------------------------------------------------------------------------

function FilaUsuario({
  usuario,
  mostrarRol,
  puedeGestionar,
  onActualizado,
}: {
  usuario: UsuarioEquipo;
  /** Solo en «Sin acceso»: en los grupos de rol lo dice el encabezado. */
  mostrarRol: boolean;
  puedeGestionar: boolean;
  onActualizado: (u: UsuarioEquipo) => void;
}) {
  const descripcionRol = DESCRIPCIONES_ROLES_INTERNOS[usuario.rol];

  return (
    <TableRow>
      <TableCell>
        <div className="space-y-0.5">
          <p className="font-medium text-foreground">{usuario.nombreCompleto}</p>
          <p className="text-xs text-muted-foreground">
            {usuario.email ?? "Sin correo registrado"}
            <span className="text-fg-subtle"> · desde el {formatearFecha(usuario.creadoEn)}</span>
          </p>
          {/* 🔴 Nunca el párrafo de capacidades. Acá se listaba
              `describirRol()` —«Dar de alta gente y cambiarle el rol, … y 21
              cosas más»— repetido en CADA fila: el texto más largo de la tabla
              para el dato menos urgente, ya contestado completo en «Qué puede
              hacer cada rol» al pie, derivado del mismo catálogo. */}
          {mostrarRol ? (
            <p className="pt-1">
              <Badge variant="outline">{descripcionRol?.etiqueta ?? usuario.rol}</Badge>
            </p>
          ) : null}
        </div>
      </TableCell>
      <TableCell>
        <DistintivoEstado
          tono={usuario.estado === "activo" ? "neutral" : "inert"}
          etiqueta={usuario.estado === "activo" ? "Activo" : "Suspendido"}
        />
      </TableCell>
      <TableCell className="text-right">
        {puedeGestionar ? (
          <MenuAccionesPersona usuario={usuario} onActualizado={onActualizado} />
        ) : null}
      </TableCell>
    </TableRow>
  );
}

// -----------------------------------------------------------------------------
// Tarjeta — persona (teléfono)
// -----------------------------------------------------------------------------
/**
 * La misma información que la fila, apilada. El nombre y el correo mandan a lo
 * ancho y los distintivos —rol y estado— comparten su propia línea: ponerlos al
 * lado del título le robaba ancho justo al dato más largo, y un correo de 34
 * caracteres se partía a mitad de palabra.
 */
function TarjetaUsuario({
  usuario,
  mostrarRol,
  puedeGestionar,
  onActualizado,
}: {
  usuario: UsuarioEquipo;
  /** Solo en «Sin acceso»: en los grupos de rol lo dice el encabezado. */
  mostrarRol: boolean;
  puedeGestionar: boolean;
  onActualizado: (u: UsuarioEquipo) => void;
}) {
  const descripcionRol = DESCRIPCIONES_ROLES_INTERNOS[usuario.rol];
  const activo = usuario.estado === "activo";

  return (
    <li className="flex items-start gap-2 px-4 py-3">
      <div className="min-w-0 flex-1 space-y-2">
        <p className="break-words font-medium text-foreground">{usuario.nombreCompleto}</p>
        {/* Sin la fecha de alta, que sí va en la fila de escritorio. En 343 px
            empujaba el correo a un segundo renglón y alargaba cada tarjeta por
            el dato menos urgente del padrón: a quién tiene acceso hoy no le
            aporta desde cuándo. */}
        <p className="break-words text-xs text-muted-foreground">
          {usuario.email ?? "Sin correo registrado"}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {mostrarRol ? (
            <Badge variant="outline">{descripcionRol?.etiqueta ?? usuario.rol}</Badge>
          ) : null}
          <DistintivoEstado
            tono={activo ? "neutral" : "inert"}
            etiqueta={activo ? "Activo" : "Suspendido"}
          />
        </div>
      </div>
      {puedeGestionar ? (
        <MenuAccionesPersona usuario={usuario} onActualizado={onActualizado} />
      ) : null}
    </li>
  );
}

// -----------------------------------------------------------------------------
// Fila — invitación (escritorio)
// -----------------------------------------------------------------------------

function FilaInvitacion({
  invitacion,
  puedeInvitar,
  puedeRevocar,
  onActualizar,
  onReemplazarPorNueva,
  onArchivar,
}: {
  invitacion: InvitacionEquipo;
  puedeInvitar: boolean;
  puedeRevocar: boolean;
  onActualizar: (cambios: Partial<InvitacionEquipo>) => void;
  onReemplazarPorNueva: (nueva: InvitacionEnviada) => void;
  onArchivar: () => void;
}) {
  const descripcionRol = DESCRIPCIONES_ROLES_INTERNOS[invitacion.rol];

  return (
    <TableRow>
      {/* El rol va acá, junto al correo: el encabezado de este grupo dice
          «Invitaciones», no un rol, así que la fila es el único sitio donde se
          puede saber qué se está entregando — y al invitar es justo cuando más
          importa. */}
      <TableCell>
        <p className="font-medium text-foreground">{invitacion.email}</p>
        <p className="pt-1">
          <Badge variant="outline">{descripcionRol?.etiqueta ?? invitacion.rol}</Badge>
        </p>
      </TableCell>
      {/* El ancho máximo no es decoración: el motivo que manda Resend viene
          recortado a 300 caracteres (`webhook-resend.ts`), y 300 caracteres sin
          tope estiran la tabla entera hasta obligar a scroll horizontal. */}
      <TableCell className="max-w-64 whitespace-normal align-top text-sm text-muted-foreground">
        <BadgeEstadoInvitacion estado={invitacion.estado} />
        <p className="mt-1 leading-snug">{copyDeApoyo(invitacion)}</p>
        <AvisoEntrega estado={invitacion.emailEstado} motivo={invitacion.emailMotivo} />
      </TableCell>
      <TableCell className="text-right">
        <MenuAccionesInvitacion
          invitacion={invitacion}
          puedeInvitar={puedeInvitar}
          puedeRevocar={puedeRevocar}
          onActualizar={onActualizar}
          onReemplazarPorNueva={onReemplazarPorNueva}
          onArchivar={onArchivar}
        />
      </TableCell>
    </TableRow>
  );
}

// -----------------------------------------------------------------------------
// Tarjeta — invitación (teléfono)
// -----------------------------------------------------------------------------
/**
 * El motivo del rebote —que en la tabla obliga a acotar la celda a `max-w-64`
 * para no estirarla— acá dispone del ancho completo de la tarjeta, que es justo
 * donde se quiere leer.
 */
function TarjetaInvitacion({
  invitacion,
  puedeInvitar,
  puedeRevocar,
  onActualizar,
  onReemplazarPorNueva,
  onArchivar,
}: {
  invitacion: InvitacionEquipo;
  puedeInvitar: boolean;
  puedeRevocar: boolean;
  onActualizar: (cambios: Partial<InvitacionEquipo>) => void;
  onReemplazarPorNueva: (nueva: InvitacionEnviada) => void;
  onArchivar: () => void;
}) {
  const descripcionRol = DESCRIPCIONES_ROLES_INTERNOS[invitacion.rol];

  return (
    <li className="flex items-start gap-2 px-4 py-3">
      <div className="min-w-0 flex-1 space-y-2">
        <p className="break-words font-medium text-foreground">{invitacion.email}</p>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{descripcionRol?.etiqueta ?? invitacion.rol}</Badge>
          <BadgeEstadoInvitacion estado={invitacion.estado} />
        </div>
        <div className="text-sm text-muted-foreground">
          <p className="leading-snug">{copyDeApoyo(invitacion)}</p>
          <AvisoEntrega estado={invitacion.emailEstado} motivo={invitacion.emailMotivo} />
        </div>
      </div>
      <MenuAccionesInvitacion
        invitacion={invitacion}
        puedeInvitar={puedeInvitar}
        puedeRevocar={puedeRevocar}
        onActualizar={onActualizar}
        onReemplazarPorNueva={onReemplazarPorNueva}
        onArchivar={onArchivar}
      />
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

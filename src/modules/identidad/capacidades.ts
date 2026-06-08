/**
 * RBAC en código — mapa rol → capacidades.
 *
 * Decisión de arquitectura (CLAUDE.md + §4 del documento de Fase A,
 * `docs/arquitectura/fase-a-cimiento.md`): el conjunto de roles es cerrado y
 * pequeño (7 valores, ver `roles.ts`). Los permisos NO viven en tablas — viven
 * en código, en este mapa. `identidad` es DUEÑO de esta matriz; `dinero`,
 * `operacion` y `frontend` la CONSUMEN a través de las funciones exportadas
 * más abajo — nunca deben replicarla ni inferirla de `rol` por su cuenta.
 *
 * Fuente de las capacidades: `docs/levantamiento.md` §4 "Usuarios y permisos"
 * (tabla Rol → Responsabilidades/Acciones/Permisos) y RF-002/RF-005/RF-006/
 * RF-009/RF-030..033/RF-039. Cada capacidad de este archivo está respaldada
 * por una fila de esa tabla o un RF explícito — no se inventan capacidades
 * "porque suenan razonables". Donde el levantamiento es ambiguo, se documenta
 * la decisión inline con un comentario `// Decisión:`.
 *
 * IMPORTANTE — alcance de "capacidad" aquí:
 *   Estas funciones responden "¿el ROL de este usuario incluye esta acción?".
 *   NO reemplazan el filtro de datos por tenant/seller/driver (eso lo impone
 *   RLS en la base de datos — regla no-negociable del proyecto). Una respuesta
 *   `true` de `puedeGestionarTarifas(usuario)` significa "este rol, en
 *   abstracto, puede gestionar tarifas"; la fila específica que intente tocar
 *   sigue acotada por su `tenant_id` (impuesto en BD). Conductor/seller jamás
 *   deben llegar aquí con capacidades internas en `true` — y de hecho no las
 *   tienen, ver matriz abajo.
 */

import { estaActivo, type UsuarioActual } from "./usuario-actual";
import type { Rol } from "./roles";

// -----------------------------------------------------------------------------
// 1. Catálogo cerrado de capacidades
// -----------------------------------------------------------------------------
// Cada capacidad documenta, en su comentario, la fila del levantamiento que la
// respalda. Mantener este catálogo como única fuente de verdad evita strings
// sueltos repartidos por el código ("magic strings").
export const CAPACIDADES = [
  // --- Gestión de usuarios e invitaciones (RF-005) ---------------------------
  // "Dueño/Gerente: gestionar usuarios y roles · Permisos totales dentro de su
  // tenant". Supervisor/coordinador/administración: explícitamente "sin config
  // financiera ni usuarios" / "sin reasignación operativa" / "operativos".
  "gestionar_usuarios_y_roles",
  "invitar_usuarios_internos",
  "revocar_invitaciones",

  // --- Configuración del courier: tarifas, DTE, certificado (RF-007/008/009) -
  // "Dueño/Gerente: configurar tarifas". RF-009 asigna Gestión de tarifas a
  // "Dueño / admin"; RF-007/008 (certificado, proveedor DTE) a "Dueño / admin".
  // El levantamiento NO lista esta acción para supervisor/coordinador/conductor
  // /seller — la tabla §4 dice de supervisor "sin config financiera".
  "gestionar_tarifas",
  "gestionar_configuracion_dte",

  // --- Motor entrega→dinero / facturación (RF-030, RF-033, RF-035..037) ------
  // "Dueño/Gerente: aprobar facturación"; "Administración/Contabilidad: emitir
  // facturas (vía proveedor) · Permisos financieros". RF-033 conciliación es
  // "Admin / dueño".
  "aprobar_facturacion",
  "emitir_facturas",
  "ver_conciliacion",

  // --- Liquidación de conductores (RF-039, RF-041) ---------------------------
  // "Administración/Contabilidad: generar liquidaciones · Permisos financieros".
  "gestionar_liquidaciones_conductores",

  // --- Cobranza / estado de cuenta (RF-043..045) -----------------------------
  // "Administración/Contabilidad: gestionar cobranza".
  "gestionar_cobranza",

  // --- Operación: asignación, manifiestos, incidencias (RF-022..029) --------
  // "Coordinador de tráfico: asignar/reasignar, generar manifiestos · Solo
  // asignación operativa". "Supervisor: confirmar/ajustar operación, gestionar
  // incidencias, reasignar · Operativos; sin config financiera ni usuarios".
  "asignar_y_reasignar_pedidos",
  "generar_manifiestos",
  "gestionar_incidencias",
  "ajustar_operacion_diaria",

  // --- Reportes / dashboard (RF-046, RF-049) ---------------------------------
  // "Dueño/Gerente: ver reportes · Permisos totales dentro de su tenant".
  // Decisión: el levantamiento no listada explícitamente "ver reportes" para
  // supervisor/administración; se concede solo a `dueno` (y `super_admin` fuera
  // de la matriz de tenant) para no inflar el alcance sin respaldo textual.
  "ver_reportes_ejecutivos",

  // --- Auditoría (RF-004 + §10 del doc. de arquitectura) ---------------------
  // "tabla... visible para dueño/administración, nunca seller/conductor" — la
  // distinción fina la fija el documento de arquitectura (§10), no el
  // levantamiento, que solo dice "Sistema/dueño". Se documenta aquí esa fuente.
  "ver_bitacora_auditoria",

  // --- Acciones propias de seller/conductor (RF-010, RF-011, RF-020, RF-042) -
  // "Seller: conectar OAuth, solicitar same-day, ver/descargar DTE, seguir
  // incidencias · Estrictamente acotado a sus datos".
  "gestionar_conexion_ml_propia",
  "solicitar_same_day",
  "ver_documentos_propios", // DTE propios (seller) o liquidación propia (conductor) — ver nota en la matriz.
  "ver_incidencias_propias",

  // "Conductor: ver ruta, marcar evidencias internas, confirmar manifiesto ·
  // Solo sus propios datos". RF-042: visibilidad de su liquidación.
  "ver_ruta_propia",
  "confirmar_manifiesto_propio",
  "marcar_evidencias_propias",
  "ver_liquidacion_propia",

  // --- Plataforma (super_admin — fuera del tenant, RF-001/006) ---------------
  // "Super-admin: crear/suspender couriers, configurar planes, soporte ·
  // Globales; acceso a datos de negocio del courier limitado y auditado".
  // Decisión: se modela como capacidad de PLATAFORMA, no de tenant — un
  // `super_admin` nunca debería evaluarse contra la matriz de tenant (no tiene
  // tenant_id). Las funciones de alta de tenant viven en `onboarding.ts` y se
  // ejecutan vía `service_role`, auditadas — esta capacidad documenta el rol,
  // no habilita un bypass de RLS desde la app.
  "administrar_plataforma",
] as const;

export type Capacidad = (typeof CAPACIDADES)[number];

// -----------------------------------------------------------------------------
// 2. Matriz rol → capacidades
// -----------------------------------------------------------------------------
// Única fuente de verdad. `dinero`/`operacion`/`frontend` NUNCA deben copiar
// estas listas — siempre consultan a través de `tieneCapacidad`/`puede*`.
//
// Notas de decisión que aplican a TODA la matriz:
//
// - `super_admin` no recibe capacidades de tenant (lista vacía): sus acciones
//   de plataforma viven fuera de esta matriz (`administrar_plataforma`, scoped
//   aparte) y sus excepcionales accesos a datos de un tenant van por funciones
//   service_role auditadas (§8.3 doc. arquitectura) — nunca por "superpermiso"
//   en esta tabla. Esto evita que un bug de rol convierta a cualquiera en
//   super-admin de facto dentro de un tenant.
// - `seller`/`conductor`: cero capacidades internas (gestionar_*, aprobar_*,
//   emitir_*, asignar_*, etc.). Solo las suyas, acotadas a "lo propio" — la
//   propia capacidad ya lo expresa en su nombre (`_propia`/`_propios`).
const MATRIZ_ROL_CAPACIDADES: Record<Rol, readonly Capacidad[]> = {
  // "Permisos totales dentro de su tenant" — el dueño obtiene el superconjunto
  // interno: gestión de usuarios, configuración financiera y tributaria,
  // aprobación de facturación, reportes y auditoría. NO incluimos aquí
  // "asignar_y_reasignar_pedidos"/"generar_manifiestos" como exclusivas: el
  // levantamiento no se las niega al dueño (a diferencia de cómo sí dice
  // explícitamente "supervisor: sin config financiera ni usuarios" o
  // "administración: sin reasignación operativa"). Decisión: el dueño puede
  // ejercer cualquier capacidad operativa también, por ser "máximo control".
  dueno: [
    "gestionar_usuarios_y_roles",
    "invitar_usuarios_internos",
    "revocar_invitaciones",
    "gestionar_tarifas",
    "gestionar_configuracion_dte",
    "aprobar_facturacion",
    "emitir_facturas",
    "ver_conciliacion",
    "gestionar_liquidaciones_conductores",
    "gestionar_cobranza",
    "asignar_y_reasignar_pedidos",
    "generar_manifiestos",
    "gestionar_incidencias",
    "ajustar_operacion_diaria",
    "ver_reportes_ejecutivos",
    "ver_bitacora_auditoria",
  ],

  // "Operativos; sin config financiera ni usuarios" — confirma/ajusta
  // operación, gestiona incidencias, reasigna. Explícitamente SIN:
  // gestionar_usuarios_y_roles, gestionar_tarifas, aprobar_facturacion,
  // emitir_facturas, gestionar_liquidaciones_conductores, etc.
  supervisor: [
    "asignar_y_reasignar_pedidos",
    "generar_manifiestos",
    "gestionar_incidencias",
    "ajustar_operacion_diaria",
  ],

  // "Solo asignación operativa" — el más acotado de los internos.
  coordinador: ["asignar_y_reasignar_pedidos", "generar_manifiestos"],

  // "Financieros; sin reasignación operativa" — la capa de dinero: factura,
  // liquida, cobra, concilia. Explícitamente SIN asignar/reasignar/manifiestos.
  // Decisión: se le concede `ver_bitacora_auditoria` porque el documento de
  // arquitectura (§10) nombra a "dueño/administración" como los roles internos
  // con visibilidad de la bitácora — es la fuente más específica disponible
  // para esa distinción fina (el levantamiento solo dice "Sistema/dueño").
  administracion: [
    "gestionar_tarifas", // RF-009 lista "Dueño / admin" como usuario de la gestión de tarifas.
    "gestionar_configuracion_dte", // RF-007/008 lista "Dueño / admin".
    "aprobar_facturacion",
    "emitir_facturas",
    "ver_conciliacion",
    "gestionar_liquidaciones_conductores",
    "gestionar_cobranza",
    "ver_bitacora_auditoria",
  ],

  // "Solo sus propios datos": ruta, evidencias internas, manifiesto, su
  // liquidación. Cero capacidades internas del tenant — RLS (capa P3) refuerza
  // esto en BD; aquí se refleja también a nivel de rol para que `frontend`
  // pueda decidir qué mostrar sin round-trips.
  conductor: [
    "ver_ruta_propia",
    "confirmar_manifiesto_propio",
    "marcar_evidencias_propias",
    "ver_liquidacion_propia",
  ],

  // "Estrictamente acotado a sus datos": conectar OAuth, solicitar same-day,
  // ver/descargar DTE, seguir incidencias. Cero capacidades internas — RLS
  // (capa P2) lo refuerza en BD.
  seller: [
    "gestionar_conexion_ml_propia",
    "solicitar_same_day",
    "ver_documentos_propios",
    "ver_incidencias_propias",
  ],

  // Plataforma, no tenant — ver nota arriba de la matriz. La capacidad
  // `administrar_plataforma` se evalúa por separado (`esSuperAdminDePlataforma`),
  // no contamina la lista de capacidades "de tenant" para evitar que código que
  // itere capacidades internas trate al super_admin como un superusuario de
  // cualquier tenant.
  super_admin: [],
};

// -----------------------------------------------------------------------------
// 3. Primitiva de evaluación
// -----------------------------------------------------------------------------

/**
 * Evalúa si el usuario actual tiene una capacidad dada.
 *
 * Condiciones, en orden:
 *   1. La cuenta debe estar `activo` (un `invitado`/`suspendido` no ejerce
 *      ninguna capacidad, sin importar su rol — RNF-03).
 *   2. El rol del usuario debe incluir la capacidad en la matriz.
 *
 * Esta es LA función que respalda todas las utilidades `puede*` de abajo —
 * ellas son azúcar sintáctica con nombres expresivos sobre esta primitiva.
 * `dinero`/`operacion`/`frontend` pueden usar esta función directamente para
 * capacidades que aún no tengan su propio helper con nombre, sin tener que
 * tocar la matriz.
 */
export function tieneCapacidad(usuario: UsuarioActual, capacidad: Capacidad): boolean {
  if (!estaActivo(usuario)) return false;
  return MATRIZ_ROL_CAPACIDADES[usuario.rol].includes(capacidad);
}

/** Lista de capacidades activas del usuario — útil para `frontend` (qué mostrar/ocultar). */
export function capacidadesDe(usuario: UsuarioActual): readonly Capacidad[] {
  if (!estaActivo(usuario)) return [];
  return MATRIZ_ROL_CAPACIDADES[usuario.rol];
}

/**
 * Verdadero si el usuario es el `super_admin` de plataforma (no pertenece a
 * ningún tenant). Las operaciones de plataforma (alta/suspensión de tenants,
 * soporte) NO se modelan como "capacidades de tenant" — se resuelven en
 * funciones service_role auditadas (ver `onboarding.ts`). Esta función solo
 * identifica al actor; no es un atajo para saltarse esas funciones.
 */
export function esSuperAdminDePlataforma(usuario: UsuarioActual): boolean {
  return estaActivo(usuario) && usuario.tipoUsuario === "super_admin" && usuario.rol === "super_admin";
}

// -----------------------------------------------------------------------------
// 4. Utilidades con nombre — el contrato que consumen otros módulos
// -----------------------------------------------------------------------------
// Nombradas en español, en infinitivo de "puede + verbo", siguiendo el ejemplo
// del enunciado (`puedeAprobarFacturacion`). Cada una es una envoltura de
// `tieneCapacidad` con un nombre expresivo — agregar una nueva capacidad NO
// debería requerir tocar el código de `dinero`/`operacion`/`frontend` que ya
// usa estas utilidades, solo agregar (si hace falta) un nuevo helper aquí.

// --- Gestión de usuarios / invitaciones (RF-005) -----------------------------
export function puedeGestionarUsuariosYRoles(usuario: UsuarioActual): boolean {
  return tieneCapacidad(usuario, "gestionar_usuarios_y_roles");
}

export function puedeInvitarUsuarios(usuario: UsuarioActual): boolean {
  return tieneCapacidad(usuario, "invitar_usuarios_internos");
}

export function puedeRevocarInvitaciones(usuario: UsuarioActual): boolean {
  return tieneCapacidad(usuario, "revocar_invitaciones");
}

// --- Configuración financiera/tributaria (RF-007..009) -----------------------
export function puedeGestionarTarifas(usuario: UsuarioActual): boolean {
  return tieneCapacidad(usuario, "gestionar_tarifas");
}

export function puedeGestionarConfiguracionDte(usuario: UsuarioActual): boolean {
  return tieneCapacidad(usuario, "gestionar_configuracion_dte");
}

// --- Motor entrega→dinero / facturación (RF-030, 033, 035..037) ---------------
export function puedeAprobarFacturacion(usuario: UsuarioActual): boolean {
  return tieneCapacidad(usuario, "aprobar_facturacion");
}

export function puedeEmitirFacturas(usuario: UsuarioActual): boolean {
  return tieneCapacidad(usuario, "emitir_facturas");
}

export function puedeVerConciliacion(usuario: UsuarioActual): boolean {
  return tieneCapacidad(usuario, "ver_conciliacion");
}

// --- Liquidación de conductores / cobranza (RF-039, 041, 043..045) -----------
export function puedeGestionarLiquidacionesConductores(usuario: UsuarioActual): boolean {
  return tieneCapacidad(usuario, "gestionar_liquidaciones_conductores");
}

export function puedeGestionarCobranza(usuario: UsuarioActual): boolean {
  return tieneCapacidad(usuario, "gestionar_cobranza");
}

// --- Operación (RF-022..029) --------------------------------------------------
export function puedeAsignarYReasignarPedidos(usuario: UsuarioActual): boolean {
  return tieneCapacidad(usuario, "asignar_y_reasignar_pedidos");
}

export function puedeGenerarManifiestos(usuario: UsuarioActual): boolean {
  return tieneCapacidad(usuario, "generar_manifiestos");
}

export function puedeGestionarIncidencias(usuario: UsuarioActual): boolean {
  return tieneCapacidad(usuario, "gestionar_incidencias");
}

export function puedeAjustarOperacionDiaria(usuario: UsuarioActual): boolean {
  return tieneCapacidad(usuario, "ajustar_operacion_diaria");
}

// --- Reportes / auditoría (RF-046, 049, 004) ----------------------------------
export function puedeVerReportesEjecutivos(usuario: UsuarioActual): boolean {
  return tieneCapacidad(usuario, "ver_reportes_ejecutivos");
}

export function puedeVerBitacoraAuditoria(usuario: UsuarioActual): boolean {
  return tieneCapacidad(usuario, "ver_bitacora_auditoria");
}

// --- Seller (RF-010, 011, 020, 037, 048) --------------------------------------
export function puedeGestionarConexionMlPropia(usuario: UsuarioActual): boolean {
  return tieneCapacidad(usuario, "gestionar_conexion_ml_propia");
}

export function puedeSolicitarSameDay(usuario: UsuarioActual): boolean {
  return tieneCapacidad(usuario, "solicitar_same_day");
}

export function puedeVerDocumentosPropios(usuario: UsuarioActual): boolean {
  return tieneCapacidad(usuario, "ver_documentos_propios");
}

export function puedeVerIncidenciasPropias(usuario: UsuarioActual): boolean {
  return tieneCapacidad(usuario, "ver_incidencias_propias");
}

// --- Conductor (RF-022, 026, 042, 047) -----------------------------------------
export function puedeVerRutaPropia(usuario: UsuarioActual): boolean {
  return tieneCapacidad(usuario, "ver_ruta_propia");
}

export function puedeConfirmarManifiestoPropio(usuario: UsuarioActual): boolean {
  return tieneCapacidad(usuario, "confirmar_manifiesto_propio");
}

export function puedeMarcarEvidenciasPropias(usuario: UsuarioActual): boolean {
  return tieneCapacidad(usuario, "marcar_evidencias_propias");
}

export function puedeVerLiquidacionPropia(usuario: UsuarioActual): boolean {
  return tieneCapacidad(usuario, "ver_liquidacion_propia");
}

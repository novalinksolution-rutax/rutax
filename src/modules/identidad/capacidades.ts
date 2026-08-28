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
import { areaDeCapacidad } from "./areas-producto";

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

  // --- Ver el dinero, sin poder moverlo -------------------------------------
  // 🔴 Nacen al separar VER de HACER (2026-08-28). `emitir_facturas` gateaba a
  // la vez la emisión del DTE y la PANTALLA de Períodos —donde se ve cuánto le
  // debe cada seller—, y `gestionar_liquidaciones_conductores` hacía lo mismo
  // con Liquidaciones. Mientras el módulo de dinero no sea productivo, Rutax
  // apaga las de acción por courier (ver `areas-producto.ts`) y el courier tiene
  // que conservar las cifras: son valiosas aunque todavía no pueda actuar.
  //
  // NO pertenecen a ninguna área a propósito: la lectura no se apaga.
  //
  // Mismo corte de roles que sus hermanas de acción —dueño y administración—,
  // así que separarlas no le abre el dinero a nadie que no lo tuviera.
  "ver_periodos_cobro",
  "ver_liquidaciones",

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

  // --- Preparación del día: el retiro llegando, en vivo ----------------------
  // Pantalla `(tenant)/preparacion` (etapa 5 del alcance "retiro en bodega +
  // ruteo"). Muestra las visitas a bodega en curso y el acumulado por comuna de
  // lo que va entrando, para decidir cuántos conductores por zona ANTES de las
  // 16:00. Hoy es LECTURA; la asignación en bloque llega en la etapa 6 y se
  // gatea con `asignar_y_reasignar_pedidos`, que es la que decide de verdad.
  //
  // Capacidad propia y no una disyunción de las operativas existentes (el
  // `esOperativo` del layout, que es `asignar || generar_manifiestos ||
  // ajustar_operacion_diaria`): esa forma expresa "es alguien de operación", no
  // "puede ver esta pantalla", y cambia de significado en silencio el día que
  // cualquiera de las tres se reparta distinto. `ver_torre_control` sentó el
  // precedente de la pantalla de lectura con gate propio.
  //
  // Dueño, supervisor y coordinador. NO `administracion`: es el rol financiero
  // "sin reasignación operativa" y esta pantalla responde "¿qué hay en la bodega
  // y a dónde va?", que no es su pregunta. Mismo corte que la Torre.
  "ver_preparacion_dia",

  // --- Bodegas: dónde se retira y de dónde sale la flota ---------------------
  // Alta y edición de `identidad.seller_bodegas` (la bodega del seller, donde
  // el conductor retira) y `identidad.courier_bodegas` (la del courier, origen
  // de toda ruta). Alcance "retiro en bodega + ruteo".
  //
  // Capacidad propia, y no `gestionar_tarifas` — que fue el primer gate
  // propuesto, por consistencia con el resto de `/configuracion`. Ese argumento
  // es de UBICACIÓN, no de semántica: una bodega no es configuración financiera.
  // Reusar `gestionar_tarifas` habría dejado el gate al revés en las dos
  // puntas — se lo daba a `administracion`, que es "sin reasignación operativa"
  // por diseño, y se lo negaba a quien vive en la operación del día.
  // Tampoco se amplió `ajustar_operacion_diaria` al coordinador: eso habría
  // cambiado de paso todas las pantallas que ya la usan como gate.
  //
  // Decisión del usuario (2026-08-13): dueño, supervisor y coordinador. El caso
  // que la decide es de terreno — entra un seller nuevo, o el conductor está
  // parado en una bodega que nadie cargó, y quien opera el día tiene que poder
  // resolverlo sin ir a buscar al dueño.
  // --- Perfil de la empresa: el propio registro del courier -----------------
  // Las columnas de `identidad.tenants` que el alta no pide: giro, dirección,
  // comuna y actividad económica —el bloque `Emisor` que el SII exige en una
  // factura, del que `razon_social` y `rut` ya eran parte— más el teléfono y el
  // correo públicos que se muestran a quien espera un paquete.
  //
  // Capacidad propia, y no `gestionar_configuracion_dte` ni `gestionar_tarifas`,
  // que fueron los dos candidatos obvios. El primero es «el proveedor y el
  // certificado», no la identidad de la empresa; el segundo no tiene nada que
  // ver con un teléfono de contacto — reusarlo sería el mismo estiramiento que
  // dejó a `gestionar_conexion_ml_propia` gobernando Shopify.
  //
  // Dueño y administración: es la misma pareja que ya edita toda la
  // configuración tributaria, y ni supervisor ni coordinador tienen config
  // financiera por diseño.
  "gestionar_perfil_empresa",

  "gestionar_bodegas",


  // --- Forzar la sincronización de una cuenta ML de un seller ----------------
  // Pedir "trae los pedidos de esta cuenta ahora" desde el panel del courier.
  // Capacidad propia y NO `asignar_y_reasignar_pedidos`, que fue el primer
  // gate elegido: esa capacidad significa "decidir qué conductor lleva qué", y
  // excluye a `administracion` por diseño. Sincronizar no decide nada de la
  // calle — solo pide datos que ya son del tenant, y no mueve un pedido ni un
  // peso. Administración la necesita: sin pedidos ingestados no hay líneas de
  // cobro que conciliar ni facturar, que es exactamente su trabajo.
  // Decisión del usuario (2026-08-13): los cuatro roles internos.
  "sincronizar_conexiones_ml",

  // --- Torre de control: anticipación operativa ------------------------------
  // Módulo `contexto` (ver `docs/arquitectura/torre-de-control.md` §8). Cruza
  // señal externa (clima, aire, eventos, prensa) con la carga interna y la
  // traduce a impacto en dinero. Es LECTURA: la capacidad no habilita ninguna
  // acción irreversible — las acciones que la Torre sugiere (adelantar un corte,
  // reasignar conductores) se ejecutan a través de las capacidades operativas
  // que ya existen, y quien no las tenga ve la Torre sin poder actuar sobre ella.
  //
  // Decisión: dueño, supervisor y coordinador. NO `administracion`, que es el
  // rol financiero "sin reasignación operativa" — la Torre responde "¿qué va a
  // pasar hoy en la calle?", que no es su pregunta. Si administración necesitara
  // el monto comprometido, va por `ver_reportes_ejecutivos`/`ver_conciliacion`,
  // no por aquí. (Ojo: el monto de la Torre es el EXPUESTO, no una cifra
  // financiera conciliable — ver §7 del documento de arquitectura.)
  "ver_torre_control",

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

  // --- Suscripción de la plataforma Rutax (backstage `plataforma`) -----------
  // Distinto del motor entrega→dinero (`aprobar_facturacion`/`emitir_facturas`,
  // courier→seller): esto es Rutax cobrándole al courier por usar el software.
  // Decisión (Fase 1 "completar suscripciones"): SOLO el dueño — la relación
  // comercial/de facturación con Rutax es del dueño, no de administración
  // operativa (que sí gestiona la facturación courier→seller). Cubre el alta
  // self-serve del plan y, a futuro (F2), el cambio de plan.
  "gestionar_suscripcion",

  // --- Acciones propias de seller/conductor (RF-010, RF-011, RF-020, RF-042) -
  // "Seller: conectar OAuth, solicitar same-day, ver/descargar DTE, seguir
  // incidencias · Estrictamente acotado a sus datos".
  "gestionar_conexion_ml_propia",
  "solicitar_same_day",
  "ver_documentos_propios", // DTE propios (seller) o liquidación propia (conductor) — ver nota en la matriz.
  "ver_incidencias_propias",
  // El seller REPORTA un problema de un pedido suyo. Es una capacidad aparte de
  // `ver_incidencias_propias` porque es una escritura: el catálogo ya separa
  // leer de escribir en el resto de lo «propio» (`ver_documentos_propios` vs.
  // `gestionar_pedidos_propios`), y un gate de lectura no puede autorizar un
  // alta. La bienvenida del portal prometía esta acción desde antes de que
  // existiera.
  "reportar_incidencias_propias",
  // Etiqueta imprimible con QR interno para pedidos same-day propios. Misma
  // fila del levantamiento que "solicitar same-day" (RF-020/021) — el seller
  // que crea el envío es quien necesita imprimir su etiqueta.
  "descargar_etiqueta_same_day",
  // Gestión del propio envío same-day ya creado: cancelarlo antes de que salga
  // a ruta (docs/arquitectura/edicion-y-cancelacion-de-pedidos.md §4.3). Misma
  // fila del levantamiento que "solicitar same-day" (RF-020/021): quien crea el
  // envío es quien corrige su error. No se reusa `solicitar_same_day` — mentiría
  // en el nombre (solicitar ≠ cancelar). Acotada a lo propio, como todas las del
  // seller — RLS (P2) lo refuerza en BD.
  "gestionar_pedidos_propios",

  // "Conductor: ver ruta, marcar evidencias internas, confirmar manifiesto ·
  // Solo sus propios datos". RF-042: visibilidad de su liquidación.
  "ver_ruta_propia",
  "confirmar_manifiesto_propio",
  "marcar_evidencias_propias",
  "ver_liquidacion_propia",
  /**
   * Etapa 9 — el conductor escanea bultos que otro conductor le pasa en la
   * calle y quedan suyos.
   *
   * ES LA PRIMERA VEZ que un conductor mueve la atribución de dinero, y el
   * nombre lo dice: `recibir_traspaso_propio`, no `asignar_*`. Solo puede
   * recibir HACIA SÍ MISMO — el receptor no es un parámetro que elija, sale de
   * su propio token — así que sigue siendo "lo propio", que es el límite
   * declarado del rol unas líneas más abajo.
   *
   * No la tiene ningún rol interno: un coordinador que quiere mover pedidos usa
   * `asignar_y_reasignar_pedidos`, que es otra cosa (repartir trabajo, no
   * recibir un bulto que ya está en la calle).
   */
  "recibir_traspaso_propio",

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
    "gestionar_perfil_empresa",
    "aprobar_facturacion",
    "emitir_facturas",
    "ver_conciliacion",
    "ver_periodos_cobro",
    "ver_liquidaciones",
    "gestionar_liquidaciones_conductores",
    "gestionar_cobranza",
    "asignar_y_reasignar_pedidos",
    "generar_manifiestos",
    "gestionar_incidencias",
    "ajustar_operacion_diaria",
    "ver_preparacion_dia",
    "gestionar_bodegas",
    "sincronizar_conexiones_ml",
    "ver_torre_control",
    "ver_reportes_ejecutivos",
    "ver_bitacora_auditoria",
    "gestionar_suscripcion",
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
    "ver_preparacion_dia",
    "gestionar_bodegas",
    "sincronizar_conexiones_ml",
    "ver_torre_control",
  ],

  // "Solo asignación operativa" — el más acotado de los internos. Recibe
  // `ver_torre_control` pese a ser el más acotado porque es el rol que MÁS vive
  // en esa pantalla: la Torre existe para que quien asigna vea venir el problema
  // antes de asignar. Es lectura; no le concede ninguna acción que no tuviera.
  coordinador: [
    "asignar_y_reasignar_pedidos",
    "generar_manifiestos",
    // El rol que MÁS vive en la Preparación del día: es quien reparte los
    // paquetes que van llegando y quien tiene que salir a las 16:00 en punto.
    "ver_preparacion_dia",
    // Decisión del usuario (2026-08-13): el coordinador SÍ gestiona bodegas,
    // pese a ser el rol más acotado. Es quien habla con los conductores durante
    // el retiro, así que es el primero en enterarse de que falta una bodega —
    // y hacerlo esperar al dueño detiene la operación de la mañana. No le
    // concede nada financiero: una bodega no lleva tarifa.
    "gestionar_bodegas",
    "sincronizar_conexiones_ml",
    "ver_torre_control",
  ],

  // "Financieros; sin reasignación operativa" — la capa de dinero: factura,
  // liquida, cobra, concilia. Explícitamente SIN asignar/reasignar/manifiestos.
  // Decisión: se le concede `ver_bitacora_auditoria` porque el documento de
  // arquitectura (§10) nombra a "dueño/administración" como los roles internos
  // con visibilidad de la bitácora — es la fuente más específica disponible
  // para esa distinción fina (el levantamiento solo dice "Sistema/dueño").
  administracion: [
    "gestionar_tarifas", // RF-009 lista "Dueño / admin" como usuario de la gestión de tarifas.
    "gestionar_configuracion_dte", // RF-007/008 lista "Dueño / admin".
    "gestionar_perfil_empresa",
    // Decisión del usuario (2026-08-13): administración SÍ puede forzar la
    // sincronización de una cuenta ML. No contradice el "sin reasignación
    // operativa" del levantamiento — traer pedidos no asigna a nadie, y sin
    // pedidos ingestados no hay nada que facturar ni conciliar.
    "sincronizar_conexiones_ml",
    "aprobar_facturacion",
    "emitir_facturas",
    "ver_conciliacion",
    "ver_periodos_cobro",
    "ver_liquidaciones",
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
    "recibir_traspaso_propio",
  ],

  // "Estrictamente acotado a sus datos": conectar OAuth, solicitar same-day,
  // ver/descargar DTE, seguir incidencias. Cero capacidades internas — RLS
  // (capa P2) lo refuerza en BD.
  seller: [
    "gestionar_conexion_ml_propia",
    "solicitar_same_day",
    "ver_documentos_propios",
    "ver_incidencias_propias",
    "reportar_incidencias_propias",
    "descargar_etiqueta_same_day",
    "gestionar_pedidos_propios",
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
  if (!MATRIZ_ROL_CAPACIDADES[usuario.rol].includes(capacidad)) return false;

  // 🔴 EL INTERRUPTOR DE RUTAX, Y ESTÁ ACÁ POR UNA RAZÓN.
  //
  // Todas las pantallas, entradas de menú y Server Actions del producto pasan
  // por esta función. Restar acá las capacidades de un área apagada cubre las
  // ~50 puertas existentes sin tocar ninguna, y hace imposible que una pantalla
  // nueva se salte el interruptor: si la gatea una capacidad, ya está gateada.
  //
  // ⚠️ `areasHabilitadas` es obligatorio en el TIPO: el compilador obliga a cada
  // sitio que construye un usuario a declarar qué tiene encendido, en vez de
  // depender de un default silencioso que puede invertirse sin que nadie lo note.
  //
  // ⚠️ Y aun así se lee con `?? []`, que no es redundante: un objeto que llegue
  // sin pasar por el compilador —deserializado de JSON, un doble sin tipar— haría
  // que `.includes` lanzara un TypeError. Lanzar dentro de la función que arma la
  // navegación deja la página en blanco; devolver `false` esconde un botón. Las
  // dos son fail-closed, pero solo una es utilizable.
  const area = areaDeCapacidad(capacidad);
  if (area !== null && !(usuario.areasHabilitadas ?? []).includes(area)) {
    return false;
  }

  return true;
}

/**
 * Las capacidades de un ROL, sin usuario de por medio.
 *
 * `capacidadesDe` responde por una persona; esto responde por un rol, que es lo
 * que hace falta para comparar DOS roles antes de cambiarle el suyo a alguien:
 * qué pierde, qué gana y qué sigue sin tener. Sin esto, esa comparación se
 * escribe a mano y queda desincronizada del mapa la primera vez que el mapa
 * cambia — que es exactamente lo que pasó con las descripciones de rol.
 */
export function capacidadesDeRol(rol: Rol): readonly Capacidad[] {
  return MATRIZ_ROL_CAPACIDADES[rol];
}

/** Lista de capacidades activas del usuario — útil para `frontend` (qué mostrar/ocultar). */
export function capacidadesDe(usuario: UsuarioActual): readonly Capacidad[] {
  if (!estaActivo(usuario)) return [];
  // Pasa por `tieneCapacidad` en vez de devolver la fila de la matriz: si no,
  // esta lista enseñaría opciones que la otra función niega, y las pantallas que
  // se arman desde acá mostrarían botones que fallan al pulsarlos.
  return MATRIZ_ROL_CAPACIDADES[usuario.rol].filter((c) => tieneCapacidad(usuario, c));
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

/** Las columnas de `identidad.tenants`: bloque Emisor del SII y contacto público. */
export function puedeGestionarPerfilEmpresa(usuario: UsuarioActual): boolean {
  return tieneCapacidad(usuario, "gestionar_perfil_empresa");
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

/** Ver los períodos y cuánto le debe cada seller. Lectura: ningún área la apaga. */
export function puedeVerPeriodosCobro(usuario: UsuarioActual): boolean {
  return tieneCapacidad(usuario, "ver_periodos_cobro");
}

/** Ver las liquidaciones y cuánto se le debe a cada conductor. Lectura. */
export function puedeVerLiquidaciones(usuario: UsuarioActual): boolean {
  return tieneCapacidad(usuario, "ver_liquidaciones");
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

/**
 * Ver la Preparación del día: las visitas a bodega en curso y el acumulado por
 * comuna de lo que va entrando. Dueño, supervisor y coordinador — mismo corte
 * que la Torre de control, y por el mismo motivo: `administracion` es el rol
 * financiero "sin reasignación operativa".
 *
 * Es LECTURA. Cuando la etapa 6 traiga la asignación en bloque a esta misma
 * pantalla, la acción se gatea con `asignar_y_reasignar_pedidos` — que
 * `administracion` no tiene y el coordinador sí. Tener esta capacidad no
 * habilita mover un solo pedido.
 */
export function puedeVerPreparacionDia(usuario: UsuarioActual): boolean {
  return tieneCapacidad(usuario, "ver_preparacion_dia");
}

/**
 * Alta y edición de bodegas — las del seller (donde se retira) y las del
 * courier (de donde sale la flota). Los TRES roles operativos: dueño,
 * supervisor y coordinador. `administracion` NO, pese a gestionar el resto de
 * `/configuracion`: es el rol financiero "sin reasignación operativa", y una
 * bodega es un lugar de la calle, no una cifra.
 *
 * Ojo al construir las etapas siguientes: esta capacidad gobierna ESCRIBIR. La
 * lectura del catálogo de bodegas que necesitan el retiro (etapa 3) y la
 * Preparación del día (etapa 5) es un gate propio de esas pantallas, y el
 * conductor nunca llega por aquí — recibe su bodega dentro del DTO de su ruta,
 * por endpoint Bearer, no como lista navegable.
 */
export function puedeGestionarBodegas(usuario: UsuarioActual): boolean {
  return tieneCapacidad(usuario, "gestionar_bodegas");
}

/**
 * Forzar "trae los pedidos de esta cuenta ahora" desde el panel del courier.
 * Los CUATRO roles internos, `administracion` incluida — a diferencia de las
 * demás capacidades de esta sección, esta no decide nada de la operación en
 * calle: solo pide datos que ya son del tenant.
 */
export function puedeSincronizarConexionesMl(usuario: UsuarioActual): boolean {
  return tieneCapacidad(usuario, "sincronizar_conexiones_ml");
}

// --- Torre de control (módulo `contexto`) -------------------------------------
/**
 * Acceso a la Torre de control. Es LECTURA: no habilita ninguna acción
 * irreversible. Las acciones que la Torre sugiere se ejercen con las
 * capacidades operativas que el usuario ya tenga.
 */
export function puedeVerTorreControl(usuario: UsuarioActual): boolean {
  return tieneCapacidad(usuario, "ver_torre_control");
}

// --- Reportes / auditoría (RF-046, 049, 004) ----------------------------------
export function puedeVerReportesEjecutivos(usuario: UsuarioActual): boolean {
  return tieneCapacidad(usuario, "ver_reportes_ejecutivos");
}

export function puedeVerBitacoraAuditoria(usuario: UsuarioActual): boolean {
  return tieneCapacidad(usuario, "ver_bitacora_auditoria");
}

// --- Suscripción de la plataforma Rutax (backstage `plataforma`) -------------
export function puedeGestionarSuscripcion(usuario: UsuarioActual): boolean {
  return tieneCapacidad(usuario, "gestionar_suscripcion");
}

// --- Seller (RF-010, 011, 020, 037, 048) --------------------------------------
export function puedeGestionarConexionMlPropia(usuario: UsuarioActual): boolean {
  return tieneCapacidad(usuario, "gestionar_conexion_ml_propia");
}

/**
 * El seller administra sus propias conexiones a FUENTES de pedidos —
 * Mercado Libre, Shopify, y las que vengan.
 *
 * ⚠️ Se apoya en la misma capacidad `gestionar_conexion_ml_propia`, cuyo nombre
 * quedó de cuando la única fuente era Mercado Libre. Se reusa a propósito en vez
 * de crear una capacidad nueva: la semántica es idéntica —"el seller administra
 * su propia conexión con la plataforma donde vende"— y una capacidad nueva
 * exigiría una migración y otorgarla a cada rol de seller ya existente en cada
 * tenant, que es más riesgo del que compra el nombre bonito.
 *
 * Este alias existe para que los sitios de llamada digan la verdad. Renombrar la
 * capacidad en la base es trabajo aparte y consciente, no un efecto colateral de
 * agregar una fuente.
 */
export function puedeGestionarConexionesFuentePropia(usuario: UsuarioActual): boolean {
  return tieneCapacidad(usuario, "gestionar_conexion_ml_propia");
}

export function puedeSolicitarSameDay(usuario: UsuarioActual): boolean {
  return tieneCapacidad(usuario, "solicitar_same_day");
}

export function puedeDescargarEtiquetaSameDay(usuario: UsuarioActual): boolean {
  return tieneCapacidad(usuario, "descargar_etiqueta_same_day");
}

/** Cancelar (y, a futuro, editar) SU PROPIO pedido same-day mientras siga en ventana. */
export function puedeGestionarPedidosPropios(usuario: UsuarioActual): boolean {
  return tieneCapacidad(usuario, "gestionar_pedidos_propios");
}

export function puedeVerDocumentosPropios(usuario: UsuarioActual): boolean {
  return tieneCapacidad(usuario, "ver_documentos_propios");
}

export function puedeReportarIncidenciasPropias(usuario: UsuarioActual): boolean {
  return tieneCapacidad(usuario, "reportar_incidencias_propias");
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

/**
 * ¿Puede recibir un traspaso de bultos de otro conductor? (etapa 9)
 *
 * Solo el rol `conductor`. Es capacidad de "lo propio" pese a mover dinero,
 * porque el receptor siempre es quien llama: no hay forma de expresar
 * "traspasar de A a B" desde acá.
 */
export function puedeRecibirTraspaso(usuario: UsuarioActual): boolean {
  return tieneCapacidad(usuario, "recibir_traspaso_propio");
}

export function puedeVerLiquidacionPropia(usuario: UsuarioActual): boolean {
  return tieneCapacidad(usuario, "ver_liquidacion_propia");
}


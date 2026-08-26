import { redirect } from "next/navigation";
import { UserRound } from "lucide-react";
import { cerrarSesion } from "@/lib/identidad/cerrar-sesion";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { createClient } from "@/lib/supabase/server";
import {
  puedeAsignarYReasignarPedidos,
  puedeAjustarOperacionDiaria,
  puedeVerReportesEjecutivos,
  puedeGenerarManifiestos,
  puedeGestionarUsuariosYRoles,
  puedeGestionarConfiguracionDte,
  puedeGestionarTarifas,
  puedeGestionarIncidencias,
  puedeEmitirFacturas,
  puedeGestionarLiquidacionesConductores,
  puedeGestionarCobranza,
  puedeVerConciliacion,
  puedeVerBitacoraAuditoria,
  puedeGestionarSuscripcion,
  puedeVerPreparacionDia,
  puedeVerTorreControl,
  puedeGestionarBodegas,
} from "@/modules/identidad/capacidades";
import { AppShell, type GrupoNav, type ItemNav } from "@/components/app-shell/app-shell";
import { destinosMovil } from "@/components/app-shell/destinos-movil";
import { BannerOnboarding } from "@/components/onboarding/banner-onboarding";
import { resolverEstadoOnboarding } from "@/app/(tenant)/onboarding/estado";
import { obtenerAvisos } from "@/lib/avisos/obtener-avisos";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { listarEventosConciliacion } from "@/modules/dinero/index";

/**
 * Layout del área autenticada para roles internos del courier (dueño, supervisor,
 * coordinador, administración). Los conductores van a /conductor y los sellers
 * a /portal — nunca deben llegar aquí.
 *
 * Redirección por rol al iniciar sesión:
 * - dueno → /dashboard
 * - supervisor / coordinador → /operaciones
 * - administracion → /onboarding (sin sección operativa en este MVP)
 */
export default async function LayoutTenant({ children }: { children: React.ReactNode }) {
  const sesion = await obtenerSesionActual();

  if (!sesion) {
    redirect("/login");
  }
  if (sesion.usuario.estado === "invitado") {
    redirect("/activar-cuenta");
  }
  if (!sesion.usuario.tenantId) {
    redirect("/login");
  }

  // Conductores → la página que los manda a la app nativa. La PWA se retiró
  // el 24-08-2026 y `/conductor/manifiesto` ya no existe: sin este cambio, un
  // conductor que abra el backoffice aterriza en un 404.
  if (sesion.usuario.tipoUsuario === "conductor") {
    redirect("/conductor");
  }
  // Sellers → su portal.
  if (sesion.usuario.tipoUsuario === "seller") {
    redirect("/portal");
  }

  const supabase = await createClient();
  const { data: tenant } = await supabase
    .from("tenants")
    .select("nombre_fantasia")
    .eq("id", sesion.usuario.tenantId)
    .maybeSingle();

  const u = sesion.usuario;
  const esOperativo =
    puedeAsignarYReasignarPedidos(u) ||
    puedeGenerarManifiestos(u) ||
    puedeAjustarOperacionDiaria(u);

  // Navegación AGRUPADA por objetivo y filtrada por capacidad (UX_STRATEGY §5.2).
  // Lo que un rol no puede hacer, no se incluye como ítem — no se muestra
  // deshabilitado. Un grupo sin ítems no se agrega.
  const grupoPrincipal: GrupoNav = { titulo: null, items: [] };
  if (puedeVerReportesEjecutivos(u)) {
    grupoPrincipal.items.push({ href: "/dashboard", etiqueta: "Dashboard", icono: "dashboard" });
  }
  // Destino de primer nivel, no un ítem de "Operación": el coordinador —que no
  // tiene Dashboard— empieza el día aquí. Ver docs/arquitectura/torre-de-control.md.
  if (puedeVerTorreControl(u)) {
    grupoPrincipal.items.push({
      href: "/torre-de-control",
      etiqueta: "Torre de control",
      etiquetaCorta: "Torre",
      icono: "torre-de-control",
    });
  }

  const grupoOperacion: GrupoNav = { titulo: "Operación", items: [] };
  // Primero del grupo, y no por orden alfabético: es el orden del DÍA. El retiro
  // en bodega ocurre toda la mañana y la asignación tiene que estar terminada a
  // las 16:00 — quien coordina abre esta pantalla antes que la de pedidos.
  if (puedeVerPreparacionDia(u)) {
    grupoOperacion.items.push({
      href: "/preparacion",
      etiqueta: "Preparación del día",
      etiquetaCorta: "Preparación",
      icono: "preparacion",
    });
  }
  if (esOperativo) {
    grupoOperacion.items.push({ href: "/operaciones", etiqueta: "Pedidos", icono: "pedidos" });
    grupoOperacion.items.push({ href: "/manifiestos", etiqueta: "Manifiestos", icono: "manifiestos" });
  }
  if (puedeAsignarYReasignarPedidos(u)) {
    grupoOperacion.items.push({ href: "/conductores", etiqueta: "Conductores", icono: "conductores" });
  }
  if (puedeGestionarIncidencias(u)) {
    grupoOperacion.items.push({ href: "/operaciones/incidencias", etiqueta: "Incidencias", icono: "incidencias" });
  }

  // Excepciones de conciliación sin resolver. Se lee acá y no en el layout de
  // dinero porque el destino vive en esta navegación, y porque así también la
  // ve quien está en otra sección.
  let excepcionesPendientes = 0;
  if (puedeVerConciliacion(u) && u.tenantId) {
    try {
      const eventos = await listarEventosConciliacion(
        crearClienteServiceRole(),
        u.tenantId,
        "pendiente",
      );
      excepcionesPendientes = eventos.length;
    } catch {
      // Un conteo que falla no puede tumbar la navegación entera.
    }
  }

  const grupoDinero: GrupoNav = { titulo: "Dinero", items: [] };
  if (puedeEmitirFacturas(u)) {
    grupoDinero.items.push({ href: "/dinero/periodos", etiqueta: "Períodos", icono: "periodos" });
  }
  if (puedeGestionarLiquidacionesConductores(u)) {
    grupoDinero.items.push({ href: "/dinero/liquidaciones", etiqueta: "Liquidaciones", icono: "liquidaciones" });
  }
  if (puedeVerConciliacion(u)) {
    // El contador vivía en las pestañas de /dinero, que se retiraron por repetir
    // destinos que ya están acá. La cifra sí era real, así que se mudó al
    // destino en vez de perderse: es el único sitio donde se ve sin entrar.
    grupoDinero.items.push({
      href: "/dinero/conciliacion",
      etiqueta: "Conciliación",
      icono: "conciliacion",
      contador: excepcionesPendientes,
    });
  }
  if (puedeVerConciliacion(u) || puedeGestionarCobranza(u)) {
    grupoDinero.items.push({ href: "/dinero/cobranza", etiqueta: "Cobranza", icono: "pagos" });
  }

  // Clientes — el seller es una entidad de negocio, no un ajuste (IA Blueprint §1.1).
  const grupoClientes: GrupoNav = {
    titulo: "Clientes",
    items: [{ href: "/sellers", etiqueta: "Sellers", icono: "sellers" }],
  };

  // Settings anidado (Patrón H de Retell): el grupo Configuración SALE del sidebar
  // principal y se vuelve una sub-navegación que reemplaza el sidebar al entrar
  // (con "‹ Volver"). Mismo gating RBAC que antes; el hub de onboarding es
  // "Puesta en marcha".
  //
  // ⚠️ **«Mi plan» NO va acá (26-08-2026).** Vivía en esta lista *y* en la
  // tarjeta de plan del bloque inferior *y* en el índice de `/configuracion`:
  // tres puertas al mismo destino. La tarjeta de abajo es la que se queda —es
  // la que muestra el estado de la suscripción, no solo un enlace— y es la
  // misma razón por la que el bloque de marca perdió su desplegable (ver más
  // abajo). Lo que le pagas a Rutax tampoco es «cómo está armado tu courier»,
  // que es lo que esta sub-navegación reúne.
  const itemsSettings: ItemNav[] = [
    { href: "/onboarding", etiqueta: "Puesta en marcha", icono: "puesta-en-marcha" },
  ];
  if (puedeGestionarTarifas(u)) {
    // ⚠️ **Zonas y Retiro ya no son entradas propias (26-08-2026).** Son las
    // otras dos secciones del módulo de tarifas: la zona es la clave por la que
    // una tarifa cobra distinto, y el retiro es la otra mitad de lo que se le
    // paga al conductor. Las tres pedían el mismo `gestionar_tarifas`, así que
    // juntarlas no cambió ningún permiso.
    //
    // Sus rutas viejas siguen vivas y redirigen: hay marcadores y enlaces
    // internos que apuntan ahí.
    itemsSettings.push({ href: "/configuracion/tarifas", etiqueta: "Tarifas", icono: "tarifas" });
    itemsSettings.push({ href: "/configuracion/api", etiqueta: "Integraciones", icono: "integraciones" });
  }
  // Bloque propio: `gestionar_bodegas` NO coincide con `gestionar_tarifas`. Se
  // la tienen dueño, supervisor y coordinador, y NO administración — al revés
  // que el resto de Configuración. Va junto a Zonas por afinidad geográfica.
  if (puedeGestionarBodegas(u)) {
    itemsSettings.push({ href: "/configuracion/bodegas", etiqueta: "Bodegas", icono: "bodegas" });
  }
  // Acá vivía «Contactos de WhatsApp». Se retiró el 2026-08-25: los avisos de
  // WhatsApp los administra RUTAX desde el backstage, no el courier. El número
  // lo pone el propio seller en su perfil.
  if (puedeGestionarUsuariosYRoles(u)) {
    itemsSettings.push({ href: "/equipo", etiqueta: "Equipo", icono: "equipo" });
  }
  if (puedeVerBitacoraAuditoria(u)) {
    itemsSettings.push({ href: "/configuracion/exportar-datos", etiqueta: "Exportar datos", icono: "exportar" });
  }

  const grupos: GrupoNav[] = [
    grupoPrincipal,
    grupoOperacion,
    grupoDinero,
    grupoClientes,
  ].filter((g) => g.items.length > 0);

  // Mi plan = card "Free trial" de Retell (billing, marco propio abajo).
  const itemPlan: ItemNav | undefined = puedeGestionarSuscripcion(u)
    ? { href: "/configuracion/plan", etiqueta: "Mi plan", icono: "plan" }
    : undefined;

  // Desplegable de la card de plan: la card deja de ser un acceso directo a la
  // pantalla y ofrece los saltos a cada sección (todas viven en la misma ruta,
  // por ancla). Solo el dueño gestiona la suscripción.
  const opcionesPlan: ItemNav[] = puedeGestionarSuscripcion(u)
    ? [
        { href: "/configuracion/plan", etiqueta: "Resumen del plan", icono: "plan" },
        { href: "/configuracion/plan#cambiar-plan", etiqueta: "Cambiar de plan", icono: "cambiar-plan" },
        { href: "/configuracion/plan#historial-pagos", etiqueta: "Historial de pagos", icono: "periodos" },
        { href: "/configuracion/plan#cobro-automatico", etiqueta: "Cobro automático", icono: "pagos" },
      ]
    : [];

  // El bloque de marca queda ESTÁTICO: solo dice de qué empresa es la cuenta.
  //
  // Tenía un desplegable con «Configuración de la empresa», «Equipo y roles» y
  // «Mi plan y facturación» — y los tres destinos están, uno por uno, dentro de
  // la navegación anidada que abre «Configuración» en el bloque de abajo. Eran
  // una segunda puerta al mismo sitio, y el tablero P1 fija una: «la
  // configuración es una navegación anidada que reemplaza a la principal al
  // entrar, con retorno explícito».
  //
  // No se pierde ningún destino: los tres siguen en `itemsSettings`, a un clic.
  // Lo que se pierde es la tercera vía —la segunda es la tarjeta de plan, que NO
  // es una puerta sino anclas dentro de una misma pantalla, y por eso se queda.
  const opcionesCuenta: ItemNav[] = [];

  // Bloque inferior (ítems sobre la card de plan): entrada "Configuración" que
  // ABRE el Settings anidado.
  //
  // 🔴 `abreSettings` y NO un `href` a `/onboarding`. Apuntaba ahí, así que un
  // clic en «Configuración» cargaba «Puesta en marcha» entera — la pantalla que
  // menos se usa después del primer día— solo para que apareciera el sub-menú
  // al lado. Quien entra a Configuración va a ver las opciones; ahora el panel
  // se despliega en el sitio y el lienzo no se mueve hasta que elija.
  //
  // El `href` se conserva apuntando al índice porque el shell lo usa para saber
  // que `/configuracion` también es "estar en configuración"; el botón no
  // navega.
  const itemsInferiores: ItemNav[] = [
    { href: "/configuracion", etiqueta: "Configuración", icono: "configuracion", abreSettings: true },
  ];

  // "‹ Volver" del Settings anidado → el primer ítem del sidebar principal.

  const ROL_ETIQUETA: Record<string, string> = {
    dueno: "Dueño",
    supervisor: "Supervisor",
    coordinador: "Coordinador",
    administracion: "Administración",
  };

  const puedeActuarSobreOnboarding = puedeGestionarConfiguracionDte(sesion.usuario);
  const [estadoOnboarding, avisos] = await Promise.all([
    puedeActuarSobreOnboarding && sesion.usuario.tenantId
      ? resolverEstadoOnboarding(sesion.usuario.tenantId)
      : Promise.resolve(null),
    obtenerAvisos(sesion.usuario.tenantId, sesion.usuario, sesion.usuarioId),
  ]);

  // Los cuatro destinos del teléfono salen de la MISMA navegación que ya se
  // filtró por capacidad arriba: no hay una segunda lista que se desincronice.
  // Lo del coordinador no es lo de Administración porque sus capacidades no son
  // las mismas, no porque haya un `if` por rol en alguna parte.
  const destinos = destinosMovil(grupos.flatMap((g) => g.items));

  return (
    <AppShell
      nombreFantasia={(tenant?.nombre_fantasia as string | undefined) ?? "Tu courier"}
      nombreCompleto={sesion.nombreCompleto}
      subtituloCuenta={ROL_ETIQUETA[sesion.usuario.rol] ?? null}
      grupos={grupos}
      itemsInferiores={itemsInferiores}
      itemsSettings={itemsSettings}
      itemPlan={itemPlan}
      opcionesPlan={opcionesPlan}
      opcionesCuenta={opcionesCuenta}
      // La Torre es la única pantalla ancha del backoffice: su mapa necesita más
      // que el `max-w-6xl` con que se lee bien todo lo demás. La excepción se
      // declara acá —donde viven las rutas— y no se le quita el ancho máximo a
      // ninguna otra pantalla.
      /**
       * 🔴 Los LISTADOS van fluidos; los formularios y los detalles, topados.
       *
       * El `max-w-6xl` (1152 px) dejaba el contenido como un cuadrado al centro
       * en cualquier monitor de 1440 para arriba, y en Pedidos obligaba a un
       * scroll horizontal dentro de la tabla con media pantalla vacía a los
       * lados. Una tabla quiere ancho: cada columna que no cabe es un dato que
       * hay que ir a buscar.
       *
       * ⚠️ **Y por eso NO se abre todo.** Un formulario o una ficha de 1.800 px
       * de ancho es peor que uno angosto: el ojo pierde el renglón al volver, y
       * un campo de texto estirado de lado a lado no se lee como un campo. Las
       * pantallas de formulario y detalle mantienen su propio `max-w` —lo
       * declaran ellas— y por eso no están en esta lista.
       *
       * La regla para agregar una: **si la pantalla es una tabla o una lista de
       * objetos, va acá. Si es un formulario, una ficha o un asistente, no.**
       */
      rutasAnchas={[
        // El mapa: la razón original de que esta lista exista.
        "/torre-de-control",
        // Operación
        "/operaciones",
        "/manifiestos",
        "/conductores",
        "/sellers",
        // ⚠️ **`/preparacion` y no solo su hijo `/asignar`.** Faltaba la raíz, y
        // se notaba justo al cambiar de pantalla: Torre, Pedidos y Manifiestos
        // se dibujan a 1800 px y Preparación caía a `max-w-6xl`, así que el
        // título saltaba hacia adentro. Cumple la regla de esta lista —es una
        // lista de objetos, las visitas de retiro del día, con su columna de
        // carga por comuna al lado— y no una ficha ni un formulario.
        "/preparacion",
        "/preparacion/asignar",
        // Dinero
        "/dinero/periodos",
        "/dinero/liquidaciones",
        "/dinero/conciliacion",
        "/dinero/cobranza",
        // Configuración con tabla
        "/configuracion/tarifas",
        "/configuracion/bodegas",
        "/configuracion/api",
        "/equipo",
      ]}
      /* ⚠️ El ícono va **ya renderizado**, no como componente: este layout es
         de servidor y una función no cruza la frontera hacia un Client
         Component — se lleva por delante todo lo que el layout envuelve, con
         typecheck y lint en verde. */
      enlacesCuenta={[
        {
          href: "/perfil",
          etiqueta: "Mi perfil",
          subtitulo: "Tus datos y tus permisos",
          icono: <UserRound className="size-4" aria-hidden="true" />,
        },
      ]}
      accionSalir={async () => {
        "use server";
        await cerrarSesion("/login");
      }}
      avisos={avisos}
      destinosMovil={destinos}
      banner={
        estadoOnboarding && !estadoOnboarding.completo ? (
          <BannerOnboarding faltaParaOperar={estadoOnboarding.faltaParaOperar} />
        ) : null
      }
    >
      {children}
    </AppShell>
  );
}

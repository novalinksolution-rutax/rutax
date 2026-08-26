import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";

import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { hoyEnSantiago } from "@/lib/fecha-santiago";
import type { EstadoPedido } from "@/modules/operacion/tipos";
import { Button } from "@/components/ui/button";
import { grupoDePedido } from "@/lib/ui/vocabulario-portal";
import { FirmadoPorRutax } from "@/components/ui/marca-rutax";

import { obtenerConexionesPropia } from "./actions";
import { obtenerConexionesShopifyPropia } from "./acciones-shopify";
import { PanelConexionesMl } from "./panel-conexion-ml";
import { PanelConexionesShopify } from "./panel-conexion-shopify";
import { WidgetSlaSeller } from "./widget-sla-seller";

export const metadata: Metadata = {
  title: "Mi portal",
};

/**
 * El inicio del portal del seller.
 * =============================================================================
 *
 * -----------------------------------------------------------------------------
 * RESPONDE «¿SALIÓ TODO?», QUE ES CON LO QUE SE ENTRA
 * -----------------------------------------------------------------------------
 * El `h1` era «Mi portal» —el nombre de la pantalla— y debajo venían cuatro
 * paneles de configuración. Ningún contador de pedidos: para saber si su día
 * salió bien, el seller tenía que ir a otra pantalla.
 *
 * Ahora el titular es la jornada («Hoy salieron 34 de tus pedidos») y debajo van
 * **dos** magnitudes, no seis: en camino y con problemas. Son las dos
 * accionables. Un mosaico de seis cifras en el portal es el panel del courier
 * disfrazado, y el seller no opera nada.
 *
 * -----------------------------------------------------------------------------
 * LA CONEXIÓN CAÍDA VA ARRIBA
 * -----------------------------------------------------------------------------
 * Vivía al fondo, dentro del panel de gestión de cuentas. Una conexión caída
 * significa que **sus pedidos dejaron de entrar**: es la única cosa de esta
 * pantalla que exige actuar hoy, y estaba debajo de todo.
 *
 * -----------------------------------------------------------------------------
 * SE RETIRA EL HISTORIAL DE SLA DE CUATRO SEMANAS
 * -----------------------------------------------------------------------------
 * Es una tabla de análisis en la pantalla de «¿cómo va hoy?». El cumplimiento
 * del mes sigue, con su riel; el histórico no aporta a la pregunta del inicio.
 */
import { PanelCrearSameDay } from "./pedidos/panel-crear-same-day";
import { obtenerEstadoAltaSeller } from "./pedidos/estado-alta-seller";

export default async function PaginaPortalSeller() {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId) {
    redirect("/login");
  }
  if (sesion.usuario.tipoUsuario !== "seller" || !sesion.usuario.sellerId) {
    redirect("/");
  }

  const tenantId = sesion.usuario.tenantId;
  const sellerId = sesion.usuario.sellerId;
  // Su hora de corte, para el aviso en línea del formulario de alta.
  const estadoAlta = await obtenerEstadoAltaSeller(sesion.usuario.tenantId, sellerId);
  const hoy = hoyEnSantiago();
  const cliente = crearClienteServiceRole();

  const [resultado, conexionesShopify, pedidosHoy, tenantFila] = await Promise.all([
    obtenerConexionesPropia(),
    obtenerConexionesShopifyPropia(),
    // Los pedidos del día, en una lectura: los conteos salen en memoria en vez
    // de cuatro consultas de `count`.
    cliente
      .from("pedidos")
      .select("estado")
      .eq("tenant_id", tenantId)
      .eq("seller_id", sellerId)
      .eq("fecha_compromiso", hoy),
    cliente.from("tenants").select("nombre_fantasia").eq("id", tenantId).maybeSingle(),
  ]);

  const nombreCourier =
    (tenantFila.data?.nombre_fantasia as string | undefined) ?? "tu empresa de despacho";

  // `null` = no se pudo leer. Es distinto de «no tienes pedidos hoy», y la
  // pantalla lo dice con otras palabras.
  const estadosHoy = pedidosHoy.error
    ? null
    : ((pedidosHoy.data ?? []) as { estado: string }[]).map((p) => p.estado);

  // Se cuenta por los MISMOS grupos con que se filtra la lista. Antes «En
  // camino» contaba solo `en_ruta` y su enlace llevaba a un cajón que además
  // trae los que no han salido: la cifra que se toca y la que aparece después
  // no coincidían, y no había forma de saber por qué.
  const total = estadosHoy?.length ?? 0;
  const porGrupo = (grupo: string) =>
    estadosHoy?.filter((e) => grupoDePedido(e as EstadoPedido) === grupo).length ?? 0;
  const entregados = porGrupo("entregado");
  const enCamino = porGrupo("en_camino");
  const conProblemas = porGrupo("problema");

  // «Caída» = `desvinculada` o `atencion`. `pendiente` es una conexión que
  // todavía no terminó de conectarse: no es una caída, y avisarla como tal
  // haría sonar la alarma justo mientras el seller la está configurando.
  const conexionesCaidas = resultado.ok
    ? resultado.conexiones.filter(
        (c) => c.estadoSalud === "desvinculada" || c.estadoSalud === "atencion",
      ).length
    : 0;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {/* 1 · La conexión caída, ARRIBA DE TODO. Sin sus cuentas conectadas los
             pedidos del seller dejan de entrar, y eso no puede estar al fondo
             de la pantalla dentro de un panel de configuración. */}
      {conexionesCaidas > 0 ? (
        <div className="border border-fault-line bg-fault-bg px-4 py-3.5">
          <p className="text-sm leading-relaxed text-fault-fg">
            <strong className="font-medium">
              {conexionesCaidas === 1
                ? "Una de tus cuentas se desconectó."
                : `${conexionesCaidas} de tus cuentas se desconectaron.`}
            </strong>{" "}
            Mientras esté así, tus pedidos nuevos no le llegan a {nombreCourier}. Vuelve a
            conectarla desde abajo.
          </p>
        </div>
      ) : null}

      {/* 2 · El titular de la jornada, en lenguaje humano. */}
      <div className="space-y-1">
        <h1 className="font-heading text-2xl font-semibold">
          {estadosHoy === null
            ? "No pudimos leer tus pedidos de hoy"
            : total === 0
              ? "Hoy no tienes pedidos"
              : entregados === total
                ? `Todo salió hoy · ${total} de ${total}`
                : `Hoy salieron ${entregados} de tus ${total} pedidos`}
        </h1>
        <p className="text-sm leading-relaxed text-fg-muted">
          {estadosHoy === null
            ? `Recarga en unos segundos. Si es urgente, escríbele a ${nombreCourier}.`
            : total === 0
              ? `Cuando entren pedidos por tus cuentas conectadas, o crees uno same-day, van a aparecer acá.`
              : entregados === total
                ? "Todas las entregas del día llegaron a destino."
                : // «van en camino» afirmaría que ya salieron, y el grupo
                  // incluye los que todavía no se asignan. Se dice lo que es
                  // cierto de los dos.
                  `${enCamino} todavía no ${enCamino === 1 ? "llega" : "llegan"} y ${conProblemas} ${
                    conProblemas === 1 ? "tuvo" : "tuvieron"
                  } un problema.`}
        </p>
      </div>

      {/* 3 · Dos magnitudes, y solo dos: las accionables. */}
      {estadosHoy !== null && total > 0 ? (
        <div className="grid grid-cols-2 gap-3">
          <Magnitud
            rotulo="En camino"
            valor={enCamino}
            href={`/portal/pedidos?estado=en_camino&fecha=${hoy}`}
          />
          <Magnitud
            rotulo="Con problemas"
            valor={conProblemas}
            href={`/portal/pedidos?estado=problema&fecha=${hoy}`}
            alerta={conProblemas > 0}
          />
        </div>
      ) : null}

      {/* 4 · Tu cumplimiento. «SLA» es jerga del contrato, no del seller. */}
      <WidgetSlaSeller tenantId={tenantId} sellerId={sellerId} />

      {/* 5 · Las dos acciones del portal. */}
      <div className="flex flex-wrap gap-2">
        {/* Mismo panel que en el listado: crear no saca de donde estabas. */}
        <PanelCrearSameDay estadoSeller={estadoAlta} variante="inicio" />
        <Button asChild size="sm" variant="outline">
          <Link href="/portal/pedidos">Ver todos mis pedidos</Link>
        </Button>
      </div>

      <PanelConexionesMl
        conexionesIniciales={resultado.ok ? resultado.conexiones : []}
        errorInicial={resultado.ok ? null : resultado.mensaje}
      />

      <PanelConexionesShopify conexionesIniciales={conexionesShopify} />

      {/* Regla 42: la marca de arriba es la del dueño de la relación —el
          courier—, y Rutax firma abajo. Este es el único lugar del portal donde
          aparece nuestra marca. */}
      <FirmadoPorRutax />
    </div>
  );
}

function Magnitud({
  rotulo,
  valor,
  href,
  alerta = false,
}: {
  rotulo: string;
  valor: number;
  href: string;
  alerta?: boolean;
}) {
  return (
    <Link
      href={href}
      className={`block border px-4 py-3 transition-colors ${
        alerta
          ? "border-attention-line bg-attention-bg hover:bg-attention-bg/70"
          : "border-line bg-bg-raised hover:bg-bg-sunken"
      }`}
    >
      <span
        className={`rx-num block text-[10px] tracking-[0.12em] uppercase ${
          alerta ? "text-attention-fg" : "text-fg-muted"
        }`}
      >
        {rotulo}
      </span>
      <span
        className={`rx-num block text-3xl font-semibold ${
          alerta ? "text-attention-fg" : "text-fg"
        }`}
      >
        {valor}
      </span>
    </Link>
  );
}

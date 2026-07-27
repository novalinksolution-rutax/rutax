import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import {
  puedeVerReportesEjecutivos,
  puedeVerTorreControl,
} from "@/modules/identidad/capacidades";
import { Button } from "@/components/ui/button";
import { ESTADO_TORRE, type EstadoTorre } from "./_fixture/estado-torre";
import { VARIANTES, esEstadoPantalla } from "./_fixture/variantes";
import { TorreConsola } from "./_componentes/torre-consola";
import { EsqueletoConsola } from "./_componentes/esqueleto-region";

export const metadata: Metadata = {
  title: "Torre de control",
};

/**
 * Torre de control — consola de anticipación operativa.
 *
 * Cruza la señal externa (clima, aire, eventos, prensa) con la carga interna
 * (pedidos, zonas, conductores, SLA) y la traduce a impacto en dinero. Responde
 * una sola pregunta: ¿qué va a pasar hoy y mañana en mi operación, dónde, y
 * cuánto me cuesta si no hago nada?
 *
 * Diseño: `design_handoff_torre_de_control/README.md` (interfaz aprobada,
 * lenguaje visual propio — NO aplicar DESIGN_SYSTEM.md aquí).
 * Arquitectura: `docs/arquitectura/torre-de-control.md`.
 *
 * RBAC: `ver_torre_control` — dueño, supervisor y coordinador. Es lectura: no
 * habilita ninguna acción irreversible. Las acciones que la Torre sugiere
 * (adelantar un corte, reasignar conductores) se ejercen con las capacidades
 * operativas que el usuario ya tenga.
 *
 * Las seis regiones se construyen contra `_fixture/estado-torre.ts` (copia
 * tipada del contrato congelado `docs/torre-de-control/datos-dummy.ts`).
 * Cuando exista el endpoint real solo cambia la fuente de `estado` — ningún
 * componente de región debería necesitar tocarse.
 *
 * La ruta vive en el grupo `(consola)` y NO en `(tenant)`: es una consola de
 * viewport fijo, no una pantalla de backoffice. Ver `(consola)/layout.tsx`
 * para el porqué y para los guards de acceso, que son los mismos.
 *
 * Paso B4: previsualización de los seis `EstadoPantalla` vía `?estado=…`,
 * ACTIVA SOLO EN DESARROLLO (ver `resolverEstado`).
 */

/**
 * Elige qué variante de la fixture renderizar.
 *
 * ⚠️ El query param es una herramienta de DESARROLLO y nada más. En producción
 * `EstadoPantalla` lo DERIVA EL SERVIDOR desde los datos reales —¿hay
 * excepciones abiertas?, ¿alguna zona cruza el umbral?, ¿el tenant configuró
 * zonas?, ¿hay pedidos hoy?— y la interfaz solo lo obedece. Dejar que la URL lo
 * elija en producción permitiría pintar «Todo tranquilo» sobre una operación en
 * llamas, que es exactamente lo que el handoff prohíbe al advertir que este
 * estado no se fuerce con un flag sobre datos calientes.
 *
 * Por eso el guard es `NODE_ENV !== 'production'` y no una capacidad RBAC: no
 * es una función del producto, es andamiaje.
 */
function resolverEstado(estadoPedido: string | undefined): EstadoTorre {
  if (process.env.NODE_ENV === "production") return ESTADO_TORRE;
  return esEstadoPantalla(estadoPedido) ? VARIANTES[estadoPedido] : ESTADO_TORRE;
}

export default async function PaginaTorreDeControl({
  searchParams,
}: {
  searchParams: Promise<{ estado?: string }>;
}) {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId) {
    redirect("/login");
  }

  // Destino del control de salida de R1. La consola vive fuera del `AppShell`,
  // así que no hay sidebar que devuelva al usuario al resto del producto: se lo
  // devuelve ella. Se elige el mismo primer destino que el sidebar le habría
  // dado según su rol — el dueño entra por el dashboard, el coordinador (que no
  // tiene reportes) por la pantalla de pedidos.
  const hrefSalida = puedeVerReportesEjecutivos(sesion.usuario) ? "/dashboard" : "/operaciones";

  if (!puedeVerTorreControl(sesion.usuario)) {
    return (
      <div className="mx-auto flex h-full max-w-lg flex-col items-center justify-center gap-3 bg-tc-papel px-6 py-14 text-center">
        <ShieldAlert className="size-8 text-tc-ink-600" aria-hidden="true" />
        <div className="space-y-1">
          <p className="font-medium text-tc-tinta">
            No tienes permiso para ver esta sección
          </p>
          <p className="text-sm text-tc-ink-700">
            La Torre de control es para el dueño, el supervisor y el coordinador
            de tráfico.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/">Volver al inicio</Link>
        </Button>
      </div>
    );
  }

  const estado = resolverEstado((await searchParams).estado);

  // `cargando` no renderiza la consola con datos vacíos: renderiza los
  // esqueletos que, cuando el dato venga del servidor, serán el `fallback` del
  // `<Suspense>` de cada región.
  if (estado.estado === "cargando") return <EsqueletoConsola />;

  return <TorreConsola estado={estado} hrefSalida={hrefSalida} />;
}

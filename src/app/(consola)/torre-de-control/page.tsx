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
import { cargarCabecera, cargarTablero, type CabeceraTorre } from "@/modules/contexto/composer";
import type { TorreRespuesta } from "@/modules/contexto/contrato-torre";
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
 * -----------------------------------------------------------------------------
 * POR QUÉ ESTE COMPONENTE NO HACE `await`
 * -----------------------------------------------------------------------------
 * Los dos cargadores se invocan y sus PROMESAS se pasan a la consola sin
 * resolver. Esperar aquí bloquearía la pantalla entera hasta la última consulta,
 * y el handoff (§6) pide lo contrario: ningún spinner de página, cada región
 * llega por su cuenta y el hueco nombra lo que falta. Cada región tiene su
 * `<Suspense>` y consume la promesa con `use()` dentro de él.
 *
 * No hay endpoint `/api/torre/estado` ni `revalidatePath`: los tres horizontes
 * vienen precalculados en el mismo payload y el cambio de horizonte es puramente
 * de cliente. Un round-trip ahí remontaría el tablero y haría saltar la posición
 * de scroll del riel, que el handoff prohíbe.
 *
 * La ruta vive en el grupo `(consola)` y NO en `(tenant)`: es una consola de
 * viewport fijo, no una pantalla de backoffice. Ver `(consola)/layout.tsx`
 * para el porqué y para los guards de acceso, que son los mismos.
 */

/**
 * Previsualización de los seis `EstadoPantalla` vía `?estado=…`.
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
function variantePedida(estadoPedido: string | undefined) {
  if (process.env.NODE_ENV === "production") return null;
  return esEstadoPantalla(estadoPedido) ? VARIANTES[estadoPedido] : null;
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

  const tenantId = sesion.usuario.tenantId;
  const variante = variantePedida((await searchParams).estado);

  if (variante) {
    // `cargando` no es una variante de datos: es la ausencia de ellos. En
    // producción lo resuelve el `<Suspense>` de cada región; aquí se fuerza el
    // tablero completo de esqueletos para poder mirarlo.
    if (variante.estado === "cargando") return <EsqueletoConsola />;

    const fijo: TorreRespuesta = {
      horizonteInicial: "hoy",
      horizontes: { hoy: variante, manana: variante, "72h": variante },
    };
    const cabeceraFija: CabeceraTorre = {
      courier: variante.courier,
      frescura: variante.frescura,
      ahoraIso: variante.ahora,
    };
    return (
      <TorreConsola
        cabecera={Promise.resolve(cabeceraFija)}
        tablero={Promise.resolve(fijo)}
        hrefSalida={hrefSalida}
      />
    );
  }

  return (
    <TorreConsola
      cabecera={cargarCabecera(tenantId)}
      tablero={cargarTablero(tenantId)}
      hrefSalida={hrefSalida}
    />
  );
}

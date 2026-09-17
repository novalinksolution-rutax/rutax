import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { PantallaSinSesion } from "@/components/ui/pantalla-sin-sesion";
import { WizardAltaSeller } from "@/app/registro-seller/wizard/wizard-alta-seller";
import type { EstadoWizardAltaSeller } from "@/lib/identidad/borrador-wizard-seller";

/**
 * ANDAMIO DE DESARROLLO — vista previa del wizard de alta de seller.
 * =============================================================================
 * El wizard real (`/registro-seller/wizard`) exige sesión de Google Y la cookie
 * firmada del borrador, así que NO se puede abrir en un navegador de pruebas ni
 * revisar su diseño sin completar un OAuth a mano. Esta ruta monta el MISMO
 * componente `WizardAltaSeller` con datos de mentira y sin sesión, para poder
 * mirarlo en claro/oscuro y en cada viewport.
 *
 * ⚠️ Solo desarrollo: en producción devuelve 404 (`notFound()`). No lee ni
 * escribe nada en la base — el estado es literal, definido acá abajo.
 *
 * `?paso=0|1|2|3` elige por qué paso abre. El wizard deriva el paso de lo que
 * ya está lleno (`pasoInicial`), así que el estado se va acumulando.
 */

export const metadata: Metadata = {
  title: "Preview wizard (dev)",
  robots: { index: false, follow: false },
};

const TENANT_FALSO = "00000000-0000-0000-0000-000000000000";

/** Estado acumulado: para abrir en el paso N hay que tener llenos los N anteriores. */
function estadoParaPaso(paso: number): EstadoWizardAltaSeller {
  const estado: EstadoWizardAltaSeller = { tenantId: TENANT_FALSO };
  if (paso >= 1) {
    estado.empresa = {
      razonSocial: "Comercializadora Lampa SpA",
      rut: "76543210-3",
      aceptaConsentimientoDatos: true,
      consentimientoDatosEn: new Date().toISOString(),
    };
  }
  if (paso >= 2) {
    estado.contacto = { nombreContacto: "Lili Zambrano", telefono: "56912345678" };
    estado.whatsapp = { telefono: "56912345678", acepta: true };
  }
  if (paso >= 3) {
    estado.bodega = {
      nombre: "Bodega Lampa",
      direccion: "La Montaña Sur 4603",
      comuna: "Lampa",
      geoEstado: "resuelto",
      lat: -33.28,
      long: -70.87,
    };
  }
  return estado;
}

export default async function PaginaPreviewWizard({
  searchParams,
}: {
  searchParams: Promise<{ paso?: string }>;
}) {
  if (process.env.NODE_ENV === "production") notFound();

  const { paso } = await searchParams;
  const n = Number.parseInt(paso ?? "0", 10);
  const estado = estadoParaPaso(Number.isFinite(n) ? Math.min(Math.max(n, 0), 3) : 0);

  return (
    <PantallaSinSesion marca={{ tipo: "courier", nombre: "Novalink" }}>
      <WizardAltaSeller estadoInicial={estado} nombreFantasia="Novalink" />
    </PantallaSinSesion>
  );
}

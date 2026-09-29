import type { NextConfig } from "next";

/**
 * `allowedDevOrigins`: en desarrollo, Next.js (v15+) bloquea por seguridad las
 * peticiones a recursos internos de dev (HMR, Server Actions) provenientes de
 * un host distinto a localhost. Cuando exponemos el dev server por un túnel
 * HTTPS (cloudflared/ngrok) para probar OAuth de Mercado Libre, el host del
 * túnel debe declararse aquí o la interactividad (login, botones) "no hace
 * nada". Lo derivamos de `APP_PUBLIC_URL` para no hardcodear la URL efímera del
 * túnel. Solo aplica en desarrollo; no afecta producción.
 */
const origenesDevPermitidos: string[] = [];
if (process.env.APP_PUBLIC_URL) {
  try {
    origenesDevPermitidos.push(new URL(process.env.APP_PUBLIC_URL).host);
  } catch {
    // APP_PUBLIC_URL malformada: se ignora (el dev local por localhost sigue
    // funcionando sin necesidad de allowedDevOrigins).
  }
}

const nextConfig: NextConfig = {
  ...(origenesDevPermitidos.length > 0
    ? { allowedDevOrigins: origenesDevPermitidos }
    : {}),

  // La puesta en marcha VIEJA (`/onboarding`, asistente de catorce pasos) se
  // retiró: los enlaces guardados y los correos ya enviados siguen llegando a
  // algún lado. Lo fiscal vive ahora en `/configuracion/*`; el resto cae en la
  // puesta en marcha nueva, que manda al dashboard si el courier ya terminó.
  // Temporales (307): si el destino se reorganiza otra vez, un 308 cacheado en
  // el navegador de cada courier seguiría apuntando al sitio viejo.
  async redirects() {
    const porPaso: Array<[string, string]> = [
      ["empresa", "/configuracion/facturacion#emisor"],
      ["dte", "/configuracion/facturacion#dte"],
      ["folios", "/configuracion/facturacion#folios"],
      ["cobro", "/configuracion/facturacion#cobro"],
      ["retencion", "/configuracion/facturacion#retencion"],
      ["contacto", "/configuracion/facturacion#contacto"],
      ["cobranza", "/configuracion/cobranza"],
      ["tarifas", "/configuracion/tarifas"],
      ["periodos", "/configuracion/tarifas?seccion=periodos"],
      ["retiro", "/configuracion/tarifas?seccion=retiro"],
      ["zonas", "/configuracion/tarifas?seccion=zonas"],
      ["bodega", "/configuracion/bodegas"],
      ["sellers", "/sellers"],
      ["conductores", "/conductores"],
      ["plan", "/configuracion/plan"],
    ];
    return [
      ...porPaso.map(([paso, destination]) => ({
        source: "/onboarding",
        has: [{ type: "query" as const, key: "paso", value: paso }],
        destination,
        permanent: false,
      })),
      { source: "/onboarding/dte", destination: "/configuracion/facturacion#dte", permanent: false },
      { source: "/onboarding/folios", destination: "/configuracion/facturacion#folios", permanent: false },
      { source: "/onboarding/cobranza", destination: "/configuracion/cobranza", permanent: false },
      { source: "/onboarding/tarifas", destination: "/configuracion/tarifas", permanent: false },
      { source: "/onboarding/listo", destination: "/dashboard", permanent: false },
      { source: "/onboarding", destination: "/puesta-en-marcha", permanent: false },
      { source: "/onboarding/:path*", destination: "/puesta-en-marcha", permanent: false },
    ];
  },

  // Tree-shaking dirigido de barriles grandes: en vez de cargar todo el paquete
  // por un `import { X } from "radix-ui"`, Next reescribe el import al submódulo
  // exacto. `radix-ui` (paquete unificado) es un barril grande y NO está en la
  // lista por defecto de Next (esa cubre los `@radix-ui/react-*` sueltos).
  // `lucide-react` suele estar cubierto por defecto; se deja explícito por
  // claridad. Reduce el JS enviado al cliente y acelera el build en dev.
  experimental: {
    optimizePackageImports: ["radix-ui", "lucide-react"],
  },
};

export default nextConfig;

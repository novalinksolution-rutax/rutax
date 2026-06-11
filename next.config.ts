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
};

export default nextConfig;

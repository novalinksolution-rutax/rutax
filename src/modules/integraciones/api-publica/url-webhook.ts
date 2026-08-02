/**
 * Validación de URLs de webhooks SALIENTES — defensa contra SSRF.
 * =============================================================================
 *
 * El job `jobs/entregar-webhook.ts` hace `fetch()` server-side a una URL que el
 * tenant configura. Sin validar el destino, un dueño/admin podría apuntar el
 * webhook a infraestructura interna (loopback, rangos privados, link-local, el
 * endpoint de metadata 169.254.169.254) y provocar un SSRF desde la posición de
 * red del servidor. Esta función PURA bloquea esos destinos y exige HTTPS.
 *
 * Se aplica en DOS capas (defensa en profundidad):
 *  - al CREAR el endpoint (`configuracion/api/acciones.ts`), y
 *  - al ENTREGAR cada webhook (el job revalida la URL almacenada).
 *
 * Residual conocido: no resuelve DNS, así que no cubre DNS-rebinding (un host
 * público que resuelva a una IP privada). Mitigarlo exige resolver-y-fijar la
 * IP antes del fetch; queda fuera de este fix. Bloquear literales privados/
 * loopback ya cierra el vector directo (incluido el de metadata).
 */

export interface ResultadoUrlWebhook {
  ok: boolean;
  motivo?: string;
}

const MOTIVO_INTERNA =
  "La URL apunta a una dirección interna/privada no permitida. Usa un host público accesible por HTTPS.";

/** Valida que una URL de webhook saliente sea pública y use HTTPS. */
export function validarUrlWebhook(urlCruda: string): ResultadoUrlWebhook {
  let url: URL;
  try {
    url = new URL(urlCruda);
  } catch {
    return { ok: false, motivo: "La URL no es válida." };
  }

  if (url.protocol !== "https:") {
    return { ok: false, motivo: "La URL debe usar HTTPS." };
  }

  // Credenciales embebidas (user:pass@host) — vector de confusión/SSRF.
  if (url.username || url.password) {
    return { ok: false, motivo: "La URL no debe incluir credenciales." };
  }

  // hostname viene con corchetes para IPv6 (`[::1]`) — los quitamos.
  const host = url.hostname.toLowerCase().replace(/^\[/, "").replace(/\]$/, "");

  if (esHostBloqueado(host)) {
    return { ok: false, motivo: MOTIVO_INTERNA };
  }

  return { ok: true };
}

function esHostBloqueado(host: string): boolean {
  if (!host) return true;
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) {
    return true;
  }

  // IPv4 literal.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    return esIpv4Privada(host);
  }

  // IPv6 literal.
  if (host.includes(":")) {
    return esIpv6Privada(host);
  }

  return false;
}

function esIpv4Privada(ip: string): boolean {
  const octetos = ip.split(".").map((n) => Number(n));
  if (octetos.length !== 4 || octetos.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true; // forma inválida → bloquear por precaución
  }
  const [a, b] = octetos;
  if (a === 0) return true; // 0.0.0.0/8 ("este host")
  if (a === 10) return true; // 10/8 privada
  if (a === 127) return true; // 127/8 loopback
  if (a === 169 && b === 254) return true; // 169.254/16 link-local (incl. metadata)
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12 privada
  if (a === 192 && b === 168) return true; // 192.168/16 privada
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64/10 CGNAT
  return false;
}

function esIpv6Privada(ip: string): boolean {
  const h = ip.toLowerCase();
  if (h === "::1" || h === "::") return true; // loopback / unspecified
  // IPv4-mapped: ::ffff:a.b.c.d o la forma hex normalizada por WHATWG URL
  // (`::ffff:127.0.0.1` se serializa como `::ffff:7f00:1`). Validar la IPv4
  // embebida en cualquiera de las dos formas.
  if (h.startsWith("::ffff:")) {
    const ipv4 = ipv4DesdeMapped(h.slice("::ffff:".length));
    return ipv4 ? esIpv4Privada(ipv4) : true; // forma rara de mapped → bloquear
  }
  if (/^f[cd]/.test(h)) return true; // fc00::/7 ULA
  if (/^fe[89ab]/.test(h)) return true; // fe80::/10 link-local
  return false;
}

/** Reconstruye la IPv4 de un sufijo `::ffff:` (dotted `a.b.c.d` o hex `hhhh:hhhh`). */
function ipv4DesdeMapped(resto: string): string | null {
  if (resto.includes(".")) {
    return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(resto) ? resto : null;
  }
  const grupos = resto.split(":");
  if (grupos.length !== 2) return null;
  const g1 = parseInt(grupos[0] || "0", 16);
  const g2 = parseInt(grupos[1] || "0", 16);
  if (Number.isNaN(g1) || Number.isNaN(g2)) return null;
  return `${(g1 >> 8) & 0xff}.${g1 & 0xff}.${(g2 >> 8) & 0xff}.${g2 & 0xff}`;
}

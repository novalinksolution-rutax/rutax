import { ImageResponse } from "next/og";

/**
 * La tarjeta de enlace compartido del seguimiento. 1200 × 630.
 * =============================================================================
 *
 * QUÉ SE VEÍA ANTES
 * -----------------------------------------------------------------------------
 * Nada propio. Al pegar el enlace de seguimiento en WhatsApp, el comprador veía
 * el título del layout raíz: **«Rutax — gestión operativo-financiera ·
 * Plataforma para couriers de última milla»**. Copy escrito para el courier que
 * contrata el software, mostrado a alguien que solo quiere saber dónde está su
 * paquete y que no sabe qué es un courier de última milla.
 *
 * No había **un solo** `openGraph` en el repo, y tampoco un raster en `public/`
 * —solo SVG—, que es lo que `og:image` exige. Por eso se genera acá con
 * `ImageResponse`: el raster se produce en la petición, así que no hay archivo
 * que versionar, ni que mantener sincronizado con los tokens, ni que rehacer
 * cuando cambie la marca.
 *
 * ⚠️ REGLA 47 · UNA PREVISUALIZACIÓN DE ENLACE NO DICE ESTADOS
 * -----------------------------------------------------------------------------
 * Ni «entregado», ni «en ruta», ni una fecha. Dos razones, y las dos son duras:
 *
 * 1. **WhatsApp cachea la previsualización.** La tarjeta que se generó cuando el
 *    seller mandó el enlace se queda congelada; el estado cambia cinco veces ese
 *    mismo día. Una tarjeta que dice «en ruta» sobre un pedido ya entregado no
 *    es información vieja: es información **falsa**, y es lo primero que se ve.
 * 2. **La previsualización se ve sin abrir el enlace.** Cualquiera con acceso a
 *    ese chat —un grupo familiar, un reenvío— ve el estado sin entrar. El estado
 *    vive detrás del enlace, que es donde el token lo protege.
 *
 * Y por la misma razón no lleva el nombre del destinatario, ni la comuna, ni la
 * dirección, ni el monto (regla 66).
 *
 * Sin imagen de fondo ni logo rasterizado: es todo tipografía sobre color
 * plano. Rinde igual en un teléfono con mala señal, que es donde se abre.
 */

export const runtime = "edge";
export const alt = "Seguimiento de tu pedido";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Valores transcritos de `rx-tokens.css`, tema oscuro: es el tema base del
// sistema y una tarjeta de enlace no tiene tema que seguir.
const FONDO = "#0B1114"; // --rx-bg
const TEXTO = "#E9F2F3"; // --rx-fg
const TENUE = "#9EB0B6"; // --rx-fg-muted
const ACENTO = "#00D6B4"; // --rx-accent

export default function ImagenEnlaceSeguimiento() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          backgroundColor: FONDO,
          padding: 72,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div
            style={{
              fontSize: 26,
              letterSpacing: 6,
              textTransform: "uppercase",
              color: TENUE,
            }}
          >
            Seguimiento de tu pedido
          </div>
          <div style={{ fontSize: 68, fontWeight: 700, color: TEXTO, lineHeight: 1.15 }}>
            Mira dónde va tu paquete
          </div>
          <div style={{ fontSize: 30, color: TENUE, maxWidth: 820, lineHeight: 1.4 }}>
            Abre el enlace para ver el estado al día. Solo lo ve quien tenga este enlace.
          </div>
        </div>

        {/* La regla de acento, el mismo recurso que separa en el producto. */}
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ width: 120, height: 4, backgroundColor: ACENTO }} />
          <div style={{ fontSize: 26, color: TENUE }}>Con tecnología de Rutax</div>
        </div>
      </div>
    ),
    size,
  );
}

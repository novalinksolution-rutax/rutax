import { ATRIBUCIONES } from "../../_lib/mapa/config";

/**
 * Atribución de las fuentes cartográficas y meteorológicas.
 *
 * NO es un detalle de cortesía y no puede esconderse tras un botón de «i»:
 * OpenStreetMap la exige por licencia ODbL, y la atribución visible en
 * pantalla es LA condición bajo la cual el tier gratuito de OpenWeather admite
 * un producto comercial — que es lo que permitió reemplazar a Open-Meteo,
 * cuyo tier libre prohíbe el uso comercial y por tanto no servía para Rutax.
 *
 * El handoff no le reservó espacio en la retícula (§4 reparte el alto entre
 * barra 52 · ola 132 · mapa 1fr · tiempo 98 y nada más), así que se lo abre
 * aquí: una franja de 18 px al pie del mapa, separada por una regla menor,
 * en el gris de metadato. Le quita 18 px al `1fr` del mapa y a nada más.
 */
export function AtribucionMapa() {
  return (
    <div className="flex h-[18px] shrink-0 items-center gap-2 border-t border-tc-ink-300 bg-tc-papel px-2 text-[9px] leading-none text-tc-ink-600">
      {ATRIBUCIONES.map((fuente, i) => (
        <span key={fuente.etiqueta} className="flex items-center gap-2">
          {i > 0 ? <span aria-hidden="true">·</span> : null}
          <a
            href={fuente.href}
            target="_blank"
            rel="noreferrer noopener"
            className="hover:text-tc-tinta hover:underline"
          >
            {fuente.etiqueta}
          </a>
        </span>
      ))}
    </div>
  );
}

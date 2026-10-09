"use client";

import { useEffect } from "react";
import Lenis from "lenis";
import "lenis/dist/lenis.css";

/**
 * Scroll suave del sitio comercial, con Lenis.
 *
 * La configuración es la de la página que el usuario tomó de referencia
 * (rayyan.contapro.lat, leída de su código el 2026-10-09): `lerp: 0.1` —en cada
 * cuadro el scroll recorre el 10% de lo que le falta, de ahí la inercia— y solo
 * para rueda y trackpad. En el teléfono queda el scroll nativo (`syncTouch: false`):
 * es el que la gente espera ahí, y no le suma trabajo a Safari de iPhone.
 *
 * Lo que agregamos nosotros:
 * · Con «reducir movimiento» activado no se monta.
 * · Con un modal abierto (formulario de ventas, menú del teléfono) se detiene, así la
 *   página no se mueve detrás. Radix marca el `<body>` con `data-scroll-locked`.
 * · Los enlaces a una sección de la misma página se deslizan en vez de saltar, y
 *   quedan bajo el encabezado fijo gracias al `scroll-mt-16` de cada sección.
 *
 * Solo vive dentro de `MarcoSitio`: la app (panel, portal, conductor) no lo tiene.
 */
export function ScrollSuave() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const lenis = new Lenis({
      autoRaf: true,
      lerp: 0.1,
      smoothWheel: true,
      syncTouch: false,
      // Dentro de un diálogo, la rueda desplaza el diálogo y no la página.
      prevent: (nodo) => !!nodo.closest('dialog, [role="dialog"], [data-lenis-prevent]'),
    });

    // Detenerlo mientras un modal bloquea el scroll de la página.
    const sincronizarBloqueo = () => {
      if (document.body.hasAttribute("data-scroll-locked")) lenis.stop();
      else lenis.start();
    };
    const observador = new MutationObserver(sincronizarBloqueo);
    observador.observe(document.body, { attributes: true, attributeFilter: ["data-scroll-locked"] });

    // Enlaces a una sección de esta misma página: «#precios» o «/#precios» estando en «/».
    // Se escucha en CAPTURA: el `<Link>` de Next maneja el clic antes en la fase normal y
    // salta de golpe a la sección. Los enlaces del menú del teléfono (un diálogo) se
    // dejan pasar, porque al tocarlos el menú tiene que cerrarse.
    const alHacerClic = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const enlace = (e.target as Element | null)?.closest<HTMLAnchorElement>("a[href*='#']");
      if (!enlace || enlace.target === "_blank" || enlace.closest('[role="dialog"]')) return;
      const url = new URL(enlace.href, window.location.href);
      if (url.pathname !== window.location.pathname || !url.hash) return;
      const destino = document.getElementById(decodeURIComponent(url.hash.slice(1)));
      if (!destino) return;
      e.preventDefault();
      e.stopPropagation();
      // Sin `offset`: Lenis ya respeta el `scroll-margin-top` de cada sección (`scroll-mt-16`,
      // el alto del encabezado fijo). Sumarle otro descuento la dejaba 64 px más abajo.
      lenis.scrollTo(destino);
      history.pushState(null, "", url.hash);
    };
    document.addEventListener("click", alHacerClic, true);

    return () => {
      document.removeEventListener("click", alHacerClic, true);
      observador.disconnect();
      lenis.destroy();
    };
  }, []);

  return null;
}

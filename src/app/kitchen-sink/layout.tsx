import { notFound } from "next/navigation";

/**
 * El escaparate solo existe en desarrollo.
 *
 * `kitchen-sink` es una superficie de diseño y QA visual, no parte del
 * producto — y estaba **servida en producción sin ninguna protección**: ni
 * sesión, ni `NODE_ENV`, ni middleware. Devolvía 200 a cualquiera que adivinara
 * la URL, y como publicar acá es empujar a master, llevaba desplegada desde que
 * se creó.
 *
 * No filtra datos —todo lo que muestra es inventado—, pero enseña el producto
 * por dentro: cada primitiva, cada estado, cada patrón antes de que exista la
 * pantalla que lo usa. Eso es información de la competencia, gratis.
 *
 * La puerta va en un layout y no en la página porque la página es un Client
 * Component: acá la comprobación corre en el servidor, así que en producción el
 * HTML del escaparate **no se genera nunca**.
 */
export default function LayoutKitchenSink({ children }: { children: React.ReactNode }) {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }
  return children;
}

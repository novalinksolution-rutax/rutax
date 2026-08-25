/**
 * La marca de Rutax.
 * =============================================================================
 *
 * -----------------------------------------------------------------------------
 * EL SÍMBOLO, Y POR QUÉ EL PRODUCTO YA SE PARECE A ÉL
 * -----------------------------------------------------------------------------
 * Son **dos reglas que calzan**: una barra desde el eje izquierdo y otra desde el
 * derecho, que se traslapan en el tercio central. Ese traslape es el cuadre — la
 * idea entera del producto en dos rectángulos.
 *
 * Y no es decoración retroactiva: medio sistema de diseño sale de ahí. «El
 * símbolo son dos reglas que calzan, así que el producto separa con reglas, no
 * con tarjetas ni sombras» — de esa frase vienen el radio de 0 a 4 px, la sombra
 * solo en lo que flota, y que una tabla de mil filas no tenga un borde
 * redondeado que dibujar.
 *
 * Hasta hoy el producto había heredado **todas las consecuencias de la marca sin
 * haber puesto nunca la marca**: el sidebar dibujaba un cuadrado con degradado y
 * la inicial del courier, que además contradice la regla de que fuera de los
 * seis tonos de estado el producto es tinta y papel.
 *
 * -----------------------------------------------------------------------------
 * LA GEOMETRÍA ES EXACTA Y NO SE AJUSTA A OJO
 * -----------------------------------------------------------------------------
 * Retícula de 24. Trazo 5 · aire entre barras 4 · traslape 8 · área de resguardo
 * = 1 trazo. Sin curvas y sin contraformas finas, que es la razón por la que
 * sobrevive a la etiqueta térmica y al favicon de 16 px **sin una versión
 * especial**: a 16 px cada barra son 3 píxeles enteros y el aire otros 3.
 *
 * -----------------------------------------------------------------------------
 * DOS COLORES, Y EL OSCURO NO ES BLANCO
 * -----------------------------------------------------------------------------
 * La barra de arriba es TINTA y la de abajo es ACENTO. En tema oscuro la tinta
 * baja a `--rx-fg` (#E9F2F3) y **no sube a blanco puro**: es una regla del
 * manual, no un descuido — el blanco puro sobre el papel oscuro vibra y el
 * símbolo pierde el filo que lo hace legible a 16 px.
 *
 * La tinta usa `currentColor`, así que hereda del contexto: en un sidebar, en un
 * correo o sobre un fondo teñido, basta con poner el color del texto.
 */

import { cn } from "@/lib/utils";

/** Trazo, aire y traslape en unidades de la retícula de 24. */
const RETICULA = { trazo: 5, aire: 4, traslape: 8 } as const;

export function SimboloRutax({
  className,
  titulo,
}: {
  className?: string;
  /**
   * Nombre accesible. Se omite —y el símbolo queda decorativo— cuando va
   * acompañado del logotipo «Rutax» en texto: anunciarlo dos veces al lector de
   * pantalla es peor que no anunciarlo.
   */
  titulo?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={cn("shrink-0", className)}
      role={titulo ? "img" : undefined}
      aria-hidden={titulo ? undefined : true}
      aria-label={titulo}
    >
      {/* Barra superior: 15×5 desde el eje izquierdo. Tinta. */}
      <rect x="1" y="5" width="15" height={RETICULA.trazo} fill="currentColor" />
      {/* Barra inferior: 15×5 desde el eje derecho. Acento.
          Se traslapan en ocho unidades del centro — ahí está el cuadre. */}
      <rect
        x="8"
        y={5 + RETICULA.trazo + RETICULA.aire}
        width="15"
        height={RETICULA.trazo}
        fill="var(--rx-accent)"
      />
    </svg>
  );
}

/**
 * Las tres versiones del manual.
 *
 * · `completa` — símbolo + logotipo + descriptor. Web, propuestas, contratos.
 *   Mínimo 148 px.
 * · `reducida` — símbolo + logotipo. Encabezado de producto, correo, documentos.
 *   Mínimo 84 px.
 * · `simbolo` — solo. Favicon, ícono de app, sello en etiqueta. Mínimo 16 px.
 *
 * No hay una cuarta: si en algún sitio no cabe la reducida, cabe el símbolo, y
 * si no cabe el símbolo a 16 px es que ese sitio no lleva marca.
 */
export function MarcaRutax({
  version = "reducida",
  /**
   * `normal` es el tamaño de encabezado de producto, que es donde la marca
   * acompaña y no protagoniza.
   *
   * `grande` existe para **la puerta**: en el login la marca no acompaña a nada
   * —es lo primero y a veces lo único que hay sobre el formulario— y al tamaño
   * de encabezado se leía como un detalle de esquina en vez de como la firma de
   * la pantalla. Las proporciones no cambian: crecen los dos elementos juntos.
   */
  tamano = "normal",
  className,
}: {
  version?: "completa" | "reducida" | "simbolo";
  tamano?: "normal" | "grande";
  className?: string;
}) {
  const grande = tamano === "grande";

  if (version === "simbolo") {
    return (
      <SimboloRutax className={cn(grande ? "size-10" : "size-6", className)} titulo="Rutax" />
    );
  }

  return (
    <span className={cn("inline-flex items-center", grande ? "gap-3" : "gap-2", className)}>
      <SimboloRutax className={grande ? "size-10" : "size-6"} />
      <span className="flex flex-col leading-none">
        {/* El logotipo va en la tipografía de titulares y en peso 700: es un
            nombre propio, no un rótulo de interfaz. */}
        <span
          className={cn(
            "font-heading font-bold tracking-[-0.02em]",
            grande ? "text-[28px]" : "text-base",
          )}
        >
          Rutax
        </span>
        {version === "completa" ? (
          <span
            className={cn(
              "rx-num mt-0.5 leading-none tracking-[0.14em] text-fg-muted uppercase",
              grande ? "text-[11px]" : "text-[9px]",
            )}
          >
            Despacho y liquidación
          </span>
        ) : null}
      </span>
    </span>
  );
}

/**
 * La fila de cierre de las superficies que **firma el courier**.
 *
 * Regla 42: la marca de arriba es la del dueño de la relación. En el seguimiento
 * que ve el comprador, esa es la del courier — «Rutax» no le dice nada a alguien
 * que compró en una tienda y espera un paquete.
 *
 * Rutax entra abajo, y el manual es específico sobre el cómo: **«la misma barra
 * que cierra una liquidación cierra la pantalla. Es un lugar estructural, no un
 * pie de página, y por eso no compite con la marca de arriba.»** Nunca toma
 * color de acento en su texto y su logotipo no pasa de 15 px acá.
 */
export function FirmadoPorRutax({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "flex items-center justify-center gap-2 border-t border-line pt-3 text-fg-muted",
        className,
      )}
    >
      <span className="rx-num text-[9px] leading-tight tracking-[0.14em] uppercase">
        Despacho y liquidación por
      </span>
      <span className="inline-flex items-center gap-1.5">
        <SimboloRutax className="size-4" />
        <span className="font-heading text-[15px] leading-none font-bold tracking-[-0.02em] text-fg">
          Rutax
        </span>
      </span>
    </div>
  );
}

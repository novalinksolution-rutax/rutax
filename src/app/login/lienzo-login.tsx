/**
 * El lienzo del login: la ola de cuadre.
 * =============================================================================
 *
 * -----------------------------------------------------------------------------
 * QUÉ ES
 * -----------------------------------------------------------------------------
 * Doce módulos y **una ola diagonal que los va cuadrando de uno en uno**. Cada
 * módulo es el símbolo de Rutax —dos barras desfasadas— y cada uno hace, al
 * pasar la ola, lo que hace el producto: **dos líneas que se buscan y quedan
 * cuadradas**. Nadie tiene que entenderlo para que funcione.
 *
 * El movimiento entero vive en CSS (`rx-cuadre-*` en `rx-puente.css`), y ahí está
 * explicado el porqué de cada tiempo. Dos cosas que importa saber acá:
 *
 * · **el retroceso de 9 px es lo que hace el efecto** — sin él la barra solo
 *   cambiaría de color y el lienzo sería un letrero titilando;
 * · **la ventana de encendido (1,36 s) es menor que el retardo entre diagonales
 *   (1,6 s)**, así que nunca hay dos diagonales encendidas a la vez.
 *
 * -----------------------------------------------------------------------------
 * ⚠️ ESTE ARCHIVO NO TIENE `"use client"`, Y ES UN REQUISITO
 * -----------------------------------------------------------------------------
 * **0 JavaScript.** La versión anterior de este lienzo llevaba estado, un
 * temporizador y una consulta de `prefers-reduced-motion` en el cliente: 12
 * módulos que se turnaban desde React. Funcionaba, y era JavaScript en la
 * primera pantalla del producto — la única donde el usuario todavía no tiene
 * nada que hacer salvo juzgar cuánto tarda en aparecer.
 *
 * Acá son 24 rectángulos, dos animaciones CSS y un `animation-delay` en línea.
 * El retardo se calcula al renderizar en el servidor y se acabó.
 *
 * -----------------------------------------------------------------------------
 * ⚠️ LA GEOMETRÍA NO SE NEGOCIA
 * -----------------------------------------------------------------------------
 * Barra de **112 × 37 px** (3:1 exacto), desfase de **52 px** —46,7 % de su
 * ancho— y separación entre topes de **67 px**, que son 1,8 veces su alto. Son
 * las proporciones del favicon a 16 px, y por eso el lienzo se lee como la misma
 * marca aunque esté a otra escala.
 *
 * **Si la celda no da, se achica la celda: nunca la barra.**
 *
 * -----------------------------------------------------------------------------
 * BAJO `lg` DESAPARECE, NO SE REUBICA
 * -----------------------------------------------------------------------------
 * Nada del lienzo es información, así que no hay que buscarle sitio en un
 * teléfono. Ésa es exactamente la ventaja de un lienzo sobre un panel con
 * contenido, y quien lo esconde es la página.
 */

const BARRA = { ancho: 112, alto: 37 };
/** 46,7 % del ancho de la barra. */
const DESFASE_X = 52;
/** Separación entre topes: 67 px. Como la barra mide 37, el margen es 30. */
const MARGEN_SUPERIOR_INFERIOR = 30;

const COLUMNAS = 4;
const FILAS = 3;

/**
 * Un paso de la diagonal. La ola cruza en 8 s y deja 6,7 s de calma.
 *
 * ⚠️ **1,6 s es mayor que la ventana de encendido (1,36 s), y eso es la regla**,
 * no una coincidencia: mientras el retardo sea el más grande de los dos, nunca
 * hay dos diagonales encendidas a la vez. Bajarlo llenaría la retícula y el
 * lienzo pasaría de «algo va cuadrando» a «esto parpadea».
 */
const RETARDO_POR_PASO = 1.6;

/**
 * El módulo que se queda cuadrado y encendido con «reducir movimiento».
 *
 * Va uno del medio y no una esquina: en la esquina se lee como un elemento
 * suelto que quedó mal, y en el medio se lee como el que ya cuadró.
 */
const MODULO_EN_REPOSO = 5;

const MODULO = { ancho: 164, alto: 104 };

export function LienzoLogin() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none flex h-full w-full items-center overflow-hidden bg-bg-sunken px-[60px] py-14"
    >
      <div
        className="grid w-full"
        style={{
          gridTemplateColumns: `repeat(${COLUMNAS}, ${MODULO.ancho}px)`,
          gap: 40,
          // El aire sobrante se reparte ENTRE las columnas y no alrededor: el
          // lienzo ocupa el panel que le toca en vez de flotar en su centro.
          justifyContent: "space-between",
        }}
      >
        {Array.from({ length: COLUMNAS * FILAS }).map((_, i) => {
          const col = i % COLUMNAS;
          const fila = Math.floor(i / COLUMNAS);
          return (
            <Modulo
              key={i}
              // La diagonal sale de sumar fila y columna: los módulos de una
              // misma antidiagonal comparten retardo, y eso es lo que hace que
              // la ola cruce en diagonal y no en barrido.
              retardo={(col + fila) * RETARDO_POR_PASO}
              // El único que queda cuadrado y encendido cuando la animación se
              // apaga por «reducir movimiento». Ver la regla en el CSS.
              quieto={i === MODULO_EN_REPOSO}
            />
          );
        })}
      </div>
    </div>
  );
}

function Modulo({ retardo, quieto }: { retardo: number; quieto: boolean }) {
  return (
    <div
      style={{ width: MODULO.ancho, height: MODULO.alto }}
      {...(quieto ? { "data-quieto": "" } : {})}
    >
      <div
        className="rx-cuadre-sup"
        style={{ width: BARRA.ancho, height: BARRA.alto, animationDelay: `${retardo}s` }}
      />
      <div
        className="rx-cuadre-inf"
        style={{
          width: BARRA.ancho,
          height: BARRA.alto,
          marginTop: MARGEN_SUPERIOR_INFERIOR,
          marginLeft: DESFASE_X,
          animationDelay: `${retardo}s`,
        }}
      />
    </div>
  );
}

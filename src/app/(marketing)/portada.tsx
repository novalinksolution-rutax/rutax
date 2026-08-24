import Link from "next/link";

import { Button } from "@/components/ui/button";
import { FirmadoPorRutax } from "@/components/ui/marca-rutax";

import { SecuenciaEntregaDinero } from "./_componentes/secuencia-entrega-dinero";

/**
 * La portada de Rutax.
 * =============================================================================
 *
 * -----------------------------------------------------------------------------
 * HASTA HOY NO EXISTÍA, Y ESO ERA UN AGUJERO Y NO UNA OMISIÓN
 * -----------------------------------------------------------------------------
 * `src/app/page.tsx` eran 31 líneas de enrutamiento: quien no tenía sesión iba
 * directo a `/login`. Un courier que llegaba a `rutax.io` encontraba un
 * formulario y ninguna forma de saber qué es esto — y **el registro no tenía un
 * solo enlace entrante** (brecha #9).
 *
 * -----------------------------------------------------------------------------
 * EL TITULAR DICE LO QUE NINGUNA OTRA PÁGINA DEL RUBRO DICE
 * -----------------------------------------------------------------------------
 * De las 17 páginas comparables que se analizaron, **ninguna promete arriba que
 * el software le cobre a sus clientes y le liquide a sus conductores**. Ese es
 * el titular, y pasa la prueba del tapado: contiene el sujeto —courier— y el
 * objeto —operación, dinero—; si los borras, la frase se cae.
 *
 * El subtítulo existe para vigilar un riesgo concreto: «el dinero» podría
 * leerse como que Rutax mueve plata. Por eso su segunda mitad es explícita —
 * *deja hecha la factura y la liquidación, cuadradas*—: **lo que hace es dejar
 * las cuentas hechas, no ser un banco.**
 *
 * -----------------------------------------------------------------------------
 * LO QUE NO ESTÁ, Y ES DELIBERADO
 * -----------------------------------------------------------------------------
 * · **La hora de corte no va en el titular.** Es material excelente y va en la
 *   sección 3, en forma de pregunta. Ponerlo arriba como afirmación —«si cierras
 *   a las 16 horas…»— excluye al 95 % de los visitantes que no cierran a esa
 *   hora. Fue el error del intento anterior.
 * · **El ruteo tampoco.** Ninguna empresa de peso se llama «optimizador de
 *   rutas» en su titular; va en su propia sección, después del foso.
 * · **Cero imágenes arriba del pliegue** (regla 79). La velocidad es parte del
 *   argumento: una portada que tarda no puede prometer que ahorra tiempo.
 * · **Ningún logo de cliente inventado.** Rutax está en piloto y lo dice; la
 *   franja que en 15 de 17 páginas son logos, acá es un hecho verificable.
 * · **Precios no se menciona** *(decisión del usuario, 24-08-2026: el modo de
 *   cobro va a ser distinto)*. El CTA lleva el TIEMPO al lado en vez del precio,
 *   que contra un comprador escéptico desactiva más objeciones.
 */
export function Portada() {
  return (
    <div className="mx-auto max-w-5xl px-5 py-12 sm:py-20">
      {/* ─── 1 · Hero ────────────────────────────────────────────────── */}
      <section className="space-y-6">
        <h1 className="font-heading max-w-3xl text-3xl leading-tight font-semibold sm:text-5xl">
          La operación y el dinero de tu courier, en un solo sistema
        </h1>
        <p className="max-w-2xl text-base leading-relaxed text-fg-muted sm:text-lg">
          <strong className="font-medium text-fg">
            Software de última milla para couriers de Santiago.
          </strong>{" "}
          Centraliza los pedidos de Mercado Libre Flex, Shopify y los tuyos, despáchalos con tu
          flota, y deja hecha la factura al seller y la liquidación del conductor. Cuadradas, sin
          planillas.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Button asChild size="lg">
            <Link href="/agendar">Agendar una demostración</Link>
          </Button>
          {/* El tiempo al lado del botón, no el precio. */}
          <span className="text-sm text-fg-muted">
            30 minutos, con tus propios pedidos en pantalla
          </span>
        </div>
        <p className="text-sm text-fg-muted">
          Hoy en <strong className="font-medium text-fg">piloto</strong> con couriers de Santiago.
        </p>
      </section>

      {/* ─── La secuencia ────────────────────────────────────────────── */}
      <section className="mt-10 sm:mt-14">
        <SecuenciaEntregaDinero />
      </section>

      {/* ─── 2 · Las tres fuentes ────────────────────────────────────── */}
      <Seccion titulo="Tus pedidos entran solos desde">
        <div className="grid gap-4 sm:grid-cols-3">
          <Fuente nombre="Mercado Libre Flex" detalle="hasta 10 cuentas por seller" />
          <Fuente nombre="Shopify" detalle="las tiendas de tus sellers" />
          <Fuente nombre="Same-day propio" detalle="los que carga tu seller o tú" />
        </div>
        <p className="mt-4 text-sm leading-relaxed text-fg-muted">
          Con dirección y coordenada resueltas.{" "}
          <strong className="font-medium text-fg">Nadie digita una dirección a mano.</strong>
        </p>
      </Seccion>

      {/* ─── 3 · Las cuatro cosas ────────────────────────────────────── */}
      <Seccion
        titulo="Cuatro cosas que hace todo courier, trabajes como trabajes"
        bajada="Cambia el tamaño, cambia el horario, cambia quién retira. Esto no."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Paso
            n={1}
            titulo="Entran"
            texto="De donde sea que vendan tus sellers, llegan a la misma pantalla con la dirección y la coordenada resueltas."
          />
          <Paso
            n={2}
            titulo="Se reparten"
            texto="Filtras, seleccionas un grupo y lo asignas de una vez. Con el dedo en la tablet o con el teclado en el escritorio."
          />
          <Paso
            n={3}
            titulo="Se prueban"
            texto="El conductor cierra la parada con foto y ubicación, entregue o no. Esa evidencia sostiene el cobro y la conversación cuando algo se discute."
          />
          <Paso
            n={4}
            titulo="Se cierran"
            texto="Cada entrega ya generó su línea de cobro y su línea de pago. Cierras, emites la factura con folio del SII, y transfieres. Sin volver a sumar nada."
          />
        </div>

        {/* El detalle operativo va en forma de PREGUNTA, no de afirmación:
            «si cierras a las 16 horas…» excluye a quien no lo hace. */}
        <div className="mt-6 divide-y divide-line-subtle border-y border-line-subtle">
          <Pregunta
            p="¿Retiras en la bodega del seller o te llegan a la tuya?"
            r="Las dos."
          />
          <Pregunta
            p="¿Trabajas contra una hora de corte?"
            r="Si la tienes, la defines por seller. Si no, el sistema no te inventa un reloj."
          />
          <Pregunta
            p="¿Conductores propios o a honorarios?"
            r="Los dos, y cada uno liquida como corresponde."
          />
          <Pregunta
            p="¿Un seller grande o veinte chicos?"
            r="Cada uno con su tarifa, su bodega y su período."
          />
        </div>
      </Seccion>

      {/* ─── 4 · El foso ─────────────────────────────────────────────── */}
      {/* La ÚNICA sección con fondo distinto de toda la portada: el cambio
          hace de subrayado, y se gasta una sola vez. */}
      <section className="mt-14 border border-line bg-bg-inset p-6 sm:mt-20 sm:p-10">
        <h2 className="font-heading max-w-2xl text-2xl leading-tight font-semibold sm:text-3xl">
          Cada entrega deja hechas sus dos líneas de dinero
        </h2>
        <p className="mt-4 max-w-2xl text-base leading-relaxed text-fg-muted">
          Cuando el conductor cierra la parada, el sistema escribe dos líneas:{" "}
          <strong className="font-medium text-fg">lo que le cobras al seller</strong> y{" "}
          <strong className="font-medium text-fg">lo que le pagas al conductor</strong>.
          Conciliadas, con la tarifa de ese seller en esa comuna.
        </p>
        <p className="mt-3 max-w-2xl text-base leading-relaxed text-fg-muted">
          A fin de mes no sumas: cierras.
        </p>
        <blockquote className="mt-6 max-w-2xl border-l-2 border-brand pl-4 text-base leading-relaxed">
          <strong className="font-medium">
            Esto es lo que no tiene ningún otro software de última milla.
          </strong>{" "}
          Los demás terminan cuando el paquete llega. Acá recién ahí empieza la parte que te quita
          el fin de semana.
        </blockquote>
      </section>

      {/* ─── 5 · Las cuatro superficies ──────────────────────────────── */}
      <Seccion titulo="Cuatro superficies, y dos llevan tu nombre">
        <div className="grid gap-4 sm:grid-cols-2">
          <Superficie nombre="Tu backoffice" detalle="Operación, dinero y configuración." />
          <Superficie
            nombre="La app de tu conductor"
            detalle="Su ruta, sus retiros y su liquidación."
          />
          <Superficie
            nombre="El portal de tus sellers"
            detalle="Con tu nombre arriba, no con el nuestro."
            tuya
          />
          <Superficie
            nombre="El seguimiento del comprador"
            detalle="Lleva tu marca. Cada entrega es una impresión de tu courier."
            tuya
          />
        </div>
      </Seccion>

      {/* ─── 6 · Ruteo ───────────────────────────────────────────────── */}
      <Seccion
        titulo="La ruta, ordenada"
        bajada="Sin digitar direcciones: ya entraron con su coordenada."
      >
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2 border border-line bg-bg-raised p-5">
          <span className="rx-num text-3xl font-semibold text-fg-muted line-through">390 km</span>
          <span className="text-fg-muted">en orden alfabético</span>
          <span className="text-fg-subtle">→</span>
          <span className="rx-num text-3xl font-semibold">185 km</span>
          <span className="text-fg-muted">con la ruta ordenada</span>
        </div>
        <p className="mt-3 text-sm leading-relaxed text-fg-muted">
          Una ruta real de <strong className="font-medium text-fg">87 paradas</strong>, medida.{" "}
          No es un porcentaje promedio.
        </p>
      </Seccion>

      {/* ─── 7 · Puesta en marcha ────────────────────────────────────── */}
      <Seccion
        titulo="Andando en cuatro pasos, sin dejar de operar"
        bajada="Lo nuevo y lo que ya usas conviven. No hay un día en que todo tenga que cambiar."
      >
        <ol className="divide-y divide-line-subtle border-y border-line-subtle">
          <Marcha n={1} texto="Conectamos tus fuentes — los pedidos empiezan a entrar el mismo día." />
          <Marcha n={2} texto="Cargamos tus tarifas y tus zonas — es lo que ya tienes en tu planilla." />
          <Marcha n={3} texto="Tus conductores bajan la app — la primera ruta en paralelo, para comparar." />
          <Marcha n={4} texto="Conectamos tu facturación — con tu contador; mientras tanto, simulación." />
        </ol>
      </Seccion>

      {/* ─── 8 · Integraciones, con su estado REAL ───────────────────── */}
      <Seccion titulo="Integraciones">
        <div className="grid gap-4 sm:grid-cols-3">
          <Integracion
            categoria="Marketplaces"
            nombre="Mercado Libre Flex"
            detalle="Hasta 10 cuentas por seller. La prueba de entrega oficial la sigue gobernando Mercado Envíos, y el sistema se lo dice al conductor."
            estado="En piloto"
          />
          <Integracion
            categoria="Tiendas"
            nombre="Shopify"
            detalle="El seller pega dominio y credencial desde su propio panel."
            estado="En piloto"
          />
          <Integracion
            categoria="Documentos y dinero"
            nombre="Facturación electrónica"
            detalle="Emisión con folio del SII. Se habilita con validez tributaria cuando terminas de probar."
            estado="En simulación"
          />
        </div>
        <p className="mt-4 border border-attention-line bg-attention-bg px-4 py-3 text-sm leading-relaxed text-attention-fg">
          <strong className="font-medium">Estado real, sin adornos.</strong> Lectura del banco, en
          construcción. No listamos integraciones que no existen.
        </p>
      </Seccion>

      {/* ─── 9 · Prueba ──────────────────────────────────────────────── */}
      <Seccion
        titulo="Estamos en piloto, y lo decimos"
        bajada="No tenemos veinte logos y no vamos a inventarlos: los ibas a verificar."
      >
        {/* Ninguna de las cuatro es un contador animado (regla 74). */}
        <div className="grid gap-4 sm:grid-cols-4">
          <Cifra valor="185 km" texto="Una ruta de 87 paradas ordenada, contra 390 alfabético. Medido." />
          <Cifra valor="0" texto="Direcciones digitadas a mano en un pedido de Flex o Shopify." />
          <Cifra valor="2" texto="Líneas de dinero por entrega, escritas solas y conciliadas." />
          <Cifra valor="130" texto="Bultos escaneados seguidos sin mirar la pantalla." />
        </div>
      </Seccion>

      {/* ─── 10 · Preguntas ──────────────────────────────────────────── */}
      {/* Abre con la MÁS DURA. Esconderla la convierte en la objeción que
          aparece en la demo, cuando ya invertiste media hora. */}
      <Seccion titulo="Preguntas">
        <div className="divide-y divide-line-subtle border-y border-line-subtle">
          <Pregunta
            p="¿Mis conductores van a usar dos apps?"
            r="En Flex, sí, y eso no lo cambia ningún software: la prueba de entrega la gobierna Mercado Envíos. Lo que hacemos es que tu conductor no se equivoque — su app le dice cuál manda en cada pedido."
          />
          <Pregunta
            p="¿Tengo que dejar de usar lo que ya uso?"
            r="No. Lo nuevo y lo viejo conviven mientras compares."
          />
          <Pregunta
            p="¿Emite factura de verdad, con folio?"
            r="Sí, con folio del SII. Y factura tu empresa, no Rutax: es tu certificado y son tus folios."
          />
          <Pregunta
            p="¿Mis sellers tienen que aprender algo?"
            r="Entran a un portal con tu nombre a ver sus pedidos y sus cobros. Conectar su cuenta de Mercado Libre les toma un minuto."
          />
        </div>
      </Seccion>

      {/* ─── 11 · Seguridad ──────────────────────────────────────────── */}
      {/* Va al FINAL: nadie en el rubro la pone arriba, y arriba compite con
          el argumento. Abajo, cierra. */}
      <Seccion titulo="Tus datos">
        <ul className="grid gap-3 sm:grid-cols-3">
          <Dato texto="Exportación total: lo que entra se puede sacar." />
          <Dato texto="Aislamiento por empresa, impuesto en la base de datos." />
          <Dato texto="Todo lo que toca plata queda registrado con autor, fecha y motivo." />
        </ul>
      </Seccion>

      {/* ─── 12 · Cierre ─────────────────────────────────────────────── */}
      <section className="mt-14 border-t border-line pt-10 sm:mt-20">
        <h2 className="font-heading text-2xl leading-tight font-semibold sm:text-3xl">
          Media hora, con tus propios pedidos en pantalla
        </h2>
        <p className="mt-3 max-w-xl text-base leading-relaxed text-fg-muted">
          Sin tarjeta, sin compromiso y sin vendedor detrás. Contesta quien construye el producto.
        </p>
        <Button asChild size="lg" className="mt-6">
          <Link href="/agendar">Agendar una demostración</Link>
        </Button>
      </section>

      <div className="mt-16">
        <FirmadoPorRutax />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Piezas de la portada
// ---------------------------------------------------------------------------

function Seccion({
  titulo,
  bajada,
  children,
}: {
  titulo: string;
  bajada?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-14 sm:mt-20">
      <h2 className="font-heading text-2xl leading-tight font-semibold sm:text-3xl">{titulo}</h2>
      {bajada ? (
        <p className="mt-2 max-w-2xl text-base leading-relaxed text-fg-muted">{bajada}</p>
      ) : null}
      <div className="mt-6">{children}</div>
    </section>
  );
}

function Fuente({ nombre, detalle }: { nombre: string; detalle: string }) {
  return (
    <div className="border border-line bg-bg-raised p-4">
      <p className="font-medium">{nombre}</p>
      <p className="mt-1 text-sm text-fg-muted">{detalle}</p>
    </div>
  );
}

function Paso({ n, titulo, texto }: { n: number; titulo: string; texto: string }) {
  return (
    <div className="border border-line bg-bg-raised p-5">
      <p className="rx-num font-mono text-[10px] tracking-[0.12em] text-fg-subtle uppercase">
        {n} · {titulo}
      </p>
      <p className="mt-2 text-sm leading-relaxed text-fg-muted">{texto}</p>
    </div>
  );
}

function Pregunta({ p, r }: { p: string; r: string }) {
  return (
    <div className="py-4">
      <p className="text-sm font-medium">{p}</p>
      <p className="mt-1 text-sm leading-relaxed text-fg-muted">{r}</p>
    </div>
  );
}

function Superficie({
  nombre,
  detalle,
  tuya = false,
}: {
  nombre: string;
  detalle: string;
  tuya?: boolean;
}) {
  return (
    <div className="border border-line bg-bg-raised p-5">
      <div className="flex items-center gap-2">
        <p className="font-medium">{nombre}</p>
        {tuya ? (
          <span className="border border-accent-line bg-accent-deep px-1.5 py-0.5 font-mono text-[9px] tracking-[0.1em] text-accent-soft uppercase">
            Tu marca
          </span>
        ) : null}
      </div>
      <p className="mt-1 text-sm leading-relaxed text-fg-muted">{detalle}</p>
    </div>
  );
}

function Marcha({ n, texto }: { n: number; texto: string }) {
  return (
    <li className="flex gap-4 py-4">
      <span className="rx-num shrink-0 font-mono text-sm text-fg-subtle">{n}</span>
      <span className="text-sm leading-relaxed text-fg-muted">{texto}</span>
    </li>
  );
}

function Integracion({
  categoria,
  nombre,
  detalle,
  estado,
}: {
  categoria: string;
  nombre: string;
  detalle: string;
  estado: string;
}) {
  return (
    <div className="border border-line bg-bg-raised p-5">
      <p className="font-mono text-[10px] tracking-[0.12em] text-fg-subtle uppercase">
        {categoria}
      </p>
      <p className="mt-1 font-medium">{nombre}</p>
      {/* Cada integración lleva su ESTADO REAL al lado (regla 77). */}
      <span className="mt-2 inline-block border border-progress-line bg-progress-bg px-2 py-0.5 text-[11px] font-medium text-progress-fg">
        {estado}
      </span>
      <p className="mt-2 text-sm leading-relaxed text-fg-muted">{detalle}</p>
    </div>
  );
}

function Cifra({ valor, texto }: { valor: string; texto: string }) {
  return (
    <div className="border border-line bg-bg-raised p-5">
      <p className="rx-num text-3xl font-semibold">{valor}</p>
      <p className="mt-2 text-sm leading-relaxed text-fg-muted">{texto}</p>
    </div>
  );
}

function Dato({ texto }: { texto: string }) {
  return (
    <li className="border border-line bg-bg-raised p-4 text-sm leading-relaxed text-fg-muted">
      {texto}
    </li>
  );
}

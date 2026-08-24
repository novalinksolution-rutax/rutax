import Link from "next/link";
import { ShieldAlert } from "lucide-react";

/**
 * La anatomía compartida de las pantallas de configuración.
 * =============================================================================
 *
 * -----------------------------------------------------------------------------
 * HABÍA CUATRO DIALECTOS
 * -----------------------------------------------------------------------------
 * El ancho se decidía pantalla por pantalla —`max-w-2xl`, `max-w-3xl`, o
 * ninguno—, la cabecera llevaba o no llevaba acción sin criterio visible, y el
 * estado «sin permiso» estaba copiado y pegado con variantes en cada archivo:
 * unas con botón de vuelta, otras sin él, y una que directamente **expulsaba en
 * silencio con un `redirect`**.
 *
 * Nada de eso era una decisión: era el orden en que se fueron escribiendo. Nueve
 * pantallas que hacen lo mismo —mostrar un ajuste y dejarlo cambiar— tienen que
 * verse igual, o cada una se lee como si fuera de otro producto.
 *
 * -----------------------------------------------------------------------------
 * `max-w-3xl` Y NO `max-w-2xl`
 * -----------------------------------------------------------------------------
 * Las pantallas de este grupo se reparten entre formularios de dos campos y
 * tablas de diez columnas. El ancho lo manda la más ancha: con `2xl` la tabla de
 * tarifas se comprime y con `3xl` el formulario de retiro no se ve mal — el
 * campo tiene su propio ancho, no el del contenedor.
 */
export function PantallaConfiguracion({
  titulo,
  bajada,
  accion,
  children,
}: {
  titulo: string;
  /** Qué es esto, en lenguaje de negocio. No es opcional: sin ella el título solo. */
  bajada: string;
  /** La acción principal de la pantalla, si tiene una. Va arriba a la derecha. */
  accion?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-heading text-2xl font-semibold">{titulo}</h1>
          <p className="mt-0.5 text-sm leading-relaxed text-fg-muted">{bajada}</p>
        </div>
        {accion ? <div className="shrink-0">{accion}</div> : null}
      </div>
      {children}
    </div>
  );
}

/**
 * El estado «no tienes permiso», uno solo para las nueve.
 *
 * ⚠️ **Nunca un `redirect`.** «Exportar datos» expulsaba al dashboard sin decir
 * nada: quien llega por un enlace directo se queda pensando que el enlace está
 * roto, y quien no sabe que le falta permiso no sabe a quién pedírselo. Ocultar
 * no basta — hay que decir por qué no se puede y quién sí puede.
 */
export function SinPermisoConfiguracion({
  frase,
}: {
  /**
   * La frase completa, ya conjugada: «Las tarifas solo las pueden ver y cambiar
   * el dueño o administración».
   *
   * Se pasa entera y no por partes a propósito: armarla con un objeto y un
   * artículo obliga a adivinar el género y el número desde el código, y produce
   * cosas como «las tarifas lo pueden ver». El español no se arma por plantilla.
   */
  frase: string;
}) {
  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex flex-col items-center gap-3 border border-line bg-bg-sunken px-6 py-14 text-center">
        <ShieldAlert className="size-8 text-fg-muted" aria-hidden="true" />
        <div className="space-y-1">
          <p className="font-medium text-fg">No tienes permiso para ver esto</p>
          <p className="mx-auto max-w-md text-sm leading-relaxed text-fg-muted">
            {frase} Si necesitas un cambio acá, pídeselo a esa persona o que te dé acceso.
          </p>
        </div>
        <Link href="/dashboard" className="text-sm font-medium text-accent-text hover:underline">
          Volver al panel
        </Link>
      </div>
    </div>
  );
}

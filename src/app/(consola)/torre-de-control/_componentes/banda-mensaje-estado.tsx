import Link from "next/link";
import type { EstadoPantalla, MensajeEstado } from "../_fixture/estado-torre";
import { FOCO_ANILLO } from "../_lib/estilos";

interface Props {
  estado: EstadoPantalla;
  mensajes: MensajeEstado[];
  /** Ejecuta la acción "Ver el detalle igual" (ancla interna, no navegación). */
  onVerDetalleIgual?: () => void;
}

/**
 * Banda de mensaje de estado (README §4). Solo existe si hay mensaje —
 * `con_excepciones` y `cargando` no tienen. Copys literales de §8, no se
 * reescriben aquí.
 */
export function BandaMensajeEstado({ estado, mensajes, onVerDetalleIgual }: Props) {
  const mensaje = mensajes.find((m) => m.estado === estado);
  if (!mensaje) return null;

  return (
    <div className="flex items-center gap-5 bg-tc-papel px-[22px] py-[13px]">
      <span className="mt-1 size-2 shrink-0 bg-tc-tinta" aria-hidden="true" />
      <div className="flex-1">
        <p className="text-[14px] font-extrabold text-tc-tinta">{mensaje.titulo}</p>
        <p className="mt-0.5 max-w-[760px] text-[12.5px] text-tc-ink-700">{mensaje.cuerpo}</p>
      </div>
      {mensaje.accion ? (
        <AccionBanda
          etiqueta={mensaje.accion.etiqueta}
          destino={mensaje.accion.destino}
          onVerDetalleIgual={onVerDetalleIgual}
        />
      ) : null}
    </div>
  );
}

function AccionBanda({
  etiqueta,
  destino,
  onVerDetalleIgual,
}: {
  etiqueta: string;
  destino: string;
  onVerDetalleIgual?: () => void;
}) {
  const claseBoton = `ml-auto shrink-0 border border-tc-tinta px-3 py-1.5 text-[12px] font-extrabold text-tc-tinta transition-colors hover:bg-tc-tinta hover:text-tc-papel ${FOCO_ANILLO}`;

  // Ancla interna (#detalle, #olas): scroll suave dentro de la misma pantalla.
  if (destino.startsWith("#")) {
    return (
      <button
        type="button"
        className={claseBoton}
        onClick={() => {
          onVerDetalleIgual?.();
          document.getElementById(destino.slice(1))?.scrollIntoView({ behavior: "smooth", block: "start" });
        }}
      >
        {etiqueta}
      </button>
    );
  }

  // Navegación real (p. ej. "/configuracion/zonas").
  return (
    <Link href={destino} className={claseBoton}>
      {etiqueta}
    </Link>
  );
}

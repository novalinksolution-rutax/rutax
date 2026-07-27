import Link from "next/link";
import { numeroTorre } from "../_lib/formato";

/**
 * Contador de sin ubicar (README §4, "Abajo derecha" del mapa; regla de
 * producto 5: "los pedidos sin geocodificar se declaran siempre"). Un mapa —
 * o su equivalente en lista — que los esconde miente sobre la carga real.
 *
 * "Revisar direcciones" enlaza a la bandeja real que ya existe en
 * `/operaciones` (filtro `por_revisar=1`, RF de geocoding/cobertura/tarifa).
 */
export function ContadorSinUbicar({ cantidad }: { cantidad: number }) {
  return (
    <div className="flex items-center gap-3 border-2 border-tc-tinta bg-tc-papel px-3.5 py-2.5">
      <span className="tc-num text-[26px] leading-none font-extrabold text-tc-tinta">
        {numeroTorre(cantidad)}
      </span>
      <p className="text-[11px] text-tc-ink-700">
        pedidos sin ubicar no están en este plano.
        <br />
        <Link href="/operaciones?por_revisar=1" className="font-semibold text-tc-senal-text hover:underline">
          Revisar direcciones
        </Link>
      </p>
    </div>
  );
}

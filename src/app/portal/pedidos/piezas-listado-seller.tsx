"use client";

/**
 * Las dos piezas de cliente de «Mis pedidos»: los cajones y el buscador.
 * =============================================================================
 *
 * La página sigue siendo un Server Component y los dos filtros viajan por la
 * URL. Lo único que necesita cliente es el manejador del clic y el del teclado,
 * así que se aísla acá en vez de convertir la lista entera en cliente.
 *
 * -----------------------------------------------------------------------------
 * POR QUÉ EL BUSCADOR VA AL SERVIDOR Y NO FILTRA LO QUE HAY EN PANTALLA
 * -----------------------------------------------------------------------------
 * La lista pagina de a 25. Un buscador que filtrara solo las filas cargadas
 * diría «ningún pedido coincide» teniendo el pedido en la página 4 — y el seller
 * concluiría que su envío no existe, que es exactamente lo contrario de lo que
 * vino a averiguar. Busca contra el conjunto completo, como los cajones cuentan
 * contra el conjunto completo.
 *
 * -----------------------------------------------------------------------------
 * SE ENVÍA AL SOLTAR EL ENTER, NO EN CADA TECLA
 * -----------------------------------------------------------------------------
 * Cada letra sería una navegación de servidor y un re-render de la tabla. El
 * campo mantiene su texto local y solo navega al enviar o al limpiar.
 */

import { useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Search, X } from "lucide-react";

import { BarraCajones, type Cajon } from "@/components/ui/barra-cajones";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

/** Navegar conservando el resto de la URL: un filtro no se lleva puesto al otro. */
function useNavegarConservando() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  return (campo: string, valor: string | null) => {
    const siguiente = new URLSearchParams(params.toString());
    if (valor) siguiente.set(campo, valor);
    else siguiente.delete(campo);
    // Cambiar de cajón o de búsqueda vuelve a la primera página: quedarse en la
    // 4 de un conjunto que ahora tiene 2 muestra una lista vacía sin motivo.
    siguiente.delete("pagina");
    const qs = siguiente.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  };
}

export function CajonesPedidosSeller({
  cajones,
  excluido,
  activo,
  total,
}: {
  cajones: Cajon[];
  excluido: Cajon;
  activo: string | null;
  total: number;
}) {
  const navegar = useNavegarConservando();

  return (
    <BarraCajones
      cajones={cajones}
      excluido={excluido}
      activo={activo}
      total={total}
      onSeleccionar={(clave) => navegar("estado", clave)}
    />
  );
}

export function BuscadorPedidosSeller({ inicial }: { inicial: string }) {
  const navegar = useNavegarConservando();
  const [texto, setTexto] = useState(inicial);

  return (
    <form
      role="search"
      className="relative flex-1 sm:max-w-xs"
      onSubmit={(e) => {
        e.preventDefault();
        navegar("q", texto.trim() || null);
      }}
    >
      <Search
        className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-fg-muted"
        aria-hidden="true"
      />
      <Input
        type="search"
        name="q"
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        placeholder="Buscar por código o destinatario"
        aria-label="Buscar por código o destinatario"
        className="pl-8"
      />
      {inicial ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="absolute top-1/2 right-1 size-7 -translate-y-1/2"
          onClick={() => {
            setTexto("");
            navegar("q", null);
          }}
        >
          <X className="size-4" aria-hidden="true" />
          <span className="sr-only">Limpiar la búsqueda</span>
        </Button>
      ) : null}
    </form>
  );
}

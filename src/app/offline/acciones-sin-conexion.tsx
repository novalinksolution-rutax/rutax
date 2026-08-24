"use client";

/**
 * La salida de la pantalla sin conexión.
 * =============================================================================
 *
 * -----------------------------------------------------------------------------
 * POR QUÉ NO ES UN «REINTENTAR» A SECAS
 * -----------------------------------------------------------------------------
 * El tablero pide una sola salida: reintentar. Y un botón de reintentar que se
 * pulsa **sin conexión** hace exactamente nada visible — recarga, vuelve a
 * fallar, y muestra la misma pantalla. Quien lo pulsa tres veces concluye que la
 * aplicación está rota, no que sigue sin señal.
 *
 * Así que el botón dice en qué estado está la red **antes** de que lo toques:
 *
 * · **sin señal** → el botón queda desactivado y lo dice. No es una función
 *   escondida: es una que todavía no puede funcionar, y decirlo evita el gesto
 *   inútil repetido.
 * · **volvió la señal** → el botón se activa solo y cambia de texto. El
 *   conductor no tiene que adivinar cuándo volver a intentar; la pantalla se lo
 *   avisa mientras él sigue caminando.
 *
 * ⚠️ **`navigator.onLine` no prueba que haya internet** —solo que hay una
 * interfaz de red activa: un wifi de estacionamiento sin salida da `true`—. Por
 * eso el estado gobierna el **rótulo y la habilitación**, nunca una promesa: al
 * pulsar se recarga de verdad, y si no había salida se vuelve acá.
 *
 * Esta pantalla la sirve el service worker desde el caché, así que no puede
 * depender de ningún dato: solo del navegador.
 */

import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";

export function AccionesSinConexion() {
  // Arranca en `false` y no en `navigator.onLine` a propósito: el servidor no
  // tiene navegador, y leerlo en el primer render daría una marca distinta a la
  // del cliente. Se resuelve en el efecto, que corre solo en el navegador.
  const [hayRed, setHayRed] = useState(false);

  useEffect(() => {
    const actualizar = () => setHayRed(navigator.onLine);
    actualizar();
    window.addEventListener("online", actualizar);
    window.addEventListener("offline", actualizar);
    return () => {
      window.removeEventListener("online", actualizar);
      window.removeEventListener("offline", actualizar);
    };
  }, []);

  return (
    <div className="mt-6 flex flex-col items-center gap-2">
      <Button
        onClick={() => window.location.reload()}
        disabled={!hayRed}
        className="w-full"
        // La altura de toque de la app: esto se pulsa de pie, en la calle.
        size="lg"
      >
        <RefreshCw className="size-4" aria-hidden="true" />
        {hayRed ? "Volver a cargar" : "Esperando señal…"}
      </Button>

      <p aria-live="polite" className="text-xs text-fg-subtle">
        {hayRed
          ? "Ya hay señal. Toca para continuar."
          : "El botón se activa solo cuando vuelva la señal."}
      </p>
    </div>
  );
}

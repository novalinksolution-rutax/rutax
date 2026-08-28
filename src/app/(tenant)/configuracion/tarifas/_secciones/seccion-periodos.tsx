import { Info, TriangleAlert } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { etiquetaFechaCivilCorta } from "@/lib/ui/rango-fecha";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import {
  contarPeriodosAbiertosConLineas,
  leerPeriodicidadTenant,
} from "@/modules/dinero/config-periodos";
import { calcularRangoPeriodo } from "@/modules/dinero/periodos";
import type { TipoPeriodoFacturacion } from "@/modules/dinero/tipos";

import { FormularioPeriodicidad } from "../formulario-periodicidad";
import { OPCIONES_PERIODICIDAD, etiquetaPeriodicidad } from "../periodicidad";

/**
 * Períodos — cada cuánto se cierra la cuenta.
 * =============================================================================
 *
 * 🔴 POR QUÉ ESTA SECCIÓN EXISTE
 * -----------------------------------------------------------------------------
 * `dinero.config_periodos` la leía el motor desde el primer día y **no la
 * escribía nadie**: el único insert del repositorio estaba en los seeds de demo.
 * En producción la lectura caía siempre en el respaldo del código —`'mensual'`—
 * así que **todo courier facturaba mensual, quisiera o no, y no tenía dónde
 * cambiarlo**. No fallaba nada: el período salía del mes calendario y se cerraba
 * solo. El courier lo descubría al emitir su primera factura, con las líneas ya
 * repartidas en el período equivocado.
 *
 * -----------------------------------------------------------------------------
 * POR QUÉ VIVE DENTRO DE TARIFAS Y NO EN UNA ENTRADA PROPIA
 * -----------------------------------------------------------------------------
 * La pantalla ya se declaró como «cuánto entra y cuánto sale por cada cosa que
 * hace el courier» al fusionar Tarifas, Zonas y Retiro el 26-08. Esto es la
 * misma pregunta con el reloj puesto: **cada cuánto se pasa la cuenta**. Pide
 * exactamente la misma capacidad (`gestionar_tarifas`), así que sumarla acá no
 * abre ningún acceso nuevo — y una quinta entrada en la navegación sí obligaría
 * otra vez a recordar en cuál de las pantallas estaba el campo.
 *
 * -----------------------------------------------------------------------------
 * ⚠️ «MENSUAL» HEREDADO Y «MENSUAL» ELEGIDO SE VEN IGUAL, Y NO LO SON
 * -----------------------------------------------------------------------------
 * Un courier que nunca tocó esto y uno que eligió mensual a propósito muestran
 * la misma palabra. Solo uno de los dos tomó una decisión. La distinción sale de
 * `leerPeriodicidadTenant` (`explicita`) y es lo que este aviso dice en voz
 * alta: si no se dijera, la pantalla estaría afirmando que el courier eligió
 * algo que en realidad le pusimos nosotros.
 *
 * ⚠️ Los rangos que se muestran los calcula `calcularRangoPeriodo`, la MISMA
 * función que el motor usa al crear el período. No hay una segunda
 * implementación de la regla que pueda decir otra cosa.
 */
export async function SeccionPeriodos({ tenantId }: { tenantId: string }) {
  const cliente = crearClienteServiceRole();

  const [config, periodosBloqueantes] = await Promise.all([
    leerPeriodicidadTenant(cliente, tenantId),
    // Tolerante: si esta cuenta falla, el formulario —que es el punto de la
    // sección— sigue en pie. La autoridad del candado es la función de base;
    // esto solo sirve para avisar antes de pulsar.
    contarPeriodosAbiertosConLineas(cliente, tenantId).catch(() => 0),
  ]);

  // El rango en que caería una entrega de HOY, por cada opción. Se calcula acá,
  // en el servidor, y no en el componente de cliente: la regla tiene que salir
  // del motor una sola vez.
  const ahora = new Date();
  const rangoDeHoy = Object.fromEntries(
    OPCIONES_PERIODICIDAD.map((o) => {
      const { fechaInicio, fechaFin } = calcularRangoPeriodo(ahora, o.valor);
      return [
        o.valor,
        `${etiquetaFechaCivilCorta(fechaInicio)} – ${etiquetaFechaCivilCorta(fechaFin)}`,
      ];
    }),
  ) as Record<TipoPeriodoFacturacion, string>;

  return (
    <div className="max-w-3xl space-y-4">
      {!config.explicita && (
        <div className="border border-border bg-muted/40 px-4 py-3">
          <div className="flex items-start gap-2">
            <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <div className="space-y-1">
              <p className="text-sm font-semibold text-foreground">
                Hoy estás facturando {etiquetaPeriodicidad(config.tipoPeriodo).toLowerCase()},
                pero nadie lo eligió
              </p>
              <p className="text-sm text-muted-foreground">
                Es lo que Rutax usa mientras el courier no decide. Funciona, y puede que sea
                justo lo que necesitas — pero conviene confirmarlo antes de tu primer cierre:
                después, cambiarlo exige cerrar los períodos que ya tengan líneas.
              </p>
            </div>
          </div>
        </div>
      )}

      {periodosBloqueantes > 0 && (
        <div
          role="alert"
          className="border border-warning-subtle bg-warning-subtle px-4 py-3"
        >
          <div className="flex items-start gap-2">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
            <div className="space-y-1">
              <p className="text-sm font-semibold text-warning-subtle-foreground">
                No se puede cambiar la periodicidad ahora
              </p>
              <p className="text-sm text-warning-subtle-foreground">
                Tienes{" "}
                <span className="rx-num font-medium">{periodosBloqueantes}</span>{" "}
                {periodosBloqueantes === 1
                  ? "período de cobro abierto que ya tiene líneas"
                  : "períodos de cobro abiertos que ya tienen líneas"}
                . Cambiarla ahora partiría ese tramo en dos rangos que se solapan, y tus sellers
                recibirían dos facturas por días repetidos. Cierra esos períodos en Dinero →
                Períodos y vuelve acá.
              </p>
            </div>
          </div>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Cada cuánto le pasas la cuenta</CardTitle>
          <CardDescription>
            Define el tramo de días que agrupa las entregas de un seller antes de facturarlas.
            La misma periodicidad rige el cierre de las liquidaciones de tus conductores.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <FormularioPeriodicidad
            actual={config.tipoPeriodo}
            explicita={config.explicita}
            rangoDeHoy={rangoDeHoy}
            periodosBloqueantes={periodosBloqueantes}
          />
          {/* La otra mitad, dicha donde se pregunta: cambiar esto NO mueve las
              líneas ya emitidas ni reabre un período cerrado. Quien elige acá se
              lo pregunta apenas ve que la opción existe. */}
          <p className="border border-line bg-bg-sunken px-4 py-3 text-sm leading-relaxed text-fg-muted">
            El cambio rige para los períodos que se abran de ahora en adelante. Los que ya
            existen conservan su tramo y su fecha de cierre.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

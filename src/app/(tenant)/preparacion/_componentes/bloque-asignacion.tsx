/**
 * "Asignación" — el hueco de la Etapa 5 (§12 de `etapa-5-preparacion-del-dia.md`)
 * pasa a ser un resumen en vivo con una sola acción (§11 de
 * `etapa-6-asignacion-en-bloque.md`): la caja y su posición NO cambian, solo
 * el contenido — se reemplaza el enlace estático a Manifiestos por el
 * conteo de "retirados sin asignar hoy" y un botón que abre la bandeja real
 * en `/preparacion/asignar`.
 *
 * Server Component async: llama a `contarAsignablesSinAsignar`
 * (`src/modules/operacion/asignacion.ts`, capa de lectura de la Etapa 6) con
 * el `tenantId`/`fecha` que ya resolvió `page.tsx` — no hay que volver a
 * calcular "ahora" acá.
 *
 * El botón sigue presente en cero: no es un estado de error, y el
 * coordinador puede querer entrar a revisar reasignaciones o a esperar el
 * próximo lote sin que el botón aparezca y desaparezca.
 *
 * RBAC (§15, criterio "condicionando el botón del bloque"): el gate de
 * `puedeAsignarYReasignarPedidos` vive en el `page.tsx` de `/preparacion`
 * (mismo patrón que el resto de bloques condicionales de esa pantalla) — este
 * componente NO se renderiza en absoluto si el usuario no tiene la capacidad,
 * en vez de renderizarse y ocultar el botón por dentro.
 */

import Link from "next/link";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import { contarAsignablesSinAsignar } from "@/modules/operacion/asignacion";
import { Button } from "@/components/ui/button";
import { pluralizar } from "../_lib/estado-preparacion";

export async function BloqueAsignacion({ tenantId, fecha }: { tenantId: string; fecha: string }) {
  const cliente = crearClienteServiceRole();
  let sinAsignar: number | null = null;

  try {
    sinAsignar = await contarAsignablesSinAsignar(cliente, { tenantId, fecha });
  } catch {
    // best-effort — este bloque es un resumen de otra pantalla; que falle no
    // debe tumbar el resto de Preparación del día (§5.3, mismo espíritu
    // defensivo que "Visitas de hoy" y "Carga por comuna").
    sinAsignar = null;
  }

  return (
    <section
      aria-labelledby="asignacion-heading"
      className="space-y-2 rounded-lg border border-dashed border-border p-4"
    >
      <h2 id="asignacion-heading" className="text-sm font-semibold text-muted-foreground">
        Asignación
      </h2>

      {sinAsignar === null ? (
        <p className="text-sm text-muted-foreground">No pudimos calcular cuánto falta por asignar.</p>
      ) : sinAsignar > 0 ? (
        <div>
          <p className="text-2xl font-semibold tabular-nums">{sinAsignar}</p>
          <p className="text-sm text-muted-foreground">
            {pluralizar(sinAsignar, "pedido retirado sin asignar", "pedidos retirados sin asignar")}
          </p>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Todo lo retirado hoy ya está asignado.</p>
      )}

      <Button asChild size="sm">
        <Link href="/preparacion/asignar">Asignar pedidos</Link>
      </Button>
    </section>
  );
}

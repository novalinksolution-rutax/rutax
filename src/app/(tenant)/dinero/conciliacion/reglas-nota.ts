/**
 * Espejo (solo lectura) de `ESTADOS_QUE_EXIGEN_COMENTARIO` en
 * `modules/dinero/acciones.ts` — esa constante es privada de un módulo
 * server-only (usa `crearClienteServiceRole`, no se puede importar desde un
 * Client Component), así que esta es la copia que usa la UI para decidir
 * cuándo mostrar el textarea de nota ANTES de llamar al servidor. El
 * servidor sigue siendo la fuente de verdad (vuelve a validar igual) — esto
 * es solo para no golpearlo con un 400 evitable. Si el backend cambia esta
 * lista, actualizar también aquí (mismo dato, dos lugares — igual criterio
 * que `conciliacion-clasificacion.ts` con el backfill SQL).
 *
 * Reutilizado por `menu-acciones-conciliacion.tsx` (para decidir qué
 * transiciones son de un clic) y `panel-detalle-excepcion.tsx` (para decidir
 * cuándo pedir el textarea antes de confirmar).
 */

import type { EstadoEventoConciliacion } from "@/modules/dinero/tipos";

export const DESTINOS_QUE_EXIGEN_COMENTARIO: ReadonlySet<EstadoEventoConciliacion> = new Set([
  "resuelta_manual",
  "aceptada_justificada",
  "ignorada",
]);

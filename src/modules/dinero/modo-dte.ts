/**
 * Modo de emisión DTE efectivo — sandbox vs. real.
 * =====================================================================
 * Fuente ÚNICA de la decisión "¿esta emisión toca el SII de verdad?". La usan
 * tanto las acciones de dominio (`emitirFacturaPeriodo`,
 * `emitirNotaCreditoPeriodo`) como la UI (badge de modo). Centralizarla evita
 * que la interfaz diga "sandbox" mientras la acción emite real, o viceversa
 * (auditoría §3.7/QW7: que una operación simulada nunca parezca real).
 */

import { crearClienteServiceRole } from '@/lib/supabase/service-role';

export type ModoDte = 'sandbox' | 'real';

/**
 * Modo de la PLATAFORMA según el switch de entorno. Sandbox por defecto:
 * SOLO `DTE_SANDBOX_MODE=false` (explícito) habilita el modo real. Defensa de
 * seguridad-por-defecto: cualquier otro valor (o ausencia) es sandbox.
 */
export function modoDtePlataforma(): ModoDte {
  return process.env.DTE_SANDBOX_MODE !== 'false' ? 'sandbox' : 'real';
}

/**
 * Modo EFECTIVO para un courier: 'real' solo si la plataforma está en modo real
 * Y el courier tiene el opt-in `emision_dte_real_habilitada`. En cualquier otro
 * caso, 'sandbox' — que es también lo que ocurre en la práctica: sin opt-in, la
 * acción de emitir bloquea la emisión real. Es lo que la UI debe mostrar.
 */
export async function resolverModoDteTenant(tenantId: string): Promise<ModoDte> {
  if (modoDtePlataforma() === 'sandbox') return 'sandbox';

  const supabase = crearClienteServiceRole();
  const { data } = await supabase
    .schema('identidad')
    .from('courier_config_dte')
    .select('emision_dte_real_habilitada')
    .eq('tenant_id', tenantId)
    .maybeSingle();

  return data?.emision_dte_real_habilitada ? 'real' : 'sandbox';
}

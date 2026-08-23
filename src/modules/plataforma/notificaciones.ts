/**
 * Notificaciones de plataforma — email al courier sobre su suscripción
 * (F2 "Ola 3", ítem M).
 * =============================================================================
 * Helpers COMPARTIDOS por los jobs `jobs/notificar-*.ts`: resolución del
 * destinatario (el dueño del courier), deduplicación vía bitácora (mismo
 * patrón que `integraciones/notificaciones/conexion-caida.ts`) y los
 * constructores de contenido de cada correo.
 *
 * SEGURIDAD/AISLAMIENTO:
 * - El destinatario se resuelve SIEMPRE filtrado por `tenant_id` — nunca se
 *   expone el email de un usuario de otro courier.
 * - Los textos están en español de Chile, tono profesional-cercano.
 * - Los montos van en CLP entero vía `formatearCLP` (criterio C-1, único
 *   formateador de moneda del proyecto).
 *
 * DEDUP: `yaSeNotifico` reusa `identidad.bitacora_auditoria` (vía la vista
 * `public.bitacora_auditoria`, igual que `registrarEnBitacora`) como fuente de
 * verdad — no se crea una tabla nueva. `soloHoy` acota a la fecha civil de
 * Santiago (para alertas que pueden repetirse día a día, como trial-por-vencer);
 * sin `soloHoy`, el chequeo es "alguna vez" (para eventos de ocurrencia única
 * por entidad, como un pago confirmado o una suscripción creada).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { crearClienteServiceRole } from '@/lib/supabase/service-role';
import { registrarEnBitacora } from '@/modules/identidad/auditoria';
import { obtenerPuertoEmail } from '@/modules/integraciones/notificaciones/email';
import { formatearCLP } from '@/lib/ui/formato-moneda';
import { EMAIL_SOPORTE_RUTAX } from '@/lib/contacto-rutax';
import { envolverEmail } from '@/lib/email/plantilla-email';
import { resolverUrlBaseApp } from '@/modules/identidad/enlace-invitacion';
import { ahoraEnSantiago, combinarFechaHoraSantiago, sumarDiasCalendario } from '@/lib/fecha-santiago';

// =============================================================================
// Destinatario — el dueño (o, en su defecto, cualquier usuario interno) del courier
// =============================================================================

export interface DestinatarioCourier {
  email: string | null;
  nombreTenant: string | null;
}

/**
 * Resuelve el email del dueño del courier y el nombre del tenant. Prioriza
 * `rol = 'dueno'` entre los usuarios internos `activo`s; si no hay ninguno
 * (courier sin dueño configurado, caso raro), cae a cualquier interno activo.
 * `email: null` si no hay ningún usuario interno resoluble — el llamador debe
 * tratarlo como "no se pudo notificar" sin lanzar (no es un error del negocio).
 */
export async function resolverDestinatarioCourier(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<DestinatarioCourier> {
  const { data: tenantData } = await supabase
    .schema('identidad')
    .from('tenants')
    .select('nombre_fantasia')
    .eq('id', tenantId)
    .maybeSingle();

  const { data: internos } = await supabase
    .schema('identidad')
    .from('usuarios_perfil')
    .select('id, rol')
    .eq('tenant_id', tenantId)
    .eq('tipo_usuario', 'interno')
    .eq('estado', 'activo')
    .limit(10);

  const candidatos = (internos ?? []) as Array<{ id: string; rol: string }>;
  const dueno = candidatos.find((u) => u.rol === 'dueno');
  const elegido = dueno ?? candidatos[0];

  let email: string | null = null;
  if (elegido?.id) {
    const { data: authUser } = await supabase.auth.admin.getUserById(elegido.id);
    email = authUser?.user?.email ?? null;
  }

  return {
    email,
    nombreTenant: (tenantData?.nombre_fantasia as string | null) ?? null,
  };
}

// =============================================================================
// Deduplicación vía bitácora
// =============================================================================

function hoyEnSantiago(): string {
  return ahoraEnSantiago().fecha;
}

/**
 * `true` si YA existe una entrada de bitácora para `(tenantId, accion,
 * entidadId)` — `soloHoy: true` acota la búsqueda al día civil de Santiago.
 * Ante un error de lectura, asume que NO se notificó (mismo criterio que
 * `conexion-caida.ts`: preferir un posible duplicado a perder una notificación).
 */
export async function yaSeNotifico(
  supabase: SupabaseClient,
  args: { tenantId: string; accion: string; entidadId: string; soloHoy?: boolean },
): Promise<boolean> {
  let query = supabase
    .from('bitacora_auditoria')
    .select('id')
    .eq('tenant_id', args.tenantId)
    .eq('accion', args.accion)
    .eq('entidad_id', args.entidadId)
    .limit(1);

  if (args.soloHoy) {
    const hoy = hoyEnSantiago();
    const inicioHoy = combinarFechaHoraSantiago(hoy, '00:00:00').toISOString();
    const inicioManana = combinarFechaHoraSantiago(sumarDiasCalendario(hoy, 1), '00:00:00').toISOString();
    query = query.gte('creado_en', inicioHoy).lt('creado_en', inicioManana);
  }

  const { data, error } = await query.maybeSingle();
  if (error) return false;
  return Boolean(data);
}

/** Registra la notificación en bitácora — sirve de marca de deduplicación para la próxima corrida. */
export async function registrarNotificacionEnviada(
  supabase: SupabaseClient,
  args: { tenantId: string; accion: string; entidadTipo: string; entidadId: string; detalle?: Record<string, unknown> },
): Promise<void> {
  await registrarEnBitacora(supabase, {
    tenantId: args.tenantId,
    actorUsuarioId: null,
    actorTipo: 'sistema',
    accion: args.accion,
    entidadTipo: args.entidadTipo,
    entidadId: args.entidadId,
    detalle: args.detalle ?? {},
  });
}

// =============================================================================
// Envío — helper único que resuelve el puerto y nunca lanza en modo stub
// =============================================================================

export interface EnvioNotificacionResultado {
  intentado: boolean;
  enviado: boolean;
  modo: 'stub' | 'real' | 'sin_destinatario';
  errorDescripcion?: string;
}

/**
 * Envía un correo vía el puerto de email. Si `destinatario.email` es `null`,
 * NO intenta enviar (no hay a quién) y devuelve `modo:'sin_destinatario'` — el
 * llamador debe loguear esto como una situación a revisar (courier sin usuario
 * interno resoluble), pero NUNCA debe lanzar: el correo es un efecto
 * secundario, no debe tumbar el job que confirma un pago o un cobro.
 */
export async function enviarNotificacionEmail(args: {
  para: string | null;
  asunto: string;
  html: string;
  texto?: string;
}): Promise<EnvioNotificacionResultado> {
  if (!args.para) {
    return { intentado: false, enviado: false, modo: 'sin_destinatario' };
  }
  const puerto = obtenerPuertoEmail();
  const resultado = await puerto.enviarEmail({
    para: args.para,
    asunto: args.asunto,
    html: args.html,
    texto: args.texto,
  });
  return { intentado: true, enviado: resultado.enviado, modo: resultado.modo, errorDescripcion: resultado.errorDescripcion };
}

/** Cliente de conveniencia — mismo patrón que el resto de `plataforma`. */
export function clienteNotificaciones(): SupabaseClient {
  return crearClienteServiceRole();
}

// =============================================================================
// Constructores de contenido — placeholders funcionales (revisar con copywriter)
// =============================================================================

interface ContenidoEmail {
  asunto: string;
  html: string;
  texto: string;
}

/** 'YYYY-MM-DD' → 'DD-MM-YYYY' (formato chileno de fecha corta). */
function formatearFechaCorta(fecha: string): string {
  const [anio, mes, dia] = fecha.split('-');
  if (!anio || !mes || !dia) return fecha;
  return `${dia}-${mes}-${anio}`;
}

/**
 * Los siete correos del backstage, sobre la plantilla comun.
 * =============================================================================
 * Estaban rotulados en este mismo archivo como «placeholders funcionales
 * (revisar con copywriter)» y se notaba: parrafos pelados con «Hola X» y
 * «Saludos, Rutax», **sin un solo boton**, mandando al lector a navegar a mano
 * hasta «Configuracion > Plan y facturacion».
 *
 * Tres cosas cambian, y las tres salen del sistema de mensajes §9:
 *
 * 1. **El asunto lleva el hecho y su numero, y NO el nombre del producto.** Los
 *    siete terminaban en «— Rutax», que es exactamente lo que el remitente ya
 *    dice; gastaban seis caracteres de los ~45 que se ven en el telefono. Y los
 *    de dinero **llevan el monto**: es lo que decide si se abre ahora o despues.
 * 2. **La plata va en el bloque de datos**, en mono, no enterrada en un parrafo.
 * 3. **Un boton**, con su enlace de respaldo. Si no hay dominio configurado no
 *    se inventa uno: el correo sale sin boton y el pie dice donde mirar.
 */

/** Escapa texto que escribió una persona: el único correo con cuerpo libre. */
function escaparTexto(valor: string): string {
  return valor
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Acción del botón del backstage, o nada si no hay dominio declarado. */
function accionPlan(etiqueta: string): { accion?: { etiqueta: string; url: string } } {
  const base = resolverUrlBaseApp();
  return base ? { accion: { etiqueta, url: `${base}/configuracion/plan` } } : {};
}

const PIE_PLAN =
  'Recibes este correo porque administras la cuenta de Rutax de tu empresa. ' +
  'Puedes revisar tu plan en Configuración → Plan y facturación.';

/** plataforma/pago.confirmado → "pago recibido / comprobante disponible". */
export function construirEmailPagoConfirmado(args: {
  nombreTenant: string;
  montoClp: number;
  periodoInicio: string;
  periodoFin: string;
}): ContenidoEmail {
  const monto = formatearCLP(args.montoClp);
  const periodo = `${formatearFechaCorta(args.periodoInicio)} al ${formatearFechaCorta(args.periodoFin)}`;
  return {
    asunto: `Pago recibido · ${monto}`,
    html: envolverEmail({
      marca: 'Rutax',
      titular: 'Recibimos tu pago',
      preencabezado: `${monto} · período ${periodo}`,
      cuerpoHtml:
        '<p style="margin:0">Tu comprobante ya está disponible en el panel. No es un ' +
        'documento tributario: es el respaldo del cobro de tu suscripción.</p>',
      datos: [
        { etiqueta: 'Período', valor: periodo },
        { etiqueta: 'Monto', valor: monto, destacada: true },
      ],
      ...accionPlan('Descargar el comprobante'),
      motivoRecepcion: PIE_PLAN,
    }),
    texto:
      `Confirmamos el pago de ${monto} correspondiente al período ${periodo}. ` +
      `Descarga tu comprobante en tu panel: Configuración > Plan y facturación.`,
  };
}

/** plataforma/cobro.fallido → "no pudimos cobrar tu suscripción". */
export function construirEmailCobroFallido(args: {
  nombreTenant: string;
  montoClp: number;
  periodoInicio: string;
  periodoFin: string;
  reintentable: boolean;
}): ContenidoEmail {
  const monto = formatearCLP(args.montoClp);
  const periodo = `${formatearFechaCorta(args.periodoInicio)} al ${formatearFechaCorta(args.periodoFin)}`;
  const accion = args.reintentable
    ? 'Reintentaremos cobrar automáticamente en los próximos días. Si quieres anticiparte, puedes pagar ahora.'
    : 'Verifica tu método de pago en tu panel. Puede que necesites vincularlo nuevamente en Configuración &gt; Plan y facturación.';
  return {
    asunto: `No pudimos cobrar ${monto}`,
    html: envolverEmail({
      marca: 'Rutax',
      titular: 'No pudimos cobrar tu suscripción',
      preencabezado: `${monto} · período ${periodo}`,
      cuerpoHtml: `<p style="margin:0">${accion}</p>`,
      datos: [
        { etiqueta: 'Período', valor: periodo },
        { etiqueta: 'Monto', valor: monto, destacada: true },
      ],
      ...accionPlan('Pagar ahora'),
      motivoRecepcion: PIE_PLAN,
    }),
    texto:
      `Tuvimos un problema al procesar el pago de ${monto} para el período ${periodo} de tu suscripción. ${accion} ` +
      `También puedes pagar manualmente: Configuración > Plan y facturación.`,
  };
}

/** plataforma/trial.por-vencer → "tu prueba vence pronto". */
export function construirEmailTrialPorVencer(args: {
  nombreTenant: string;
  trialHasta: string;
  diasRestantes: number;
}): ContenidoEmail {
  const fecha = formatearFechaCorta(args.trialHasta);
  return {
    asunto: `Tu prueba termina en ${args.diasRestantes} días`,
    html: envolverEmail({
      marca: 'Rutax',
      titular: 'Tu prueba está por terminar',
      preencabezado: `Vence el ${fecha}. Vincula un metodo de pago para seguir operando.`,
      cuerpoHtml:
        '<p style="margin:0">Para seguir operando sin interrupciones, vincula un método de ' +
        'pago antes de esa fecha. Si no lo haces, la cuenta se suspende y tu equipo deja de ' +
        'poder entrar.</p>',
      datos: [{ etiqueta: 'Vence el', valor: fecha, destacada: true }],
      ...accionPlan('Vincular un método de pago'),
      motivoRecepcion: PIE_PLAN,
    }),
    texto:
      `Tu período de prueba termina el ${fecha} (faltan ${args.diasRestantes} días). ` +
      `Vincula un método de pago en tu panel (Configuración > Plan y facturación) para continuar sin interrupciones.`,
  };
}

/** plataforma/suscripcion.creada → "bienvenido / tu prueba empezó". */
export function construirEmailSuscripcionCreada(args: {
  nombreTenant: string;
  trialHasta: string | null;
}): ContenidoEmail {
  const bloqueTrial = args.trialHasta
    ? `<p>Tienes hasta el <strong>${formatearFechaCorta(args.trialHasta)}</strong> para usar Rutax sin costo.</p>`
    : '';
  const bloqueTrialTexto = args.trialHasta ? ` Tienes hasta el ${formatearFechaCorta(args.trialHasta)} para usar sin costo.` : '';
  return {
    asunto: 'Tu cuenta ya está lista',
    html: envolverEmail({
      marca: 'Rutax',
      titular: 'Tu cuenta ya está lista',
      preencabezado: args.trialHasta
        ? `Sin costo hasta el ${formatearFechaCorta(args.trialHasta)}.`
        : 'Entra al panel para empezar a operar.',
      cuerpoHtml:
        '<p style="margin:0">Entra al panel y empieza por conectar a tus sellers: los ' +
        `pedidos llegan solos apenas lo hagan. ¿Dudas? Escríbenos a ${EMAIL_SOPORTE_RUTAX}.</p>`,
      ...(args.trialHasta
        ? {
            datos: [
              {
                etiqueta: 'Sin costo hasta',
                valor: formatearFechaCorta(args.trialHasta),
                destacada: true,
              },
            ],
          }
        : {}),
      ...accionPlan('Entrar al panel'),
      motivoRecepcion: PIE_PLAN,
    }),
    texto: `Tu cuenta ya está lista.${bloqueTrialTexto} Entra a tu panel para empezar a operar. ¿Dudas? Responde este correo o escríbenos a ${EMAIL_SOPORTE_RUTAX}.`,
  };
}

/** plataforma/plan.cambiado → confirmación de cambio de plan/periodicidad. */
export function construirEmailPlanCambiado(args: {
  nombreTenant: string;
  tipo: 'upgrade' | 'downgrade' | 'periodicidad';
  montoAjusteClp: number | null;
  efectivoDesde: string;
}): ContenidoEmail {
  const fecha = formatearFechaCorta(args.efectivoDesde);
  const etiquetaTipo =
    args.tipo === 'upgrade' ? 'Tu plan se actualizó' : args.tipo === 'downgrade' ? 'Tu plan bajará' : 'Tu facturación cambiará';
  const bloqueAjuste =
    args.montoAjusteClp && args.montoAjusteClp > 0
      ? `<p>Se aplicó un cargo prorrateado de <strong>${formatearCLP(args.montoAjusteClp)}</strong> por los días restantes del ciclo actual.</p>`
      : '';
  const bloqueAjusteTexto =
    args.montoAjusteClp && args.montoAjusteClp > 0
      ? ` Se aplicó un cargo prorrateado de ${formatearCLP(args.montoAjusteClp)}.`
      : '';
  return {
    asunto: `${etiquetaTipo} desde el ${fecha}`,
    html: envolverEmail({
      marca: 'Rutax',
      titular: etiquetaTipo,
      preencabezado: `Efectivo desde el ${fecha}`,
      cuerpoHtml: bloqueAjuste
        ? '<p style="margin:0">Se aplicó un cargo prorrateado por los días que quedaban del ' +
          'ciclo actual. El próximo cobro ya va con el plan nuevo.</p>'
        : '<p style="margin:0">El próximo cobro ya va con el plan nuevo.</p>',
      datos: [
        { etiqueta: 'Efectivo desde', valor: fecha },
        ...(args.montoAjusteClp && args.montoAjusteClp > 0
          ? [
              {
                etiqueta: 'Cargo prorrateado',
                valor: formatearCLP(args.montoAjusteClp),
                destacada: true,
              },
            ]
          : []),
      ],
      ...accionPlan('Ver mi plan'),
      motivoRecepcion: PIE_PLAN,
    }),
    texto:
      `${etiquetaTipo}, efectivo desde el ${fecha}.${bloqueAjusteTexto} ` +
      `Revisa los detalles en tu panel: Configuración > Plan y facturación.`,
  };
}

/**
 * plataforma/comunicacion.publicada → broadcast de una comunicación de Rutax
 * (mantención, novedad, alerta) al courier, cuando la comunicación se creó con
 * `enviarEmail=true` (F3, Gap 7). `cuerpo` es texto plano autor(ad)o por el
 * super-admin — se parte por línea para un HTML mínimamente legible.
 */
export function construirEmailComunicacion(args: {
  nombreTenant: string;
  titulo: string;
  cuerpo: string;
}): ContenidoEmail {
  const cuerpoHtml = args.cuerpo
    .split('\n')
    .filter((linea) => linea.trim().length > 0)
    .map((linea) => `<p style="margin:0 0 12px">${escaparTexto(linea)}</p>`)
    .join('');
  return {
    // Sin «— Rutax»: el remitente ya lo dice, y esos seis caracteres se comen
    // el título en la bandeja del teléfono.
    asunto: args.titulo,
    html: envolverEmail({
      marca: 'Rutax',
      titular: args.titulo,
      cuerpoHtml: cuerpoHtml || `<p style="margin:0">${escaparTexto(args.cuerpo)}</p>`,
      motivoRecepcion:
        'Recibes este correo porque administras la cuenta de Rutax de tu empresa.',
    }),
    texto: `${args.titulo}\n\n${args.cuerpo}`,
  };
}

/** plataforma/vigilarTrials (rama vencido-sin-pago) → recordatorio de período vencido (dunning, ítem F). */
export function construirEmailPeriodoVencido(args: {
  nombreTenant: string;
  montoClp: number;
  periodoInicio: string;
  periodoFin: string;
}): ContenidoEmail {
  const monto = formatearCLP(args.montoClp);
  const periodo = `${formatearFechaCorta(args.periodoInicio)} al ${formatearFechaCorta(args.periodoFin)}`;
  return {
    asunto: `Pago vencido · ${monto}`,
    html: envolverEmail({
      marca: 'Rutax',
      titular: 'Tu suscripción tiene un pago vencido',
      preencabezado: `${monto} · período ${periodo}`,
      cuerpoHtml:
        '<p style="margin:0">Regulariza el pago para mantener el servicio activo. Si la ' +
        'deuda sigue, la cuenta se suspende y tu equipo deja de poder entrar. ' +
        `¿Problemas? Escríbenos a ${EMAIL_SOPORTE_RUTAX}.</p>`,
      datos: [
        { etiqueta: 'Período', valor: periodo },
        { etiqueta: 'Monto vencido', valor: monto, destacada: true },
      ],
      ...accionPlan('Regularizar el pago'),
      motivoRecepcion: PIE_PLAN,
    }),
    texto:
      `El período ${periodo} de tu suscripción a Rutax, por ${monto}, está vencido. ` +
      `Regulariza tu pago en tu panel (Configuración > Plan y facturación). ¿Problemas? Escríbenos a ${EMAIL_SOPORTE_RUTAX}.`,
  };
}

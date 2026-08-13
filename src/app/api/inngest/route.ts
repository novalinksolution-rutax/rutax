/**
 * Endpoint de Inngest — Next.js route handler.
 *
 * Sirve como puente entre el servidor de Inngest (cloud o Dev Server local)
 * y las funciones del sistema. Inngest llama a este endpoint para:
 * - Descubrir las funciones registradas (GET — introspección).
 * - Disparar ejecuciones (POST).
 * - Verificar liveness (PUT).
 *
 * Para añadir una nueva función de Inngest al sistema: importarla aquí y
 * agregarla al array `funciones`. Ese es el único cambio necesario — el
 * cliente Inngest y la ruta no necesitan saber nada más.
 *
 * Variables de entorno requeridas (ver .env.example):
 * - INNGEST_EVENT_KEY   — para publicar eventos desde el servidor.
 * - INNGEST_SIGNING_KEY — para validar que las peticiones vienen de Inngest.
 *   En desarrollo local con el Dev Server puede omitirse.
 *
 * NUNCA loguear el valor de estas variables.
 */

import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest/cliente";

// Jobs de Mercado Libre
import { jobRefrescarTokens } from "@/modules/integraciones/ml/jobs/refrescar-tokens";
import { jobSondeoSaludConexiones } from "@/modules/integraciones/ml/jobs/sondeo-salud";
import { jobProcesarShipmentActualizado } from "@/modules/integraciones/ml/jobs/procesar-shipment";
import { jobPollingEstadosPedidos } from "@/modules/integraciones/ml/jobs/polling-estados";
import { jobEjecutarBackfill } from "@/modules/integraciones/ml/jobs/ejecutar-backfill";
// Ingesta continua de pedidos Flex: cron de respaldo (cada 30 min, 06:00–23:00
// Santiago) + sincronización manual por conexión. Cierra el bloqueador raíz
// "un pedido Flex nuevo no entra al sistema solo".
import {
  jobIngestaPedidosMl,
  jobSincronizarConexionMl,
} from "@/modules/integraciones/ml/jobs/ingesta-pedidos-ml";

// Jobs de geocoding (F4 — ingesta → coordenadas + cobertura)
import { jobGeocodificarPedido } from "@/modules/integraciones/geocoding/jobs/geocodificar-pedido";

// Jobs de notificaciones
import { jobNotificacionConexionCaida } from "@/modules/integraciones/notificaciones/conexion-caida";

// Jobs de operación
import { jobNotificacionIncidenciasSinGestion } from "@/modules/operacion/jobs/notificacion-incidencias-sin-gestion";
import { jobPurgarEvidencias } from "@/modules/operacion/jobs/purgar-evidencias";
// Consumidor de `operacion/pedido.cancelado-en-ml`: `integraciones` DETECTA la
// cancelación en ML y avisa; este job es el que aplica estado, incidencia y el
// cierre del cabo de dinero. Sin registrarlo, el evento no tendría quién lo
// escuche y la cancelación se quedaría a mitad de camino.
import { jobProcesarCancelacionMl } from "@/modules/operacion/jobs/procesar-cancelacion-ml";

// Jobs de Dinero (Fase C — motor entrega→dinero)
import { jobGenerarLineas } from "@/modules/dinero/jobs/generar-lineas";
import { jobCerrarPeriodo } from "@/modules/dinero/jobs/cerrar-periodo";
import { jobEmitirDtePeriodo } from "@/modules/dinero/jobs/emitir-dte-periodo";
import { jobGenerarLiquidacionConductor } from "@/modules/dinero/jobs/generar-liquidacion-conductor";
import { jobPollingEstadoDte } from "@/modules/dinero/jobs/polling-estado-dte";
import { jobConciliarPeriodo } from "@/modules/dinero/jobs/conciliar-periodo";
import { jobAlertaFoliosProximos } from "@/modules/dinero/jobs/alerta-folios-proximos";
import { jobConciliarPago } from "@/modules/dinero/jobs/conciliar-pago";
import { jobAlertaMorosidad } from "@/modules/dinero/jobs/alerta-morosidad";
import { jobEmitirNotaCredito } from "@/modules/dinero/jobs/emitir-nota-credito";
import { jobConciliarTresFuentes } from "@/modules/dinero/jobs/conciliar-tres-fuentes";
// Jobs de payouts a conductores (F19, Bloque 3 — dinero saliente)
import { jobEjecutarPayout } from "@/modules/dinero/jobs/ejecutar-payout";
import { jobConsultarEstadoPayout } from "@/modules/dinero/jobs/consultar-estado-payout";
// Jobs F19/Fase 3 — confirmación instantánea de payouts por webhook Fintoc
import { jobAplicarActualizacionPayout } from "@/modules/dinero/jobs/aplicar-actualizacion-payout";
import { jobConciliarPayoutConfirmado } from "@/modules/dinero/jobs/conciliar-payout-confirmado";

// Jobs de Plataforma (backstage Rutax — suscripciones de couriers)
import { jobGenerarPeriodosSuscripcion } from "@/modules/plataforma/jobs/generar-periodos";
// Aplica downgrades de plan diferidos (F2, item I) — cron 05:00, antes de generar-periodos (06:00)
import { jobAplicarCambiosPlan } from "@/modules/plataforma/jobs/aplicar-cambios-plan";
// Watchdog de salud del sistema (telemetría de crons + backlog + integridad) — QW3/QW6
import { jobVerificarSalud } from "@/modules/plataforma/jobs/verificar-salud";
// Morosidad de suscripción — marca períodos vencidos + alerta (item 2)
import { jobMarcarMorosidad } from "@/modules/plataforma/jobs/marcar-morosidad";
// Auto-cobro de período por mandato Fintoc (F1-E)
import { jobCobrarPeriodoAuto } from "@/modules/plataforma/jobs/cobrar-periodo-auto";
// F2 "Ola 3" ítem F — dunning: reintento de auto-cobro de períodos vencidos + escalamiento
import { jobReintentarCobroVencido } from "@/modules/plataforma/jobs/reintentar-cobro-vencido";
// F2 "Ola 3" ítem E — ciclo de vida del trial: alerta por-vencer + trial vencido sin pago
import { jobVigilarTrials } from "@/modules/plataforma/jobs/vigilar-trials";
// F2 "Ola 3" ítem M — notificaciones de plataforma por email al courier
import { jobNotificarPagoConfirmado } from "@/modules/plataforma/jobs/notificar-pago-confirmado";
import { jobNotificarCobroFallido } from "@/modules/plataforma/jobs/notificar-cobro-fallido";
import { jobNotificarTrialPorVencer } from "@/modules/plataforma/jobs/notificar-trial-por-vencer";
import { jobNotificarSuscripcionCreada } from "@/modules/plataforma/jobs/notificar-suscripcion-creada";
import { jobNotificarPlanCambiado } from "@/modules/plataforma/jobs/notificar-plan-cambiado";
// F3 · Gap 7 — comunicaciones de Rutax a los couriers (banner in-app + broadcast email opcional)
import { jobNotificarComunicacion } from "@/modules/plataforma/jobs/notificar-comunicacion";

// Jobs F23 — API pública y webhooks salientes
import { jobEntregarWebhook } from "@/modules/integraciones/api-publica/jobs/entregar-webhook";
// Jobs de contexto — Torre de control (anticipación operativa)
import { jobSincronizarCalendario } from "@/modules/contexto/jobs/sincronizar-calendario";

/**
 * Array de todas las funciones de Inngest del sistema.
 * Se pasa completo al `serve()` para que el servidor de Inngest las conozca.
 */
const funciones = [
  // Jobs ML (Fase B)
  jobRefrescarTokens,
  jobSondeoSaludConexiones,
  jobProcesarShipmentActualizado,
  jobPollingEstadosPedidos,
  jobEjecutarBackfill,
  // Ingesta continua Flex (webhook + cron de respaldo + botón manual)
  jobIngestaPedidosMl,
  jobSincronizarConexionMl,
  // Jobs de geocoding (F4)
  jobGeocodificarPedido,
  jobNotificacionConexionCaida,
  // Jobs de operación
  jobNotificacionIncidenciasSinGestion,
  jobPurgarEvidencias,
  // Cancelación detectada en ML → estado + incidencia + cabo de dinero
  jobProcesarCancelacionMl,
  // Jobs Dinero (Fase C)
  jobGenerarLineas,
  jobCerrarPeriodo,
  jobEmitirDtePeriodo,
  jobGenerarLiquidacionConductor,
  jobPollingEstadoDte,
  jobConciliarPeriodo,
  jobAlertaFoliosProximos,
  // Jobs de cobranza (capa "pagado" — Fintoc)
  jobConciliarPago,
  jobAlertaMorosidad,
  // Notas de crédito (RF-038 — anulación total)
  jobEmitirNotaCredito,
  // Job C7: conciliación de 3 fuentes (F17, Bloque 3) — cron 02:30
  jobConciliarTresFuentes,
  // Jobs F19: payouts a conductores (Bloque 3 — dinero saliente)
  jobEjecutarPayout,
  jobConsultarEstadoPayout,
  // Jobs F19/Fase 3: confirmación instantánea de payouts por webhook Fintoc
  jobAplicarActualizacionPayout,
  jobConciliarPayoutConfirmado,
  // Jobs Plataforma — suscripciones de couriers a Rutax (backstage financiero)
  jobGenerarPeriodosSuscripcion,
  jobAplicarCambiosPlan,
  // Watchdog de salud del sistema — crons stale, backlog y líneas huérfanas (cron horario)
  jobVerificarSalud,
  // Morosidad de suscripción — marca períodos vencidos + alerta (cron diario 08:00)
  jobMarcarMorosidad,
  // Auto-cobro de período por mandato Fintoc (F1-E) — evento plataforma/suscripcion.periodo-generado
  jobCobrarPeriodoAuto,
  // F2 "Ola 3" ítem F — dunning: reintento de auto-cobro + escalamiento (cron diario 08:30)
  jobReintentarCobroVencido,
  // F2 "Ola 3" ítem E — ciclo de vida del trial (cron diario 11:00)
  jobVigilarTrials,
  // F2 "Ola 3" ítem M — notificaciones de plataforma por email al courier
  jobNotificarPagoConfirmado,
  jobNotificarCobroFallido,
  jobNotificarTrialPorVencer,
  jobNotificarSuscripcionCreada,
  jobNotificarPlanCambiado,
  // F3 · Gap 7 — broadcast por email de comunicaciones de Rutax a los couriers
  jobNotificarComunicacion,
  // Jobs F23 — entrega de webhooks salientes (cron cada 2 min)
  jobEntregarWebhook,
  // Torre de control. Queda UN job: el calendario comercial, que alimenta las
  // olas entrantes. Cron desplazado fuera de la hora en punto — el repo ya tiene
  // un cluster en 02:00–02:30 y 05:00–06:00.
  //
  // Eran cinco. El rediseño v2 retiró `jobRefrescarClima`, `jobRefrescarAire`,
  // `jobRiesgoBarrido` y `jobRiesgoRecalcularTenant`: la Torre dejó de tener un
  // puntaje de riesgo que precalcular cada 15 minutos y pasó a leer la carga en
  // vivo desde `operacion`. Ver `docs/torre-de-control/alcance-v2.md` §5.2.
  jobSincronizarCalendario,
];

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: funciones,
});

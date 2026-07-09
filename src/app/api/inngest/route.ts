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

// Jobs de geocoding (F4 — ingesta → coordenadas + cobertura)
import { jobGeocodificarPedido } from "@/modules/integraciones/geocoding/jobs/geocodificar-pedido";

// Jobs de notificaciones
import { jobNotificacionConexionCaida } from "@/modules/integraciones/notificaciones/conexion-caida";

// Jobs de operación
import { jobNotificacionIncidenciasSinGestion } from "@/modules/operacion/jobs/notificacion-incidencias-sin-gestion";

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

// Jobs F23 — API pública y webhooks salientes
import { jobEntregarWebhook } from "@/modules/integraciones/api-publica/jobs/entregar-webhook";

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
  // Jobs de geocoding (F4)
  jobGeocodificarPedido,
  jobNotificacionConexionCaida,
  // Jobs de operación
  jobNotificacionIncidenciasSinGestion,
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
  // Jobs F23 — entrega de webhooks salientes (cron cada 2 min)
  jobEntregarWebhook,
];

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: funciones,
});

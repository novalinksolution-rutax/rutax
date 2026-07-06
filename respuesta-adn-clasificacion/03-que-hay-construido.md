# 3. Qué hay construido más allá de ML + multi-tenant

> **Resumen corto:** las 3 fases del MVP (A Cimiento, B Operación, C Motor entrega→dinero)
> están **implementadas y la fase C verificada end-to-end con datos de demo**. Lo que está más
> avanzado no es el ruteo (deliberadamente fuera de foco), sino **el lado financiero**, que es
> el diferenciador del producto.

## ¿Ruteo? — NO (por diseño)
- El ruteo/optimización está **explícitamente excluido del MVP** (regla dura en CLAUDE.md:
  "NO introducir … optimizadores de ruteo"). Se considera commodity.
- Lo único parecido es `src/modules/operacion/orden-paradas.ts`: un **ordenamiento simple de
  paradas** para el manifiesto del conductor, no un optimizador.
- La app de escaneo/POD de Flex es obligatoria y **no integrable**; el software orquesta
  alrededor de ella, el conductor usa dos apps.

## ¿App de conductor? — SÍ (PWA)
- Vista de conductor en `src/app/conductor/` como **PWA** (manifest, service worker, página
  offline). En V2 se plantea nativa (Expo).
- Pantallas: **manifiesto del día**, detalle de **parada** por pedido, botón "listo para salir",
  **liquidaciones** del conductor con descarga.

## ¿Lado financiero? — SÍ, es lo más completo (Fase C)
Esto es el núcleo del producto. Implementado:

**Motor entrega→dinero** (`src/modules/dinero/`)
- Generación automática, por cada entrega, de su **línea de cobro al seller** y su **línea de
  liquidación al conductor** (`generar-lineas.ts`, `motor.ts`).
- **Reglas de incidencia** que ajustan cobro/liquidación.

**Períodos y facturación DTE**
- Períodos de cobro con estados `abierto → cerrado → facturado`.
- Cron `cerrar-periodo` (solo cierra y dispara conciliación) + **compuerta humana de emisión**
  (`emitirFacturaPeriodo`, ningún cron emite DTE).
- Adaptador DTE en **sandbox** (SimpleFactura) con **opt-in real por courier** (default off);
  esqueleto de adaptador real (Openfactura) validado.
- **Notas de crédito** (`20260612000002_dinero_notas_credito.sql`).
- Polling de estado SII del DTE; alerta de folios CAF próximos a agotarse.

**Conciliación**
- Job `conciliar-periodo.ts`: concilia **entregado-vs-facturado** (detective, solo lectura),
  con tipos de diferencia y eventos de conciliación.

**Liquidación de conductores**
- `generar-liquidacion-conductor.ts` consolida líneas de liquidación; descarga de PDF de
  liquidación (tenant y conductor).

**Cobranza (courier → seller)**
- Adaptador **Fintoc** (`src/modules/integraciones/pagos/fintoc/`), webhooks de pago,
  `pagos_recibidos` con matching automático contra el período.

## Otras piezas construidas
- **Operación (Fase B):** ingesta Flex multi-seller, **same-day ad-hoc**, asignación +
  manifiesto, máquina de estados de pedido, incidencias con evidencias, **salud de conexiones
  ML + reconexión + backfill**, dashboard del dueño con métricas, **portal del seller** (pedidos,
  cobros con factura PDF, incidencias, conectar ML), exportación de datos (RNF-13).
- **Cimiento (Fase A):** multi-tenant + **RLS** (probado con pgTAP), **RBAC por capacidades**,
  onboarding del courier (certificado + proveedor DTE + folios + tarifas), **OAuth del seller +
  refresco de tokens**, cifrado de secretos.
- **Integración ML:** OAuth multicuenta, cliente HTTP, traducción de estados/subestados,
  etiquetas, webhook de shipments, jobs de refresco de tokens y sondeo de salud.

## Lo que NO está hecho (pendiente, no tocar sin pedido)
- Observabilidad/Sentry; disponibilidad y respaldos (devops).
- Emisión DTE **real** al SII (hoy sandbox; requiere opt-in + revisión de seguridad).
- App de conductor **nativa** (hoy PWA).

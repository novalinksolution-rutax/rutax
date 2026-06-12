# 14 · Reportes y métricas de ventas — verificación oficial
> Fecha de verificación: 2026-06-11 · Site: MLC

> Nota metodológica: los portales `developers.mercadolibre.com.ar/.cl` devuelven HTTP 403
> al fetch automatizado directo. La verificación se hizo sobre los extractos indexados
> (snippets) de esas mismas páginas oficiales, que reproducen el contenido literal y las
> URLs canónicas. Donde no se pudo confirmar el literal exacto de un parámetro, se marca
> explícitamente con ❓.

## Resumen del hallazgo principal

**No existe un recurso "Sales Report" / "reportería de ventas" genérico** en la API de
Mercado Libre. Lo que existe documentado es la familia **"Billing Reports"** (Reportes de
Facturación), cuyo propósito declarado es **conciliación fiscal y de facturación**, no
analítica operativa/comercial. La doc oficial advierte explícitamente que estos recursos
**no deben usarse como fuente primaria para gestión de ventas, seguimiento de órdenes en
tiempo real, ni para fines operativos** — son para post-venta / reconciliación contable.

Para reportería ejecutiva (volumen, desempeño por seller, SLA, etc.) la vía real es
**agregación propia** sobre `/orders/search` + `/shipments/{id}` (recursos ya cubiertos
en `04-ordenes-ventas.md` y `05-mercado-envios-shipments.md`).

## Tabla de endpoints

| Capacidad | Endpoint + método | Detalle clave | Scope | Estado MLC (✅/⚠️/❌/❓) | URL oficial |
|---|---|---|---|---|---|
| Períodos de facturación disponibles | `GET /billing/integration/monthly/periods?group={ML\|MP\|FLEX\|FULL\|INSURTECH\|PAYMENT}` | Devuelve por defecto últimos 6 períodos; `limit` máx. 12 (`/monthly/periods`); paginable con `offset`/`limit`. Respuesta incluye `key` (fecha de inicio del período) y `expiration_date`. Disponible para sites MLA, MLB, MCO, **MLC**, MLU, MPE, MLV, MCR | `read` (permiso "Billing" / facturación) | ✅ verificada (lista de sites incluye MLC) | [.ar billing-reports](https://developers.mercadolibre.com.ar/en_us/billing-reports) · [.cl reportes-de-facturacion](https://developers.mercadolibre.cl/es_ar/reportes-de-facturacion) |
| Documentos (facturas/notas de crédito) de un período | `GET /billing/integration/periods/key/{key}/group/{group}/documents` | Filtros por `document_id`, `document_type` (`BILL` \| `CREDIT_NOTE`); `limit` (mín. 150, máx. 1000) | `read` | ⚠️ existe el recurso para MLC pero no se confirmó el comportamiento exacto del filtro `document_type` para `group=FLEX` específicamente | [.ar billing-reports](https://developers.mercadolibre.com.ar/en_us/billing-reports) |
| Resumen de facturación de un período | `GET /billing/integration/periods/key/{key}/group/{group}/summary` | Totales agregados por tipo de cargo del período | `read` | ✅ verificada (estructura general descrita) | [.ar billing-reports](https://developers.mercadolibre.com.ar/en_us/billing-reports) |
| Detalle de facturación de un período | `GET /billing/integration/periods/key/{key}/group/{group}/details` | Detalle línea a línea; `detail_sub_type` usado para conciliar contra `/summary` (la suma de `detail_amount` por `detail_sub_type` debe igualar el monto del `/summary`) | `read` | ✅ verificada | [.ar billing-reports](https://developers.mercadolibre.com.ar/en_us/billing-reports) |
| **Detalle de facturación específico de Flex** | `GET /billing/integration/periods/key/{key}/group/ML/flex/details` | Agrupa facturas y notas de crédito **cerradas con logística FLEX** dentro del período identificado por `key` | `read` | ⚠️ existe pero no se pudo confirmar el literal 100% (snippet indexado, no la página renderizada) | [.cl reportes-de-facturacion](https://developers.mercadolibre.cl/es_ar/reportes-de-facturacion) |
| Generación de reporte de conciliación (descarga CSV/XLSX) | `POST /billing/integration/periods/{expiration_date}/reports` | Body incluye `group` (`ML`/`MP`/`FLEX`/`FULL`/`INSURTECH`/`PAYMENT`) y tipo de documento. Proceso de 3 pasos: 1) generar, 2) consultar estado (`PROCESSING`/`READY`/`ERROR`), 3) descargar. **Reporte Fulfillment y de pagos solo soporta XLSX**; el resto soporta XLSX y CSV | `read` | ⚠️ el recurso existe y `group=FLEX` está documentado para el flujo, pero no se confirmó textualmente que el endpoint de generación liste MLC entre los sites soportados (la lista de sites se documenta para `/monthly/periods`, no se confirmó 1:1 para `/reports`) | [.ar billing-reports](https://developers.mercadolibre.com.ar/en_us/billing-reports) |
| Consulta de estado del reporte generado | `GET` (endpoint de status del reporte; URL exacta no confirmada en los extractos indexados) | Devuelve `PROCESSING`/`READY`/`ERROR` | `read` | ❓ no encontrado el literal exacto de la ruta | [.ar billing-reports](https://developers.mercadolibre.com.ar/en_us/billing-reports) |
| Descarga del archivo generado | `GET` (endpoint de descarga; URL exacta no confirmada) | Formato según `group` (CSV/XLSX o solo XLSX para FULL/PAYMENT) | `read` | ❓ no encontrado el literal exacto de la ruta | [.ar billing-reports](https://developers.mercadolibre.com.ar/en_us/billing-reports) |
| Reporte de ventas / métricas operativas genérico | **No existe un recurso así** | N/A | N/A | ❌ no existe — confirmado que el equivalente real es agregación propia sobre `/orders/search` + `/shipments/{id}` | [.ar gestiona-ventas](https://developers.mercadolibre.com.ar/es_ar/gestiona-ventas) |
| Reporte específico de envíos ("shipments report") | **No existe como recurso de descarga independiente.** El único "reporte" relacionado a envíos dentro de Billing es el de Flex (`group=FLEX`), que es de **facturación/cobro de la logística**, no de desempeño operativo (tiempos, estados, SLA) | N/A | N/A | ⚠️ FLEX existe solo como reporte de facturación, no operativo | [.ar billing-reports](https://developers.mercadolibre.com.ar/en_us/billing-reports) |

Estado: ✅ verificada · ⚠️ existe pero con condiciones/sin confirmar literal completo · ❌ no existe · ❓ no encontrado en doc oficial.

## Notas de aplicabilidad MLC

1. **El grupo FLEX existe y está disponible para MLC.** Un snippet indexado de la doc
   confirma textualmente: *"FLEX is used for Flex reports, and the endpoint Flex is
   available just for MLA, MLC and MCO sites"*. Esto confirma que para Chile sí hay un
   reporte de facturación de Mercado Envíos Flex, a diferencia de otros sites donde el
   grupo FLEX no aplica.

2. **`/billing/integration/monthly/periods` lista explícitamente MLC** entre los sites
   soportados (junto a MLA, MLB, MCO, MLU, MPE, MLV, MCR), con `key` = primer día del mes
   del período.

3. **Naturaleza del recurso: facturación, no analítica operativa.** La doc oficial es
   explícita: los recursos de Billing Reports son *"strictly intended for Post-Sale
   operations"* y *"should not be used as a primary data source for sales management,
   real-time order tracking, or any other operational purpose"*. Para el caso de uso del
   catálogo (sección 14: "alimentar reportería ejecutiva con históricos de volumen y
   desempeño por seller") **este recurso no es el adecuado** — está pensado para que el
   courier/seller concilie sus propios cargos de Mercado Libre/Mercado Pago/Flex contra
   su contabilidad, no para medir desempeño operativo (tiempos de entrega, tasa de
   incidencias, volumen por conductor, etc.).

4. **Permiso/scope:** requiere scope `read` y, según un snippet de Authentication and
   Authorization, el permiso funcional de **"Billing"** ("Facturación") en la app —
   adicional al scope OAuth genérico. También se documenta que el usuario que autoriza
   debe ser **manager/admin de la cuenta** (no un operador/colaborador), porque de lo
   contrario la autorización falla con `invalid_operator_user_id`. Esto es coherente con
   el modelo de OAuth por seller del proyecto (cuenta principal/manager), pero implica
   verificar que el permiso "Billing" esté habilitado en la app de ML antes de intentar
   estos endpoints.

5. **No se confirmaron las rutas exactas de "consultar estado" y "descargar"** del
   reporte de conciliación generado vía `POST /billing/integration/periods/{expiration_date}/reports`.
   Los extractos indexados describen el flujo de 3 pasos (generar → consultar estado →
   descargar) pero no exponen el literal de las dos últimas rutas. Si se decide construir
   sobre este flujo, hay que entrar a la página renderizada (no al snippet) para
   confirmarlas — posiblemente requiera sesión/headers que el WebFetch automatizado no
   reproduce (403).

6. **Diferencia vs MLA:** no se detectó diferencia funcional relevante para el grupo
   FLEX entre MLA y MLC — ambos están en la lista de sites soportados para
   `/monthly/periods` y para el grupo FLEX. La diferencia real está en **qué sites NO
   tienen FLEX** (p. ej. MLB, MLU, MPE no aparecen en la lista de FLEX), no en MLC vs MLA.

## URLs citadas

- [Billing Reports (.ar, en_us)](https://developers.mercadolibre.com.ar/en_us/billing-reports)
- [Reportes de Facturación (.ar, es_ar)](https://developers.mercadolibre.com.ar/es_ar/es_ar/reportes-de-facturacion)
- [Reportes de Facturación (.ar, alias "Períodos")](https://developers.mercadolibre.com.ar/es_ar/reportes-de-facturacion)
- [Reportes de Facturación (.cl)](https://developers.mercadolibre.cl/es_ar/reportes-de-facturacion)
- [Datos de Facturación (.cl)](https://developers.mercadolibre.cl/es_ar/facturacion)
- [Best Practices for Consuming Billing Reports APIs (.ar)](https://developers.mercadolibre.com.ar/en_us/services-sync-listings/best-practices-for-consuming-billing-reports-apis)
- [Billing data — Global Selling](https://global-selling.mercadolibre.com/devsite/gs-billing-data)
- [Gestiona Ventas / Obtener una orden (.ar)](https://developers.mercadolibre.com.ar/es_ar/gestiona-ventas)
- [Envíos (.ar)](https://developers.mercadolibre.com.ar/es_ar/envios)

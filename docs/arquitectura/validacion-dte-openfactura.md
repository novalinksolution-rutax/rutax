# Validación del contrato DTE contra un proveedor real (Openfactura) — B1-3

**Objetivo:** de-riesgar los supuestos del adaptador *stub* (`simplefactura.ts`,
`DTE_SANDBOX_MODE=true`) validando el contrato del puerto DTE contra un proveedor
**real, certificado por el SII y con sandbox gratuito** (Openfactura / Haulmer),
antes de que el frontend construya las pantallas de facturación sobre supuestos
del stub.

**Estado:** investigación de contrato + adaptador esqueleto
(`src/modules/integraciones/dte/adaptadores/openfactura.ts`) **hechos**.
Validación **en vivo pendiente** (requiere credenciales del sandbox — ver
"Qué necesita decidir/proveer el dueño").

> El esqueleto **no está cableado** en la fábrica `obtenerPuertoDte`: el stub
> sigue siendo el default del MVP. Es material de validación de contrato, no un
> cambio de proveedor.

---

## 1. Contrato real encontrado (Openfactura)

Fuentes: portal oficial `docsapi-openfactura.haulmer.com`, ejemplo cURL en
`haulmer.dev/factura-electronica/api`, plugin oficial
`github.com/haulmer/openfactura-woocommerce`, y SDK comunitario
`tsukiro/openfactura-api-sdk`.

| Aspecto | Contrato real |
| --- | --- |
| Host sandbox/dev | `https://dev-api.haulmer.com` (CAF simulado, no valida timbre ante el SII) |
| Host producción | `https://api.haulmer.com` |
| Autenticación | Header `apikey: <API_KEY>` (no `Authorization: Bearer`). Por-tenant (cada courier su API key). |
| Emisión | `POST /v2/dte/document`, body `{ response: [...], dte: { Encabezado, Detalle, Referencia? } }` |
| PDF/XML | Llegan **INLINE como base64** en la respuesta de emisión cuando se piden en `response: ["PDF","XML",...]`. No requieren GET aparte. |
| Identificador | La respuesta trae `TOKEN` (id opaco del documento) → se mapea a `idExternoProveedor`. |
| Estado SII | **Asíncrono**: la emisión devuelve el DTE timbrado/"enviado"; la aceptación/rechazo del SII llega después (resuelve el job de polling C5). |
| Consulta | `GET /v2/dte/document/{rut}/{type}/{documentNumber}/{value}` |
| Idempotencia | Header `Idempotency-Key` soportado en el POST (lo usamos como `{rutEmisor}-{tipo}-{folio}`). |

---

## 2. Gap analysis: stub ↔ proveedor real (las 3 brechas que importan)

1. **PDF/XML inline (base64) vs. URL.** El puerto declara `xmlUrl`/`pdfUrl:
   string | null`, pensado para una URL. Openfactura devuelve el contenido
   **base64 inline** en la emisión. El job C3 (`emitir-dte-periodo.ts`) deberá
   **subir ese base64 a Storage privado** y guardar la referencia opaca
   (`pdf_ref`/`xml_dte_ref`), de donde ya se generan signed URLs de 15 min al
   descargar. El stub deja ambos en `null` (por eso en las pruebas el botón de
   descarga no aparece). → El puerto necesita poder **recibir contenido base64**,
   no solo una URL.

2. **Estado SII asíncrono.** El stub deja `estado_sii='pendiente'` y nunca
   cambia. Con el proveedor real, `pendiente` es **correcto como estado inicial**
   pero el job de polling C5 (`polling-estado-dte.ts`) debe resolverlo a
   `aceptado` / `rechazado` / `aceptado_con_discrepancias`. La tabla de mapeo de
   estados en `openfactura.ts::mapearEstadoSii` es una **hipótesis** (los valores
   exactos del proveedor no están documentados públicamente) — hay que
   confirmarla en vivo.

3. **Clave de consulta: `TOKEN` vs `{rut}/{tipo}/{folio}`.** El GET de consulta
   pide `rut/tipo/folio`, pero el puerto solo entrega `idExternoProveedor` (el
   `TOKEN`). O bien (a) se persisten rut/tipo/folio y se ajusta la firma de
   `consultarEstadoDte`, o (b) se confirma si existe un GET por `TOKEN`. Hasta
   resolverlo, `consultarEstadoDte` del esqueleto lanza `501` en vez de adivinar.

---

## 3. Cambios mínimos que necesitará el puerto cuando se conecte el proveedor real

- **`EmitirFacturaResultado`**: agregar una vía para devolver contenido **base64**
  de PDF/XML (p. ej. `pdfBase64`/`xmlBase64`) además de (o en vez de) las URLs, y
  que el job C3 lo persista en Storage. Alternativa: que C3 llame a
  `descargarPdfDte`/`descargarXmlDte` tras emitir (requiere resolver la brecha 3).
- **`consultarEstadoDte`**: parametrizar con la clave de consulta real
  (rut/tipo/folio) o documentar un GET por TOKEN.
- **Mapeo de estado SII**: fijar la tabla real `mapearEstadoSii` con valores
  confirmados del sandbox.
- **Mapeo de errores** (`errores.ts`): mapear el cuerpo de error real
  (`{ message, code, details }`) a `ErrorFolioAgotado` (CAF agotado, no
  reintentable) vs `ErrorDteProveedor` 4xx (rechazo de esquema).

Todo esto es **aditivo** y no rompe el stub: el MVP sigue corriendo en sandbox.

---

## 4. Qué necesita decidir/proveer el dueño del proyecto

1. **Credencial del sandbox de Openfactura** (API key dev) para correr la
   validación en vivo del POST de emisión y confirmar: PDF/XML inline, shape del
   estado SII y shape del cuerpo de error. Es una credencial de sandbox (sin
   efectos tributarios), pero la provee una cuenta del titular.
2. **Decisión comercial del proveedor DTE definitivo** (Openfactura vs
   SimpleFactura/SimpleAPI), por multiempresa, costo por documento y delegación
   de certificación/folios — escala a una relación con un tercero (la toma el
   dueño, no un agente).

Mientras tanto, el sistema sigue en **sandbox stub** y la **emisión real exige
opt-in explícito por courier** (`courier_config_dte.emision_dte_real_habilitada`,
migración 0007) + la **compuerta de aprobación humana** (`emitirFacturaPeriodo`).

# Folios CAF y proveedor DTE — hallazgo y recomendación (punto 6, §12)

> Investigación previa a construir el adaptador DTE (que NO se construye en
> esta iteración — es trabajo de otra). Objetivo: decidir si `folios_caf`
> (migración 0003, ya migrada) la llenamos nosotros o la sincronizamos desde
> el proveedor, y si necesita ajustes de esquema.

## Qué dice el levantamiento

`docs/levantamiento.md` (RF-008, §13, "Stack de integraciones") deja
**SimpleFactura/SimpleAPI (Chilesystems) como candidato líder**, con
Openfactura (Haulmer) como alternativa fuerte. Los criterios que el propio
levantamiento pide comparar: "multiempresa real, costo por documento,
delegación de certificación/folios, límites de tasa, sandbox".

## Lo que verifiqué (fuentes oficiales, junio 2026)

- **SimpleAPI Folios** (producto dedicado de Chilesystems,
  `simpleapi.cl/Productos/SimpleFolios`, doc en `documentacion.simpleapi.cl`):
  automatiza la **obtención, anulación y consulta de CAF directamente desde
  el sitio del SII** ("Solicita directamente al SII el archivo CAF que
  necesitas"). El cliente solo indica **tipo y cantidad**; SimpleAPI hace el
  trámite con el SII (vía scraping, porque "el SII no dispone de web
  services" para esto) y entrega el CAF resultante. Es decir: **el proveedor
  gestiona el ciclo de vida del folio por el courier**, no solo lo recibe.
- **SimpleFactura** (el producto "todo en uno" sobre SimpleAPI): "handles
  folio assignment, sending to the client and SII, tracking" — confirma que
  la asignación de folios al emitir también la resuelve el proveedor, no
  nuestra capa.
- **Openfactura** (Haulmer): la documentación de soporte indica que **el
  usuario tiene la obligación de descargar el CAF desde el sitio del SII y
  subirlo a la plataforma** ("special obligations to manage and administer
  the CAF 'folios' file from the SII Application and subsequent upload").
  Es decir, con Openfactura SÍ recaería en nosotros (o en el courier)
  gestionar la solicitud/; la plataforma solo consume el CAF ya obtenido.

## Recomendación

**Confirma la preferencia que ya señala el levantamiento: SimpleFactura/
SimpleAPI.** Además de ser multiempresa real (su propia documentación lo
declara "multi-RUT"), es la opción que **delega la gestión de folios al
proveedor** — justamente el criterio que el levantamiento pide ponderar y
que más reduce nuestra superficie operativa (coherente con "comprar la
cañería" del roadmap, §11 de `docs/levantamiento.md`).

Con SimpleFactura/SimpleAPI como proveedor elegido:

- **`folios_caf` puede reducirse a un espejo de solo-lectura** (tal como ya
  anticipa la nota de alcance §5 del documento de arquitectura): el job de
  sincronización (Fase C, junto al adaptador DTE) consultaría el estado de
  folios vía la API del proveedor y reflejaría `folio_actual`/`estado` para
  que el dashboard del courier y las alertas de "folios por agotarse" tengan
  de dónde leer — pero la fuente de verdad de "cuándo pedir más" y "qué rango
  está vigente" la posee el proveedor.
- **No se requiere que nuestra plataforma orqueste la solicitud al SII** ni
  guarde el archivo `.pfx`/CAF crudo más que como referencia opaca de
  respaldo (si acaso) — el flujo "pide folios cuando se agoten" lo resuelve
  SimpleAPI Folios.

## Reporte de ajuste de esquema (para `base-datos-rls`, NO lo migro yo)

No encontré una razón para cambiar la FORMA de `folios_caf` ahora mismo — sus
columnas (`folio_desde/hasta/actual`, `estado`, `archivo_caf_ref`) siguen
siendo razonables como espejo de solo-lectura. Sugerencia a evaluar cuando se
construya el adaptador DTE real (no urgente, no bloquea Fase A):

- Si se confirma SimpleFactura/SimpleAPI, considerar agregar una columna de
  metadatos de sincronización (p. ej. `sincronizado_en timestamptz`,
  `fuente text default 'proveedor_dte'`) para distinguir "lo que el proveedor
  reportó" de cualquier ajuste manual — y para que el sondeo de salud sepa si
  el espejo está desactualizado. Es un cambio aditivo y no bloqueante; lo
  reporto para que `base-datos-rls`/`arquitecto` lo prioricen junto al
  adaptador DTE, no antes.
- Confirmar (cuando se construya el adaptador) si SimpleAPI expone el CAF
  crudo o solo el resultado de la asignación — eso determina si
  `archivo_caf_ref` sigue teniendo sentido como referencia opaca o si puede
  eliminarse del espejo.

## Resumen para el cierre de esta iteración

| Pregunta | Respuesta |
| --- | --- |
| ¿El proveedor candidato gestiona folios por el courier? | **Sí — SimpleFactura/SimpleAPI gestiona la solicitud/anulación/consulta de CAF directo con el SII** (a diferencia de Openfactura, donde recae en el usuario). |
| ¿Hay que sincronizar `folios_caf` nosotros? | Solo como **espejo de solo-lectura** (reflejar lo que el proveedor ya gestionó), no como sistema de verdad. |
| ¿Se requiere migrar/cambiar el esquema ahora? | **No** — la forma actual sirve para el espejo. Ajustes de metadatos de sincronización pueden esperar al adaptador DTE real (reportado arriba para `base-datos-rls`). |

### Fuentes consultadas
- https://www.simpleapi.cl/Productos/SimpleFolios
- https://documentacion.simpleapi.cl/
- https://www.simpleapi.cl/ (overview SimpleFactura/SimpleAPI, multi-RUT)
- https://docsapi-openfactura.haulmer.com/ y centro de ayuda Haulmer (obligación
  del usuario de descargar/subir el CAF)
- `docs/levantamiento.md` líneas 252-253, 386, 566, 614-617 (RF-008, criterios
  de selección, candidatos)

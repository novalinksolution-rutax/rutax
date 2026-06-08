# Informe de mercado — SaaS última milla (couriers Flex) · Santiago

> **Nota de origen:** el informe de mercado original del proyecto (investigación de escritorio sobre Mercado Libre Flex, e-commerce en Chile y competidores, citado como fuente en `Contexto/17-anexo-c-fuentes.md`) **no forma parte de este workspace** — solo se le menciona como insumo previo del levantamiento. Este documento es una **síntesis derivada**, extraída y organizada a partir del contenido de mercado que sí quedó documentado en [`docs/levantamiento.md`](./levantamiento.md) (secciones 1, 2, 12 y Anexo B). No sustituye al informe original; sirve para que `@docs/informe-mercado.md` tenga contenido de contexto de mercado mientras no se incorpore el documento fuente.
>
> Si encuentras el informe original, reemplaza este archivo por su conversión a Markdown (ver Fase de preparación previa a Fase A).

## 1. El dolor que paga (tesis de mercado)

El dolor pagable **no está en el ruteo**, sino en la trastienda de dinero del courier:

- Ruteo, tracking y POD ya están **commoditizados** (SimpliRoute, Beetrack, Drivin) y existe un **incumbente vertical** en Flex + Falabella (E-Courier).
- Donde el courier pierde margen y horas es en convertir cada entrega en su **factura al seller** y su **liquidación al conductor**, y en **conciliar** lo entregado contra lo facturado y lo pagado — hoy resuelto a mano en Excel, WhatsApp y llamadas.

La cuña diferenciadora frente a ese mercado commoditizado es el **"motor entrega→dinero"**: ante cada cambio de estado de una entrega, genera automáticamente la línea de cobro al seller (según tarifa) y la línea de liquidación al conductor, aplica incidencias y concilia todo desde un único dato de origen (estados de la API de Flex + same-day propio).

**Restricción dura que define el techo del mercado servible:** la app de Mercado Envíos Flex es obligatoria para escanear/completar entregas y no es integrable. El software orquesta alrededor de ella, nunca la reemplaza.

**Veredicto del levantamiento:** GO condicionado y angosto — negocio de nicho bootstrapped viable y defendible (defensibilidad vía costos de cambio en los datos de dinero, relevantes también para el SII). Solo alcanza escala de interés para un inversionista si se expande más allá de Santiago/Flex.

## 2. Panorama competitivo

| Competidor / referencia | Categoría | Por qué no resuelve el dolor central |
| --- | --- | --- |
| SimpliRoute, Beetrack, Drivin | Ruteo / tracking | Commoditizados; el ruteo no es el problema #1 del courier formal |
| E-Courier | Incumbente vertical (Flex + Falabella) | Cubre operación, pero el levantamiento identifica un flanco abierto en conciliación/cobranza/liquidación (hipótesis a validar) |

**Referencias de pricing de mercado (orden de magnitud, a validar):**
- SimpliRoute ≈ US$40/vehículo/mes
- E-Courier: cobro por conductor o mensualidad fija

## 3. Segmentación y modelo de negocio

**Tipo de producto:** SaaS B2B vertical, neutral, multi-tenant — "plataforma de gestión operativo-financiera para couriers de última milla". No es marketplace, ni CRM, ni WMS, ni otro ruteador, ni un ERP general.

**Cliente que paga:** PyME de última milla formal (emite factura), flota de 5–50 conductores (núcleo 8–20), que agrega sellers de ML Flex.

**Segmentos:**
- Cliente pagador / firmante: el courier.
- Decisor de compra: dueño/gerente del courier.
- Operadores de uso diario: supervisor, coordinador de tráfico, administración/contabilidad.
- Conductores: usuarios de la app móvil del courier.
- Usuario final del courier: el seller (principalmente ML Flex), que conecta por OAuth y ve tracking, incidencias y estado de cuenta.
- Destinatario/consumidor: no paga ni gestiona — no es un segmento de cliente.

**Modelo de ingresos:** suscripción recurrente como ingreso único (sin comisión por entrega):
- Base + variable por **conductor activo** (anclado a datos reales, difícil de inflar a la baja).
- **Planes por funcionalidad**: el plan de entrada cubre lo operativo; el motor entrega→dinero + conciliación + reportería va en el plan superior (land-and-expand).
- **Costos variables** (DTE, cobranza) como cupo incluido + excedente, cobrado por servicio efectivamente prestado.
- Plan anual con descuento (mejora caja, reduce churn).
- Fee por entrega: reservado como posible ajuste futuro si los pilotos muestran volúmenes muy distintos a igual número de conductores.

## 4. Hallazgos de investigación relevantes para el mercado

(Verificados contra fuentes públicas — ver `Contexto/17-anexo-c-fuentes.md`)

- **Ley 21.431 (plataformas digitales):** el sujeto regulado sería el courier (no el fundador, que no opera entregas). El conductor es dependiente o independiente según el Art. 7; la ley protege sus datos y prohíbe discriminación algorítmica. Esto da forma al producto (registro del tipo de relación, protección de datos) y es relevante para el discurso comercial hacia couriers formales.
- **Facturación electrónica (DTE/SII):** la factura B2B es un DTE tipo 33; certificarse ante el SII es costoso. El mercado de proveedores DTE (Chilesystems/SimpleFactura, Haulmer/Openfactura, BaseAPI, Bsale) hace viable integrar en vez de construir — define el modelo de "adaptador" del producto y reduce barrera de entrada.
- **Pagos:** Fintoc/Khipu (transferencia con conciliación automática) atacan directo el dolor de cuadre courier→seller; Flow/Webpay PatPass para la suscripción SaaS. Esto valida que existe infraestructura de pagos chilena madura sobre la cual construir la propuesta de conciliación.
- **OAuth de Mercado Libre:** dependencia crítica y frágil (tokens caducan, hay eventos que fuerzan re-vinculación manual) — esto es tanto un riesgo de producto como una razón por la que un jugador especializado (vs. Excel) genera valor defendible.

## 5. Tamaño de mercado — pendiente de validar (no es un TAM/SAM/SOM cerrado)

El levantamiento es explícito: **las cifras de mercado son supuestos**, no estimaciones confirmadas (no hubo entrevistas primarias, fue investigación de escritorio + iteración con el fundador). Antes de dimensionar TAM/SAM/SOM con rigor falta validar (`Contexto/16-anexo-b-supuestos-a-validar.md`):

- Número aproximado de couriers Flex formales en Santiago (insumo base para TAM/SAM/SOM).
- Que el dolor financiero-administrativo sea agudo y **pagable** (hipótesis #1).
- Disposición de pago real y unidad de cobro preferida (por conductor, fijo, por envío).
- Que la fricción de las dos apps y el ruteo **no** sean el problema #1 percibido.
- Que el incumbente (E-Courier) deje un flanco real en conciliación/cobranza/liquidación.
- Calidad, completitud y latencia de los estados de la API de Flex visibles para el courier.

**Implicación práctica:** no se debe invertir fuerte en adquisición ni en escalar el plan de negocio sobre estas cifras hasta correr **pilotos pagados** que confirmen la hipótesis #1 (dolor agudo y pagable). Tipo de cambio referencial usado en el levantamiento: ≈ CLP 950 por USD (fluctúa).

## Referencias

- Contenido fuente: [`docs/levantamiento.md`](./levantamiento.md), secciones "1. Resumen ejecutivo", "2. Modelo de negocio", "12. Hallazgos de investigación clave" y "Anexo B — Supuestos a validar".
- Fuentes públicas consultadas: `Contexto/17-anexo-c-fuentes.md` (Mercado Libre Developers, SII, proveedores DTE, proveedores de pago, Ley 21.431, Claude Code docs).

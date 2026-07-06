# 4. Volumen objetivo  [PROPUESTA — validar con pilotos]

> El número exacto **no vive en el repo**. El levantamiento es explícito en que **las cifras de
> mercado son supuestos**, no estimaciones confirmadas (sin entrevistas primarias). Lo que sí
> está documentado es el **perfil del cliente pagador**, y de ahí derivo una propuesta de
> dimensionamiento de trabajo. Trátala como hipótesis a confirmar con pilotos pagados.

## Anclas reales que sí da el repo
- **Perfil del courier (cliente pagador):** PyME de última milla **formal** (emite factura),
  flota de **5–50 conductores**, **núcleo 8–20**, que agrega sellers de ML Flex
  (`docs/informe-mercado.md`, `Contexto/03-modelo-de-negocio.md`).
- **Modelo de cobro:** base mensual + variable **por conductor activo** (no por volumen de
  paquetes). El same-day **no** es un cobro aparte: se suma al período.
- **Mercado servible:** acotado a **Santiago/RM + Flex** (techo definido por la restricción de
  la app de Flex). Escala mayor solo si se expande fuera de Santiago/Flex.

## Propuesta de volumen de trabajo (para dimensionar Etapas 2 y 3)

| Dimensión | Propuesta de trabajo | Base del cálculo |
|-----------|----------------------|------------------|
| Conductores por courier | **8–20** (rango 5–50) | perfil documentado |
| Entregas/día por conductor | **40–70** | estándar última milla urbana |
| **Entregas/día por courier** | **~400–1.400** (núcleo ~600–800) | conductores × entregas/conductor |
| Sellers por courier | **10–40** (techo ~100) | *inferido* — el courier agrega varios sellers Flex; **a confirmar** |
| Couriers (tenants) — meta MVP/piloto | **3–10** | escala bootstrapped, pilotos pagados |
| Couriers (tenants) — meta año 1 | **20–50** | crecimiento de nicho, Santiago |
| **Entregas/día agregadas (plataforma, año 1)** | **~10.000–40.000** | tenants × entregas/courier |
| Estacionalidad | picos x2–x3 en CyberDay/Navidad | estándar e-commerce CL |

## Implicación para el ADN (Etapa 2/3)
- A este perfil (decenas de tenants, miles–decenas de miles de entregas/día agregadas), el
  stack actual **Supabase gestionado + Inngest, monolito, sin colas propias ni sharding**
  **alcanza de sobra**. No hay caso para microservicios ni infra exótica en el MVP.
- Los primeros límites de rendimiento a vigilar **no son de cómputo**, sino: (a) **rate limits de
  la API de ML** en ingesta/backfill por seller, (b) volumen de **jobs Inngest** en picos
  (cierre de período, conciliación masiva), (c) tamaño de listados paginados en operación.
- **Variable de costo a modelar:** "conductor activo" por período (es la unidad de cobro), no el
  número de paquetes.

> ⚠️ Confirmar con pilotos: nº real de sellers por courier y nº de couriers Flex formales en
> Santiago (el insumo base del TAM, hoy sin validar — ver `Contexto/16-anexo-b-supuestos-a-validar.md`).

# 9. Roadmap de desarrollo

Ordenado por impacto y por dependencia técnica, que aquí coincide con el orden correcto de go-to-market: entrar por la operación, retener con el dinero.

## 9.1 MVP (V1) — en tres fases secuenciadas

**Fase A · Cimiento (P0). **Multi-tenant + RLS, RBAC, onboarding del courier (certificado + proveedor DTE + folios), tarifas, OAuth del seller + refresco de tokens. Sin valor visible aún, pero todo se apoya aquí.

**Fase B · Operación y lazo de datos (P1). **Ingesta Flex + panel multi-seller, same-day ad-hoc, asignación + manifiesto, sincronización de estados, incidencias, salud de conexiones + reconexión + backfill, dashboard del dueño, vista de conductor, portal del seller básico. Aquí el courier ya corre su día en la plataforma (gana adopción y produce el dato).

**Fase C · Motor entrega→dinero (P1, diferenciador). **Líneas de cobro/liquidación, reglas de incidencia, conciliación entregado-vs-facturado, facturación DTE al seller, liquidación de conductores. Monetiza el dato de la Fase B y crea los costos de cambio.

**El orden es forzado: **C necesita el dato de B y B necesita el aislamiento de A; además es la mejor secuencia comercial.

## 9.2 V2 — Crecimiento

Cobranza + conciliación bancaria (Fintoc/Khipu), app de conductor nativa, reportería ejecutiva avanzada, protección proactiva de reputación, integración de ruteo, notificaciones al consumidor, portal del seller avanzado. Sube ARPA y profundiza retención sobre una base ya adoptada.

## 9.3 V3 — Expansión

Multicanal (Falabella + e-commerce propio), otras ciudades/LATAM, evaluación de DTE propio si el volumen lo justifica, e IA donde reduzca trabajo real. Única vía a escala relevante y a reducir la dependencia de Flex-Santiago.

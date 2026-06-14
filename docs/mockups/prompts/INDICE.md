# Índice de prompts de mockups UI — Rutax

Set de **41 prompts** listos para pegar en el generador de imágenes de ChatGPT/DALL·E. Cada archivo contiene, al inicio y **verbatim**, el [BLOQUE ADN DE DISEÑO](00-ADN.md) (idéntico carácter por carácter en los 41 — verificado por hash), seguido de la sección específica de la vista. Esa repetición literal es lo que hace converger todos los mockups al mismo "ADN" (sistema de diseño de Rutax).

- **Cómo usarlo:** abre el `.md` de la vista, copia TODO su contenido y pégalo en el generador de imágenes. Renderiza las 41 para obtener un set coherente.
- **Fuente de verdad del ADN:** [DESIGN_SYSTEM.md](../../../DESIGN_SYSTEM.md) (autoridad), aterrizado a valores reales del código (`src/app/globals.css`, `src/lib/ui/traduccion-estados.ts`, `src/lib/ui/formato-moneda.ts`, `src/components/app-shell/`).
- **Dispositivo por área:** `(tenant)` y `portal` → escritorio 16:10; `conductor` → móvil vertical 9:19; auth/público → escritorio con formulario centrado.

> Nota de fidelidad: el backoffice del courier `(tenant)` usa, en el código real y en `DESIGN_SYSTEM.md` §7, una **barra lateral izquierda agrupada + barra superior** (no una barra superior con la nav). Los prompts describen ese shell real. El mapa de colores de estado se tomó EXACTO de `traduccion-estados.ts` (6 variantes: verde/ámbar/rojo/azul/gris + navy de marca), que prevalece sobre descripciones más libres (p. ej. "índigo en ruta", "naranja devuelto").

## A) Autenticación / público (escritorio, formulario centrado)

| # | Vista | Archivo | Descripción |
|---|---|---|---|
| 1 | `/` | [01-auth/01-landing.md](01-auth/01-landing.md) | Entrada de la app; aterriza en el login centrado de Rutax. |
| 2 | `/login` | [01-auth/02-login.md](01-auth/02-login.md) | Login de usuarios internos del courier. |
| 3 | `/registro` | [01-auth/03-registro.md](01-auth/03-registro.md) | Alta de la empresa (courier) en dos bloques. |
| 4 | `/registro/revisa-tu-correo` | [01-auth/04-revisa-tu-correo.md](01-auth/04-revisa-tu-correo.md) | Estado intermedio tras el alta. |
| 5 | `/activar-cuenta` | [01-auth/05-activar-cuenta.md](01-auth/05-activar-cuenta.md) | Define tu contraseña (primer ingreso del dueño). |
| 6 | `/invitacion/[token]` | [01-auth/06-invitacion.md](01-auth/06-invitacion.md) | Aceptar invitación al equipo / seller / conductor. |

## B) Backoffice del courier — área `(tenant)` (escritorio, barra lateral + superior)

| # | Vista | Archivo | Descripción |
|---|---|---|---|
| 7 | `/dashboard` | [02-tenant/07-dashboard.md](02-tenant/07-dashboard.md) | KPIs del día, dinero del mes, distribución, comunas, incidencias, accesos rápidos. |
| 8 | `/operaciones` | [02-tenant/08-operaciones.md](02-tenant/08-operaciones.md) | Lista de pedidos: contadores + filtros + tabla. |
| 9 | `/operaciones/[pedidoId]` | [02-tenant/09-pedido-detalle.md](02-tenant/09-pedido-detalle.md) | Detalle de pedido + trazador del lazo + timeline. |
| 10 | `/operaciones/incidencias` | [02-tenant/10-incidencias.md](02-tenant/10-incidencias.md) | Bandeja de incidencias. |
| 11 | `/manifiestos` | [02-tenant/11-manifiestos.md](02-tenant/11-manifiestos.md) | Lista de manifiestos. |
| 12 | `/manifiestos/nuevo` | [02-tenant/12-manifiesto-nuevo.md](02-tenant/12-manifiesto-nuevo.md) | Crear manifiesto. |
| 13 | `/manifiestos/[id]` | [02-tenant/13-manifiesto-detalle.md](02-tenant/13-manifiesto-detalle.md) | Detalle de manifiesto + pedidos asignados. |
| 14 | `/manifiestos/[id]/asignar` | [02-tenant/14-manifiesto-asignar.md](02-tenant/14-manifiesto-asignar.md) | Asignar pedidos (selección múltiple). |
| 15 | `/dinero/periodos` | [02-tenant/15-dinero-periodos.md](02-tenant/15-dinero-periodos.md) | Períodos de cobro: chips + tabla + badges. |
| 16 | `/dinero/periodos/[id]` | [02-tenant/16-periodo-detalle.md](02-tenant/16-periodo-detalle.md) | Detalle de período: factura DTE + líneas de cobro. |
| 17 | `/dinero/conciliacion` | [02-tenant/17-conciliacion.md](02-tenant/17-conciliacion.md) | Conciliación entregado-vs-facturado ("todo cuadra"). |
| 18 | `/dinero/liquidaciones` | [02-tenant/18-liquidaciones.md](02-tenant/18-liquidaciones.md) | Liquidaciones de conductores. |
| 19 | `/dinero/cobranza` | [02-tenant/19-cobranza.md](02-tenant/19-cobranza.md) | Revisión de pagos (cobranza courier→seller). |
| 20 | `/sellers` | [02-tenant/20-sellers.md](02-tenant/20-sellers.md) | Lista de sellers + salud de conexión ML. |
| 21 | `/sellers/invitar` | [02-tenant/21-sellers-invitar.md](02-tenant/21-sellers-invitar.md) | Invitar seller. |
| 22 | `/equipo` | [02-tenant/22-equipo.md](02-tenant/22-equipo.md) | Gestión de equipo y roles. |
| 23 | `/onboarding` | [02-tenant/23-onboarding.md](02-tenant/23-onboarding.md) | Checklist/panel de activación del courier. |
| 24 | `/onboarding/dte` | [02-tenant/24-onboarding-dte.md](02-tenant/24-onboarding-dte.md) | Proveedor DTE + certificado. |
| 25 | `/onboarding/folios` | [02-tenant/25-onboarding-folios.md](02-tenant/25-onboarding-folios.md) | Carga de folios CAF. |
| 26 | `/onboarding/tarifas` | [02-tenant/26-onboarding-tarifas.md](02-tenant/26-onboarding-tarifas.md) | Configuración de tarifas. |
| 27 | `/onboarding/cobranza` | [02-tenant/27-onboarding-cobranza.md](02-tenant/27-onboarding-cobranza.md) | Conectar banco para cobranza (Fintoc). |
| 28 | `/configuracion/exportar-datos` | [02-tenant/28-exportar-datos.md](02-tenant/28-exportar-datos.md) | Exportación de datos del courier. |

> `/dinero/*` lleva sub-navegación por pestañas (Períodos · Liquidaciones · Conciliación · Pagos) con badge de aviso; descrita en las vistas 15–19.

## C) Portal del seller — área `portal` (escritorio, header liviano ~960px)

| # | Vista | Archivo | Descripción |
|---|---|---|---|
| 29 | `/portal/login` | [03-portal/29-portal-login.md](03-portal/29-portal-login.md) | Login propio del seller. |
| 30 | `/portal` | [03-portal/30-portal-home.md](03-portal/30-portal-home.md) | Home: estado de conexión ML de un vistazo. |
| 31 | `/portal/bienvenida` | [03-portal/31-portal-bienvenida.md](03-portal/31-portal-bienvenida.md) | Onboarding del seller. |
| 32 | `/portal/conectar-ml` | [03-portal/32-portal-conectar-ml.md](03-portal/32-portal-conectar-ml.md) | Conectar/reconectar Mercado Libre (OAuth). |
| 33 | `/portal/pedidos` | [03-portal/33-portal-pedidos.md](03-portal/33-portal-pedidos.md) | Sus pedidos (tracking). |
| 34 | `/portal/pedidos/nuevo` | [03-portal/34-portal-pedido-nuevo.md](03-portal/34-portal-pedido-nuevo.md) | Crear pedido same-day ad-hoc. |
| 35 | `/portal/cobros` | [03-portal/35-portal-cobros.md](03-portal/35-portal-cobros.md) | Estado de cuenta (sus cobros/facturas). |
| 36 | `/portal/cobros/[id]` | [03-portal/36-portal-cobro-detalle.md](03-portal/36-portal-cobro-detalle.md) | Detalle de cobro + descargar factura PDF. |
| 37 | `/portal/incidencias` | [03-portal/37-portal-incidencias.md](03-portal/37-portal-incidencias.md) | Sus incidencias. |

## D) PWA del conductor — área `conductor` (móvil vertical 9:19, ~512px)

| # | Vista | Archivo | Descripción |
|---|---|---|---|
| 38 | `/conductor` | [04-conductor/38-conductor-home.md](04-conductor/38-conductor-home.md) | Home del conductor (aterriza en el manifiesto). |
| 39 | `/conductor/manifiesto` | [04-conductor/39-conductor-manifiesto.md](04-conductor/39-conductor-manifiesto.md) | Manifiesto del día: paradas + "Listo para salir". |
| 40 | `/conductor/manifiesto/[pedidoId]` | [04-conductor/40-conductor-parada.md](04-conductor/40-conductor-parada.md) | Detalle de una parada/entrega. |
| 41 | `/conductor/liquidaciones` | [04-conductor/41-conductor-liquidaciones.md](04-conductor/41-conductor-liquidaciones.md) | Sus liquidaciones/pagos. |

## Fuentes que no se encontraron

Ninguna. Todas las fuentes del Paso 1 existen en el working tree y se leyeron: `DESIGN_SYSTEM.md`, `UX_STRATEGY.md`, `BRIEF_DECISIONES_UX.md`, `FRONTEND_IMPLEMENTATION_PLAN.md`, `FRONTEND_EXPERIENCE_AUDIT.md`, `UX_READINESS_REPORT.md`, `FRONTEND_CHANGELOG.md`, `PRODUCT_BLUEPRINT.md`, `AGENTS.md`, `PROJECT_AUDIT.md`, `CLAUDE.md`, `docs/ux/fase-a-onboarding.md`, `docs/ux/fase-b-operacion.md`, `docs/ux/fase-c-dinero.md`, más la "piel" en código (`src/app/globals.css`, `src/app/layout.tsx`, `components.json` + `src/components/ui/*`, `src/lib/ui/traduccion-estados.ts`, `src/lib/ui/formato-moneda.ts`) y cada `page.tsx`/`layout.tsx` de las 41 vistas.

# FRONTEND_CHANGELOG.md — Ejecución de consistencia y experiencia premium

> **Qué es.** Registro exacto de los cambios aplicados al frontend para cerrar las brechas de **consistencia visual y experiencia** detectadas en [FRONTEND_EXPERIENCE_AUDIT.md](FRONTEND_EXPERIENCE_AUDIT.md), contra el estándar de [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) y [UX_STRATEGY.md](UX_STRATEGY.md).
>
> **Regla respetada.** Solo presentación. **No** se tocaron reglas de negocio, jobs, RLS, contratos Inngest ni la matriz de capacidades. Compatibilidad funcional mantenida.
>
> **Validación (todo en verde):** `npm run typecheck` ✓ · `npm run lint` (0 errores; 58 warnings, todos pre-existentes en mocks de test) ✓ · `npm test` **650/650** ✓ · `npm run build` ✓.
>
> **Fecha:** 2026-06-13 · **Rama:** feat/frontend-premium-rutax

---

## Resumen

| Categoría | Estado | Qué cambió |
|---|---|---|
| **Componentes** | ✅ | Badge unificado (fuente única de render de estado); Button/Badge/Table/Input/Dialog con motion tokens; Card unificado; EmptyState con entrada animada |
| **Tablas** | ✅ | Badges de estado del sistema en todas las tablas; transición de fila con token; skeletons de carga |
| **Formularios / filtros** | ✅ | Filtros de Pedidos y Conciliación migrados de `<select>` nativo a `Select` de Radix |
| **Dashboards** | ✅ | Badges del sistema; skeleton de carga |
| **Modales** | ✅ | Dialog con duración/easing por token (DESIGN §3, modal = `slow` + `ease-standard`) |
| **Navegación** | ✅ | **Centro de Avisos conectado a datos reales** (antes era un placeholder vacío) |
| **Empty States** | ✅ | Conductor migrado a `EmptyState`; entrada animada en el componente |
| **Loading States** | ✅ | `loading.tsx` (skeleton que preserva layout) en Dashboard, Pedidos y Períodos |

---

## 1. Sistema único de Badges de estado (mata la inconsistencia #1 del audit)

**Problema:** existían **dos** sistemas de color de estado — el componente `Badge` con variantes semánticas **y** un sistema paralelo de `<span>` hechos a mano con `COLOR_ESTADO_*` (clases sueltas), usado en ~20 pantallas. Mismos estados, dos renders distintos (alturas, bordes e íconos inconsistentes).

**Solución:** una sola fuente de verdad que devuelve la **variante del componente `Badge`**, y reemplazo de **todos** los `<span>` hand-rolled por `<Badge variant=…>`.

### Enabler
- **[src/lib/ui/traduccion-estados.ts](src/lib/ui/traduccion-estados.ts)**
  - Nuevo tipo `BadgeVariante` y mapa `VARIANTE_A_BADGE` (vocabulario interno → variante de `Badge`).
  - Nueva función `badgeDeVariante()` y `badgeEstadoSii()`.
  - Nuevos mapas `BADGE_ESTADO_PEDIDO/_INCIDENCIA/_MANIFIESTO/_PERIODO/_LIQUIDACION/_CONCILIACION/_MATCH_PAGO/_COBRO_PERIODO`, derivados del mismo mapa estado→variante que ya alimentaba los colores (sin duplicar la decisión de color).
  - Los `COLOR_ESTADO_*` antiguos se conservan exportados (retrocompatibilidad), pero ya **no se consumen** en pantallas.

### Pantallas migradas a `<Badge>` (26 sitios, 14 archivos)
- `(tenant)/operaciones/page.tsx` · `(tenant)/operaciones/[pedidoId]/page.tsx`
- `(tenant)/operaciones/incidencias/page.tsx`
- `(tenant)/manifiestos/page.tsx` · `(tenant)/manifiestos/[manifiestoId]/page.tsx`
- `(tenant)/dinero/periodos/page.tsx` · `(tenant)/dinero/periodos/[periodoId]/page.tsx`
- `(tenant)/dinero/liquidaciones/page.tsx` · `(tenant)/dinero/conciliacion/page.tsx` · `(tenant)/dinero/cobranza/page.tsx`
- `(tenant)/sellers/page.tsx` (estado del seller + salud de conexión, con mapas locales → variante)
- `portal/cobros/page.tsx` · `portal/cobros/[periodoId]/page.tsx` · `portal/pedidos/page.tsx` · `portal/incidencias/page.tsx`
- `conductor/manifiesto/page.tsx` · `conductor/manifiesto/[pedidoId]/page.tsx` · `conductor/liquidaciones/page.tsx`
- **[src/components/dinero/trazador-lazo.tsx](src/components/dinero/trazador-lazo.tsx)**: el helper `EtiquetaEstado` ahora envuelve `Badge` (recibe `variante` en vez de `clases`).

**Beneficio:** una sola altura, radio, borde y foco de badge en las 41 pantallas. El badge SII conserva su ícono pero ahora dentro de `Badge`.

---

## 2. Centro de Avisos — de placeholder a funcional (HI-1 del audit)

**Problema:** `CentroAvisos` tenía `const avisos = []` hardcodeado; la campana **siempre** decía "Sin avisos" aunque el dashboard mostrara banners rojos.

**Solución:** agregador server-side, capacidad-aware, cableado al layout.
- **Nuevo [src/lib/avisos/obtener-avisos.ts](src/lib/avisos/obtener-avisos.ts)**: reúne conexiones ML caídas, folios CAF bajos (<50) e incidencias sin gestión (>4h), jerarquizados por urgencia. Filtra por capacidad (`puede*`); cada fuente es defensiva (un fallo no tumba el layout). **Nunca** promete email (P6).
- **[src/components/app-shell/centro-avisos.tsx](src/components/app-shell/centro-avisos.tsx)**: recibe `avisos` por props; conteo real sobre la campana, lista con punto de urgencia, descripción y acción ("Reconectar", "Cargar folios", "Ver incidencias").
- **[src/components/app-shell/app-shell.tsx](src/components/app-shell/app-shell.tsx)**: nueva prop `avisos` → `CentroAvisos`.
- **[src/app/(tenant)/layout.tsx](src/app/(tenant)/layout.tsx)**: calcula `obtenerAvisos()` en paralelo con el estado de onboarding y lo pasa al `AppShell`.

---

## 3. Migración de `<select>` nativo → `Select` de Radix

**Problema:** `<select>` nativo del navegador (estética y comportamiento ajenos al sistema) en los filtros, vs el `Select` estilado/animado usado solo en onboarding.

**Solución:** migrados los **dos filtros de mayor tráfico**:
- **[src/app/(tenant)/operaciones/filtros-pedidos.tsx](src/app/(tenant)/operaciones/filtros-pedidos.tsx)**: `Select`/`Input`/`Button` del sistema (era client component controlado; navega por URL al cambiar).
- **Nuevo [src/app/(tenant)/dinero/conciliacion/filtros-conciliacion.tsx](src/app/(tenant)/dinero/conciliacion/filtros-conciliacion.tsx)** + **[…/conciliacion/page.tsx](src/app/(tenant)/dinero/conciliacion/page.tsx)**: el `<form method="get">` con 3 `<select>` nativos se reemplazó por un client island que navega al cambiar (misma fluidez que Pedidos), usando `Select` del sistema.

> **Deliberadamente NO migrado (con razón):** los `<select>` que son **inputs de formularios server** que envían a server actions (same-day, cambio de estado, alta de pedido/manifiesto, asignación, menú de pago). Migrarlos exige re-cablear el envío (Radix usa un `<select>` oculto con `name`) y toca lógica de envío — fuera del alcance "solo presentación / sin regresión". Quedan como follow-up acotado.

---

## 4. Motion — los tokens cableados ahora se usan (HI-2 del audit)

**Problema:** `--motion-*` / `ease-*` estaban definidos pero solo `sheet.tsx` los consumía.

**Solución (en las primitivas, se propaga a todo):**
- **[button.tsx](src/components/ui/button.tsx)**: `transition-all` → `duration-(--motion-instant) ease-standard`.
- **[badge.tsx](src/components/ui/badge.tsx)**: `duration-(--motion-fast) ease-standard`.
- **[input.tsx](src/components/ui/input.tsx)**: `duration-(--motion-instant) ease-standard`.
- **[table.tsx](src/components/ui/table.tsx)** (`TableRow`): transición de estado con `duration-(--motion-fast) ease-standard`.
- **[dialog.tsx](src/components/ui/dialog.tsx)**: overlay y contenido a `[animation-duration:var(--motion-slow)] ease-standard` (DESIGN §3: modal = `slow`).
- **[empty-state.tsx](src/components/ui/empty-state.tsx)**: entrada `animate-in fade-in slide-in-from-bottom` con `[animation-duration:var(--motion-base)]` y `motion-reduce:animate-none`.
- **[centro-avisos.tsx](src/components/app-shell/centro-avisos.tsx)**: hover de avisos con `duration-(--motion-fast) ease-out`.

Todo respeta el bloque global `prefers-reduced-motion` ya presente en `globals.css`.

---

## 5. Card unificado

**Problema:** el primitivo `Card` usaba `ring-1 ring-foreground/10` (sin borde, sin sombra), mientras las pantallas densas hand-rolleaban `border + shadow-xs`. Dos texturas de "card".

**Solución:** **[card.tsx](src/components/ui/card.tsx)** ahora usa `border border-border shadow-xs` — alineado a la textura dominante de las pantallas de datos. Cambio en un solo archivo, propaga a los ~14 usos (forms, onboarding, auth).

---

## 6. Conductor — consistencia con el sistema

**[src/app/conductor/manifiesto/page.tsx](src/app/conductor/manifiesto/page.tsx)**:
- El `<button>` crudo "Reintentar" → `<Button>`.
- Los estados sueltos (error / sin ruta / borrador) → `EmptyState` (mismo lenguaje que el resto de la app), con copy de conductor.
- Badge de estado del pedido → `<Badge>`.

---

## 7. Loading States nuevos

Skeletons que preservan el layout final (UX_STRATEGY §6.1), vía `loading.tsx` de Next:
- **Nuevo [src/app/(tenant)/dashboard/loading.tsx](src/app/(tenant)/dashboard/loading.tsx)** — grilla de KPIs + dinero.
- **Nuevo [src/app/(tenant)/operaciones/loading.tsx](src/app/(tenant)/operaciones/loading.tsx)** — contadores + tabla con filas skeleton.
- **Nuevo [src/app/(tenant)/dinero/periodos/loading.tsx](src/app/(tenant)/dinero/periodos/loading.tsx)** — tabla skeleton.

---

## Fuera de alcance en este pase (transparente)

Lo siguiente se detectó pero **no** se ejecutó por riesgo/alcance (requiere decisión o toca envío de datos), no por olvido:

1. **Migrar el resto de `<select>` nativos** que son inputs de formularios server (ver §3) — re-cablea el envío; follow-up acotado por pantalla.
2. **`Input` con estado de éxito visible (✓ RUT) + componente `Field`** — se añadió la base de motion al `Input`, pero el patrón de validación inline y su adopción por formulario quedó pendiente (toca cada form).
3. **Tablas crudas `<table>` → sistema `DataTable/Table`** en `sellers`, `portal/pedidos`, `portal/incidencias`, `manifiestos`, `dinero/liquidaciones` — funcionan y ya usan `Badge` del sistema; la conversión estructural es un refactor mayor con riesgo de responsive.
4. **Gráficos reales** en el dashboard (los `--chart-*` ya tienen color) y **selección múltiple / acciones masivas** en pedidos — features de pantalla, no de consistencia.

---

## Archivos tocados (resumen)

**Componentes/sistema:** `traduccion-estados.ts`, `badge.tsx` (uso, no API), `button.tsx`, `input.tsx`, `table.tsx`, `dialog.tsx`, `empty-state.tsx`, `card.tsx`, `app-shell.tsx`, `centro-avisos.tsx`, `trazador-lazo.tsx`.
**Nuevos:** `lib/avisos/obtener-avisos.ts`, `dinero/conciliacion/filtros-conciliacion.tsx`, `dashboard/loading.tsx`, `operaciones/loading.tsx`, `dinero/periodos/loading.tsx`.
**Pantallas:** `(tenant)/layout.tsx`, operaciones (lista + detalle + incidencias + filtros), manifiestos (lista + detalle), dinero (períodos lista + detalle, liquidaciones, conciliación, cobranza), sellers, portal (cobros lista + detalle, pedidos, incidencias), conductor (manifiesto, detalle, liquidaciones).

---

*Cambios de presentación validados con typecheck + lint + 650 tests + build. Sin regresión funcional: el backend, RLS, jobs y la matriz de capacidades no se tocaron.*

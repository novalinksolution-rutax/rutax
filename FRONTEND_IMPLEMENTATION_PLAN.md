# FRONTEND_IMPLEMENTATION_PLAN.md — Plan de implementación de la experiencia premium de Rutax

> **Qué es este documento.** El plan de ejecución para transformar la experiencia **actual** de Rutax en la **experiencia objetivo** definida por la estrategia y el sistema de diseño. No redefine la estrategia ni el sistema: los **ejecuta**. Traduce los principios en gaps concretos, secuencia el trabajo para minimizar riesgo, y entrega backlogs accionables y paquetes de trabajo por agente.
>
> **Fuente de verdad.** Derivado y subordinado a [PROJECT_AUDIT.md](PROJECT_AUDIT.md) (estado verificado del repo), [PRODUCT_BLUEPRINT.md](PRODUCT_BLUEPRINT.md) (producto), [UX_STRATEGY.md](UX_STRATEGY.md) (experiencia objetivo) y [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) (lenguaje visual y de movimiento). Donde haya conflicto, mandan esos documentos.
>
> **Principios de referencia (analizados, no copiados).** Linear (rapidez percibida, navegación eficiente) · Stripe (calidad visual, confianza) · Duolingo (motion, feedback, microinteracciones) · Notion (organización, escalabilidad). De cada uno se extrae el **principio**; la identidad de Rutax es propia.
>
> **Regla de oro heredada.** Esta es una fase de **pulido de experiencia sobre cimiento firme**. No se tocan reglas de negocio ni backend. No se introduce IA, ruteo ni gamificación. No se diseña captura de POD propia. No se promete email hasta que Resend esté conectado.
>
> **Estado de partida verificado en código.** Base técnica: Next.js 16 · React 19 · Tailwind 4 · shadcn/ui sobre Radix · tokens OKLCH + dark mode. 20 primitivas base en [src/components/ui/](src/components/ui/). ~41 pantallas en [src/app/](src/app/). `--primary` hoy es **gris**, no navy. Sin tokens semánticos ni de motion. Navegación superior plana sin agrupación. Sin PWA real (solo SVGs por defecto en `public/`).
>
> **Fecha:** 2026-06-13 · **Rama:** master

---

## Estado de ejecución (bitácora) — actualizado 2026-06-14

> Registro vivo de lo construido. Cada incremento cerró con `typecheck` + `lint` + `build` en verde y **650/650** tests Vitest (sin tocar backend ni reglas de negocio). El plan de 8 fases está **sustancialmente completo**; el remanente es un *long-tail* de tokens de baja exposición.

| Fase | Estado | Resumen de lo entregado |
|---|---|---|
| **1 · Fundaciones** | ✅ Completa | Navy de marca en `--primary` (light/dark); tokens semánticos `success/warning/info` (+ `-foreground`/`-subtle`/`-subtle-foreground`); tokens de motion (`--motion-*`/`--ease-*`) + `prefers-reduced-motion`; charts con color; elevación. En [globals.css](src/app/globals.css). |
| **2 · Componentes** | ✅ Núcleo P0 | `Badge` semántico + migración de [traduccion-estados.ts](src/lib/ui/traduccion-estados.ts) a tokens (fuente única de color de estado); `Button` con `loading`; **EmptyState**; **DialogConfirmacionDinero**. P1 (Data Table, Pagination) construidos JIT en Fase 4. |
| **3 · Layouts** | ✅ Completa | App shell nuevo ([app-shell.tsx](src/components/app-shell/app-shell.tsx)): nav **lateral agrupada** por objetivo + barra superior, filtrada por capacidad RBAC en servidor, responsive (Sheet en `<lg`). **Centro de avisos** in-app (ranura). Eliminado `barra-superior.tsx` legado. |
| **4 · Flujos principales** | ✅ Completa | Emisión DTE/NC cableadas a `DialogConfirmacionDinero` (UX-4); dashboard con jerarquía + charts con color (UX-2 parcial); **sistema Data Table** ([data-table.tsx](src/components/ui/data-table.tsx) + densidades en `Table` + [pagination.tsx](src/components/ui/pagination.tsx)) aplicado a pedidos (UX-7); **TrazadorLazo** entrega→dinero ([trazador-lazo.tsx](src/components/dinero/trazador-lazo.tsx), UX-1) con gate financiero; asignación masiva al sistema. |
| **5 · Flujos secundarios** | ✅ Completa | Conciliación como tranquilidad (UX-10); **incidencias con consecuencia financiera** (UX-9) vía módulo puro [afectacion-incidencia.ts](src/modules/operacion/afectacion-incidencia.ts); portal del seller (cobros lista+detalle) a sistema/tokens (UX-8); onboarding a tokens (UX-6, ya era secuencia guiada); barrido de tokens en pantallas de dinero/incidencias/manifiestos. |
| **6 · Responsive + PWA** | ✅ Completa | **PWA real del conductor** (T-4): [manifest.ts](src/app/manifest.ts) + [sw.js](public/sw.js) (network-first + fallback [/offline](src/app/offline/page.tsx)) + [icon.svg](public/icon.svg) + registro; táctil ≥44px; tokens en todo `conductor/`. Nav→Sheet y densidad seller ya cubiertos en fases previas. |
| **7 · Accesibilidad** | ✅ Base AA | Skip-to-content ([skip-link.tsx](src/components/app-shell/skip-link.tsx)) + `main` landmark en los 3 shells; botones solo-ícono con nombre accesible (auditado); cierres en español; focus-visible navy y `prefers-reduced-motion` heredados. *Pendiente humano:* verificación de contraste por herramienta. |
| **8 · Pulido** | 🟡 Mayoría | Tokens en diálogos/drawers operativos (cerrar-periodo, cambio-estado, reasignación, same-day, marcar-pagada). **Long-tail pendiente** (abajo). |

**Componentes nuevos del sistema:** `EmptyState`, `DialogConfirmacionDinero`, `DataTable`, `Pagination`, `TrazadorLazo`, `CentroAvisos`, `SkipLink`, `RegistrarSW` + densidades en `Table` y `loading` en `Button`.

### Long-tail pendiente (transparente)
- **Barrido de tokens de baja exposición** (~10 archivos): sub-formularios de onboarding (folios/tarifas/cobranza — `Alert` emerald), forms de auth (activar-cuenta, invitación — medidor de contraseña), badge de equipo, botones rojos en algunos `menu-acciones`. Ideal para un barrido dedicado del agente `frontend`.
- **Requiere decisión/backend (fuera de pulido):** resumen financiero del dashboard (ampliar `metricas.ts`, UX-2); UI optimista plena en listados (client island).
- **Requiere verificación humana/navegador:** contraste AA exacto (light/dark), instalabilidad PWA en dispositivo, E2E de UI.

---

## Índice

1. [Gap Analysis](#sección-1--gap-analysis)
2. [Implementation Strategy](#sección-2--implementation-strategy)
3. [Experience Layer](#sección-3--experience-layer)
4. [Motion Implementation](#sección-4--motion-implementation)
5. [Component Refactor Plan](#sección-5--component-refactor-plan)
6. [Screen Refactor Plan](#sección-6--screen-refactor-plan)
7. [Execution Phases](#sección-7--execution-phases)
8. [Agent Work Packages](#sección-8--agent-work-packages)

---

# SECCIÓN 1 — GAP ANALYSIS

> Comparación entre el **estado actual** (verificado leyendo `globals.css`, `button.tsx`, `traduccion-estados.ts`, `barra-superior.tsx`, `package.json` y el árbol de `src/app/`) y la **experiencia objetivo** (UX_STRATEGY + DESIGN_SYSTEM). Los gaps se clasifican en UX, UI y técnicos. Cada gap lleva un ID para trazarlo en el resto del plan.

## 1.1 Resumen del diagnóstico

El backend está firme, poblado y verificado E2E. El frontend **funciona** pero es **shadcn genérico sin identidad**: gris, plano, sin movimiento, con estados de sistema parciales y una navegación que el propio código describe como "andamiaje mínimo". El motor financiero es sólido; la experiencia no está a su altura. El riesgo no es técnico — es **desperdiciar un motor de confianza tras una piel genérica**.

La buena noticia: la base está **tokenizada**. El primario es una sola variable CSS; el cambio de mayor impacto (identidad navy) es de bajo costo. La mayoría del trabajo es **aditivo** (tokens, componentes nuevos, estados), no demolición.

## 1.2 Gaps UX (experiencia)

| ID | Gap | Estado actual | Estado objetivo | Severidad |
|---|---|---|---|---|
| **UX-1** | **Trazabilidad del lazo entrega→dinero no es visible.** El diferenciador no se *siente*. | Módulos conectados en el dato, no en la UI. No se puede ir de una entrega a su cobro/liquidación/factura/pago de un vistazo. | Lazo visible de punta a punta; cada peso trazable a la entrega que lo originó (UX_STRATEGY §A6, P2/P4). | **Alta** |
| **UX-2** | **El dinero no es el héroe.** | Operación y dinero compiten visualmente sin jerarquía clara; navegación plana iguala todo. | "Dinero" con el mismo peso que "Operación"; estado financiero del período omnipresente para quien factura (P1, IA §5.2). | **Alta** |
| **UX-3** | **Estados de sistema (vacío/cargando/error/sin-permiso) parciales y ad-hoc.** | Resueltos caso a caso; sin catálogo; tablas vacías que se ven "rotas". | Catálogo formal por las 3 audiencias; cada vista de datos resuelve sus 4 estados (DESIGN principio 7, UX_STRATEGY §6, §A3). | **Alta** |
| **UX-4** | **Emisión de DTE sin UX a prueba de errores.** | Diálogos de emisión existen pero sin previsualización rica ni consecuencia escrita estandarizada. | Previsualización (líneas, monto, seller) + confirmación con consecuencia escrita + lenguaje inequívoco de irreversibilidad (P5, §A2). | **Alta** |
| **UX-5** | **Avisos in-app dispersos.** | Alertas viven en bitácora; no hay centro de avisos in-app coherente. | Centro de avisos in-app accionable y jerarquizado (reconexión, folios, morosidad, incidencias). **Nunca prometer email** (P6, §A5). | **Alta** |
| **UX-6** | **Onboarding percibido como pasos sueltos.** | `banner-onboarding` existe; los pasos se sienten desconectados. | Secuencia única guiada con progreso persistente y "por qué" de cada paso; salir y retomar (Flujo 4.1, §M1). | Media |
| **UX-7** | **Asignación operativa lenta y de a uno.** | Flujo repetido decenas de veces/día sin acciones masivas ni UI optimista garantizada ni atajos. | Selección y asignación masiva + UI optimista + atajos de teclado (Flujo 4.3, §A4). | Media |
| **UX-8** | **El "por qué" de cada monto no está a un clic.** | Montos sin desglose visible (tarifa + ajuste por incidencia). | Desglose accesible a un clic; cero cobros-sorpresa (§2.1, §M2). | Media |
| **UX-9** | **Consecuencia financiera de incidencias no visible.** | Registrar incidencia no muestra su impacto en cobro/liquidación. | Al registrar, el sistema muestra el efecto ("reagendado: afecta cobro, no liquidación") (Flujo 4.4, §M3). | Media |
| **UX-10** | **Conciliación se presenta solo como problema, no como tranquilidad.** | Lista de descuadres. | "0 descuadres este período" como mensaje de confianza de primera clase (§2.3, §M7). | Media |
| **UX-11** | **Vocabulario de esquema filtrado a la UI.** | Riesgo de tecnicismos ("líneas de cobro", "período cerrado") visibles al usuario. | Vocabulario del usuario por audiencia (S2, §M6). | Media |
| **UX-12** | **Recuperación de contraseña sin entrada visible.** | Sin enlace "¿Olvidaste tu contraseña?" detectado. | Enlace en logins (delegado a Supabase nativo por ahora) (§B2). | Baja |

## 1.3 Gaps UI (lenguaje visual)

| ID | Gap | Estado actual (verificado) | Estado objetivo | Severidad |
|---|---|---|---|---|
| **UI-1** | **Sin identidad de marca: `--primary` es gris.** | `globals.css` línea 58: `--primary: oklch(0.205 0 0)` (gris neutro). | Navy de marca aplicado a `--primary`, contraste AA validado en light/dark (DESIGN cierre paso 1, §A1). | **Alta** |
| **UI-2** | **Tokens semánticos inexistentes como variables.** | Solo `--destructive`. No hay `success`/`warning`/`info` ni sus `-foreground`/`-subtle`. | Tokens semánticos OKLCH propios + variantes (DESIGN §9 tokens). | **Alta** |
| **UI-3** | **Colores de estado hardcodeados a paleta Tailwind, fuera del sistema.** | `traduccion-estados.ts` usa `bg-green-100 text-green-800 border-green-200`, etc. — bypassa los tokens. | Mapear estados a tokens semánticos vía un `Badge` con variantes; una sola fuente de color. | **Alta** |
| **UI-4** | **Charts en escala de grises.** | `--chart-1..5` todos grises (`globals.css` 70-74). | Color semántico para el dashboard del dueño (DESIGN §9). | Media |
| **UI-5** | **Tokens de motion no cableados.** | No existen `--motion-*` ni `--ease-*` en `globals.css`. | Tokens de duración/easing de DESIGN §3 cableados. | **Alta** (habilita Sección 4) |
| **UI-6** | **Tablas sin densidades ni numéricos tabulares.** | `table.tsx` base shadcn; sin `compact/comfortable/relaxed`, sin `tabular-nums`, sin alineación derecha de montos. | Tres densidades, montos en mono tabular alineados a la derecha (DESIGN §5). | **Alta** |
| **UI-7** | **Botón sin estado de carga integrado.** | `button.tsx`: variantes ok, pero **sin** `loading` (spinner in-situ). | Estado `loading` que deshabilita y muestra spinner sin cambiar tamaño (DESIGN §4 Buttons). | Media |
| **UI-8** | **Inputs sin estados error/success visibles ni patrón de validación.** | `input.tsx` base; sin error inline, sin ✓ de RUT válido. | Estados completos + validación inline al blur (DESIGN §6). | Media |
| **UI-9** | **Jerarquía por líneas/cajas en vez de espacio y peso.** | Riesgo de sobre-uso de `border`/`separator`. | Jerarquía por espacio en blanco y peso tipográfico; líneas como último recurso (DESIGN principio 6). | Baja |
| **UI-10** | **Elevación y escala tipográfica sin formalizar.** | Sombras y tamaños ad-hoc. | `shadow-xs/sm/md` de baja opacidad + escala tipográfica tokenizada (DESIGN §9). | Baja |

## 1.4 Gaps técnicos (frontend)

| ID | Gap | Estado actual (verificado) | Estado objetivo | Severidad |
|---|---|---|---|---|
| **T-1** | **Navegación es barra superior plana, sin agrupación.** | `barra-superior.tsx` — lista plana de `enlaces`; el comentario la declara "andamiaje mínimo". No hay grupos Operación/Dinero/Configuración. | Navegación lateral + barra superior, agrupada por objetivo, filtrada por capacidad (DESIGN §7, IA §5.2). | **Alta** |
| **T-2** | **Sin componentes clave de alta prioridad.** | `package.json` no incluye react-hook-form; no hay `Form`, `Data Table`, `Empty State`, `Stepper`, `Pagination`, `Date Picker`, `Command`, `Switch`, `Radio Group`. | Incorporar los de alta prioridad primero (DESIGN §9 "a incorporar"). | **Alta** |
| **T-3** | **5 `boton-descarga-*` duplicados.** | `boton-descarga-documento`, `-pdf-liquidacion`, `-factura-pdf`, `-liquidacion`, `-descargar-etiqueta`. | Un `BotonDescarga` parametrizable (AUDIT deuda #7, §M4). | Media |
| **T-4** | **PWA sin manifest/service worker/íconos.** | `public/` solo tiene SVGs por defecto de Next. | `manifest.webmanifest` + SW + íconos; instalabilidad verificada (AUDIT #10, §M5). | Media |
| **T-5** | **Sin librería de animación ni utilidades de motion.** | Solo `tw-animate-css`. Sin sistema propio sobre tokens. | Utilidades de transición sobre `--motion-*`/`--ease-*`; respetar `prefers-reduced-motion`. | Media |
| **T-6** | **Paneles de conexión ML parcialmente duplicados.** | `panel-conexion-ml.tsx` + `pantalla-conexion-ml.tsx` + `compartido.ts`. | Consolidar en patrón único "Estado de conexión ML" (§B3). | Baja |
| **T-7** | **Grupo `(app)/` legado.** | Reemplazado por `(tenant)`, pendiente de limpieza. | Eliminado (§B1, AUDIT deuda #8). | Baja |
| **T-8** | **Sin auditoría de accesibilidad ni verificación de contraste de marca.** | Radix da base ARIA; no hay verificación formal del navy ni focus rings consistentes. | WCAG 2.2 AA verificado; AAA en montos/estados críticos (DESIGN §8, §B4). | Media |

## 1.5 Lo que NO es un gap (no tocar)

- Reglas de negocio, jobs, RLS, contratos Inngest — **firmes**. La capa de presentación viste lo que ya funciona.
- Las funciones `puede*()` de capacidades — el frontend las consume; **nunca** replicar la matriz.
- Helpers de `src/lib/ui/` (moneda, comunas, traducción de textos de estado) — se reutilizan; solo se migra el **color** de estado a tokens (UI-3).
- Las 20 primitivas shadcn — son la base correcta; se **extienden**, no se reemplazan.

---

# SECCIÓN 2 — IMPLEMENTATION STRATEGY

> Plan de migración diseñado para minimizar **riesgo, re-trabajo y regresiones**. Premisa: el backend no se toca, así que todo riesgo es de presentación. La estrategia es **token-first y aditiva**: cambiar los cimientos una vez, abajo, para que el cambio se propague solo hacia arriba.

## 2.1 Principios de la migración

1. **Token-first, no pantalla-first.** Aplicar identidad y semántica en `globals.css` y en las primitivas **antes** de tocar pantallas. Un cambio en `--primary` o en `Badge` se propaga a las 41 pantallas sin editarlas una a una. Esto colapsa el re-trabajo.
2. **Aditivo sobre destructivo.** Se **añaden** tokens, variantes y componentes nuevos. Las primitivas existentes se extienden de forma retrocompatible (ej.: `Button` gana `loading` sin romper sus usos actuales).
3. **Una sola fuente de color de estado.** Migrar `traduccion-estados.ts` de clases Tailwind crudas a variantes de `Badge` ligadas a tokens. Cambio quirúrgico, alto alcance, bajo riesgo (el texto traducido no se toca).
4. **Sin regresión funcional.** Cada fase cierra con `npm run typecheck` + `npm run lint` + `npm test` (645 Vitest) + `npx supabase test db` (195 pgTAP) en verde. El pulido visual **no** puede romper RBAC ni RLS.
5. **Capacidad-aware desde el día uno.** Cualquier refactor de navegación o pantalla conserva el filtrado por `puede*()`. Lo que un rol no puede hacer, no lo ve (P3).
6. **Verificación visual progresiva.** Tras cada fase, correr la app con datos demo ([docs/PRUEBA.md](docs/PRUEBA.md)) y revisar las 3 audiencias. Lo visual se valida mirando, no solo con tests.

## 2.2 Orden de migración (por qué este orden reduce riesgo)

```
Fundaciones (tokens)  →  Componentes (primitivas + compuestos)  →  Layouts (nav/shell)
        │                          │                                      │
   se propaga solo          se reusa en todas               estructura estable
   a todo lo de arriba       las pantallas                  antes de pulir flujos
                                                                      │
                          Flujos críticos (dinero) → Flujos secundarios → Responsive → A11y → Pulido
```

- **Fundaciones primero** porque son el multiplicador: un token bien puesto evita editar 41 pantallas.
- **Componentes antes que pantallas** porque las pantallas son composición de componentes; pulir el componente pule todas sus instancias.
- **Layout antes que flujos** porque la navegación es el esqueleto: cambiarla después obliga a re-tocar pantallas ya pulidas.
- **Flujos críticos (dinero) antes que secundarios** porque ahí vive la confianza y el único punto irreversible (DTE).
- **Responsive y A11y al final pero no opcionales** — sobre una base ya consistente, son verificación y calibración, no rediseño.

## 2.3 Gestión de regresiones

| Riesgo | Mitigación |
|---|---|
| Cambiar `--primary` rompe contraste/legibilidad | Validar AA en light/dark con herramienta de contraste antes de mergear; el navy es provisional y reversible (1 variable). |
| Migrar colores de estado rompe badges en pantallas | Migrar vía `Badge` con variantes manteniendo el mapa `estado→variante`; snapshot visual de cada estado antes/después. |
| Refactor de navegación rompe gating RBAC | La nueva nav consume los mismos `puede*()`; QA prueba con tokens de cada rol (interno/seller/conductor). |
| Consolidar `BotonDescarga` rompe descargas | Migrar uno a uno, manteniendo el endpoint/acción; probar cada descarga (factura, etiqueta, liquidación, export). |
| Motion molesta o marea | `prefers-reduced-motion` obligatorio; duraciones tope (400ms); revisión en dispositivo real del conductor. |
| Tocar pantalla introduce bug funcional | Pulido es solo presentación; no mover lógica de `actions.ts`/server components. Tests en verde por fase. |

## 2.4 Definición de "hecho" por incremento

Un incremento está hecho cuando: (a) usa tokens, no valores mágicos; (b) resuelve sus 4 estados de sistema; (c) respeta capacidad RBAC; (d) cumple contraste AA; (e) respeta `prefers-reduced-motion`; (f) typecheck/lint/test en verde; (g) verificado visualmente en su(s) audiencia(s) con datos demo.

---

# SECCIÓN 3 — EXPERIENCE LAYER

> Backlog de estados de experiencia, inspirado en el **detalle obsesivo de Duolingo** adaptado a un producto financiero serio (rico y específico, sin gamificación). Cada estado se define como entregable de sistema (no caso a caso) y se calibra por audiencia. Implementa UX_STRATEGY §6 y DESIGN §7/§9.

## 3.1 Loading states — *"el sistema está vivo y trabajando"*

| ID | Estado | Patrón | Audiencia | Notas |
|---|---|---|---|---|
| L-1 | Carga inicial de tabla | Filas skeleton con el alto real de la fila; preserva layout, no salta | Interno | Nunca spinner suelto. |
| L-2 | Carga inicial de card/panel | Skeleton con la forma del contenido final | Seller/Conductor | Pulso suave 1500ms (no parpadeo). |
| L-3 | Acción optimista | Resultado al instante; reconciliación en segundo plano | Interno (asignar, cambiar estado) | UI optimista (I1). Loading real solo en carga inicial. |
| L-4 | Trabajo asíncrono (job) | "Emitiendo factura… puedes seguir trabajando, te avisamos acá" | Interno (dinero) | El usuario no queda secuestrado (F5/I5). |
| L-5 | Botón en proceso | Spinner in-situ, deshabilita, no cambia tamaño; texto "Emitiendo…" | Todas | Depende de UI-7. |

## 3.2 Empty states — *"está vacío por una razón, y esto puedes hacer"*

| ID | Estado | Tipo | Copy ejemplo (placeholder, lo afina Copy) | Acción |
|---|---|---|---|---|
| E-1 | Sin pedidos aún | Arranque | "Aún no tienes pedidos. Llegan solos cuando tus sellers conecten Mercado Libre." | Ir a invitar/ver sellers |
| E-2 | Sin incidencias sin gestionar | Buen estado | "Sin incidencias pendientes. Todo al día." | — (es confianza) |
| E-3 | 0 descuadres en período | Buen estado | "Este período cuadra: 0 descuadres." | — (UX-10/§M7) |
| E-4 | Filtro sin resultados | Filtro | "Ningún pedido coincide con estos filtros." | "Limpiar filtros" |
| E-5 | Conductor sin ruta hoy | Arranque (audiencia) | "No tienes ruta asignada para hoy." | — (tono distinto al dueño) |
| E-6 | Seller sin cobros aún | Arranque | "Todavía no hay cobros. Aquí verás tus facturas cuando se emitan." | — |
| E-7 | Sin liquidaciones | Arranque | "Aún no tienes liquidaciones. Aparecerán al cerrar tu primer período." | — |
| E-8 | Sin pagos recibidos | Arranque | "Sin pagos registrados todavía." | — |

> **Regla:** distinguir siempre **vacío de arranque** vs **vacío de buen estado** (celebración sobria) vs **vacío de filtro** (ofrece limpiar). Un empty state nunca es un muro.

## 3.3 Error states — *"qué pasó y cómo salgo de esto"*

| ID | Estado | Patrón | Ejemplo |
|---|---|---|---|
| ER-1 | Error de regla de negocio | Traducir el error del sistema a acción | "No se puede emitir: el período aún está abierto. Ciérralo primero." (no "Error 42501") |
| ER-2 | Error de validación (Zod/RLS) | Mostrar junto al campo, no en toast lejano | "El dígito verificador del RUT no coincide." |
| ER-3 | Error recuperable | Ofrecer la recuperación en el lugar | "No se pudo cargar. [Reintentar]" |
| ER-4 | Conexión ML caída | Honesto y accionable | "Tu conexión con Mercado Libre se cayó. [Reconectar]" |
| ER-5 | Error en tabla | Mensaje en zona de tabla + reintento | "No pudimos cargar los pedidos. [Reintentar]" |
| ER-6 | Error preventivo en irreversible | Evitar *antes* con confirmación clara | (DTE: la prevención es la confirmación, §3.5) |

> **Regla (F3):** todo error responde **qué** pasó, **por qué**, **qué hacer ahora**. Tono franco y tranquilizador, nunca culpabilizador ni alarmista. Nunca un código crudo de cara al usuario.

## 3.4 Success states — *"esto exactamente pasó"*

| ID | Estado | Patrón | Ejemplo |
|---|---|---|---|
| S-1 | Acción rápida (asignar, filtrar) | Toast discreto que se desvanece | "Pedido asignado a Juan Pérez." |
| S-2 | Acción de dinero | Toast específico: objeto + resultado + magnitud | "Factura folio 1042 emitida para Comercial XYZ — $1.240.500. El seller ya puede descargarla." |
| S-3 | Momento "aha" (primer lazo) | Confirmación más presente, sobria, con overshoot sutil | "Tu primera entrega ya generó su cobro y su liquidación, conciliados." |
| S-4 | Éxito encadenado | Sugiere el siguiente paso | "Período facturado. → Revisar cobranza." |
| S-5 | Guardado de formulario | Estado explícito con timestamp | "Guardado · 14:32" |

> **Regla:** específico, no genérico (nunca "Operación exitosa"). Proporcional al peso del evento. Encadena al siguiente paso (fluidez).

## 3.5 Confirmation states — *"fricción proporcional a la consecuencia"*

| ID | Acción | Confirmación | Detalle |
|---|---|---|---|
| C-1 | Asignar/reasignar, cambiar estado, filtrar | **Ninguna** | Reversible/trivial → directo (I4). |
| C-2 | Emitir DTE | Modal con consecuencia escrita + previsualización + paso de confirmación | "Vas a emitir un documento tributario por $X. Es irreversible ante el SII; corregirlo después requiere una nota de crédito." `Esc`/click-fuera deshabilitados (UX-4/§A2). |
| C-3 | Emitir nota de crédito | Modal + motivo obligatorio + consecuencia | "Anulación total de la factura folio Y. Irreversible." |
| C-4 | Anular período | Modal + consecuencia + auditoría automática | El "quién" se registra solo (bitácora). |
| C-5 | Marcar liquidación pagada / descartar pago | Confirmación ligera | Reversible con auditoría. |

## 3.6 Notification states — *in-app, honestos (decisión cerrada)*

| ID | Aviso | Jerarquía | Acción | Origen |
|---|---|---|---|---|
| N-1 | Conexión ML caída | Urgente | "Reconectar" | Salud de conexiones |
| N-2 | Folios casi agotados (<50) | Urgente | "Cargar folios" | `alerta-folios-proximos` |
| N-3 | Morosidad de seller | Importante | "Ver cobranza" | `alerta-morosidad` |
| N-4 | Incidencia sin gestión >4h | Importante | "Ver incidencia" | `notificacion-incidencias-sin-gestion` |
| N-5 | Resultado de job listo (factura emitida) | Informativo | "Ver factura" | Resultado asíncrono |

> **El copy nunca promete email** (P6). Hoy todo es in-app: badges, banners, un centro de avisos. Cuando se conecte Resend, el email se *suma* sobre esta base, sin rehacerla.

---

# SECCIÓN 4 — MOTION IMPLEMENTATION

> Implementa DESIGN §3. El movimiento tiene tres trabajos: **confirmar, orientar, suavizar**. Ninguno más. Regla de oro: **si el movimiento hace esperar al usuario, está mal calibrado.** Inspiración: el cuidado de Duolingo por el detalle; **no** su exuberancia.

## 4.1 Prerrequisito técnico

Cablear los tokens de motion en `globals.css` (UI-5, T-5) **antes** de animar nada:

```css
:root {
  --motion-instant: 100ms;  --motion-fast: 160ms;  --motion-base: 220ms;
  --motion-slow: 320ms;      --motion-page: 400ms;
  --ease-standard: cubic-bezier(0.2, 0, 0, 1);
  --ease-out: cubic-bezier(0, 0, 0.2, 1);
  --ease-in: cubic-bezier(0.4, 0, 1, 1);
  --ease-emphasis: cubic-bezier(0.34, 1.3, 0.64, 1);
}
```

`prefers-reduced-motion` ya tiene el bloque definido en DESIGN §3 — **obligatorio** incluirlo.

## 4.2 Qué animar (con propósito)

| Interacción | Duración | Curva | Trabajo |
|---|---|---|---|
| Botón hover/press (escala 0.98) | instant | standard | Confirmar |
| Foco de teclado (anillo) | instant | standard | Orientar |
| Checkbox/toggle/tabs | fast | out/standard | Confirmar |
| Tooltip (fade + 4px, delay 400ms) | fast | out | Orientar |
| Dropdown/Select/Popover (escala 0.98→1 + fade) | base | out/in | Orientar |
| Toast (Sonner) | base | out | Confirmar |
| Acordeón/colapsable (altura + fade) | base | standard | Suavizar |
| Modal (escala 0.96→1 + overlay fade) | slow | out/in | Orientar |
| Drawer/Sheet (desliza desde borde) | slow | out/in | Orientar |
| Fila nueva en tabla (fade + 8px, resalte breve) | base | out | Confirmar |
| **Éxito de acción de dinero** (único overshoot) | base | **emphasis** | Confirmar (clímax) |
| Cambio de estado de pedido/período | base | standard | Suavizar (el ojo registra el cambio, F4) |
| Skeleton (pulso opacidad 1→0.5→1) | 1500ms loop | ease-in-out | "vivo" |

## 4.3 Qué NO animar

- **Cargas de datos largas** — no decorar la espera; usar skeleton, no animación.
- **Layout principal / navegación entre secciones** más allá de `--motion-page` (400ms tope).
- **Nada con rebote en lo cotidiano** — `--ease-emphasis` se reserva al clímax de un flujo de dinero (factura emitida, pago conciliado), con cuentagotas.
- **Movimiento de pantalla completa** — los elementos se desplazan 8–16px, no toda la pantalla (excepto drawer/sheet desde el borde).
- **Confeti, celebraciones lúdicas, animaciones de marca decorativas** — esto es dinero serio.
- **Animaciones que bloqueen interacción** — nunca el usuario espera a que termine una transición para actuar.

## 4.4 Cuándo animar

- **Siempre** que una acción del usuario cambie el estado visible de un objeto (confirmar).
- **Siempre** que algo entre/salga de la pantalla (orientar de dónde viene/va).
- **Solo** cuando suaviza un cambio que de otro modo "saltaría".
- **Nunca** por decoración, ni para "dar vida", ni para llenar una espera.

**Objetivo:** mejorar comprensión, no decorar. Cada animación que no ayude a *entender* qué pasó es candidata a eliminarse.

---

# SECCIÓN 5 — COMPONENT REFACTOR PLAN

> Backlog de componentes priorizado por impacto en la experiencia. Esfuerzo: S (≤0.5d) · M (~1–2d) · L (~3–5d). "Existe" = presente en `src/components/ui/`. Implementa DESIGN §9.

| Componente | Acción | Prioridad | Esfuerzo | Impacto UX |
|---|---|---|---|---|
| **Tokens (globals.css)** | Aplicar navy a `--primary`; añadir semánticos `success/warning/info` + `-subtle`; motion `--motion-*`/`--ease-*`; charts con color; elevación | **P0** | M | **Crítico** — multiplicador; viste las 41 pantallas (UI-1/2/4/5) |
| **Badge** | Variantes ligadas a tokens semánticos; migrar `traduccion-estados.ts` a este Badge | **P0** | M | **Alto** — una sola fuente de color de estado (UI-3) |
| **Button** | Añadir estado `loading` integrado (spinner in-situ, no cambia tamaño) | **P0** | S | Alto — feedback de toda acción (UI-7, L-5) |
| **Empty State** (nuevo) | Componente estándar: ícono + frase + acción; soporta los 3 tipos | **P0** | M | **Alto** — hace la app sentirse "terminada" (UX-3, E-1..8) |
| **Confirmación de dinero** (compuesto sobre Dialog) | Modo irreversible: resumen + consecuencia escrita + paso de confirmación; `Esc` deshabilitado | **P0** | M | **Crítico** — único punto irreversible (UX-4, C-2/3/4) |
| **Data Table** (compuesto sobre Table) | Densidades; numéricos tabulares a la derecha; estados de tabla; selección masiva; filtros en URL | **P1** | L | **Alto** — caballo de batalla del interno (UI-6, UX-7) |
| **Form** (RHF + Zod resolver) | Estructura, errores inline al blur, validación CL (RUT/CLP) | **P1** | M | Alto — onboarding y altas (UI-8, DESIGN §6) |
| **Input** | Estados error/success visibles; ✓ RUT válido; texto de ayuda | **P1** | S | Medio (UI-8) |
| **Centro de avisos in-app** (nuevo) | Badge + panel; avisos jerarquizados y accionables; sin email | **P1** | L | **Alto** — las alertas hoy no se ven (UX-5, N-1..5) |
| **BotonDescarga** (consolidación) | Unificar los 5 `boton-descarga-*` en uno parametrizable | **P1** | M | Medio — consistencia (T-3, §M4) |
| **Stepper / Wizard** (nuevo) | Onboarding por pasos con progreso persistente | **P1** | M | Alto — activación del courier (UX-6) |
| **Pagination** (nuevo) | Tablas de gran volumen; total visible ("1–50 de 1.240") | **P1** | S | Medio — escalabilidad (DESIGN §5) |
| **Trazador del lazo** (compuesto nuevo) | Línea visible entrega→cobro→período→factura→pago | **P1** | L | **Alto** — *la* prueba de confianza (UX-1, §A6) |
| **Estado de conexión ML** (consolidación) | Unificar `panel-`/`pantalla-conexion-ml` en un indicador + acción | **P2** | M | Medio (T-6, §B3) |
| **Desglose de monto** (compuesto) | Popover/expand: tarifa + ajuste incidencia | **P2** | S | Medio — confianza del seller (UX-8) |
| **Switch / Radio Group** (nuevos) | Toggles de config (opt-in DTE real), opciones excluyentes (tarifa) | **P2** | S | Medio |
| **Date Picker / Calendar** (nuevo) | Rangos de período, fechas de manifiesto | **P2** | M | Medio |
| **Command (⌘K)** (nuevo) | Búsqueda/atajos del backoffice denso | **P3** | M | Medio — poder-usuario (UX-7) |
| **Breadcrumb** (nuevo) | Orientación en config profunda | **P3** | S | Bajo |
| **Accordion / Popover** (nuevos) | Detalle expandible, ayuda contextual | **P3** | S | Bajo |
| **Chart** (nuevo) | Dashboard con color semántico | **P3** | M | Medio — depende de UI-4 |

---

# SECCIÓN 6 — SCREEN REFACTOR PLAN

> Backlog de pantallas priorizado por impacto. La mayoría se beneficia "gratis" del token-first y del refactor de componentes; aquí se listan las que requieren **trabajo de pantalla específico**. Prioridad: P0 (define confianza/identidad) → P3 (limpieza).

| Pantalla | Acción de refactor | Prioridad | Impacto |
|---|---|---|---|
| **App shell / Navegación `(tenant)`** | Reemplazar barra plana por nav lateral + superior, agrupada (Operación/Dinero/Configuración), filtrada por capacidad | **P0** | **Alto** — esqueleto de todo el interno (T-1) |
| **Período · detalle (emisión DTE)** | Previsualización + confirmación de dinero + lenguaje de irreversibilidad | **P0** | **Crítico** — punto irreversible (UX-4) |
| **Dashboard del dueño** | Jerarquía: pulso operativo + **estado financiero del período** arriba; charts con color; avisos in-app accionables | **P0** | **Alto** — la puerta de entrada (UX-2, UX-5) |
| **Pedidos (operaciones)** | Data Table con densidad, filtros persistentes, selección masiva, UI optimista, estados de tabla | **P0** | **Alto** — flujo más repetido (UX-7, UI-6) |
| **Detalle de pedido** | Trazador del lazo (a su línea de cobro/liquidación, incidencia, manifiesto); desglose de monto | **P1** | Alto — trazabilidad (UX-1, UX-8) |
| **Incidencias (registro)** | Mostrar consecuencia financiera al clasificar; destacar >4h sin gestión | **P1** | Alto — claridad (UX-9) |
| **Conciliación** | "0 descuadres" como mensaje de tranquilidad; descuadres accionables | **P1** | Alto — confianza (UX-10) |
| **Cobranza (pagos)** | Estado de cobro por período visible; atribuir/descartar de un gesto; empty states | **P1** | Medio (Flujo 4.7) |
| **Liquidaciones** | Data Table + montos tabulares; marcar pagada; descarga unificada | **P1** | Medio |
| **Onboarding (DTE/folios/tarifas/cobranza)** | Wizard con progreso persistente, "por qué" de cada paso, retomar | **P1** | Alto — activación (UX-6) |
| **Portal seller · Cobros** | Estado de cuenta transparente; desglose; descarga grande y evidente; cards en móvil | **P1** | Alto — confianza del seller (UX-8, §3.2 seller) |
| **Portal seller · Conexión ML** | Indicador de salud permanente + reconexión self-service clara | **P1** | Alto — ansiedad de conexión (ER-4, N-1) |
| **Portal seller · Pedidos** | Tracking en lenguaje de seller; cards en móvil; empty states | **P2** | Medio |
| **PWA conductor · Manifiesto** | Táctil ≥44px, contraste alto, nav inferior, "listo para salir" full-width; offline-tolerante | **P1** | Alto — calle, una mano (DESIGN §7, T-4) |
| **PWA conductor · Liquidaciones** | Una pantalla, descargable, mínimo | **P2** | Medio |
| **Logins (interno/seller)** | Enlace "¿Olvidaste tu contraseña?"; identidad de marca | **P2** | Bajo (UX-12) |
| **Equipo / Sellers** | Data Table + Form + empty states | **P2** | Medio |
| **Exportar datos** | BotonDescarga unificado; feedback de descarga | **P3** | Bajo |
| **Grupo `(app)/` legado** | Eliminar | **P3** | Bajo — higiene (T-7) |

---

# SECCIÓN 7 — EXECUTION PHASES

> Ocho fases secuenciadas según la estrategia de §2.2. Cada fase cierra con la suite en verde (typecheck/lint/Vitest/pgTAP) y verificación visual con datos demo. Las fases tempranas son multiplicadores; las tardías son calibración sobre base estable.

## FASE 1 — Fundaciones
**Objetivo:** los cimientos tokenizados que se propagan solos.
- Aplicar **navy de marca** a `--primary` (light/dark) y validar contraste AA (UI-1).
- Definir **tokens semánticos** `success/warning/info` + `-foreground`/`-subtle` (UI-2).
- Cablear **tokens de motion** `--motion-*`/`--ease-*` + bloque `prefers-reduced-motion` (UI-5).
- Color semántico para **charts** (UI-4); formalizar **elevación** y escala tipográfica (UI-10).
- **Salida:** `globals.css` con identidad completa; 0 cambios de pantalla; todo lo de arriba "hereda" navy.

## FASE 2 — Sistema de componentes
**Objetivo:** primitivas y compuestos que pulen todas sus instancias.
- `Badge` con variantes semánticas + **migrar `traduccion-estados.ts`** a tokens (UI-3).
- `Button` con `loading` (UI-7); `Input` con error/success (UI-8).
- Componentes nuevos P0/P1: **Empty State**, **Confirmación de dinero**, **Data Table**, **Form (RHF+Zod)**, **Stepper**, **Pagination**, **Centro de avisos**.
- Consolidar **BotonDescarga** (T-3).
- **Salida:** inventario de DESIGN §9 cubierto en sus prioridades altas; documentado en un catálogo navegable.

## FASE 3 — Layouts
**Objetivo:** el esqueleto estable antes de pulir flujos.
- App shell `(tenant)`: **nav lateral + superior agrupada por objetivo, filtrada por capacidad** (T-1).
- Calibrar densidades por audiencia (interno denso / seller espaciado / conductor táctil).
- Layout responsive base de los 3 grupos (sin pulir flujos aún).
- **Salida:** navegación objetivo en su sitio; pantallas existentes funcionando dentro del nuevo shell.

## FASE 4 — Flujos principales
**Objetivo:** la confianza y el punto irreversible.
- **Emisión DTE / nota de crédito**: previsualización + confirmación de dinero (UX-4).
- **Dashboard**: pulso operativo + financiero, charts con color, avisos in-app (UX-2, UX-5).
- **Pedidos + asignación**: Data Table, selección masiva, UI optimista, atajos (UX-7).
- **Trazador del lazo** entrega→dinero (UX-1).
- **Salida:** el diferenciador se *siente*; el flujo crítico es a prueba de errores.

## FASE 5 — Flujos secundarios
**Objetivo:** completar el lazo y la activación.
- Onboarding como **wizard** (UX-6); incidencias con consecuencia financiera (UX-9).
- Conciliación como tranquilidad (UX-10); cobranza Fintoc; liquidaciones.
- Portal del seller (cobros transparentes, conexión ML, tracking); desglose de montos (UX-8).
- Vocabulario del usuario auditado en toda la UI (UX-11).
- **Salida:** las 3 audiencias con su experiencia completa.

## FASE 6 — Responsive
**Objetivo:** una base, tres calibraciones.
- Seller: tablas → cards en móvil; descargas evidentes.
- **Conductor: PWA real** — manifest + service worker + íconos; táctil ≥44px; offline-tolerante (T-4, UX/DESIGN §7).
- Interno: nav lateral colapsa a sheet en `md`; tablas priorizan columnas clave.
- **Salida:** sin scroll horizontal indebido; cada contexto físico resuelto.

## FASE 7 — Accesibilidad
**Objetivo:** WCAG 2.2 AA (AAA en montos/estados críticos).
- Contraste verificado en ambos temas; color nunca único portador de significado.
- Teclado: orden lógico, foco visible, trap en modales/drawers, `Esc` (salvo irreversibles).
- Semántica/ARIA: `aria-label` en solo-ícono, `aria-live` en carga/error, `label`+`aria-describedby` en forms (T-8).
- **Salida:** auditoría de accesibilidad aprobada.

## FASE 8 — Pulido premium
**Objetivo:** la calidad en lo invisible (Stripe) y el detalle del movimiento (Duolingo).
- Microinteracciones de transición de estado (F4, §B5); overshoot del clímax de dinero.
- Ritmo de espaciado, alineación, tipografía afinada; revisión de "menos ruido, más señal".
- Limpieza: grupo `(app)/` legado (T-7), consolidación de conexión ML (T-6).
- **Salida:** el producto se siente premium y coherente en las 41 pantallas.

---

# SECCIÓN 8 — AGENT WORK PACKAGES

> Paquetes de trabajo **independientes y ejecutables por separado**, alineados a la orquestación de [CLAUDE.md](CLAUDE.md). Cada paquete declara: alcance, entradas, entregables, fuera-de-alcance y criterio de aceptación. Los agentes no se llaman entre sí (delegación de un nivel); la sesión principal coordina.

## 8.1 UX Agent (`ux-ui`)

- **Alcance:** flujos, jerarquía de información y estados de experiencia **antes** de maquetar. Sección 3 (Experience Layer) y los flujos de §6.
- **Entradas:** UX_STRATEGY (§3 journeys, §4 flujos, §6 feedback), gaps UX de §1.2.
- **Entregables:** (1) Catálogo de estados de vista por audiencia (vacío/cargando/error/sin-permiso) como spec; (2) wireframes conceptuales del app shell agrupado (T-1), wizard de onboarding (UX-6), trazador del lazo (UX-1), confirmación de DTE (UX-4); (3) mapa de vocabulario usuario↔esquema (UX-11).
- **Fuera de alcance:** código, tokens visuales finales, copy literal.
- **Aceptación:** cada flujo crítico tiene una acción primaria inequívoca; cada vista declara sus 4 estados; navegación por capacidad respetada.

## 8.2 UI Agent (`frontend` con dirección de DESIGN_SYSTEM)

- **Alcance:** Fundaciones (Fase 1) y sistema visual de componentes (Fase 2). Gaps UI de §1.3 y §4.1.
- **Entradas:** DESIGN_SYSTEM (§3 motion, §9 inventario), `globals.css`, las 20 primitivas.
- **Entregables:** (1) `globals.css` con navy + tokens semánticos + motion + charts; (2) `Badge`/`Button`/`Input` extendidos; (3) catálogo navegable de componentes; (4) validación de contraste AA light/dark.
- **Fuera de alcance:** lógica de pantallas, server actions, backend.
- **Aceptación:** un botón primario se ve igual en las 41 pantallas; ningún componente usa valores mágicos; `traduccion-estados.ts` migrado a tokens; `prefers-reduced-motion` respetado.

## 8.3 Frontend Agent (`frontend`)

- **Alcance:** Layouts (Fase 3), flujos principales/secundarios (Fases 4–5), responsive (Fase 6), pulido (Fase 8). Componentes nuevos (Data Table, Form, Stepper, Empty State, Confirmación de dinero, Centro de avisos, BotonDescarga, Trazador del lazo).
- **Entradas:** wireframes del UX Agent, componentes del UI Agent, patrón obligado (Server Component + `"use client"` + `actions.ts`), `puede*()` de capacidades.
- **Entregables:** app shell agrupado; pantallas refactorizadas de §6 en orden de prioridad; PWA real (manifest+SW); limpieza de `(app)/` y conexión ML.
- **Fuera de alcance:** tocar reglas de negocio, jobs, RLS, contratos Inngest; replicar matriz de permisos; diseñar POD; introducir IA/ruteo.
- **Aceptación:** typecheck/lint/Vitest/pgTAP en verde por fase; gating RBAC intacto; verificación visual con datos demo en las 3 audiencias.

## 8.4 QA Agent (`qa`)

- **Alcance:** prevención de regresiones funcionales y de la experiencia. Énfasis en aislamiento multi-tenant y reglas de dinero (no se rompen al pulir).
- **Entradas:** suites existentes (645 Vitest, 195 pgTAP), §2.3 (matriz de regresiones), criterio "hecho" de §2.4.
- **Entregables:** (1) checklist de regresión por fase; (2) pruebas de gating RBAC con tokens de cada rol (interno/seller/conductor) tras el refactor de navegación; (3) verificación de cada descarga tras consolidar BotonDescarga; (4) verificación de contraste y `prefers-reduced-motion`; (5) candidato a **E2E de UI** (hoy inexistente, PRODUCT_BLUEPRINT).
- **Fuera de alcance:** implementar features.
- **Aceptación:** cero regresión funcional; aislamiento de datos verificado a nivel API/BD, no solo UI.

## 8.5 Copy Agent (`copywriter`)

- **Alcance:** microcopy de todos los estados de la Sección 3 y los flujos de dinero. Español de Chile, claro, sin jerga.
- **Entradas:** UX_STRATEGY §6, descripciones de roles, helpers de `lib/ui/`, decisión "in-app, sin email" (P6).
- **Entregables:** (1) copy de empty/error/success/loading states (reemplaza los placeholders de §3); (2) **copy de emisión/cierre de DTE y nota de crédito** con consecuencia escrita inequívoca de irreversibilidad; (3) copy de avisos in-app accionables; (4) vocabulario del usuario por audiencia.
- **Fuera de alcance:** prometer canales no implementados (email); copy que exponga tecnicismos de esquema.
- **Aceptación:** ningún texto promete email; cada error dice qué/por qué/qué hacer; cada éxito de dinero nombra objeto + resultado + magnitud; cada confirmación irreversible describe la consecuencia, no pregunta "¿estás seguro?".

---

## Cierre

Este plan **ejecuta** la estrategia y el sistema de diseño ya cerrados; no los reabre. El orden es deliberado: **cambiar los cimientos una vez, abajo (tokens), para que la identidad se propague sola hacia arriba (componentes → layout → flujos)** — así se minimiza el re-trabajo, y la suite verde por fase contiene la regresión. El backend está firme; el trabajo es **vestir con identidad y rigor de experiencia** un motor financiero que ya hace lo difícil. El éxito se mide en un solo sentimiento, en las tres audiencias: *acá los números cuadran y no tengo que revisarlos a mano.*

---

*Documento de implementación derivado de [PROJECT_AUDIT.md](PROJECT_AUDIT.md), [PRODUCT_BLUEPRINT.md](PRODUCT_BLUEPRINT.md), [UX_STRATEGY.md](UX_STRATEGY.md) y [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md). Estado verificado en código al 2026-06-13. Mantener al día conforme avanzan las fases.*

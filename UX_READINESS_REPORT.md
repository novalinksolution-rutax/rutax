# INFORME DE READINESS UX/UI/FRONTEND
## Dirección de Producto — SaaS Courier (Motor entrega→dinero)

> **Qué es este documento.** Evaluación ejecutiva de si el producto está listo para iniciar una fase seria de UX Design, UI Design, UX Writing, Design System y optimización de experiencia frontend, sin generar retrabajo importante posterior.
>
> **Fuente primaria.** [PROJECT_AUDIT.md](PROJECT_AUDIT.md) y [PRODUCT_BLUEPRINT.md](PRODUCT_BLUEPRINT.md), validados contra código (41 pantallas `page.tsx`, 20 componentes shadcn/ui, 3 documentos de flujos en [docs/ux/](docs/ux/), tokens de tema en [src/app/globals.css](src/app/globals.css)).
>
> **Fecha:** 2026-06-13 · **Rama:** master · **Pregunta que responde:** ¿Es el momento correcto para invertir en UX/UI/UX-Writing/Frontend, o falta madurez funcional?

**Veredicto en una línea:** **Sí, es el momento correcto.** El backend está firme, poblado y verificado E2E; el riesgo de retrabajo estructural es bajo. La inversión en UX/UI es la siguiente jugada lógica y de mayor ROI. Las restricciones son acotadas y resolubles en paralelo.

> **ESTADO: GO formal (2026-06-13).** Las 3 decisiones de dirección que condicionaban el arranque están cerradas (ver [BRIEF_DECISIONES_UX.md](BRIEF_DECISIONES_UX.md)):
> 1. **Notificaciones** → in-app ahora; email cuando se conecte Resend (el copy NO promete correo).
> 2. **Marca** → producto = **Rutax** (serio, versátil, inspira confianza); primario azul navy provisional sobre la base shadcn, a validar por el UI Lead.
> 3. **Recuperación de contraseña** → Supabase nativo ahora; UI propia post-pulido.
>
> Con esto, UX/UI, UX Writer y Frontend tienen luz verde para iniciar.

---

## FASE 1 — Madurez de producto

**Clasificación: MUY MADURO (conceptualmente) · 85/100 de madurez global.**

| Dimensión | Estado | Evidencia |
|---|---|---|
| Problema que resuelve | **Cristalino** | "Trastienda de dinero": brecha entre lo entregado y lo cobrado/liquidado. Diferenciador único y defendido (motor entrega→dinero, no ruteo). |
| Casos de uso | **Cristalino** | 11 casos principales + 14 secundarios, todos verificados en código (Blueprint §3). |
| Usuarios | **Cristalino** | 4 `tipo_usuario` macro, perfiles con objetivos/frustraciones/acciones documentados. |
| Roles | **Cristalino** | 7 roles con matriz `rol→capacidad` cerrada en código (`capacidades.ts`), no en suposiciones. |
| Funcionalidades | **Cristalino** | RF-001..RF-051 mapeados; lazo completo cierra E2E con datos demo. |

**Por qué "muy maduro" y no solo "maduro":** la definición no vive en un PRD aspiracional, vive **ejecutándose en código verificado** (645 tests unitarios + 195 pgTAP). El "qué" y el "para quién" no admiten ambigüedad. La única madurez incompleta es de *go-to-market* (proveedor DTE definitivo, modelo de suscripción) — irrelevante para arrancar UX/UI.

---

## FASE 2 — Evaluación de flujos

| Flujo | Estado | Riesgo UX | Riesgo Retrabajo |
|---|---|---|---|
| Onboarding del courier (DTE, folios, tarifas, cobranza) | ✅ Implementado | Medio | **Bajo** |
| Alta de sellers / conductores | ✅ | Bajo | Bajo |
| OAuth ML del seller + reconexión | ✅ | Medio | Bajo |
| Ingesta de pedidos (webhook + polling) | ✅ (sin UI propia) | Bajo | Bajo |
| Asignación + manifiestos | ✅ | Medio | Bajo |
| Estados + incidencias | ✅ | Medio | Bajo |
| Motor entrega→dinero (líneas cobro/liquidación) | ✅ | Bajo (es backend) | Bajo |
| Cierre de período → conciliación | ✅ | Medio | Bajo |
| **Aprobación + emisión DTE (compuerta humana)** | ✅ | **Alto** | **Medio** |
| Descarga factura (seller) | ✅ | Bajo | Bajo |
| Liquidación conductor | ✅ | Bajo | Bajo |
| Cobranza Fintoc | ✅ | Medio | Bajo |
| **Notificaciones (reconexión, folios, morosidad)** | 🟡 Solo bitácora | **Alto** | **Medio** |
| Recuperación de contraseña | ❔ No verificable | Medio | Bajo |
| Instalabilidad PWA conductor | ❔ No verificable | Medio | Bajo |

**Lectura:** la inmensa mayoría de flujos son **bajo riesgo de retrabajo** porque ya están implementados y poblados — UX/UI rediseña sobre una base que no se moverá bajo sus pies. Solo **dos flujos concentran el riesgo real**: (1) emisión DTE (irreversibilidad ante el SII exige copy y confirmaciones inequívocas) y (2) notificaciones (la lógica existe pero **no envía nada** — diseñar prometiendo "te avisaremos por correo" generaría retrabajo y rompería confianza).

---

## FASE 3 — UX Readiness

**¿Puede un UX Designer empezar hoy? → SÍ, con restricciones acotadas.**

| Elemento | Estado |
|---|---|
| Arquitectura de información | ✅ Definida y jerarquizada (Blueprint §8: 4 grupos de navegación) |
| Navegación | ✅ Existe, condicionada por capacidad RBAC (`barra-superior.tsx`) |
| Jerarquía | ✅ 3 audiencias con 3 lenguajes distintos (interno denso / seller tranquilizador / conductor mínimo) |
| Flujo principal | ✅ Lazo entrega→dinero documentado paso a paso |
| Flujos secundarios | ✅ Reconexión, backfill, NC, anulación documentados |
| Estados del sistema | 🟡 Enums traducidos (`traduccion-estados.ts`) pero **sin catálogo formal de empty/loading/error states** |
| Casos límite | 🟡 Existen en código, no catalogados para diseño |
| Errores | 🟡 Manejados en backend (42501, validación Zod); **sin inventario de estados de error de cara al usuario** |
| Confirmaciones | ✅ Diálogos críticos existen (cerrar/emitir/NC) |

**Restricciones (no bloqueantes):**
1. Hay flujos documentados (`docs/ux/fase-a/b/c`), pero son **flujos por fase, no una auditoría de IA consolidada ni un mapa de estados empty/error/loading**. El UX debe levantar ese inventario como primer entregable (no es bloqueo, es su trabajo).
2. Decidir el **tratamiento de notificaciones** antes de diseñar pantallas que las prometan.

---

## FASE 4 — UI Readiness

**¿Hay estabilidad funcional para diseñar wireframes/mockups/sistema visual/Design System? → SÍ.**

| Elemento | Estado |
|---|---|
| Consistencia de layouts | ✅ Patrón único App Router (Server Component + cliente + actions) en las 41 pantallas |
| Componentes | ✅ 20 primitivas shadcn/ui sobre Radix, todas con `cva` + `tailwind-merge` |
| Navegación | ✅ Estable |
| Formularios / Tablas / Modales / Dashboards | ✅ Todos existen y funcionan |
| **Tokens de diseño** | ✅ Cableados (`globals.css`, `@theme inline`, dark mode) **PERO** = default shadcn |
| **Identidad visual / marca** | ⛔ **No existe** — paleta en escala de grises pura (`oklch chroma 0`), sin color de marca, charts en grises |

**Hallazgo clave (nuevo, no explícito en el audit):** el sistema visual actual **es el default de shadcn sin marca**. Esto es, paradójicamente, una **buena noticia para arrancar**: no hay un sistema visual "equivocado" que deshacer (retrabajo ≈ 0); hay una **base técnica limpia y correctamente tokenizada** sobre la que construir identidad. El Design System no parte de cero técnico, parte de cero **visual** — que es exactamente lo que un UI/Design Lead debe definir.

---

## FASE 5 — UX Writing Readiness

**¿Hay suficiente contexto para empezar? → SÍ, con una restricción dura.**

| Zona de copy | Estado |
|---|---|
| Microcopy base | ✅ Existe en español de Chile a lo largo del código |
| Tooltips / confirmaciones | ✅ Diálogos críticos presentes |
| Empty states | 🟡 Parciales, sin inventario |
| **Mensajes de error** | ✅ Tono CL, pero sin guía unificada |
| **Notificaciones** | ⛔ **No prometer email/push** — Resend es un TODO, hoy solo se escribe en bitácora |
| Emails del sistema | ⛔ Plantillas no existen (pendiente Resend) |
| Onboarding | ✅ Mensajes existentes a revisar |

**Restricción dura (del propio Blueprint §14):** las zonas críticas son los **diálogos de emisión/cierre de DTE** (el copy debe dejar inequívoco que el DTE es irreversible ante el SII) y las **alertas de reconexión ML**. Y la regla de oro: **no escribir "te enviaremos un correo" hasta que Resend esté conectado.** El UX Writer puede empezar hoy por todo lo que es UI in-app; debe **posponer plantillas de email** hasta la decisión de proveedor.

---

## FASE 6 — Frontend Readiness

**¿Puede un Frontend Senior empezar sin riesgo importante de rehacer? → SÍ.**

| Elemento | Estado |
|---|---|
| Stack | ✅ Next.js 16 / React 19 / Tailwind 4 / shadcn — firme y documentado |
| Patrón de componentización | ✅ Establecido y consistente |
| Autorización en UI | ✅ Funciones `puede*()` — nunca replicar matriz |
| Responsive | ✅ Tailwind en toda la app |
| Design System | 🟡 Base sólida; falta formalizar tokens de marca |
| Accesibilidad | 🟡 Radix da base a11y; sin auditoría formal |
| **Deuda a saldar** | 5 `boton-descarga-*` a consolidar; grupo `(app)/` legado a limpiar; PWA manifest/SW a verificar |

El Frontend puede arrancar de inmediato. La deuda detectada es **menor y aislada** (no estructural): no condiciona el rediseño, se salda en paralelo.

---

## FASE 7 — Bloqueadores

### 🔴 CRÍTICOS (obligarían a rehacer UX/UI)
**Ninguno estructural.** No existe un sistema visual erróneo, ni una IA que contradiga el código, ni flujos por inventar. El backend no se moverá bajo el diseño. *Este es el hallazgo más importante del informe.*

### 🟡 IMPORTANTES (generan incertidumbre — resolver antes o muy temprano)
1. **Política de notificaciones** — ¿se conecta Resend antes de diseñar, o se diseña explícitamente "sin email"? Afecta copy y pantallas de alertas/reconexión.
2. **Identidad de marca / sistema visual** — no existe; debe definirse como primer entregable de UI (decisión de dirección, no bloqueo técnico).
3. **UX de emisión DTE real** — el opt-in (`emision_dte_real_habilitada`) es punto de no retorno; exige flujo de confirmación y copy a prueba de errores.
4. **Recuperación de contraseña** — definir si se diseña UI propia o se delega a Supabase.
5. **Instalabilidad PWA del conductor** — confirmar manifest/SW antes de prometer "instala la app".

### 🟢 MENORES (resolubles después)
- Consolidar 5 `boton-descarga-*` en `BotonDescarga`.
- Limpiar grupo `(app)/` legado.
- Catálogo formal de empty/loading/error states (entregable temprano del UX).

---

## FASE 8 — Scorecard

| Área | Score | Justificación |
|---|---|---|
| **Product Readiness** | **90/100** | Problema, usuarios, roles, casos de uso y funcionalidades cristalinos y verificados en código. Solo restan decisiones de GTM. |
| **UX Readiness** | **80/100** | IA, navegación y flujos definidos y documentados. Falta inventario formal de estados (empty/error/loading) y resolver política de notificaciones. |
| **UI Readiness** | **75/100** | Base técnica tokenizada y consistente, pero **sin identidad de marca** — el sistema visual está por crear (clean slate, sin retrabajo). |
| **UX Writing Readiness** | **75/100** | Tono CL presente, zonas críticas identificadas. Restricción dura: no prometer notificaciones; emails pendientes de Resend. |
| **Frontend Readiness** | **85/100** | Stack firme, patrones establecidos, deuda menor y aislada. Listo para componentizar y pulir. |
| **Overall Readiness** | **83/100** | Momento óptimo para invertir en UX/UI: máxima estabilidad funcional, mínimo riesgo de retrabajo. |

---

## FASE 9 — Veredicto

### UX/UI Designer → **SÍ** *(con restricciones menores)*
Puede empezar hoy por dashboard, portal del seller y PWA del conductor. Restricción: levantar primero el inventario de estados y resolver la política de notificaciones con dirección.

### UX Writer → **SÍ, con restricciones**
Empieza por todo el copy in-app (estados, confirmaciones, onboarding, diálogos DTE). **Pospone plantillas de email** hasta decidir proveedor; **no promete notificaciones** que aún no se envían.

### Frontend Developer → **SÍ**
Stack y patrones firmes. Arranca componentización, Design System y responsive; salda deuda menor (botones, `(app)/`) en paralelo.

---

## FASE 10 — Plan de acción

### Antes de UX/UI (decisiones de dirección — ✅ CERRADAS 2026-06-13)
1. ✅ **Política de notificaciones** → in-app ahora; email cuando se conecte Resend.
2. ✅ **Identidad de marca** → Rutax; primario azul navy provisional, a validar por el UI Lead.
3. ✅ **Recuperación de contraseña** → Supabase nativo ahora; UI propia post-pulido.

### En paralelo (semanas 1–3)
- **UX:** auditoría de IA consolidada + inventario de empty/loading/error states (primer entregable).
- **UI:** tokens de marca sobre la base shadcn ya cableada → Design System v1.
- **UX Writer:** copy in-app de las 3 audiencias; foco en diálogos DTE (irreversibilidad) y reconexión ML.
- **Frontend:** consolidar `BotonDescarga`, limpiar `(app)/`, verificar PWA manifest/SW.

### Después (post-pulido UX/UI)
- Plantillas de email reales (cuando Resend esté conectado).
- UX del opt-in de emisión DTE real (cuando se decida proveedor definitivo).
- Auditoría formal de accesibilidad.
- E2E de UI automatizados.

---

## RESULTADO FINAL — Recomendación a dirección

> **Sí, es el momento correcto para invertir en UX/UI.** De hecho, es el momento *ideal*.

La razón es estructural, no de optimismo: en la mayoría de proyectos el riesgo de invertir temprano en diseño es que el backend cambie y obligue a rehacer. **Aquí ese riesgo está neutralizado** — las Fases A/B/C están implementadas, pobladas y verificadas E2E (645 tests + 195 pgTAP, lazo entrega→dinero cerrado con datos demo). El diseño se construye sobre cimiento firme.

El producto tiene **madurez funcional alta (85/100) y madurez visual baja (sistema default sin marca)** — exactamente el perfil donde la inversión en UX/UI rinde más: hay sustancia que vestir y nada que deshacer. No existe ningún bloqueador crítico que obligue a rehacer trabajo de diseño; los importantes son **3–4 decisiones de dirección** que se toman en una semana y se resuelven en paralelo al arranque.

**Recomendación:** activar UX/UI, UX Writer y Frontend de inmediato, condicionado a cerrar en la primera semana las decisiones de (1) notificaciones, (2) identidad de marca y (3) recuperación de contraseña. No esperar a observabilidad/respaldos/DTE-real: esos son bloqueantes de *producción*, no de *diseño*, y corren en un carril independiente (devops).

---

*Informe derivado de [PROJECT_AUDIT.md](PROJECT_AUDIT.md) y [PRODUCT_BLUEPRINT.md](PRODUCT_BLUEPRINT.md), validado contra código. Mantener al día tras decisiones de dirección o cambios estructurales.*

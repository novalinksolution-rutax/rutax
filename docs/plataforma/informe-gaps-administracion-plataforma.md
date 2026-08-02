# Informe de gaps de administración de plataforma (backstage Rutax)

> **Qué es esto.** El área `/admin` y el módulo `plataforma` son el *backstage* de Rutax (Rutax→courier): planes, suscripciones, cobros y salud. Distinto del módulo `dinero` (courier→seller). Hoy el backstage cubre lo básico (suscripciones, cobro por link Fintoc, salud de jobs), pero le faltan capacidades para **operar la plataforma como negocio y gobernarla con seguridad**. Este informe **identifica** esos gaps y propone un **plan por fases**; salvo el solape con suscripciones (MRR/ARR, item L), **no se implementan aquí** — el dueño decide qué construir y cuándo.
>
> **Origen.** Fase 0 del trabajo de suscripciones (jul 2026). Insumos: análisis de `arquitecto` (arquitectura del backstage) y `seguridad-cumplimiento` (gobernanza, secretos, cumplimiento). Estado del cimiento verificado directamente sobre el código.
>
> **Fases.** **F1** = habilitar cobro real / no perder plata / cerrar riesgo de gobernanza mínimo · **F2** = operación diaria del backstage y monetización · **F3** = madurez y escala.

---

## Resumen ejecutivo (prioridad)

| # | Gap | Impacto | Esfuerzo | Fase | Por qué importa |
|---|-----|:-------:|:--------:|:----:|-----------------|
| 3 | **Super-admins con identidad real** | Alto | Alto | **F1→F3** | Hoy toda acción de plataforma es **anónima** en la bitácora (`actorUsuarioId = null`). Rompe el espíritu de RNF-04 ("quién"). Deuda de gobernanza #1. |
| 8 | Opt-in de DTE real por courier desde admin | Alto | Bajo | **F2** | Hoy se cambia por SQL manual; debe ser acción auditada con el gate humano. Columna y gate ya existen. |
| 5 | Visor de bitácora de auditoría (plataforma) | Alto | Bajo-Med | **F2** | La bitácora ya se **escribe** pero no se **lee** desde el admin. Quick win de cumplimiento. |
| 1 | Gestión de couriers/tenants (panel + offboard) | Alto | Medio | **F2** | No hay vista "todos mis couriers + estado + salud" ni acciones de provisión/suspensión/offboard. |
| 2 | Dashboard de negocio ampliado | Alto | Medio | **F2/F3** | MRR/ARR barato (item L, F1/F2); GMV, pedidos, DTEs, conductores exigen agregación cross-schema cuidada. |
| 6 | Feature flags / entitlements por courier | Alto | Medio | **F2** | Monetización + enforcement (item G). Base = `obtenerEntitlementsTenant`; faltan overrides. |
| 9 | Observabilidad por-tenant (drill-down) | Alto | Med-Alto | **F2/F3** | Extender salud/telemetría ya existentes a un drill-down por courier (salud ML, backlog, errores). |
| 4 | Impersonation / soporte auditado | Med-Alto | Alto | **F3** | Soporte real necesita "ver como el courier", con auditoría estricta. Depende de (3). |
| 7 | Comunicaciones a couriers | Medio | Medio | **F3** | Banner in-app + email de mantención/novedades. Reusa `src/lib/avisos/`. |

---

## Detalle por gap

### (3) Super-admins con identidad real — *la mayor deuda de gobernanza*
- **Hoy.** El acceso a `/admin` es un **secreto compartido** (`SUPER_ADMIN_SECRET`), sesión por cookie HMAC. Toda acción del backstage (`acciones.ts`, `cobro.ts`) registra en bitácora con `actorTipo: 'super_admin'` pero **`actorUsuarioId: null`** — no hay "quién" real.
- **Propuesta.** Usuarios `super_admin` **nombrados** con sesión Supabase real (el tipo `super_admin` ya existe en el JWT y en `capacidades.ts`), reemplazando gradualmente el secreto compartido. La bitácora pasa a llevar el UUID real del admin. Roles del equipo (admin total vs. soporte de solo lectura), **2FA** (Supabase Auth MFA), y "quién hizo qué" auditable a nivel plataforma.
- **Impacto.** Alto y prioritario (gobernanza/cumplimiento). **Esfuerzo.** Alto (provisioning + refactor de `verificarAdminSecret`/`sesion-admin.ts` con transición sin romper las acciones que hoy exigen `adminSecret`). **Dependencias.** Ninguna dura; habilita (4) y (8). **Fase.** F1 *parcial* (darle **nombre** al actor en la bitácora cuanto antes) → F3 (2FA, roles finos).

### (8) Gestión del opt-in de DTE real por courier desde el admin
- **Hoy.** `identidad.courier_config_dte.emision_dte_real_habilitada` (default `false`) se cambia por SQL/manual. La columna y el gate ya existen; falta la superficie.
- **Propuesta.** Acción de admin **auditada** (service_role + bitácora) para habilitar/deshabilitar DTE real por courier. **Sigue exigiendo** la revisión de `seguridad-cumplimiento` del proyecto: el admin *habilita*, nunca auto-emite.
- **Impacto.** Alto. **Esfuerzo.** Bajo. **Dependencias.** Idealmente (3) para saber *quién* habilitó. **Fase.** F2.

### (5) Visor de bitácora de auditoría a nivel plataforma
- **Hoy.** `bitacora_auditoria` es append-only y ya se escribe en todo el sistema, pero **no se lee** desde `/admin`.
- **Propuesta.** Lectura service_role con filtros por tenant / acción / fecha / actor.
- **Impacto.** Alto (cumplimiento). **Esfuerzo.** Bajo-medio. **Dependencias.** Ninguna dura. **Fase.** F2. *Quick win.*

### (1) Gestión de couriers/tenants (panel + salud + provisión/suspensión/offboard)
- **Hoy.** El alta de tenant vive en `onboarding.ts` (service_role) sin panel unificado. No hay vista "todos mis couriers + estado + salud".
- **Propuesta.** Panel que reusa `consultas.ts`/`obtenerTodasSuscripciones` + salud por-tenant + acciones de provisión/suspensión/**offboard**.
- **Impacto.** Alto. **Esfuerzo.** Medio. **Dependencias.** Offboard toca RLS/**retención de datos financieros** (nunca borrar bitácora ni respaldos). **Fase.** F2.

### (2) Dashboard de negocio ampliado
- **Hoy.** Solo existe `scripts/metricas-plataforma.sql`. MRR/ARR se implementa como parte de suscripciones (item L).
- **Propuesta.** MRR, ARR, couriers por estado, churn, ingresos del mes, morosidad (item L, **barato**, se deriva de `suscripciones`+`planes` y se alimenta realtime del evento `plataforma/pago.confirmado`). **Ampliado:** GMV procesado, pedidos, DTEs emitidos, conductores activos — exige agregación cross-schema (`operacion`/`dinero`) vía service_role, **solo agregados**, nunca fila de un tenant sin justificación auditada.
- **Impacto.** Alto (decisiones del dueño). **Esfuerzo.** Medio. **Dependencias.** Eventos D3. **Fase.** F2 (MRR/ARR) / F3 (GMV completo).

### (6) Feature flags / entitlements por courier ligados al plan
- **Hoy.** `limite_pedidos_mes` y `caracteristicas` (`conductores_max`, `api_publica`, `webhooks`) **no se aplican**.
- **Propuesta.** Base = contrato `obtenerEntitlementsTenant` (ver enforcement, item G). Añadir **overrides por-tenant** (`suscripciones.caracteristicas_override jsonb`) para habilitar una feature fuera del plan sin cambiar de plan.
- **Impacto.** Alto (monetización + enforcement). **Esfuerzo.** Medio. **Dependencias.** Enforcement (item G). **Fase.** F2.

### (9) Observabilidad por-tenant (drill-down)
- **Hoy.** Existen telemetría de jobs (`verificar-salud.ts`) y `/admin/salud` global; falta el **drill-down por courier**.
- **Propuesta.** Salud de conexiones ML, backlog de `operacion` y errores por tenant, sobre la telemetría ya existente.
- **Impacto.** Alto (operar + prevenir churn). **Esfuerzo.** Medio-alto. **Dependencias.** Reusa lo ya construido. **Fase.** F2/F3.

### (4) Impersonation / soporte auditado
- **Propuesta.** "Ver como el courier" a través de una función service_role **auditada** (bitácora con actor real + tenant impersonado + motivo), nunca un bypass de RLS silencioso.
- **Impacto.** Medio-alto. **Esfuerzo.** Alto y **sensible**. **Dependencias.** (3) primero (necesitas identidad real del admin para auditar la impersonation). **Fase.** F3.

### (7) Comunicaciones a couriers (mantención, novedades, avisos)
- **Propuesta.** Banner in-app en `(tenant)` + email; reusar `src/lib/avisos/`.
- **Impacto.** Medio. **Esfuerzo.** Medio. **Dependencias.** Ninguna dura. **Fase.** F3 (o F2 si se prioriza el aviso de mantención).

---

## Nota de cumplimiento (seguridad-cumplimiento)

- **Datos personales.** El módulo `plataforma` trata al courier como **persona jurídica** (facturación de la empresa); su exposición directa a la **Ley 21.431** es marginal (el peso recae en `operacion`/`identidad`, datos de conductores/destinatarios). El diseño ya evita arrastrar PII operativa a `plataforma`.
- **Ley 21.719** (protección de datos, plena vigencia **1-dic-2026**): incluso en facturación B2B hay algún dato personal (contacto/representante legal del courier). Dirección: minimización, base de licitud = ejecución del contrato de suscripción, y un **DPA / contrato de encargo** que respalde a Rutax como *encargado de tratamiento* por la PII operativa del resto del sistema. No bloqueante para este módulo, pero conviene tenerlo antes de dic-2026.
- **Prohibición dura.** Ninguna vista `public.*` sobre tablas `plataforma` (elude el deny-all vía PostgREST). Cualquier migración futura que la introduzca debe rechazarse o forzar `security_invoker=true`.

---

## Cómo se conecta con el trabajo de suscripciones (en curso)

- **Item L (MRR/ARR)** se implementa **ahora** porque es núcleo para operar suscripciones (solapa con el gap 2). El resto del dashboard de negocio (GMV/DTEs/conductores) queda como F2/F3.
- El **enforcement de entitlements** (item G) crea el contrato `obtenerEntitlementsTenant`, que es la base del gap 6.
- Los **eventos nuevos** (`plataforma/pago.confirmado`, etc.) alimentan el MRR realtime del gap 2.
- La **identidad real de super-admins** (gap 3) conviene empezarla dándole *nombre* al actor en la bitácora de las acciones que se toquen durante suscripciones, aunque el 2FA/roles finos queden en F3.

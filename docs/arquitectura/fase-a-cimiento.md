# Fase A · Cimiento — modelo de datos multi-tenant y esquema de RLS de alto nivel

> Documento de decisión arquitectónica. Define el "cómo encaja" (tablas, relaciones, alcances de acceso, contratos entre módulos). Las migraciones SQL y las políticas RLS exactas las escribe `base-datos-rls`; la lógica de servidor y jobs, `backend`/`integraciones`.

Alcance: cubre exactamente lo que pide el roadmap de Fase A — multi-tenant + RLS, RBAC, onboarding del courier (certificado + DTE + folios), tarifas, OAuth del seller. No se diseñan aquí entidades de Fase B (pedidos, manifiestos, incidencias) ni de Fase C (líneas de cobro/liquidación, conciliación, facturas) más allá de las referencias mínimas que el cimiento debe dejar listas para no migrar dos veces.

---

## 1. Principio rector

**Una sola columna decide quién ve qué filas: `tenant_id`, y dentro del tenant, `seller_id` o `driver_id` cuando aplique.** Todo el esquema de RLS de Fase A (y de las fases siguientes) se reduce a tres capas de filtro en cascada:

1. **Capa tenant** (obligatoria en toda tabla de negocio): la fila pertenece al courier `tenant_id`.
2. **Capa seller** (en tablas que el seller puede consultar): además del tenant, la fila pertenece al `seller_id` del usuario-seller autenticado.
3. **Capa conductor** (en tablas que el conductor puede consultar): además del tenant, la fila pertenece al `driver_id` del usuario-conductor autenticado.

**Regla de diseño que más impacta el resto:** toda tabla que un seller o conductor pueda llegar a leer necesita, además de `tenant_id`, una columna `seller_id`/`driver_id` (FK, normalmente denormalizada) que permita aplicar la segunda capa sin joins complejos. Si una tabla de Fase B/C no la respeta, las políticas RLS se vuelven lentas o difíciles de razonar.

---

## 2. Cómo se modela el tenant

- El **tenant es el courier**. Modelo plano: 1 fila en `tenants` = 1 empresa courier = 1 suscripción. No hay jerarquías de tenant.
- `tenants` vive en **identidad**; es la raíz de la que cuelga todo `tenant_id`.
- El **super-admin de plataforma** (el fundador) NO es un tenant ni pertenece a uno: rol de plataforma aparte, con acceso de soporte limitado y auditado (§8.3).

### Tabla `tenants`
| Columna | Nota |
| --- | --- |
| `id` (PK) | uuid |
| `nombre_fantasia`, `razon_social`, `rut` | texto, RUT validado |
| `estado` | enum: `activo` / `suspendido` / `onboarding` |
| `plan_id` | simple (enum/texto) — no sobre-diseñar facturación de plataforma en Fase A |
| `zona_horaria` | default `America/Santiago` |
| `creado_en`, `actualizado_en` | timestamps |

No lleva `tenant_id` (es la raíz). Toda tabla de negocio de aquí en adelante: `tenant_id uuid not null references tenants(id)`.

---

## 3. Identidad de usuarios y su relación con Supabase Auth

**Decisión:** Supabase Auth gestiona identidad técnica (login, password, sesión); el esquema de negocio gestiona identidad de dominio (tenant, rol, y si además es seller o conductor). No duplicar lo que Supabase resuelve bien.

### Tabla `usuarios_perfil` (1:1 con `auth.users`)
| Columna | Nota |
| --- | --- |
| `id` (PK, FK) | uuid = `auth.users.id` |
| `tenant_id` | FK a `tenants` — **nulo solo para super-admin** |
| `nombre_completo` | texto |
| `tipo_usuario` | enum: `interno` / `seller` / `conductor` / `super_admin` |
| `seller_id` | FK a `sellers`, nulo salvo `tipo_usuario='seller'` |
| `driver_id` | FK a `conductores`, nulo salvo `tipo_usuario='conductor'` |
| `rol` | enum (ver §4) |
| `estado` | enum: `activo` / `invitado` / `suspendido` |
| `creado_en`, `actualizado_en` | timestamps |

`tipo_usuario` + `seller_id`/`driver_id` es la pieza que permite resolver, para cualquier usuario autenticado, su tenant y (si corresponde) su seller o conductor — la base de toda política RLS posterior.

**Propagación a claims del JWT:** en login (o vía *custom access token hook* de Supabase Auth) se inyectan `tenant_id`, `tipo_usuario`, `seller_id`, `driver_id` leídos de `usuarios_perfil`. Las políticas RLS leen `auth.jwt() ->> 'tenant_id'`, etc., en vez de hacer subselect por fila — más simple y rápido. `base-datos-rls` decide el mecanismo exacto, pero este es el contrato de datos que debe resolver.

---

## 4. RBAC — roles y permisos

### Decisión: enum acotado, no tabla de permisos genérica

El levantamiento (§4, RF-002) define un conjunto **cerrado y pequeño**: `super_admin`, `dueno`, `supervisor`, `coordinador`, `administracion`, `conductor`, `seller`. No hay indicio de que el courier necesite roles a medida en el MVP. Una tabla `roles` + `permisos` + `rol_permiso` sería sobre-ingeniería: más superficie que operar y más casos de prueba RLS sin un dolor real que lo justifique.

**Decisión:** `rol` como **columna enum** en `usuarios_perfil`. Los permisos por rol viven **en código** (mapa `rol → capacidades` en el módulo `identidad`), no en tablas. Cambiar qué puede hacer un `coordinador` es un cambio de código + deploy — suficiente para equipos de 1-3 personas por courier, y coherente con "poco que operar".

```
usuarios_perfil.rol  enum (
  'super_admin', 'dueno', 'supervisor', 'coordinador',
  'administracion', 'conductor', 'seller'
)
```

**Contrato:**
- `identidad` es dueño de `rol` y del mapa rol→capacidades; expone utilidades (p. ej. `puedeAprobarFacturacion(usuario)`) que `dinero`/`operacion`/`frontend` consultan — nunca replicar la matriz en otros módulos.
- **RLS solo distingue, en la mayoría de tablas, "interno" vs. "seller" vs. "conductor"**. Las distinciones finas entre `dueno`/`supervisor`/`coordinador`/`administracion` son **reglas de aplicación verificadas en backend** (RNF-03), no políticas RLS por rol — evita un enredo de políticas SQL por cada combinación rol×tabla.

### Invitaciones (RF-005, RF-010)

### Tabla `invitaciones`
| Columna | Nota |
| --- | --- |
| `id`, `tenant_id` | uuid, FK |
| `email` | texto |
| `tipo_usuario`, `rol`, `seller_id`/`driver_id` | igual semántica que en `usuarios_perfil` |
| `token` | único, un solo uso |
| `estado` | enum: `pendiente`/`aceptada`/`expirada`/`revocada` |
| `expira_en`, `creado_en` | timestamps |

Un solo mecanismo cubre invitación interna (RF-005), onboarding del seller (RF-010) y, a futuro, del conductor.

---

## 5. Onboarding del courier: certificado digital, proveedor DTE y folios

Aplica la skill `chile-dte`: el courier emite bajo su propio RUT; nosotros orquestamos vía proveedor certificado. El modelo solo guarda configuración y referencias; la emisión vive en `integraciones` (adaptador) y `dinero` (Fase C).

### Tabla `courier_config_dte` (1:1 con `tenants`)
| Columna | Nota |
| --- | --- |
| `tenant_id` (PK, FK) | uuid |
| `proveedor_dte` | identifica el adaptador (`simplefactura`, `openfactura`, …) |
| `proveedor_credenciales_ref` | **referencia opaca** al secreto cifrado (nunca el valor aquí) |
| `certificado_digital_ref` | idem, referencia opaca |
| `certificado_vence_en` | fecha — para alertar antes de expirar |
| `estado_certificacion` | enum: `pendiente`/`en_proceso`/`activo`/`con_problemas` |
| `creado_en`, `actualizado_en` | timestamps |

### Tabla `folios_caf`
| Columna | Nota |
| --- | --- |
| `id`, `tenant_id` | uuid, FK |
| `tipo_documento` | código SII (33 = factura, 61 = nota de crédito, …) |
| `folio_desde`, `folio_hasta`, `folio_actual` | enteros |
| `archivo_caf_ref` | referencia opaca a archivo cifrado en Storage |
| `estado` | enum: `vigente`/`agotado`/`vencido` |
| `creado_en`, `actualizado_en` | timestamps |

> **Nota de alcance:** si el proveedor DTE elegido **gestiona los folios por el courier** (skill `chile-dte` señala que varios lo hacen), esta tabla puede reducirse a un espejo de solo-lectura, o posponerse. Se incluye porque RF-008 la nombra explícitamente, pero **`integraciones` debe validar con el proveedor elegido** si esta tabla la llenamos nosotros o se sincroniza desde allá, antes de que `base-datos-rls` la migre con todas sus columnas.

### 5.1 Patrón común para secretos (certificados y tokens)

**Build vs. integrar:** no construimos un "secrets manager" propio (más infraestructura que operar — justo lo que se evita). En su lugar:

- Los **valores cifrados** (certificado `.pfx`, credenciales DTE, tokens OAuth ML) van en una **tabla separada de los datos de negocio** — p. ej. `secretos_cifrados` — o en **Supabase Storage cifrado** si son archivos. Esa tabla/almacenamiento tiene su propia política RLS, más restrictiva (roles internos `dueno`/`administracion`, nunca `seller`/`conductor`).
- Las tablas de configuración (`courier_config_dte`, `conexiones_seller_ml`) **solo guardan una referencia opaca** (`*_ref`), nunca el valor. Una fuga de la tabla de negocio no expone el secreto, y el cifrado/descifrado queda concentrado donde `seguridad-cumplimiento` puede auditarlo.
- Quién cifra/descifra: una utilidad central en `integraciones` (o capa compartida que solo `integraciones`/jobs consumen), con clave gestionada (Supabase Vault o equivalente — integrar, no construir gestión de claves propia).

Esto resuelve a la vez RNF-02 (cifrado, fuera de logs) y "nunca en URLs": si el valor nunca llega a una tabla de negocio ni a una respuesta normal de API, es estructuralmente difícil que termine en un log.

---

## 6. Tarifas (insumo del motor entrega→dinero)

RF-009: tarifas "por seller, por tipo de entrega y/o zona". Nace en Fase A; el motor que la consume nace en Fase C — pero el modelo debe ser correcto desde ahora (migrar dos veces es más caro).

### Tabla `tarifas`
| Columna | Nota |
| --- | --- |
| `id`, `tenant_id` | uuid, FK — la define el courier |
| `seller_id` | FK a `sellers`, **nulo = tarifa por defecto del tenant**; con valor = override específico |
| `tipo_entrega` | enum: `flex`/`same_day` (extensible) |
| `zona` | texto/código de comuna; nulo = todas las zonas |
| `modo_calculo` | enum: `monto_fijo`/`por_zona` (no diseñar lo que no se pide aún) |
| `monto_clp` | entero (CLP sin decimales — evita `numeric` innecesario) |
| `vigente_desde`, `vigente_hasta` | fechas — **versiona** tarifas sin perder histórico |
| `estado` | enum: `activa`/`inactiva` |
| `creado_en`, `actualizado_en` | timestamps |

**Por qué tabla independiente con vigencia, y no columna en `sellers`:** (a) RF-009 ya pide variar por tipo y zona — una columna no alcanza; (b) el motor entrega→dinero (Fase C, RF-030) necesita reconstruir "qué tarifa aplicaba el día de esta entrega", no solo la vigente hoy. Diseñarlo ahora con `vigente_desde/hasta` evita una migración dolorosa en Fase C.

**Resolución de tarifa aplicable** (regla para `dinero`/Fase C, documentada aquí para no re-derivarla): buscar primero fila con `seller_id` del pedido + `tipo_entrega`/`zona` coincidentes y vigente a la fecha de la entrega; si no existe, caer a la fila con `seller_id` nulo (default del tenant) con los mismos criterios.

---

## 7. OAuth del seller con Mercado Libre

Aplica la skill `flex-ml`. Separar **quién es el seller** (entidad de negocio estable) de **su conexión OAuth** (token, salud — cambia constantemente).

### Tabla `sellers`
| Columna | Nota |
| --- | --- |
| `id`, `tenant_id` | uuid, FK — el seller es cliente del courier |
| `razon_social`, `rut`, `nombre_contacto`, `email_contacto` | texto |
| `estado` | enum: `invitado`/`activo`/`suspendido` |
| `creado_en`, `actualizado_en` | timestamps |

### Tabla `conexiones_seller_ml`
1:1 (el levantamiento dice "cuenta principal", singular — se parte 1:1, se amplía solo si aparece necesidad real):

| Columna | Nota |
| --- | --- |
| `id`, `tenant_id` | uuid; `tenant_id` **denormalizado** desde `sellers` |
| `seller_id` | FK única a `sellers` |
| `ml_user_id` | id de la cuenta ML |
| `access_token_ref`, `refresh_token_ref` | referencias opacas al secreto cifrado (nunca el token aquí) |
| `token_expira_en` | timestamp — para el job de refresco (RF-012) |
| `estado_salud` | enum: `sana`/`atencion`/`desvinculada`/`pendiente` (RF-013) |
| `ultima_sync_exitosa_en`, `desconectada_desde` | timestamps — el segundo apoya el backfill (RF-017) sin tabla aparte |
| `ultimo_error` | texto corto, sin datos sensibles |
| `creado_en`, `actualizado_en` | timestamps |

**Por qué `tenant_id` denormalizado aquí:** es la regla de §1 — toda tabla que el seller pueda leer (su propio estado de conexión, portal del seller RF-048) necesita `tenant_id` directo para que la política de capa-tenant no dependa de un subselect. Denormalización deliberada y barata (FK + trigger, o exigir consistencia al insertar); `base-datos-rls` decide el mecanismo, el contrato es que la columna esté presente y consistente.

No se propone una tabla `eventos_backfill` aparte en Fase A — el campo `desconectada_desde` basta para que Fase B implemente el backfill sin tocar el esquema. Diseñar más sería anticipar detalles que Fase B aún no especifica.

---

## 8. Esquema de RLS de alto nivel

Guía conceptual para `base-datos-rls`; las políticas SQL exactas (USING/WITH CHECK, claims vs. roles de Postgres, etc.) son su implementación.

### 8.1 Las tres políticas-tipo

| Tipo | Condición conceptual | Se aplica a |
| --- | --- | --- |
| **P1 — tenant** | `fila.tenant_id = claim.tenant_id` | Toda tabla de negocio, sin excepción — base que nunca se omite |
| **P2 — seller** | P1 **y** (`claim.tipo_usuario != 'seller'` **o** `fila.seller_id = claim.seller_id`) | `sellers`, `conexiones_seller_ml`, y en fases siguientes: pedidos, incidencias, DTE recibidos, estado de cuenta |
| **P3 — conductor** | P1 **y** (`claim.tipo_usuario != 'conductor'` **o** `fila.driver_id = claim.driver_id`) | `conductores`, y luego: asignaciones, manifiestos, su liquidación |

P2/P3 están escritas como "si no eres seller/conductor, no te restringe" — así el mismo conjunto de políticas sirve al usuario interno (ve todo su tenant) y al seller/conductor (solo lo suyo). Implementar como política compuesta o separadas por rol es decisión de `base-datos-rls`.

**Escritura (`INSERT`/`UPDATE`/`DELETE`):** en Fase A, ningún seller/conductor escribe directo sobre tablas internas (`tarifas`, `courier_config_dte`, `folios_caf`, `usuarios_perfil` ajeno). Lo más simple y seguro: **`SELECT` amplio bajo P1+P2/P3, escritura restringida a roles internos**, y lo que requiera validación compleja pasa por backend con `service_role` (bypassa RLS de forma controlada y deliberada — nunca como atajo general).

### 8.2 Mapa tabla → política (Fase A)

| Tabla | P1 | P2 | P3 | Nota |
| --- | --- | --- | --- | --- |
| `tenants` | — (raíz) | — | — | Cada tenant ve solo su fila (`id = claim.tenant_id`); super-admin vía rol de servicio auditado, no claim de tenant |
| `usuarios_perfil` | Sí | Solo su propia fila (`id = auth.uid()`) | Igual | Internos ven el listado de su tenant; seller/conductor solo la propia |
| `invitaciones` | Sí | No (se resuelven por token, fuera de RLS normal) | No | Gestión solo `dueno`/roles internos con permiso |
| `courier_config_dte` | Sí | **No** | **No** | Solo `dueno`/`administracion` |
| `folios_caf` | Sí | **No** | **No** | Dato puramente interno/tributario |
| `secretos_cifrados` | Sí | **No** | **No** | La más restrictiva — idealmente solo accedida vía `service_role`, ni expuesta por API normal |
| `tarifas` | Sí | **No** (el seller no ve montos pactados; ve su factura final en Fase C) | No aplica | Roles internos con permiso financiero; escritura probablemente fuera del alcance de `coordinador`/`supervisor` (regla de aplicación) |
| `sellers` | Sí | Sí — su propia fila | No aplica | Internos ven todos los de su tenant |
| `conexiones_seller_ml` | Sí | Sí — su propia conexión (RF-048 reconectar) | No aplica | Escritura de tokens/salud: solo jobs/`service_role`; el seller *inicia* reconexión vía acción de servidor, no edita la fila |
| `conductores` | Sí | No aplica | Sí — su propia fila | Internos ven todos los de su tenant |

`bitacora_auditoria`: ver §10 (P1 estricta, visible solo a roles internos con permiso).

### 8.3 El caso del super-admin

El super-admin **no tiene `tenant_id`**. El levantamiento exige que su acceso a datos de negocio sea "limitado y auditado" — no es "ver todos los tenants libremente". **Decisión:** no se le da una política RLS de bypass general. Sus operaciones (alta/suspensión de tenants, soporte) pasan por **funciones de servidor con `service_role`** que registran cada acceso en la bitácora. Es más simple de razonar y más seguro que mantener una política "si eres super-admin, ves todo": evita que un bug de claim convierta a cualquiera en super-admin de facto.

---

## 9. Dónde vive `conductores` (límite con `operacion`)

El levantamiento ubica al conductor con permisos propios desde el día 1 (RBAC), pero su gestión operativa llega en Fases B/C. **Decisión:** `conductores` (identidad mínima: nombre, RUT, tipo de relación Ley 21.431, estado, vínculo a `usuarios_perfil`) nace en **Fase A dentro de `identidad`**, porque RBAC y `usuarios_perfil.driver_id` la necesitan como FK desde el día 1. Lo operativo (rutas, disponibilidad) y financiero (liquidaciones) se agregan en sus fases como columnas/tablas que referencian esta misma fila — **no se crea una segunda tabla "conductor" en `operacion` ni en `dinero`**.

### Tabla `conductores` (mínima, Fase A)
| Columna | Nota |
| --- | --- |
| `id`, `tenant_id` | uuid, FK |
| `nombre_completo`, `rut` | texto |
| `tipo_relacion` | enum: `dependiente`/`independiente` (Art. 7, Ley 21.431 — se registra, no se infiere) |
| `estado` | enum: `activo`/`inactivo` |
| `creado_en`, `actualizado_en` | timestamps |

Contrato resultante: **`identidad` es dueño de "quién es"; `operacion` de "qué hace"; `dinero` de "cuánto se le paga"**. Los tres referencian `conductores.id`, ninguno la duplica.

---

## 10. Bitácora de auditoría

RF-004/RNF-04 son P0 — no es razonable diseñar el cimiento sin esta tabla.

### Tabla `bitacora_auditoria`
| Columna | Nota |
| --- | --- |
| `id` | uuid/bigserial |
| `tenant_id` | FK; nulo solo para acciones de plataforma (alta de tenant, soporte super-admin) |
| `actor_usuario_id`, `actor_tipo` | quién (`usuario`/`sistema`/`super_admin`); nulo si lo hizo un job |
| `accion` | código (p. ej. `tarifa.creada`, `certificado.cargado`, `usuario.rol_cambiado`, `conexion_ml.reconectada`) |
| `entidad_tipo`, `entidad_id` | qué fila se afectó |
| `detalle` | jsonb — **sin secretos ni tokens, regla dura** |
| `creado_en` | timestamp inmutable |

**Decisión:** tabla **append-only** (sin `UPDATE`/`DELETE`, ni para `dueno` — solo `INSERT` desde funciones de servidor). RLS: P1 estricta, visible para `dueno`/`administracion`, nunca `seller`/`conductor`. Vive en `identidad` (o un módulo transversal `auditoria`) — **una sola tabla**, no una por módulo: fragmentarla rompe la trazabilidad y multiplica lo que hay que operar.

---

## 11. Contratos entre módulos que este cimiento establece

| Módulo | Dueño de (Fase A) | Expone | Consume |
| --- | --- | --- | --- |
| **identidad** | `tenants`, `usuarios_perfil`, `invitaciones`, `sellers` (identidad básica), `conductores` (identidad básica), `bitacora_auditoria`, mapa rol→capacidades, claims JWT | Resolución de "quién es este usuario"; utilidades de permiso; registro en bitácora | — |
| **dinero** | `courier_config_dte`, `folios_caf`, `tarifas` | Configuración tributaria; función de tarifa aplicable (Fase C) | `sellers` (de identidad), estados de entrega (de operación, Fase C) |
| **integraciones** | adaptadores/puertos DTE y ML; `conexiones_seller_ml`; mecanismo de cifrado/descifrado de secretos | Estado de salud de conexión; tokens descifrados solo a jobs autorizados | `sellers`, `courier_config_dte`/`folios_caf` |
| **operacion** | (Fase B — sin tablas propias en Fase A) | — | `conductores`, `sellers` como FKs futuras |

**Reglas de límite que se fijan ahora:**
1. Nadie fuera de `identidad` escribe en `usuarios_perfil`, `tenants` ni `bitacora_auditoria` directamente — todo vía funciones que ese módulo expone.
2. Nadie fuera de `integraciones` llama a la API de ML o al proveedor DTE, ni descifra un secreto por su cuenta — siempre a través del adaptador/puerto.
3. `tarifas` es de `dinero` (insumo de su motor), aunque la UI de captura viva en "configuración del courier".
4. `conductores` e identidad básica de `sellers` son de `identidad`; `operacion`/`dinero` los referencian, nunca los duplican.

---

## 12. Siguientes pasos concretos (orden de implementación)

1. **`base-datos-rls`** — inicializar proyecto Supabase + CLI de migraciones; cargar skill `multitenant-rls`.
2. **`base-datos-rls`** — migración 1: `tenants`, `usuarios_perfil` (enums `tipo_usuario`/`rol`/`estado`), `invitaciones`. Define el mecanismo de claims (custom access token hook u otro) que resuelve `tenant_id`/`tipo_usuario`/`seller_id`/`driver_id` al JWT — **esto bloquea todo lo demás**; pruébalo con un tenant de prueba antes de seguir.
3. **`base-datos-rls`** — migración 2: `sellers`, `conductores`. Activa RLS y políticas P1/P2/P3 sobre estas + `usuarios_perfil`. Escribe ya las pruebas de aislamiento de la skill `multitenant-rls` (tenant cruzado, seller cruzado, conductor cruzado) — no esperar a "después".
4. **`base-datos-rls`** — migración 3: `courier_config_dte`, `folios_caf`, `secretos_cifrados` (o el mecanismo de Storage cifrado — coordinar con `integraciones` y `seguridad-cumplimiento` antes de fijar su forma exacta; es la pieza más sensible). RLS solo roles internos.
5. **`base-datos-rls`** — migración 4: `tarifas`, `conexiones_seller_ml`, `bitacora_auditoria`. RLS según §8.2.
6. **`integraciones`** — antes del adaptador DTE: confirmar con el proveedor elegido (SimpleFactura/SimpleAPI vs. Openfactura — pendiente del levantamiento §13) si gestiona folios o si hay que sincronizar `folios_caf`; ajustar la tabla si corresponde (más barato ahora que con datos reales).
7. **`integraciones`** — adaptador ML (puerto OAuth) sobre `conexiones_seller_ml` + mecanismo de secretos; el job de refresco (RF-012) y sondeo de salud (RF-013) son de Fase B, pero su forma de persistencia ya queda fija aquí.
8. **`backend`** — funciones de servidor de identidad: alta de tenant (RF-006), invitaciones (RF-005/010), gestión de roles, utilidades rol→capacidades para `frontend` y otros módulos.
9. **`qa`** — suite de aislamiento (no opcional, es la definición de hecho de `multitenant-rls`): tenant cruzado, seller cruzado, conductor cruzado, y verificación de que `secretos_cifrados`/`courier_config_dte`/`folios_caf`/`tarifas` son invisibles para `seller`/`conductor`.
10. **`seguridad-cumplimiento`** — revisión del cifrado de secretos y de que ningún campo sensible aparece en `bitacora_auditoria.detalle` ni en logs, antes de cerrar Fase A.

Solo al cerrar estos pasos (cimiento + RLS probado) corresponde abrir Fase B (`operacion`) — no antes.

---

## Referencias

- `CLAUDE.md` — contrato no-negociable del proyecto.
- `docs/levantamiento.md` — secciones §4 Usuarios y permisos, §6 RF-001..RF-051, §7 RNF, §9 Roadmap.
- `.claude/skills/multitenant-rls/SKILL.md`, `.claude/skills/chile-dte/SKILL.md`, `.claude/skills/flex-ml/SKILL.md`.
- `src/modules/{identidad,operacion,dinero,integraciones}/README.md`, `src/lib/supabase/server.ts`.

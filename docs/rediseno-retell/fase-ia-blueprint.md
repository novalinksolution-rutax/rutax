# FASE IA — IA Blueprint de Rutax (re-arquitectura desde la capacidad)

> **Qué es esto.** El rediseño **greenfield de la arquitectura de información**. Insumo = `fase-0-informe-capacidades.md` (qué puede hacer cada persona), **no** el layout actual. Aquí se decide, por superficie: el **árbol de navegación nuevo**, el **mapa capacidad→pantalla→patrón de Retell**, la **composición** de cada vista y la resolución previa de los **4 estados** y las **densidades**.
> **Guardrail vigente:** cero cambios de lógica/RBAC/datos. El gating actual se **preserva exacto** (el hueco de PII de Sellers se escala aparte a `seguridad-cumplimiento`). Solo cambia el **cómo/dónde se ve**.
> **Patrones referidos** = catálogo `catalogo-visual.md`/`design-system.md §10`: **A** shell/sidebar · **B** listado con folders · **C** tabla densa+toolbar · **D** dashboard analítico · **E** billing/plan · **F** skeleton · **G** menú ⋮ · **H** settings (nav anidada + rows + toggle) · **I** toggle. Más: form modal, wizard, connector card, confirmación de dinero.

---

## 0. Decisiones transversales (aplican a las 4 superficies)

### 0.1 Los 4 estados de toda vista de datos (resueltos por adelantado)
| Estado | Tratamiento | Patrón |
|---|---|---|
| **Vacío real** (no hay datos aún) | `EmptyState`: ícono en cuadro redondeado + frase + acción primaria ("Crea tu primer…"). | 2.10 |
| **Filtrado sin resultados** | Distinto del vacío: "Sin resultados para estos filtros" + **botón limpiar filtros** (nunca ofrece "crear"). | 2.10 |
| **Cargando** | `Skeleton` con el **layout final** (mismas columnas/altura). Nunca spinner suelto. Loader de marca solo en navegación pesada. | F |
| **Error** | Card de error + causa breve + **Reintentar**. Nunca pantalla en blanco. | — |
| **Sin permiso** | **No se renderiza** (RBAC en servidor oculta el ítem y la ruta). Nunca "deshabilitado". | §0 informe |

### 0.2 Densidades por persona
- **`admin`, `(tenant)`** → compacto (filas 40–44px, tabla densa, mono en IDs/montos).
- **`portal`** → relajado (más aire, tablas→**cards** en móvil, tono tranquilizador).
- **`conductor`** → táctil (targets ≥44px, alto contraste, **cero tablas** → listas de cards, nav inferior).

### 0.3 Componentes de dominio (un solo lugar, se reusan en las 4)
`BadgeEstado` (sobre `traduccion-estados.ts`, punto de color + texto — nunca color solo) · `MontoCLP` (mono-tabular, negativo en rojo) · `ConfirmacionDinero` (resumen + fricción) · `SelectorComuna` (comunas-rm) · `EstadoConexionML` (salud + reconectar) · `BotonDescarga` (DTE/etiqueta/export) · `CentroAvisos` · `PaletaComando` (⌘K).

### 0.4 Regla de "detalle en drawer, no navegar fuera"
Salvo editores complejos, **fila → `Sheet` lateral** con el detalle (mantiene el contexto de la tabla). Páginas de detalle propias solo donde el recurso es rico (manifiesto, período, liquidación, courier).

---

## 1. Superficie `(tenant)` — backoffice del courier (el caballo de batalla)

### 1.1 Árbol de navegación NUEVO (Patrón A — sidebar 260px lavanda)

```
┌─ SIDEBAR (260px, #f5f5fa, sin borde) ──────────┐
│ [◧] Tenant switcher  ▸ "Andes Última Milla"    │  ← workspace = courier/tenant + colapsar
│                                                 │
│   ◻ Dashboard                    (Home, suelto) │  ← pill blanca activa + ícono navy
│                                                 │
│   OPERACIÓN                                     │  ← header xs UPPERCASE muted
│   ◻ Pedidos                                     │
│   ◻ Manifiestos                                 │
│   ◻ Conductores                                 │
│   ◻ Incidencias                                 │
│                                                 │
│   DINERO                                        │
│   ◻ Períodos                                    │
│   ◻ Liquidaciones                               │
│   ◻ Conciliación                                │
│   ◻ Cobranza                                    │
│                                                 │
│   CLIENTES                                      │
│   ◻ Sellers                                     │
│                                                 │
│  ───────────────────────────── (empuja abajo)  │
│   ◻ Mi plan            "Prueba · 12 días"       │  ← análogo "Free trial" de Retell
│   ⚙ Configuración                → nested (H)   │  ← entra a settings anidado
│   [av] Usuario · rol            ▸ (tema/salir)  │  ← cuenta abajo (menú J)
└─────────────────────────────────────────────────┘
```

**Cambios vs hoy (justificados por capacidad, no por inercia):**
- El hub `/onboarding` (hoy mal-etiquetado **"Configuración"** dentro del grupo Configuración) desaparece del sidebar principal → se convierte en **"Puesta en marcha"** dentro del Settings anidado. Resuelve la colisión de nombres del informe §B.
- **Sellers** sube a grupo propio **CLIENTES** (hoy colgaba de Configuración, donde no pertenece: es una entidad de negocio, no un ajuste).
- **Tarifas · Integraciones (API) · Zonas · Equipo · Exportar** salen del sidebar plano → entran al **Settings anidado (Patrón H)**. El sidebar principal queda enfocado en el trabajo diario (Operación/Dinero), no en la config.
- **Mi plan** baja al bloque inferior como el "Free trial" de Retell (billing vive abajo, siempre visible).
- Gating **idéntico** al de `(tenant)/layout.tsx` actual: cada ítem sigue detrás de su `puede*`. Un grupo sin ítems no se pinta. (Sellers se mantiene visible a todos los roles internos **como hoy** — el arreglo de gating es tarea aparte, no de este rediseño.)

### 1.2 Settings anidado (Patrón H) — reemplaza el sidebar al entrar

```
‹ Volver
CONFIGURACIÓN
  Puesta en marcha      (wizard: certificado → folios → tarifas → cobranza)
  Tarifas
  Integraciones         (salud ML · reconectar · backfill)
  Zonas de reparto
  Equipo                (usuarios · roles · invitaciones)
  Exportar datos
  Mi plan               (también accesible desde el bloque inferior)
```
Cada ajuste = **setting row**: label (medium) + valor/estado + descripción muted + control a la derecha (botón outline o **toggle** azul-navy). Toggles para opt-in (p. ej. futuro "emisión DTE real", alertas).

### 1.3 Mapa capacidad → pantalla → patrón

| Capacidad (informe §B) | Pantalla nueva | Patrón | Composición clave |
|---|---|---|---|
| Dashboard operativo | `/dashboard` (página) | **D** | KPI cards (comprometido/entregado, $ por cobrar, $ por liquidar, incidencias abiertas) + charts (paleta chart) + panel salud conexiones + alertas. |
| Pedidos consolidados + detalle | `/operaciones` + **drawer** | **C** | Toolbar (Rango fecha · Filtro · Seller · Estado · columnas · Acciones) · tabla densa, punto de estado, ID mono, **MontoCLP** derecha · fila→`Sheet` detalle (incl. reubicar/geocoding). Selección ⧉. |
| Manifiestos + crear + asignar | `/manifiestos`, `/nuevo`, `/[id]`, `/[id]/asignar` (página) | **C** + form + **confirmación** | Lista (C) → detalle rico (página) → **asignar** = selección múltiple ⧉ + barra de acciones masivas. |
| Conductores + detalle | `/conductores` + drawer | **B/C** | Listado con segmentos (activos/ocupados) + avatar-cell; detalle en drawer. |
| Incidencias | `/operaciones/incidencias` + drawer | **C** | Tabla + punto de estado + acciones de reputación; detalle drawer. |
| Períodos: cerrar/**emitir DTE** | `/dinero/periodos` + `/[id]` (página) | **C** + **ConfirmaciónDinero $📄** | Tabla períodos → detalle → acción "Emitir facturas": dialog resumen "N facturas · $X · M sellers" + fricción. Gate humano intacto. |
| Liquidaciones: **generar** | `/dinero/liquidaciones` + `/[id]` | **C** + **ConfirmaciónDinero $** | Igual patrón; resumen antes de generar. |
| Conciliación (bandeja excepciones) | `/dinero/conciliacion` | **C** (solo lectura) | Bandeja detective; sin acciones de escritura de dinero. |
| Cobranza / Pagos | `/dinero/cobranza` | **E** + C | **Card de balance** (saldo del período / morosidad) + tabla de estados de cuenta + pago→conductor ($). |
| Sellers + invitar | `/sellers` + `/invitar` (modal) | **B** + form modal | Listado con folders→segmentos (activos, por estado ML, sin conectar) · primaria oscura "Invitar seller" (modal 🔒). |
| Onboarding (wizard) | Settings › Puesta en marcha | **wizard** | Pasos con progreso; campos sensibles 🔒 "cifrado, nunca visible". |
| Tarifas / Integraciones / Zonas / Equipo / Exportar | Settings › * | **H** | Setting rows + toggles; Integraciones usa `EstadoConexionML`. |
| Mi plan | `/configuracion/plan` (+ bloque inferior) | **E** | Card de estado de suscripción + gestionar plan / método de pago (Fintoc). $ |

---

## 2. Superficie `admin` — consola de plataforma del fundador

### 2.1 Árbol de navegación NUEVO (de barra horizontal → **sidebar denso**, Patrón A)

```
┌─ SIDEBAR admin (consola densa) ─────────────────┐
│ [◧] Rutax · Plataforma                          │
│                                                 │
│   ◻ Overview                        (Home)      │  ← hoy OMITIDO en el nav; se restituye
│                                                 │
│   NEGOCIO                                       │
│   ◻ Couriers                                    │
│   ◻ Suscripciones                               │
│   ◻ Planes                                      │
│                                                 │
│   PLATAFORMA                                    │
│   ◻ Métricas                                    │
│   ◻ Salud                                       │
│   ◻ Bitácora                                    │
│   ◻ Comunicaciones                              │
│                                                 │
│  ─────────────────────────────                  │
│   ◻ Seguridad (MFA)                             │
│   [av] admin@rutax · [Administrador]  ▸         │  ← badge rolAdmin + tema/salir
└─────────────────────────────────────────────────┘
```

**Gating por `rolAdmin`** (preservando el gate real Supabase+AAL2): el rol **`soporte` (solo lectura)** ve las mismas vistas pero **sin acciones de escritura** (crear/suspender courier, editar planes/suscripciones) — las acciones simplemente no se renderizan, igual que el patrón RBAC del courier. `admin_total` las ve todas.

### 2.2 Mapa capacidad → pantalla → patrón

| Capacidad (informe §A) | Pantalla | Patrón | Composición clave |
|---|---|---|---|
| Overview | `/admin` | **D** | KPI (MRR, couriers activos, suscripciones al día, salud) + charts + accesos rápidos. |
| Couriers: listar/ver/crear/**suspender** | `/admin/couriers` + `/[tenantId]` (página) | **B/C** + detalle + **confirmación $** | Listado con segmentos (activo/suspendido/trial) → detalle rico. Suspender = dialog auditado. |
| **Soporte / impersonación auditada** | `/admin/couriers/[tenantId]/soporte` | confirmación **🔒$** | Banner de impersonación activa + registro en bitácora antes del efecto. |
| Suscripciones + detalle | `/admin/suscripciones` + `/[id]` | **C** + drawer/página | Tabla (estado, dunning, método) → detalle. |
| Planes | `/admin/planes` | **H** o C | Setting rows / tabla editable (base + por conductor + cupos DTE). $ |
| Métricas | `/admin/metricas` | **D** | Dashboards MRR/uso/adopción. |
| Salud | `/admin/salud` | **C/D** | Jobs Inngest, watchdog, integraciones (semáforo). |
| Bitácora global | `/admin/bitacora` | **C** | Tabla densa auditoría, filtros por actor/acción/fecha. 🔒 |
| Comunicaciones | `/admin/comunicaciones` | listado + form | Anuncios a couriers. |
| Seguridad (MFA propia) | `/admin/seguridad` | **H** | Gestión de factores TOTP. 🔒 |

---

## 3. Superficie `portal` — seller (relajada, tranquilizadora)

### 3.1 Árbol de navegación NUEVO (Patrón A, variante ligera/espaciada)

```
┌─ SIDEBAR portal (simple, aire) ─────────────────┐
│ [◧] "Tienda del seller"                         │
│   ◻ Inicio                          (Home)      │
│                                                 │
│   OPERACIÓN                                     │
│   ◻ Mis pedidos                                 │
│   ◻ Incidencias                                 │
│                                                 │
│   DINERO                                        │
│   ◻ Estado de cuenta                            │
│                                                 │
│  ─────────────────────────────                  │
│   ◻ Conexión ML   • Conectado / ⚠ Reconectar    │  ← EstadoConexionML, siempre visible
│   [av] seller@… ▸ (tema/salir)                  │
└─────────────────────────────────────────────────┘
```
Sin variantes RBAC (rol único) → nav fija. **Densidad relajada**; en móvil las tablas colapsan a **cards**.

### 3.2 Mapa capacidad → pantalla → patrón

| Capacidad (informe §C) | Pantalla | Patrón | Composición clave |
|---|---|---|---|
| Home / resumen · Bienvenida | `/portal`, `/portal/bienvenida` | **D** ligero | KPI tranquilizadores (pedidos en curso, entregados, por cobrar) + próximos pasos. |
| **Conectar ML (OAuth)** + reconexión | `/portal/conectar-ml` | connector card (2.7) | Card conector + `EstadoConexionML`. **Diseñado como lista** (no una sola) para no estorbar el futuro 1:N. 🔒 |
| Pedidos: listar/ver/**crear same-day** | `/portal/pedidos`, `/[id]`, `/nuevo` (modal/wizard) | **C** relajado + form | Tabla→cards en móvil; detalle drawer; **crear same-day** = form con **destino de facturación** ($) + `SelectorComuna` + `BotonDescarga` etiqueta 📄. |
| Incidencias propias | `/portal/incidencias` | **C** relajado | Seguimiento, solo lectura. |
| **Estado de cuenta** + detalle + **descargar DTE** | `/portal/cobros`, `/[periodoId]` | **E** | Card de balance "¿me cobraron bien?" + tabla de períodos + `BotonDescarga` DTE 📄. |

---

## 4. Superficie `conductor` — PWA (táctil, nav inferior)

### 4.1 Navegación NUEVA (de header superior → **nav inferior táctil**)

```
┌─ Pantalla conductor (móvil, max-w-lg) ──────────┐
│  Header mínimo: "Mis entregas"        [avatar]  │
│                                                 │
│   (contenido: listas de CARDS, no tablas)       │
│   ┌───────────────────────────────────────────┐ │
│   │ Parada 3 · Providencia          • en ruta │ │  ← card táctil ≥44px
│   │ Av. Ejemplo 123 · Depto 4B                │ │
│   │ [ Llamar ]        [ Marcar entregada → ]  │ │
│   └───────────────────────────────────────────┘ │
│                                                 │
├─ NAV INFERIOR (tab bar, ≥44px, alto contraste) ─┤
│   [🚚 Manifiesto]   [💵 Liquidaciones]  [☰ Yo]  │
└─────────────────────────────────────────────────┘
```

### 4.2 Mapa capacidad → pantalla → patrón

| Capacidad (informe §D) | Pantalla | Patrón | Composición clave |
|---|---|---|---|
| Home | `/conductor` | card list | Saludo + resumen del día + CTA "Ver manifiesto". |
| **Manifiesto del día** + parada/pedido | `/conductor/manifiesto`, `/[pedidoId]` | card list + detalle full-screen | Paradas como cards ordenadas; detalle = pantalla completa con botones grandes. |
| Evidencia interna | `/conductor/manifiesto/[pedidoId]` | captura táctil | Foto/estado (informativa; POD Flex sigue en la app de ML). |
| Confirmar manifiesto | (acción) | confirmación táctil | Resumen + confirmar. |
| Mis liquidaciones | `/conductor/liquidaciones` | card list | `MontoCLP` grande; sin tabla. |
| **Offline** | `/offline` | estado PWA | Mensaje claro + cola local (AsyncStorage en Expo; en PWA, aviso). |

---

## 5. Superficie pública / auth / tracking

| Pantalla | Patrón | Composición clave |
|---|---|---|
| Landing `/` | marketing ligero | Inter, primary neutro oscuro, acento navy escaso. |
| Login / Registro / Activar / Invitación | **card centrada** | Inputs/botones ADN Retell; validación al blur; RUT/CLP; campos 🔒 marcados. |
| **Tracking público** `/tracking/[token]` | timeline público | Sin login, PII mínima, estado del pedido como **línea de tiempo** + `BadgeEstado`; tono tranquilizador, marca ligera. |
| Offline | estado | Amable, sin jerga. |

---

## 6. Cierre de la Fase IA — qué queda decidido

1. **Navegación nueva de las 4 superficies** definida (árboles arriba), con Retell aplicado por densidad.
2. **Cada capacidad tiene su patrón asignado** (tablas §1.3/§2.2/§3.2/§4.2) — se construyó el mapa *capacidad→patrón*, nunca *pantalla-vieja→pantalla-nueva*.
3. **Reubicaciones/fusiones aprobadas conceptualmente:** onboarding→"Puesta en marcha" en Settings; config plana→Settings anidado (H); Sellers→grupo CLIENTES; admin barra→sidebar denso con Overview; conductor→nav inferior; detalles→drawers.
4. **4 estados y densidades** resueltos por adelantado (§0).
5. **Sin tocar lógica/RBAC:** el gating se preserva; el hueco de PII de Sellers va como **seguimiento a `seguridad-cumplimiento`** (no en este rediseño).

### Apéndice — seguimiento fuera del rediseño (para `seguridad-cumplimiento`)
- **[Prioridad alta · PII]** `Sellers`/`invitar seller` se muestra a todos los roles internos sin gate de capacidad (`(tenant)/layout.tsx` agrega el ítem sin `if`). Invitar seller maneja PII → definir capacidad y gatear.
- **[Prioridad baja · semántica]** `Integraciones (API)` y `Zonas` cuelgan del check `puedeGestionarTarifas`; conviene capacidad propia (salud ML/config ≠ tarifas).

---

🛑 **CHECKPOINT IA** — Esta es la nueva arquitectura de información **antes de construir**. Al aprobarla, paso a la **Fase 1 (tokens & tema)** y empieza el código. Aquí es donde confirmas (o corriges) las reubicaciones: onboarding→Settings, config anidada, Sellers→CLIENTES, admin→sidebar, conductor→nav inferior.

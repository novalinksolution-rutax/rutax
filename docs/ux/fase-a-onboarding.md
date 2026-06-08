# Flujos de Onboarding — Fase A
## Documento de UX/UI para `frontend` · Courier, Invitaciones internas, Seller (OAuth ML)

> Define jerarquía de información, pasos, decisiones del usuario y estados de pantalla. No es spec visual pixel-perfect — es el contrato de comportamiento que `frontend` traduce a componentes shadcn/ui.
> Basado en: `docs/levantamiento.md` (RF-005..010, RF-048), `docs/arquitectura/fase-a-cimiento.md`, `src/modules/identidad/{onboarding,invitaciones,capacidades}.ts`, `src/modules/integraciones/ml/*`.
> Principio transversal (CLAUDE.md): reducir clics, llamadas, mensajes de WhatsApp, errores y tiempos de respuesta. Cada decisión de flujo más abajo está optimizada contra ese criterio, no contra "se ve bien".

---

## 0. Decisiones de secuencia que enmarcan los tres flujos

**¿Es auto-servicio el alta del courier?** Confirmado en el código ya construido: `crearTenantConDueno` contempla explícitamente el caso `actor.usuarioId === null` con `actorTipo: 'sistema'` para "autoservicio (el propio interesado se da de alta)". El levantamiento lista RF-006 como "Super-admin / dueño" — es decir, ambos caminos son válidos. **Diseño: el flujo principal de Fase A es auto-servicio** (formulario público "Crea tu cuenta de courier"), porque reduce a cero la dependencia de un humano (el fundador) para activar un nuevo tenant — coherente con "reducir... tiempos de respuesta". El alta operada por `super_admin` (soporte, casos especiales) reutiliza la misma función de servidor desde un panel interno fuera del alcance de este documento.

**Orden de los pasos del onboarding del courier:** la secuencia que defino es **(1) alta de empresa → (2) primer login del dueño → (3) configuración DTE → (4) folios CAF → (5) tarifas**, y la justifico así:
- (1)→(2): no puede haber sesión sin cuenta; el dueño necesita credenciales antes de configurar nada.
- (2)→(3): DTE va antes que tarifas porque **tarifas es el insumo del motor entrega→dinero, pero sin DTE activo el courier no puede facturar de todos modos** — configurar tarifas sin DTE deja al dueño con una falsa sensación de "ya quedé listo". Mostrar primero el requisito tributario (más alto riesgo de fricción y de demora externa — activación con el SII puede tardar) deja el paso más rápido (tarifas, que es 100% interno) al final, donde no bloquea nada externo.
- (3)→(4): folios depende de que el proveedor DTE esté elegido (es quien decide si gestiona folios o no).
- Las **tarifas son el único paso 100% bajo control del courier** y no depende de terceros — por eso queda al final: el dueño puede "cerrar" su sensación de progreso con algo que sí completa en el acto, incluso si DTE sigue "en proceso" del lado del proveedor/SII.

**Importante:** estos pasos NO son un wizard estrictamente secuencial bloqueante. DTE puede demorar días en activarse (validación con el SII). Forzar al dueño a esperar ahí sería fricción pura. **Diseño: checklist de onboarding con pasos navegables independientemente**, donde cada paso muestra su propio estado, y el dueño puede saltar a "Tarifas" mientras "DTE" queda `en_proceso`. El estado global de "onboarding incompleto" vive en un panel persistente, no en un wizard modal.

---

# FLUJO 1 — Onboarding del courier (RF-006, RF-007, RF-008, RF-009)

## 1.1 Mapa de pantallas (vista de pájaro)

```
Landing pública
   └─ [Crear cuenta de courier] ──► Pantalla A: Alta de empresa
                                         │ (envía invitación por email al dueño)
                                         ▼
                                    Pantalla B: Revisa tu correo (estado intermedio)

Email del dueño
   └─ [Aceptar invitación] ──► Pantalla C: Define tu contraseña (primer login)
                                         │
                                         ▼
                              Pantalla D: Panel "Onboarding" (checklist persistente)
                                    ├─ Paso 1: Configuración DTE   ──► Pantalla E
                                    ├─ Paso 2: Folios CAF          ──► Pantalla F
                                    └─ Paso 3: Tarifas iniciales   ──► Pantalla G
                                         │
                                         ▼ (al completar los 3 pasos críticos)
                              Dashboard del dueño (fuera de este documento — RF-046)
```

## 1.2 Paso a paso

### Pantalla A — Alta de la empresa
**Objetivo:** capturar los datos del tenant + datos de contacto del dueño, en una sola pantalla, sin pasos previos de "verifica tu email" (eso ya lo cubre la invitación).

**Campos (un solo formulario, agrupado en dos bloques visuales):**
- Bloque "Tu empresa": nombre de fantasía, razón social, RUT (con máscara `NN.NNN.NNN-DV` y validación de dígito verificador en vivo — feedback inmediato, no al enviar).
- Bloque "Tú, como dueño": nombre completo, email.

**Decisiones de diseño:**
- No se pide contraseña aquí — coherente con "el dueño define su propia contraseña al aceptar" (decisión ya tomada en `crearTenantConDueno`). Comunicarlo explícitamente bajo el botón de envío: *"Te enviaremos un correo a [email] para que crees tu contraseña y actives tu cuenta."* — anticipa la pregunta "¿y mi clave?" antes de que se convierta en un mensaje de soporte.
- Validación de RUT en el campo, no solo al enviar: dígito verificador incorrecto se marca al perder foco, con mensaje específico ("el dígito verificador no corresponde a este RUT") — evita el viaje de ida y vuelta al servidor para un error que se puede detectar en el cliente.
- Botón primario: **"Crear mi cuenta"** (no "Siguiente" — comunica que esto activa algo real, no que hay más pasos ocultos).

**Estados:**
- *Vacío / inicial*: formulario en blanco, foco en "Nombre de fantasía".
- *Error de validación*: inline, por campo (RUT inválido, email mal formado, campos vacíos) — replica los mensajes de `validarEntrada` (`ErrorValidacion`) para que el texto del frontend y del backend no diverjan.
- *Error de conflicto — RUT duplicado*: "Ya existe un courier registrado con este RUT" → ofrecer enlace a soporte/login, no dejar al usuario reintentando un dato que nunca pasará (mapea 1:1 a `ErrorConflicto` de `esErrorDeRutDuplicado`).
- *Error de conflicto — email duplicado*: "Ya existe una cuenta con este correo" → ofrecer **"¿Ya tienes cuenta? Inicia sesión"** como salida (mapea a `esErrorDeEmailDuplicado`).
- *Enviando*: botón con spinner + deshabilitado (evitar doble submit — la función ya es resiliente a reintentos por compensación, pero un doble clic del usuario no debería generar dos llamadas).
- *Éxito*: navega a Pantalla B.

### Pantalla B — "Revisa tu correo" (estado intermedio, sin acción posible)
**Objetivo:** cerrar el ciclo del paso anterior con una expectativa clara — sin esto, el usuario se queda "colgado" preguntándose si funcionó.

**Contenido:** ícono de correo, mensaje *"Enviamos un enlace a [email] para que actives tu cuenta y crees tu contraseña. El enlace vence en 7 días."* + acción secundaria discreta **"¿No te llegó? Reenviar correo"** (throttled — evitar abuso) + enlace a soporte.

**Por qué importa:** evita el típico mensaje de WhatsApp al fundador "oye, me registré pero no me llegó nada" — la pantalla se anticipa a esa duda con la información exacta (vigencia incluida).

### Pantalla C — Define tu contraseña (primer login / aceptación de invitación)
**Objetivo:** convertir al "invitado" en usuario `activo` con el menor número de campos posibles.

**Contenido:** saludo personalizado con el nombre que ya quedó registrado (*"Hola, [nombre]. Estás a un paso de activar [nombre de fantasía]"* — el contexto reduce la sensación de "formulario genérico"), campo de contraseña + confirmación, indicador de fortaleza.

**Estados:**
- *Token inválido / ya usado*: "Este enlace ya no es válido. Si ya activaste tu cuenta, inicia sesión; si no, solicita uno nuevo." — cubre el caso de doble clic en el correo.
- *Token expirado*: "Este enlace venció. Te enviamos uno nuevo a [email]" (puede disparar reenvío automático o requerir clic — decisión de `backend`, pero el copy debe distinguir expirado de inválido).
- *Éxito*: redirige directo al panel de onboarding (Pantalla D) — **no** a una pantalla de "tu cuenta fue creada, ahora inicia sesión" (eso sería un paso y una llamada de más).

### Pantalla D — Panel de onboarding (checklist persistente)
**Objetivo:** ser el "centro de mando" del onboarding — el dueño siempre sabe qué falta y nunca se pierde a medio camino. Esta pantalla **no desaparece** hasta que los pasos críticos estén completos; después se repliega a un banner discreto o desaparece del todo.

**Jerarquía de información (de arriba hacia abajo):**
1. Encabezado: *"Completa la activación de [nombre de fantasía]"* + barra/contador de progreso ("2 de 3 pasos completados").
2. Lista de pasos, cada uno como tarjeta con: ícono de estado, título, descripción de una línea, botón de acción, badge de estado.

| Paso | Estados posibles | Badge / texto |
|---|---|---|
| 1. Configuración DTE | `pendiente` / `en_proceso` / `activo` / `con_problemas` | "Sin configurar" / "En revisión" / "Activo" / "Necesita tu atención" |
| 2. Folios CAF | `no_aplica` (proveedor los gestiona) / `pendiente` / `vigente` | "Lo gestiona tu proveedor" / "Pendiente" / "Vigentes" |
| 3. Tarifas iniciales | `sin_tarifas` / `configuradas` | "Sin configurar" / "Configuradas" |

3. Si **todos** los pasos críticos (DTE activo + al menos una tarifa) están completos, la tarjeta de onboarding se reemplaza por un mensaje de cierre ("Tu cuenta está lista para operar") y dirige al dashboard real.

**Decisión de "qué bloquea qué":** Folios CAF nunca bloquea el resto (puede depender 100% del proveedor). Tarifas no depende de nada. Solo DTE bloquea la posibilidad de operar financieramente — pero **no bloquea la navegación**: el dueño puede entrar a cualquier sección de la app desde el día 1; el panel de onboarding solo lo acompaña, no lo encierra.

**Estado vacío real:** no aplica — esta pantalla siempre tiene contenido (los 3 pasos), nunca está "vacía". Lo que cambia es el estado de cada paso.

**Cómo se retoma tras dejarlo a medias:** el panel persiste en el dashboard (sección fija o banner colapsable) hasta que se completa. Cada tarjeta lleva directo al paso correspondiente con los datos ya guardados precargados — nunca se vuelve a pedir lo ya capturado.

### Pantalla E — Configuración DTE (RF-007 + RF-008, parte 1: proveedor + certificado + credenciales)
**Objetivo:** capturar tres secretos/configuraciones (proveedor, certificado, credenciales) comunicando con total claridad que **lo que se guarda nunca se vuelve a mostrar**.

**Estructura en dos secciones:**

**A) Selección de proveedor DTE**
- Selector simple (lista corta — `simplefactura`, `openfactura`, etc.). Una vez elegido y guardado, **no se puede cambiar libremente** desde esta pantalla (cambiar de proveedor DTE es una operación delicada — fuera de alcance de auto-servicio en Fase A; mostrar como dato fijo con nota "Para cambiar de proveedor, contacta a soporte").
- Estado tras elegir: la sección queda "cerrada" (modo lectura) y aparecen las dos siguientes.

**B) Certificado digital + credenciales del proveedor**
Dos sub-bloques con **el mismo patrón de interacción** (consistencia reduce la curva de aprendizaje):
- *Certificado digital*: input de archivo (`.pfx`/`.p12`) + campo de contraseña del certificado.
- *Credenciales del proveedor DTE*: campos según lo que el proveedor exija (usuario/API key — variará; el formulario se adapta al proveedor elegido).

**Regla de oro de la pantalla — comunicar "se guardó cifrado", nunca mostrar el valor:**
- Antes de cargar: estado vacío con copy explicativo: *"Tu certificado y tus credenciales se cifran antes de guardarse. Una vez cargados, no podrás verlos de nuevo aquí — solo reemplazarlos."*
- Después de cargar con éxito: el campo de archivo/contraseña **desaparece** y se reemplaza por una tarjeta de estado de solo-lectura:
  - Ícono de candado/check + *"Certificado cargado y cifrado"*
  - Metadatos visibles (NO el valor): `certificado_vence_en` ("Vence el 14-03-2027"), `estado_certificacion` (badge: Pendiente / En proceso / Activo / Con problemas).
  - Acción: **"Reemplazar certificado"** (única vía de cambio — sobrescribe, nunca "edita" el secreto existente).
- Alerta temprana: cuando `certificado_vence_en` está dentro de un umbral (p. ej. 30 días), la tarjeta cambia a estado de advertencia con acción directa "Renovar certificado" — esto es exactamente el tipo de "alerta solo cuando algo se sale de rango" que pide el dashboard de 30 segundos, aplicado aquí también.

**Estados de la pantalla completa:**
- *Sin proveedor elegido*: solo se ve el selector; el resto está oculto (no abrumar con campos que no aplican aún).
- *Proveedor elegido, sin certificado/credenciales*: formularios de carga visibles y vacíos.
- *Cargando*: spinner + "Cifrando y guardando — no cierres esta ventana".
- *Guardado con éxito*: tarjetas de solo-lectura, mensaje de confirmación temporal ("Certificado guardado de forma segura").
- *Error de carga* (archivo corrupto, formato no soportado, credenciales rechazadas por el proveedor): mensaje específico y accionable — nunca un genérico "ocurrió un error". Ej.: *"El proveedor rechazó estas credenciales. Verifica que sean las que te entregó al contratar el servicio."*
- *`estado_certificacion = con_problemas`*: banner de alerta persistente con el motivo (si el proveedor lo entrega) y acción "Reintentar" o "Contactar soporte".

### Pantalla F — Folios CAF (RF-008, parte 2)
**Objetivo:** esta pantalla **se decide en tiempo de ejecución según el proveedor elegido** — diseño contemplando ambos casos sin sobre-construir, tal como advierte la arquitectura (§5, nota de alcance).

**Caso A — el proveedor gestiona los folios directo con el SII (probable, según hallazgo de `integraciones`):**
- Pantalla de **solo-lectura/estado**, no de captura.
- Contenido: mensaje *"Tu proveedor [nombre] gestiona tus folios directamente con el SII. No necesitas hacer nada aquí."* + (si el proveedor expone esa info) un espejo de solo-lectura: tipo de documento, folios disponibles, estado (`vigente`/`agotado`/`vencido`).
- Esta pantalla puede incluso **no aparecer como paso del checklist** si el proveedor elegido es de este tipo — se reemplaza por una nota informativa dentro del paso de DTE. (Decisión para `frontend`: renderizar condicionalmente según `proveedor_dte`.)

**Caso B — el proveedor requiere carga manual de CAF:**
- Formulario de carga: tipo de documento (33 = factura, 61 = nota de crédito...), rango de folios, archivo CAF (`.xml`, cifrado al guardarse igual que el certificado — mismo patrón de "se guardó, no se muestra el contenido").
- Tabla/lista de folios cargados con su estado (`vigente`/`agotado`/`vencido`) y barra de consumo (`folio_actual` / `folio_hasta`).
- Alerta cuando un rango está por agotarse o vencer — mismo patrón de "alerta solo si se sale de rango".

**Estados comunes a ambos casos:**
- *Sin proveedor DTE elegido aún*: pantalla bloqueada con mensaje "Configura primero tu proveedor DTE" + enlace de vuelta a la Pantalla E (evita que el dueño llegue aquí por error y se confunda con un formulario que no puede llenar coherentemente).
- *Vacío* (caso B, sin folios cargados): estado vacío con CTA clara "Cargar mi primer CAF".
- *Error de carga*: archivo con formato incorrecto / rango inconsistente — mensaje específico.

### Pantalla G — Tarifas iniciales (RF-009)
**Objetivo:** dejar al courier operativo financieramente lo más rápido posible — por eso el diseño prioriza **una tarifa por defecto en menos de un minuto**, con la posibilidad de refinar después.

**Estructura — flujo de "lo simple primero, lo específico después":**
1. **Tarifa por defecto del tenant** (obligatoria para "completar" este paso): un solo formulario simple — tipo de entrega (`flex`/`same_day`), monto en CLP (con formato de miles, sin decimales — "$ 2.500", nunca "$2500.00"), fecha de vigencia desde (hoy por defecto). Sin `seller_id` ni `zona` — ese es justamente el caso "default del tenant" que describe la arquitectura (§6, "nulo = tarifa por defecto").
2. **Tarifas específicas (opcional, expandible)**: sección colapsada por defecto, "Agregar tarifa específica por seller o zona" — aquí aparecen los selectores de seller/zona/tipo de entrega. No se muestra de entrada para no intimidar al dueño que solo necesita arrancar.
3. **Listado de tarifas vigentes**: tabla con columnas seller (o "Todos — tarifa por defecto"), tipo de entrega, zona (o "Todas"), monto CLP, vigencia, estado. Acciones: editar (crea nueva versión vigente, no sobreescribe — coherente con el modelo versionado de `vigente_desde/hasta`), desactivar.

**Estados:**
- *Vacío*: solo aparece el formulario de tarifa por defecto, con copy "Define un monto base para empezar — podrás ajustar por seller o zona cuando lo necesites".
- *Con tarifa por defecto creada, sin específicas*: el listado muestra una sola fila "Todos los sellers · Tarifa por defecto"; este paso ya cuenta como "completo" en el checklist.
- *Error de validación*: monto vacío o cero, fecha de vigencia inconsistente (p. ej. `vigente_hasta` anterior a `vigente_desde`).
- *Conflicto de solapamiento* (si el backend lo detecta — dos tarifas vigentes para la misma combinación seller/tipo/zona en el mismo rango de fechas): mensaje explicativo, no un error de base de datos crudo.

## 1.3 Estado de "onboarding incompleto" — vista consolidada

- **Dónde vive:** banner persistente en la barra superior del dashboard ("Tu cuenta tiene 2 pasos pendientes — Completar configuración") + la propia Pantalla D accesible en cualquier momento desde el menú ("Configuración" → "Estado de activación").
- **Cómo se retoma:** un clic desde el banner lleva directo al panel D; cada tarjeta de paso lleva directo a su pantalla con los datos ya cargados — el dueño nunca repite información ya capturada.
- **Cuándo desaparece:** cuando DTE está `activo` y existe al menos una tarifa vigente. Folios CAF no es bloqueante si el proveedor los gestiona (caso A).
- **Si el dueño nunca vuelve:** aquí es donde corresponde un recordatorio por correo (no por WhatsApp — ver principio transversal) a los N días de inactividad con onboarding incompleto — el copy y la cadencia los define `copywriter`, pero el gatillo (estado `onboarding` del tenant + tiempo transcurrido) es información que esta pantalla ya tiene disponible.

---

# FLUJO 2 — Invitaciones internas (RF-005)

## 2.1 Mapa de pantallas

```
Dashboard del dueño/admin
   └─ "Equipo" / "Usuarios" ──► Pantalla H: Lista de usuarios + invitaciones
                                     └─ [Invitar usuario] ──► Pantalla I: Formulario de invitación (modal/panel)
                                                                    │
                                                                    ▼ (envía invitación)
                                                              vuelve a Pantalla H, con la nueva fila visible

Email del invitado
   └─ [Aceptar invitación] ──► Pantalla J: Aceptación (define contraseña o inicia sesión)
                                     │
                                     ▼
                              Acceso a la app, con su rol ya activo
```

## 2.2 Paso a paso

### Pantalla H — Lista de usuarios e invitaciones (vista única, con pestañas o filtro de estado)
**Objetivo:** el dueño/admin necesita ver, en un vistazo, "quién tiene acceso, con qué rol, y qué invitaciones están en el aire" — sin tener que ir a buscar en dos lugares distintos.

**Estructura — una sola tabla con dos grupos visuales (no dos pantallas separadas):**
1. **Usuarios activos**: nombre, email, rol (badge), estado (`activo`/`suspendido`), última actividad. Acción: cambiar rol / suspender (según `puedeGestionarUsuariosYRoles`).
2. **Invitaciones**: email, rol invitado, estado (badge: `Pendiente` / `Aceptada` / `Expirada` / `Revocada`), fecha de envío / vencimiento. Acciones contextuales según estado (ver tabla abajo).

**Filtro/pestañas sugeridas:** "Todos" · "Activos" · "Invitaciones pendientes" — permite al dueño enfocarse en "qué necesita seguimiento" sin scrollear una lista mezclada.

**Botón primario:** **"Invitar persona"** (siempre visible, esquina superior — la acción más frecuente de esta pantalla).

**Tabla de estados de invitación → qué puede hacer el dueño/admin:**

| Estado | Badge / color sugerido | Acciones disponibles | Copy de apoyo |
|---|---|---|---|
| `pendiente` | Amarillo/neutro — "Pendiente" | Reenviar correo · Revocar | "Enviada hace 2 días · vence en 5 días" |
| `aceptada` | Verde — "Aceptada" | (ninguna sobre la invitación — ya es un usuario activo, aparece en la lista de usuarios) | — |
| `expirada` | Gris — "Expirada" | Reinvitar (crea una invitación nueva con un clic, reusando los mismos datos) | "Venció el 12-05-2026" |
| `revocada` | Gris — "Revocada" | Reinvitar | "Revocada por [nombre] el 10-05-2026" |

**Decisión clave — "reenviar" vs. "reinvitar":** una invitación `pendiente` se **reenvía** (mismo token, mismo registro, solo se reenvía el correo — útil cuando "no me llegó"); una `expirada`/`revocada` se **reinvita** (crea una invitación nueva, porque el token y la vigencia anteriores ya no sirven). El frontend no debe confundir estas dos acciones bajo un mismo botón — son operaciones distintas en el backend.

**Estados de la pantalla:**
- *Vacío* (tenant recién creado, solo existe el dueño): mensaje "Aún no has invitado a nadie de tu equipo" + CTA "Invitar a tu primera persona".
- *Cargando*: skeleton de filas.
- *Error al cargar*: reintento simple, sin tecnicismos.

### Pantalla I — Formulario de invitación (modal o panel lateral, no página completa)
**Objetivo:** capturar email + rol en el menor número de pasos — esta es una acción que el dueño repetirá varias veces al formar su equipo; cada fricción se multiplica.

**Campos:**
1. Email del invitado.
2. Selector de rol — **solo los 4 roles internos invitables**: `supervisor`, `coordinador`, `administracion` (y `dueno` si el levantamiento permite invitar otro dueño — *nota: la validación de `crearInvitacion` permite `dueno` como rol interno válido; si el negocio decide que solo debe haber un dueño por tenant, esa restricción debe vivir en backend, no inferirse aquí*). Cada opción del selector lleva una descripción de una línea de qué puede hacer ese rol (tomado de §4 del levantamiento) — esto evita la pregunta "¿y un coordinador qué puede hacer?" que hoy termina en WhatsApp al fundador.

**Decisión de diseño — sin selector de `tipo_usuario`:** el formulario de invitación interna **no expone** el campo `tipo_usuario` ni `seller_id`/`driver_id` — son inferidos (`tipo_usuario = 'interno'`) porque esta pantalla es exclusivamente para el equipo interno. La invitación de sellers (RF-010) y conductores vive en sus propios flujos contextuales (el de seller se cubre en el Flujo 3; el de conductor es de Fase B), no aquí — mezclarlos en un selector confundiría al dueño sobre "a quién estoy invitando".

**Qué pasa si el email ya tiene cuenta (en este u otro tenant):**
- El backend ya contempla, vía `upsert` en `aceptarInvitacion`, el caso de "usuario ya existente que el courier vuelve a invitar con otro rol" — esto cubre re-invitar a alguien que ya pasó por el tenant.
- Para el caso de un email que pertenece a **otro** tenant (otra empresa courier): el formulario no necesita resolverlo de antemano — se envía la invitación igual; si la persona acepta, su perfil de dominio queda asociado al tenant de la invitación más reciente aceptada. **Frontend no debe intentar "verificar si el correo existe" antes de invitar** — eso agregaría una llamada y una espera sin beneficio real (y podría filtrar si un correo está o no registrado, un patrón de seguridad a evitar). Simplemente se envía.

**Estados:**
- *Inicial*: campos vacíos, foco en email.
- *Error de validación*: email mal formado, rol no seleccionado.
- *Enviando*: botón deshabilitado con spinner.
- *Éxito*: el modal/panel se cierra, aparece un toast ("Invitación enviada a [email]") y la nueva fila aparece arriba de la lista en Pantalla H — **sin recargar la página completa**.
- *Error del servidor* (p. ej. el actor perdió su capacidad entre que abrió el modal y envió — caso de borde, pero `crearInvitacion` lo valida): mensaje claro, "No tienes permiso para invitar usuarios — contacta al dueño de la cuenta".

### Pantalla J — Aceptación de la invitación (lado del invitado)
**Objetivo:** el invitado entra desde un enlace de correo — debe llegar a estar operativo en el menor número de pantallas posibles.

**Dos variantes según si la persona ya tiene cuenta en la plataforma o no** (el backend resuelve esto vía `usuarioAuthId` — `frontend` necesita poder mostrar ambas):

- **Caso "persona nueva"**: pantalla de "Define tu contraseña" — igual estructura que la Pantalla C del Flujo 1, pero con el contexto del tenant que la invita: *"[Nombre del courier] te invitó como [rol]. Crea tu contraseña para empezar."*
- **Caso "persona ya tiene cuenta"** (ya es usuario en este u otro tenant): pantalla de "Confirma para aceptar" — sin pedir contraseña nueva, solo *"Estás por unirte a [Nombre del courier] como [rol]. ¿Confirmas?"* con botón "Aceptar e ingresar". Esto evita pedirle datos que el sistema ya tiene — la fricción más evitable de todas.

**Estados:**
- *Token inválido / ya usado*: mismo patrón que en el Flujo 1 — "Este enlace ya no es válido."
- *Token expirado*: "Esta invitación venció. Pide a quien te invitó que te envíe una nueva." (el invitado no puede "reinvitarse a sí mismo" — esa acción es del dueño/admin).
- *Invitación revocada* (la persona hace clic en un enlace que el dueño ya canceló): "Esta invitación fue cancelada. Si crees que es un error, contacta a quien te invitó."
- *Éxito*: entra directo a la app con su rol activo — la primera pantalla que ve depende de su rol (un `conductor` ve su vista de ruta; un `supervisor`/`coordinador`/`administracion` ve el dashboard correspondiente a sus capacidades — fuera del alcance de este documento, pero el punto de entrada es éste).

---

# FLUJO 3 — Onboarding y conexión OAuth del seller (RF-010, RF-048)

## 3.1 Mapa de pantallas

```
Dashboard del courier — sección "Sellers"
   └─ [Invitar seller] ──► Pantalla K: Formulario de alta + invitación de seller
                                │ (crea fila `sellers` + invitación tipo='seller')
                                ▼
                          Pantalla H-bis: misma lista de invitaciones, vista "Sellers"

Email del seller
   └─ [Aceptar invitación] ──► Pantalla L: Bienvenida + explicación de la conexión ML
                                     │
                                     ▼
                                Pantalla M: "Conectar con Mercado Libre" (CTA + instrucción "cuenta principal")
                                     │
                                     ▼ (redirección OAuth)
                            [ML: el seller inicia sesión y autoriza]
                                     │
                                     ▼ (callback con code/state, o con error)
                                Pantalla N: Resultado de la conexión (éxito / error / cuenta-ya-vinculada)
                                     │
                                     ▼
                          Portal del seller — Pantalla O: Estado de conexión (persistente)
                                     │
                                     └─ [Reconectar] (cuando la salud se degrada) ──► reusa Pantalla M/N
```

## 3.2 Paso a paso

### Pantalla K — Invitar a un seller (lado courier)
**Objetivo:** dar de alta al seller como entidad de negocio (`sellers`) y dispararle la invitación, en un solo paso — el courier conoce los datos del seller (es su cliente), así que no tiene sentido pedírselos al seller después.

**Campos:** razón social, RUT del seller, nombre de contacto, email de contacto. Botón: **"Invitar a este seller"**.

**Decisión de diseño:** este formulario vive dentro de la sección "Sellers" del courier — **no** mezclado con el formulario de invitación interna (Pantalla I) — porque acá se está creando primero una entidad de negocio (`sellers`) y *luego* enviando la invitación asociada (`tipoUsuario: 'seller'`, `sellerId` obligatorio); son semánticamente distintos aunque el mecanismo de token sea el mismo por debajo.

**Estados:** análogos a la Pantalla I (validación, envío, éxito con toast + aparición en lista, error de email duplicado). El RUT del seller se valida igual que el del courier (módulo 11).

### Pantalla L — Bienvenida del seller (primera pantalla tras aceptar la invitación)
**Objetivo:** un seller que llega por primera vez no sabe qué es esta plataforma ni por qué tiene que "conectar Mercado Libre" — esta pantalla cierra esa brecha de contexto **antes** de pedirle la acción más delicada del flujo (autorizar acceso a su cuenta de ML).

**Contenido (texto breve, no un muro):**
- *"[Nombre del courier] te invitó a su portal de despachos en [Plataforma]."*
- Explicación de una línea de qué gana el seller (ver tracking de sus envíos, estado de cuenta, reportar incidencias — RF-048) — el copy exacto lo define `copywriter`, pero la pantalla debe dejarle un slot para "qué obtengo yo conectando esto", no solo "qué se me pide".
- **Anticipo de lo que viene**: *"Para sincronizar tus pedidos, necesitaremos que conectes tu cuenta de Mercado Libre. Te explicamos cómo en el siguiente paso."* — prepara al seller para la decisión real (Pantalla M), reduce el "¿esto es legítimo?" que dispara llamadas de duda.

**Estado:** una sola variante — pantalla informativa, botón único "Continuar".

### Pantalla M — Conectar con Mercado Libre (la pantalla más crítica del flujo)
**Objetivo:** lograr que el seller autorice **con su cuenta principal/manager** — el punto de falla más común y más costoso de revertir (la skill `flex-ml` lo marca como CRÍTICO: "si entra como colaborador/operador, el permiso es inválido").

**Jerarquía de la pantalla — la instrucción de "cuenta principal" va ANTES del botón, no en letra chica después:**
1. Encabezado: *"Conecta tu cuenta de Mercado Libre"*.
2. **Bloque de instrucción destacado** (no un aviso pequeño al pie): *"Importante: inicia sesión con tu cuenta PRINCIPAL de Mercado Libre — la del dueño/administrador de tu tienda. Si entras con la cuenta de un colaborador u operador, la conexión no funcionará y tendrás que rehacerla."* — con un ícono de advertencia visual que no se pueda ignorar al pasar el ojo rápido.
3. Botón primario, grande: **"Conectar con Mercado Libre"** → dispara la redirección OAuth (`iniciarAutorizacion`).
4. Nota de confianza breve: qué datos se comparten y qué no (de nuevo, copy de `copywriter`, pero la pantalla necesita ese espacio).

**Por qué esta instrucción importa tanto para "reducir errores y mensajes":** un seller que conecta con la cuenta equivocada genera, río abajo, una conexión que aparenta estar "sana" pero falla silenciosamente — eso se traduce en tickets de soporte confusos y mensajes de WhatsApp del tipo "oye, no me están llegando pedidos". Prevenir esto en el primer clic es la inversión de UX de mayor retorno de todo el flujo 3.

**Estados:**
- *Inicial*: como se describe arriba.
- *Redirigiendo*: breve estado de transición ("Te llevamos a Mercado Libre…") — útil porque la redirección externa puede tardar un instante y un usuario que no ve nada hace clic dos veces.

### Pantalla N — Resultado de la conexión (pantalla de retorno del callback OAuth)
**Objetivo:** el seller vuelve de ML — esta pantalla debe resolver, sin ambigüedad, "¿funcionó o no, y qué hago ahora?". Es la pantalla con más ramificaciones del documento.

**Ramificaciones (todas devuelven a esta misma pantalla, con contenido distinto):**

| Caso | Qué pasó | Qué ve el seller | Acción ofrecida |
|---|---|---|---|
| **Éxito** | `intercambiarCodigoPorTokens` devuelve conexión con `estado_salud: 'sana'` | Confirmación positiva: "¡Listo! Tu cuenta de Mercado Libre está conectada." + datos no sensibles (nombre/usuario de la cuenta ML conectada — `mlUserId` resuelto a nombre si la API lo permite, para que el seller verifique "sí, es mi cuenta correcta") | "Ir a mi portal" → Pantalla O |
| **Cuenta ya conectada a otro courier** | ML autoriza, pero la `conexiones_seller_ml` (única por `seller_id`, y el `ml_user_id` ya pertenece a otra fila/tenant) detecta colisión | Mensaje específico, NO un error genérico: *"Esta cuenta de Mercado Libre ya está conectada a otra empresa de despacho en nuestra plataforma. Si esto es un error, contacta a [courier] o a soporte."* — explica la causa real, no deja al seller adivinando | "Volver a intentar con otra cuenta" (vuelve a Pantalla M) · "Contactar soporte" |
| **El seller canceló/rechazó la autorización en ML** | ML redirige con error/sin `code` | "No completaste la conexión con Mercado Libre. Puedes intentarlo de nuevo cuando quieras." — tono neutro, sin culpar | "Intentar de nuevo" → Pantalla M |
| **Cuenta de colaborador/operador (si ML lo señala explícitamente)** | El adaptador deja evidencia en `ultimo_error`/bitácora según nota de `puerto.ts` | *"Detectamos que iniciaste sesión con una cuenta de colaborador. Para conectar correctamente, vuelve a intentarlo iniciando sesión con la cuenta PRINCIPAL de tu tienda."* — repite la instrucción crítica, ahora con el beneficio de la experiencia (el seller ya sabe que falló por eso) | "Intentar de nuevo" → Pantalla M (con la instrucción de cuenta principal aún más prominente la segunda vez) |
| **Error transitorio / del proveedor** (5xx, límite de tasa) | `ErrorHttpMl` con código 429/5xx | "Mercado Libre no respondió a tiempo. No es un problema de tu cuenta — intenta de nuevo en unos minutos." — distingue claramente "no es tu culpa" | "Reintentar" |
| **`code` ya canjeado / doble callback** | Caso de idempotencia (`codigosEnProceso`) — la conexión ya existe | Se trata como **éxito** — el seller no debe notar que hubo un reintento interno | "Ir a mi portal" |

**Decisión de diseño que atraviesa toda esta tabla:** cada mensaje de error debe responder, en una frase, **"¿es mi culpa, es de ML, o es un conflicto con otra cuenta?"** — esa distinción es lo que define si el seller reintenta solo, espera, o necesita ayuda externa. Un mensaje genérico ("Ocurrió un error al conectar") fuerza al seller a escribirle al courier, que a su vez escala al fundador — exactamine la cadena de mensajes que el proyecto busca cortar.

### Pantalla O — Estado de conexión en el portal del seller (vista persistente, RF-048)
**Objetivo:** el seller necesita, de un vistazo, saber "¿está todo bien con mi conexión?" sin tener que entender qué es un token o un OAuth.

**Jerarquía — un solo indicador de estado, traducido a lenguaje humano (no jerga técnica):**

| `estado_salud` (interno) | Cómo se presenta al seller | Color/ícono | Acción visible |
|---|---|---|---|
| `sana` | "Tu cuenta está conectada y sincronizando con normalidad" + "Última sincronización: hace 5 minutos" | Verde / check | (ninguna — no molestar cuando todo va bien) |
| `pendiente` | "Estamos terminando de configurar tu conexión" | Neutro / reloj | (ninguna — informativo, transitorio) |
| `atencion` | "Tu conexión necesita atención — estamos trabajando en resolverlo" | Amarillo / advertencia | "Ver más" (opcional — explica que es un problema operativo nuestro/de ML, no algo que el seller deba resolver) |
| `desvinculada` | "Tu cuenta de Mercado Libre se desconectó. Reconéctala para seguir recibiendo tus pedidos." | Rojo / alerta | **"Reconectar"** (botón primario, prominente) |

**Decisión de diseño — el seller NUNCA edita tokens:** no existe, en ninguna parte de este portal, un campo donde el seller vea o modifique un token, client_id, o cualquier dato técnico de la conexión. El **único** control disponible es el botón **"Reconectar"**, que es una acción de servidor (reinicia el flujo OAuth — reutiliza Pantallas M→N). Esto es coherente con §8.2 ("el seller *inicia* reconexión vía acción de servidor, no edita la fila") y reduce drásticamente la superficie de error: no hay forma de que el seller "rompa" su conexión manualmente.

**Flujo de "reconectar" (RF-015 — self-service de un clic):**
1. Seller en estado `desvinculada` o `atencion` ve el botón "Reconectar".
2. Un clic lo lleva directo a la Pantalla M (con el mismo bloque de instrucción de "cuenta principal" — **más relevante todavía aquí**, porque una causa común de desvinculación es justamente haber autorizado con la cuenta equivocada la primera vez).
3. El resultado vuelve a converger en la Pantalla N con sus mismas ramificaciones.
4. Al reconectar con éxito, el estado vuelve a `sana` y el banner de alerta desaparece — sin que el seller tenga que "confirmar" nada adicional.

**"Empujón de reconexión iniciado por el courier" (RF-016):** desde el lado del courier (dashboard, sección Sellers — fuera del detalle de este documento pero vale anotarlo aquí porque comparte la misma pantalla de destino), el courier puede disparar el envío de un correo al seller con un enlace directo a la Pantalla M/Reconectar — mismo mecanismo, otro disparador. El seller que llega por ese enlace ve exactamente la misma Pantalla M; no hay una variante distinta que mantener.

**Estados de la pantalla O en su conjunto:**
- *Sin conexión todavía* (`pendiente`, recién aceptó la invitación pero no ha completado OAuth): tarjeta de estado neutro + CTA "Conectar mi cuenta de Mercado Libre" → Pantalla M (mismo flujo que el onboarding inicial — no hay una variante "distinta" de conectar; conectar y reconectar son la misma acción con distinto punto de entrada).
- *Backfill en curso* (tras reconectar desde `desvinculada` — RF-017): si el sistema expone progreso del backfill, mostrar un mensaje informativo transitorio: "Estamos recuperando los pedidos del período en que tu cuenta estuvo desconectada (desde el [fecha de `desconectada_desde`])" — gestiona la expectativa de "por qué no veo todavía los pedidos de ayer".
- *Error al cargar el estado de conexión*: reintento simple — esta es información crítica para el seller, no debe quedar en blanco silenciosamente.

## 3.3 Resumen de criterios para `frontend` — Flujo 3

- Las Pantallas M y N son **compartidas** entre el flujo de "primera conexión" (tras aceptar invitación) y el flujo de "reconexión" (desde el portal). Constrúyanse como un único componente parametrizable por contexto (`modo: 'conexion_inicial' | 'reconexion'`), no como dos pantallas duplicadas — reduce mantenimiento y garantiza que ambas reciban las mismas mejoras de copy/diseño a futuro.
- El estado `estado_salud` y sus transiciones **siempre** se presentan traducidos a lenguaje natural — el seller no debe ver jamás los strings internos (`sana`/`atencion`/`desvinculada`/`pendiente`) ni términos técnicos (token, OAuth, refresh, callback).
- Cualquier mensaje de error de esta sección debe responder primero "¿qué hago ahora?" y solo después (si acaso) "qué pasó técnicamente" — invierte el orden natural en que un desarrollador escribiría el mensaje, y es exactamente lo que hace que el seller no necesite escribirle a nadie.

---

## Anexo — checklist de criterios transversales para `frontend` (los tres flujos)

1. **Nunca mostrar el valor de un secreto.** Certificado, credenciales DTE, tokens OAuth: solo metadatos de estado (`vence_en`, `estado_certificacion`, `estado_salud`, fechas). La única acción posible sobre un secreto ya guardado es *reemplazarlo*, nunca *verlo* o *editarlo* en línea.
2. **CLP siempre formateado como moneda chilena**, sin decimales, con separador de miles (`$ 2.500`, no `$2,500.00` ni `2500`).
3. **RUT con validación de dígito verificador en el cliente**, con el mismo mensaje de error que produce el backend (`normalizarYValidarRut`) — evita que el usuario vea un mensaje en la UI y otro distinto si el error llega del servidor.
4. **Ningún flujo de invitación/aceptación pide al usuario un dato que el sistema ya tiene.** Si la persona ya existe, se le pide confirmar — no rellenar de nuevo.
5. **Todo estado vacío lleva una acción clara hacia adelante** (nunca una pantalla en blanco con solo un título).
6. **Todo mensaje de error responde "qué puedo hacer ahora"**, distinguiendo explícitamente "es tu dato/acción" vs. "es nuestro sistema/un tercero (ML, SII, proveedor DTE)" — esa distinción es la que evita que el usuario escale por el canal equivocado (WhatsApp al fundador, en vez de simplemente reintentar).
7. **Las acciones reversibles/repetibles (reenviar invitación, reconectar, reintentar carga) son botones de un clic**, sin confirmaciones intermedias innecesarias — son justo las acciones que el principio "reducir clics" más beneficia.
8. **Las acciones irreversibles o sensibles** (revocar invitación, reemplazar certificado activo) sí llevan una confirmación breve — pero de una sola pregunta, no un wizard.
9. **El español es de Chile, formal pero directo** ("tu cuenta", "tu equipo" — trato de "tú", coherente con el resto del producto; el tono exacto lo cierra `copywriter`).

---

**Archivo de destino sugerido:** `docs/ux/fase-a-onboarding.md`

**Referencias usadas para este diseño** (rutas absolutas):
- `C:\Users\jorge\Desktop\SaaS Courier Again\docs\levantamiento.md` (RF-005..RF-010, RF-048, RF-011..017, §4 Usuarios y permisos)
- `C:\Users\jorge\Desktop\SaaS Courier Again\docs\arquitectura\fase-a-cimiento.md` (§3 identidad, §4 RBAC, §5 onboarding DTE, §6 tarifas, §7 OAuth ML, §8 RLS)
- `C:\Users\jorge\Desktop\SaaS Courier Again\src\modules\identidad\onboarding.ts` (flujo y estados reales de `crearTenantConDueno`)
- `C:\Users\jorge\Desktop\SaaS Courier Again\src\modules\identidad\invitaciones.ts` (estados y transiciones reales de `crearInvitacion`/`aceptarInvitacion`/`revocarInvitacion`)
- `C:\Users\jorge\Desktop\SaaS Courier Again\src\modules\identidad\capacidades.ts` (matriz rol→capacidades, para decidir qué ve cada actor)
- `C:\Users\jorge\Desktop\SaaS Courier Again\src\modules\integraciones\ml\tipos.ts` y `puerto.ts` (estados de salud, ramificaciones reales del callback OAuth, clasificación de fallos de refresco)
- `C:\Users\jorge\Desktop\SaaS Courier Again\.claude\skills\flex-ml\SKILL.md` (criticidad de "cuenta principal", patrón de salud y reconexión)
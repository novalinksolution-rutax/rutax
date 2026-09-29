# Puesta en marcha v2 del courier: documento de experiencia

Destino sugerido: `docs/ux/puesta-en-marcha-v2.md`. Reemplaza `docs/ux/fase-a-onboarding.md` en lo que toca al courier.

Este documento es de diseño. No incluye código. Las referencias a archivos y columnas salen de leer el repo el 2026-09-28.

---

## 0. Hallazgos que condicionan el diseño (leer primero)

Algunas pantallas de este documento no se pueden construir con lo que el sistema escribe hoy. Van primero para que nadie las descubra a mitad de la construcción.

| # | Hallazgo | Verificado en | Consecuencia |
|---|---|---|---|
| H1 | El login no tiene enlace a "Crear cuenta". Solo aparece si falla Google con `sin_cuenta`. El único enlace fijo es "Qué es Rutax". | `src/app/login/formulario-login.tsx` (pie, líneas 261-265; `errorDesdeUrl`) | Se agrega el enlace (sección 3.1). |
| H2 | **No existe horario de operación a nivel de courier.** `identidad.ventanas_corte` tiene `seller_id NOT NULL` con FK a `sellers`. Durante la puesta en marcha aún no hay sellers. | migración `20260613000004` | Hace falta almacenamiento nuevo (H6). |
| H3 | **No existe "servicios que ofrece" a nivel de courier.** No hay columna ni tabla. | búsqueda en migraciones y `areas-producto.ts` | Se puede derivar de qué tarifas existen, o guardar en la tabla de H6. |
| H4 | **La tarifa por zona se guarda pero nunca se usa para cobrar.** `resolverTarifaVigente` (`src/modules/operacion/tarifas.ts:39`) filtra por tenant, `tipo_entrega`, vigencia y seller. Ordena por seller y por `vigente_desde` y toma una sola. No mira `zona` ni `zona_id`. `generar-lineas.ts` lee `zona_id` solo para el snapshot. Con dos tarifas same_day (Zona 1 y Zona 2) gana la más reciente para todas las comunas. | `tarifas.ts`, `generar-lineas.ts:282-293` | El "cobras $X por zona" es hoy una promesa que el motor no cumple. Hay que cambiar `resolverTarifaVigente` (comuna del pedido → `identidad.resolver_zona` → tarifa de esa zona, con respaldo a `zona_id IS NULL`). Es cambio de motor de dinero: `arquitecto` y `backend`, con pruebas. |
| H5 | `accionCrearTarifa` no acepta `zona_id`, solo `zona` (texto legado). La columna `identidad.tarifas.zona_id` existe. `modo_calculo` acepta `por_zona`. | `configuracion/tarifas/actions.ts:51-105` | Ampliar la acción, o crear una acción nueva por lotes (H8). |
| H6 | Hace falta una tabla por courier: `identidad.courier_config_operacion` (una fila por tenant, patrón de `courier_config_retiro`). Con `tenant_id`, RLS interna, `servicios`, `hora_salida_reparto`, `hora_corte`, `puesta_en_marcha_completada_en`. | (propuesta) | Cubre H2, H3 y el estado del bloqueo con una sola lectura por navegación. |
| H7 | `resolverBloqueoOperativo` hoy exige razón social y RUT, un seller, un conductor, una tarifa y el DTE listo. Es un banner, **no** un bloqueo duro. El layout `(tenant)` no puede redirigir sin entrar en bucle porque no conoce la ruta actual: no hay `x-pathname` ni middleware que la inyecte. | `estado.ts:161`, `layout.tsx:306` | Se necesita separar el layout (sección 8). |
| H8 | La bodega se crea con geocoding **y** inserción en un solo paso, y guarda incluso `no_resuelto`. No existe un "previsualizar ubicación" que no escriba. Sí existe `coordenadaElegida` (pin manual, queda `resuelto` con confianza 1). | `bodegas/actions.ts:277-343`, `:738` | Falta una acción de solo lectura que geocodifica y devuelve candidato. El bloqueo debe exigir `geo_estado = 'resuelto'`, no solo "existe una bodega". |
| H9 | El geocoder devuelve un solo resultado (`resolverCoordenadaConCache`), sin lista de sugerencias. | `resolver-coordenada.ts:159` | No se diseña autocompletado de direcciones. Se diseña "escribir, ubicar, ajustar el pin". |
| H10 | "Confirmar en mapa" solo sirve con calles visibles. CLAUDE.md dice que faltaba publicar los glifos y `NEXT_PUBLIC_MAPA_GLIFOS_URL`. Sin basemap el mapa muestra solo comunas. | CLAUDE.md, sección Torre v2 | Antes de lanzar hay que verificar en producción que el basemap y los glifos estén publicados. Si no, el pin se confirma a ciegas. |
| H11 | No sé si `monto_clp` es neto o con IVA. Nada en `configuracion/tarifas` lo dice. | grep sin resultados | El "te queda" es correcto solo si ambos montos están en la misma base. Pregunta abierta Q3. |
| H12 | No verifiqué cómo obtienen `tarifa_id` las líneas de pedidos Flex. La ingesta ML no escribe `tarifa_aplicable_id` y `generar-lineas.ts:723` inserta `tarifaAplicableId!`. | `tarifas.ts:68-78`, `generar-lineas.ts:723` | Debe confirmarlo `backend` antes de prometer "cobras $X" para Flex. |
| H13 | Los formularios de DTE, folios y cobranza, y los actions `acciones-datos-courier.ts`, viven bajo `/onboarding/*`. Otras pantallas los enlazan: `dinero/periodos`, `dinero/liquidaciones`, `dinero/cobranza`, `dashboard`, `lib/avisos/obtener-avisos.ts`. `components/onboarding/estado-pantalla.tsx` lo usan varios módulos. `src/modules/identidad/onboarding.ts` **no** es esta pantalla: es alta de tenant y activación de perfil, y no se toca. | grep de `/onboarding` | Se borra la UI de asistente y se reubica lo reutilizable (sección 10). |

---

## 1. Principios

1. **El bloqueo es una promesa corta.** Cuatro pantallas, unos cuatro minutos, todo con valor sugerido. Si una pantalla pide más de lo que un dueño sabe de memoria, ese dato no va aquí.
2. **Una pantalla, una decisión.** Cada pantalla resuelve una cosa y tiene un solo botón principal.
3. **Se pregunta lo que Rutax no puede inferir.** Lo que ya se sabe (RUT, correo, comuna elegida) llega prellenado. El RUT no se vuelve a pedir.
4. **Lo fiscal se pide cuando duele.** Al emitir la primera factura, no antes.
5. **El progreso se siente en la interfaz, no se narra.** Barra de cuatro segmentos, transiciones cortas, sin porcentajes y sin celebración.
6. **El texto es la excepción.** Cada texto de este documento trae su justificación. Lo que no la tiene queda vacío, y los vacíos son intencionales.
7. **Nada de checklist.** No hay lista de tareas ni barra de completitud en el producto. El dashboard vacío tiene una sola acción.
8. **Tono visual.** Sobrio premium (Linear/Stripe) **con la marca real de Rutax, sin cambiarla**: acento teal `#00b89a` (texto `#04231e`), tinta `#0b1114`, fondo `#f1f6f6`, líneas `#c6d6d8`, radio 3px, Chivo, logo `MarcaRutax`. Valores medidos en producción; el `--brand` navy de `globals.css` no es lo que se ve. Sin confeti, sin ilustraciones.

---

## 2. Mapa del recorrido

```
rutax.io (portada)
   |  CTA "Crear cuenta" (ya existe hacia /registro; ver Q10)
   v
/login  --- NUEVO enlace "Crear cuenta de courier" ---+
   |                                                    v
   |                                     /registro (4 campos + consentimiento)
   |                                        |-- Google --------> /auth/callback --+
   |                                        '-- Codigo --> /registro/revisa-tu-correo --+
   v                                                                                    v
sesion activa ------------------------------------------------------------> "/" reparte
                                                                                |
                    puesta_en_marcha_completada_en IS NULL (solo dueno)         |
                                     |                                          |
                                     v                                          |
                       /puesta-en-marcha  (sin AppShell)                        |
   1 Tu empresa -> 2 Tu bodega -> 3 Tu operacion -> 4 Zonas y tarifas -> Listo   |
                                     |                                          |
                                     '------------------------------------> /dashboard
                                                                        (una accion siguiente)
```

Cuatro pantallas de trabajo y una de cierre. Servicios y horario van juntos en "Tu operación": son tres interruptores y dos horas, sin dependencia entre sí, y separarlos añadiría una pantalla sin añadir información.

Presupuesto de tiempo, ritmo de referencia:

| Pantalla | Tiempo |
|---|---|
| Tu empresa | ~60 s |
| Tu bodega | ~60-90 s |
| Tu operación | ~30 s |
| Zonas y tarifas | ~60-90 s |
| **Total** | **~4 min** |

Debe medirse con 3 couriers reales (Q9).

---

## 3. Pantallas

### 3.1 Login: agregar "Crear cuenta" (hallazgo H1)

**Cambio.** El pie de `formulario-login.tsx` pasa de un enlace a dos, en una línea, separados por un punto medio:

```
              Crear cuenta de courier  ·  Qué es Rutax
```

**Justificación del texto "Crear cuenta de courier".** Por `/login` también entran sellers y conductores. Un "Crear cuenta" a secas atrae a quien no debe registrarse aquí, y luego se topa con "Ese correo ya tiene una cuenta". Además coincide con la salida que ya ofrece `errorDesdeUrl` para `sin_cuenta`, así que es el mismo nombre en los dos sitios.

**Jerarquía.** Ambos enlaces son texto pequeño subrayado (`text-sm text-fg-subtle`). El registro no compite con "Continuar con Google", que sigue siendo el botón principal del login.

**Se borra.** El subtítulo "Plataforma de despacho y liquidación." Es un eslogan que no ayuda a entrar. Lo confirma `copywriter`.

**Estados.** Sin cambios. El enlace funciona igual con `?error=`.

**Móvil.** Los dos enlaces se apilan a partir de 360 px y quedan centrados. Objetivo táctil mínimo de 44 px de alto (`pointer-coarse:py-3`).

### 3.2 Registro (`/registro`)

**Cambio de forma.** Deja de ser una `Card` de 672 px con dos `fieldset` con ícono. Pasa a la misma columna de 400 px de `MarcoPuerta` que el login. Así "entrar" y "crear cuenta" son la misma puerta.

**Se mantiene**, y el rediseño no lo toca:
- El orden guardar borrador, luego Google o código (`guardarBorradorTenant`).
- La casilla de consentimiento **sin marcar y bloqueante** (Ley 21.719).
- La validación de RUT con máscara y dígito verificador.
- La pantalla de código, que reutiliza `IngresaCodigo`.

```
                    [Rutax]

     Crea tu cuenta

     Nombre de fantasía
     [____________________________]

     RUT de la empresa
     [12.345.678-9_________________]
     (error inline aquí)

     ---------------------------------
     Tu nombre
     [____________________________]

     Tu correo
     [____________________________]

     [ ] Acepto los términos y la política de privacidad.

     [ G  Continuar con Google      ]   <- deshabilitado hasta marcar la casilla
     [    Enviar código             ]

                Ya tengo cuenta
```

**Copy exacto y justificación.**

| Elemento | Texto | Por qué |
|---|---|---|
| Título | `Crea tu cuenta` | Es el título de la acción. "de courier" sobra: el enlace de origen ya lo dice. |
| Subtítulo | *(vacío)* | El actual ("Registra tu empresa en un solo paso. Sin contraseña...") narra mecánica. |
| Labels | `Nombre de fantasía`, `RUT de la empresa`, `Tu nombre`, `Tu correo` | Son el contenido mínimo. "Tu nombre" y "Tu correo" reemplazan el fieldset "Tú, como dueño". |
| Placeholders | Solo en RUT: `12.345.678-9` | El formato del RUT es un dato útil. Los demás se borran. "Ej: Despachos Rápidos SpA" además sugiere razón social en un campo que no lo es. |
| Legends de fieldset | *(vacías)* | Son evidentes por los labels. |
| Casilla | `Acepto los [términos] y la [política de privacidad].` | Legal, con enlaces. Sin "He leído y". |
| Párrafo bajo la casilla ("Rutax trata los datos...") | *(se borra)* | Es contenido de la política de privacidad. Si Legal exige tenerlo aquí, `seguridad-cumplimiento` lo confirma (Q8). |
| Botones | `Continuar con Google` / `Enviar código` | Copy vigente, acortado. |
| Párrafo bajo los botones ("Con Google entras al tiro...") | *(se borra)* | Narra mecánica y la coloquialidad no aporta. |
| Enlace inferior | `Ya tengo cuenta` → `/login` | Es la salida simétrica al enlace del login. |

**Estados y errores.**

| Caso | Tratamiento | Texto |
|---|---|---|
| Campo vacío | Al enviar, foco al primero con error. Mensaje debajo del campo. | `Obligatorio.` |
| RUT con formato incorrecto | Al perder foco, `role="alert"` | `Usa el formato 12.345.678-9.` |
| RUT con dígito verificador inválido | Al perder foco | `El dígito verificador no coincide.` |
| RUT ya registrado | Banner sobre los botones | `Ya existe un courier con este RUT.` |
| Correo con cuenta | Banner con enlace | `Ese correo ya tiene una cuenta.` + enlace `Iniciar sesión` |
| Fallo de Google o de red | Banner | `No pudimos conectar con Google. Intenta de nuevo.` (vigente) |
| Cargando | Botón con spinner y campos `readOnly` (no `disabled`, patrón vigente) | Sin texto extra |
| Móvil | Inputs de 48 px (`pointer-coarse:h-12`), botones a ancho completo. `autoComplete`: `organization`, `off`, `name`, `email`. | — |

**Pregunta que no verifiqué.** Con Google, ¿el correo escrito debe coincidir con el de la cuenta Google? Ese flujo vive en `/auth/callback`. Si no coincide, se debe definir qué pasa (Q7).

**Después del código o de Google.** La persona cae en `/`, que la manda a `/puesta-en-marcha` porque `puesta_en_marcha_completada_en IS NULL`. No hay pantalla de bienvenida intermedia.

---

### 3.3 Marco de la puesta en marcha (común a las 4 pantallas)

Ruta: `/puesta-en-marcha`. **Sin `AppShell`**: sin sidebar, sin avisos, sin navegación. Ver sección 8.

```
+--------------------------------------------------------------+
| [Rutax]                                       Cerrar sesión  |
| [########][########][........][........]      <- 4 segmentos |
|                                                              |
|                  (contenido, max 480 px)                     |
|                                                              |
|   Paso                                          [ Continuar ]|
+--------------------------------------------------------------+
```

**Jerarquía.**
1. Título del paso, `h1`, 24 px semibold (`font-heading`).
2. El campo o zona de trabajo.
3. Botón principal, alineado a la derecha en escritorio. En móvil va a ancho completo en una barra fija inferior con `env(safe-area-inset-bottom)`.
4. Barra de progreso, 2 px de alto y 4 segmentos separados por 4 px. Es un elemento visual, no texto.
5. "Cerrar sesión", texto pequeño arriba a la derecha.

**Copy.**
- Título del paso: sí, es la orientación mínima.
- Botón: `Continuar`. En el último paso de trabajo, `Continuar`. En el cierre, `Entrar`.
- Botón secundario "Atrás": ícono de flecha con `aria-label="Volver"`, sin texto visible. Se muestra desde el paso 2.
- La barra lleva `role="progressbar"`, `aria-valuenow`, `aria-valuemax=4` y texto solo para lector de pantalla: `Paso 2 de 4`. Es texto visible **solo** para tecnología asistiva.
- No hay "Bienvenido", ni "Estás a X pasos", ni "Guardado".

**Guardado.** En cada `Continuar` el servidor persiste el paso (sección 6). El feedback es el propio avance de la barra; no hay toast.

**Ancho.** Contenido de 480 px, centrado. El paso 4 usa 960 px. Se declara en la propia pantalla (patrón de `rutasAnchas` del layout).

---

### 3.4 Paso 1: Tu empresa

**Escribe hoy:** `tenants.nombre_fantasia`, `razon_social`, `telefono_contacto` y `email_contacto`. Todos existen. El teléfono tiene CHECK `^\+[1-9][0-9]{7,14}$` (migración `20260828000002`). Se reutiliza `accionGuardarContacto` para el contacto; `accionGuardarDatosEmisor` pide giro, dirección, comuna y actividad económica, así que no sirve tal cual para este paso (ver Q1).

**Qué se pide y qué no.** Es la mínima identidad para operar y facturar después. Giro, dirección fiscal, comuna fiscal y actividad económica **son fiscales**: van al disparador de la sección 7, no aquí. Lo que sí ya bloquea `resolverBloqueoOperativo` es razón social y RUT. El RUT viene del registro y se muestra fijo.

```
     Tu empresa

     Nombre comercial
     [Despachos del Sur___________]

     Razón social
     [____________________________]

     RUT  76.123.456-7                  <- texto fijo, sin campo

     ---------------------------------
     Teléfono
     [+56] [9 1234 5678__________]

     Correo
     [dueño@correo.cl____________]

     Lo ven quienes esperan un paquete.       <- una línea, bajo Teléfono/Correo

                                    [ Continuar ]
```

**Copy y justificación.**

| Elemento | Texto | Por qué |
|---|---|---|
| Título | `Tu empresa` | Orienta. |
| Labels | `Nombre comercial`, `Razón social`, `Teléfono`, `Correo` | Mínimos. |
| RUT | Línea fija `RUT 76.123.456-7` | Dato ya validado. Editarlo aquí cambiaría la identidad del tenant. |
| Línea `Lo ven quienes esperan un paquete.` | Sí | **Es lo único no obvio de la pantalla**: explica por qué un teléfono y un correo son "públicos". El decidir si van o no depende de que el dueño lo sepa. |
| Separador entre bloques | Línea gris, sin texto | Reemplaza la etiqueta "Contacto público". |

**Prellenados.** `Nombre comercial` = el de fantasía del registro (editable). `Correo` = correo del registro (editable). `Razón social` = vacío: no se debe adivinar un nombre legal.

**Validación.**

| Caso | Texto |
|---|---|
| Razón social vacía | `Obligatorio.` |
| Teléfono con menos de 9 dígitos | `Ingresa 9 dígitos.` |
| Correo inválido | `Correo inválido.` |

El prefijo `+56` va como chip fijo. La máscara `9 1234 5678` se aplica al escribir y se guarda como `+56912345678`. Teléfonos fijos (9 dígitos que empiezan por 2) también se aceptan.

**Estados.**

| Estado | Tratamiento |
|---|---|
| Cargando al entrar | Skeleton de 4 campos, 160 ms de aparición. |
| Error de guardado | Banner sobre el botón: `No pudimos guardar. Reintenta.` |
| Reanudación | Campos con lo ya guardado. |
| Móvil | Una columna; teclado `tel` para el teléfono y `email` para el correo. |

---

### 3.5 Paso 2: Tu bodega

**Escribe hoy:** `identidad.courier_bodegas` con `nombre`, `direccion`, `comuna`, `lat`, `long`, `geo_estado`, `es_principal`. `accionCrearBodegaCourier` ya acepta `coordenadaElegida`. El geocoding es síncrono (`resolverCoordenadaConCache`). **Falta:** una acción de previsualización que no escriba (H8) y fijar `es_principal = true` en la primera bodega (hoy hay índice parcial que la permite como máximo una).

**Idea central.** Escribir dirección y comuna, ver el pin sobre el mapa, confirmar. La confirmación **es** el botón principal. No existen "guardar" y "confirmar" separados.

```
     Tu bodega

     Dirección                          Comuna
     [Av. Los Leones 1234____]          [Providencia          v]

     +-----------------------------------------------------+
     |                                                     |
     |                    (mapa 280 px)                    |
     |                        (o)  <- pin arrastrable      |
     |                                                     |
     +-----------------------------------------------------+
     Arrastra el pin si no está exacto.

                                     [ Confirmar ubicación ]
```

**Copy y justificación.**

| Elemento | Texto | Por qué |
|---|---|---|
| Título | `Tu bodega` | |
| Labels | `Dirección`, `Comuna` | La dirección va sin comuna en el campo, porque la comuna es un selector aparte (`COMUNAS_RM`, con búsqueda). |
| Ayuda del mapa | `Arrastra el pin si no está exacto.` | **Es la única pista de cómo corregir.** Aparece solo cuando hay un pin resuelto. |
| Botón | `Confirmar ubicación` | Cambia la semántica del botón: confirmar es la acción. |
| Nombre de la bodega | *(no se pide)* | Se guarda como `Bodega principal`. Editable en `/configuracion/bodegas`. Un dueño con una bodega no necesita nombrarla. |

**Comportamiento del geocoding.**
- Se dispara al **perder foco** el campo Dirección con la comuna elegida, o al elegir la comuna con la dirección ya escrita. No hay geocoding por tecla.
- Si el geocoder devuelve `resuelto`, el mapa hace `flyTo` a la coordenada (280 ms, `ease-out`) y cae el pin.
- El pin es arrastrable y también se puede tocar el mapa para moverlo.
- Cambiar dirección o comuna después de mover el pin **vuelve a geocodificar** y descarta el ajuste manual. Se acepta por ser la conducta esperable.

**Estados.**

| Estado | Qué se ve | Botón principal | Texto |
|---|---|---|---|
| Vacío | Mapa centrado en Santiago, sin pin, comunas en gris | Deshabilitado | *(ninguno)* |
| Ubicando | Spinner dentro del campo Dirección; pin fantasma | Deshabilitado | *(ninguno)* |
| Resuelto | Pin sólido sobre la calle | Habilitado | Ayuda del pin |
| Tarda (más de 4 s) | Igual a ubicando | Deshabilitado | `Está tardando.` |
| No resuelto | Mapa sobre la comuna, cursor de cruz; el toque coloca el pin | Habilitado al colocar pin | `No encontramos esa dirección. Toca el mapa para ubicarla.` |
| Fuera de cobertura (o pin fuera de la RM) | El pin no se fija | Deshabilitado | `Esa dirección está fuera de la Región Metropolitana.` |
| Error de red o servidor | Igual a no resuelto | Habilitado al colocar pin | `No pudimos ubicarla. Reintenta o toca el mapa.` + botón `Reintentar` |
| Sin basemap (solo comunas) | Solo polígonos comunales | Habilitado | Ver H10: **no se debe lanzar** así |

**El bloqueo exige coordenada resuelta.** Si la persona solo tiene un `no_resuelto`, no avanza. Un `Confirmar` con pin manual es válido y queda `resuelto` con confianza 1 (comportamiento vigente de `coordenadaElegida`).

**Móvil.** El mapa mide 240 px y se apila bajo los campos. El pin se ajusta con un toque en vez de arrastre. La barra inferior fija lleva `Confirmar ubicación`. Teclado con `enterkeyhint="next"`.

---

### 3.6 Paso 3: Tu operación (servicios y horario)

**Escribe hoy:** nada de esto tiene columna (H2, H3). Con la tabla de H6, `servicios` (arreglo) y las dos horas. Alternativa mínima para servicios (Q4): no guardarlos y derivarlos de qué tarifas existen.

```
     Tu operación

     +----------------------------------------------------+
     | Pedidos propios                              [ ok ] |   <- fijo, activo
     +----------------------------------------------------+
     | Mercado Libre Flex                            ( o  ) |
     +----------------------------------------------------+
     | Shopify                                       ( o  ) |
     +----------------------------------------------------+

     Salida a reparto            Corte
     [ 16:00 ]                   [ 21:00 ]
     5 h de reparto

                                              [ Continuar ]
```

**Copy y justificación.**

| Elemento | Texto | Por qué |
|---|---|---|
| Título | `Tu operación` | |
| Tarjetas | `Pedidos propios`, `Mercado Libre Flex`, `Shopify` | Son los nombres visibles reales de las fuentes (`etiqueta-fuente-pedido.ts`). "Same-day" **no** se muestra: el commit `cd32047` lo sacó de la interfaz. |
| Marca en "Pedidos propios" | Ícono de check y `aria-label="Incluido"`; sin texto visible | Incluido por defecto (decisión 3). No hace falta explicarlo. |
| Labels | `Salida a reparto`, `Corte` | Son los dos horarios del día real (CLAUDE.md, alcance de retiro). |
| Línea `5 h de reparto` | Cálculo en vivo entre las dos horas, `tabular-nums` | Es un dato, no una explicación. Ayuda a notar un error de horario (p. ej. 16:00 a 06:00). |
| Descripciones bajo cada servicio | *(vacías)* | El nombre alcanza. |

**Valores sugeridos.** `Salida a reparto = 16:00` y `Corte = 21:00` (CLAUDE.md: despacho desde las 16:00, corte entre 21:00 y 22:00). El paso se puede aceptar sin tocar nada.

**Efectos de cada interruptor.**
- **Flex activado:** el paso 4 muestra la fila de plataforma Flex. Nada más cambia en el producto hoy.
- **Shopify activado:** hoy no cambia nada, porque Shopify se cobra como same-day. La fila de Shopify aparece en el paso 4 solo si el modelo lo permite (H4/Q5).
- Ambos apagados: se permite. Es un courier de pedidos propios.

**Validación.**

| Caso | Texto |
|---|---|
| Corte antes o igual que la salida | `El corte debe ser después de la salida.` |
| Diferencia menor a 1 h | *(permitido, sin aviso)* |

**Pregunta de semántica (Q2).** No es seguro que `hora_corte` de `ventanas_corte` signifique lo mismo que "corte de reparto". Se documenta antes de escribirlo.

**Móvil.** Las tarjetas ocupan el ancho. Las horas usan selector nativo `type="time"` con `step=900`.

---

### 3.7 Paso 4: Zonas y tarifas

Es la pantalla más importante: el primer contacto con el motor entrega→dinero. Es la única pantalla ancha (960 px).

**Escribe hoy (parcial, ver H4/H5).**
- `identidad.zonas` y `identidad.zona_comunas` mediante `actionGuardarZona` (crea zona y comunas atómicamente; una comuna pertenece a una sola zona por tenant).
- `identidad.tarifas` con `monto_clp` (cobras), `monto_conductor_clp` (pagas), `tipo_entrega`, `modo_calculo = 'por_zona'`, `zona_id`, `seller_id = NULL` (tarifa por defecto del tenant), `vigente_desde = hoy`.
- `zona_id` **no se puede escribir** con `accionCrearTarifa` (H5).
- Aunque se escriba, **el motor no la usa para cobrar** (H4).

```
     Zonas y tarifas

  +-------------------------------+   +--------------------------------------+
  |                               |   | Zona 1 · Gran Santiago urbano    34  |
  |    (mapa RM, comunas          |   |  Cobras        Pagas        Te queda |
  |     coloreadas por zona)      |   |  $ [3.500]     $ [2.400]    $1.100   |
  |                               |   |                              (31 %)  |
  |                               |   +--------------------------------------+
  |                               |   | Zona 2 · Periferia               18  |
  |  Pincel: (Zona 1)(Zona 2)(--) |   |  $ [5.500]     $ [3.800]    $1.700   |
  |                               |   |                              (31 %)  |
  +-------------------------------+   +--------------------------------------+
      Mapa | Lista                       [ ] Diferenciar por plataforma
                                                            [ Continuar ]
```

**Preset.**
- **Zona 1 · Gran Santiago urbano** = las 32 comunas de la provincia de Santiago + Puente Alto + San Bernardo = **34**: Cerrillos, Cerro Navia, Conchalí, El Bosque, Estación Central, Huechuraba, Independencia, La Cisterna, La Florida, La Granja, La Pintana, La Reina, Las Condes, Lo Barnechea, Lo Espejo, Lo Prado, Macul, Maipú, Ñuñoa, Pedro Aguirre Cerda, Peñalolén, Providencia, Pudahuel, Quilicura, Quinta Normal, Recoleta, Renca, San Joaquín, San Miguel, San Ramón, Santiago, Vitacura, Puente Alto, San Bernardo.
- **Zona 2 · Periferia** = las otras **18** comunas de `COMUNAS_RM`: Alhué, Buin, Calera de Tango, Colina, Curacaví, El Monte, Isla de Maipo, Lampa, María Pinto, Melipilla, Padre Hurtado, Paine, Peñaflor, Pirque, San José de Maipo, San Pedro, Talagante, Tiltil.
- 34 + 18 = 52, el catálogo completo. **Periferia es el respaldo:** toda comuna que la persona no pinte en Zona 1 cae ahí. Así ninguna comuna queda sin tarifa (ver Q6 sobre comunas remotas).
- La geometría sale de `public/mapas/comunas-rm.topojson.json` (comunal, nunca disuelta por zona; el disuelto lo hace el cliente).

**Editar comunas.**
- Selector "pincel" con tres estados: Zona 1, Zona 2 y "Sin cobertura". Un toque o arrastre sobre el mapa pinta la comuna con el pincel activo.
- "Sin cobertura" existe pero **no está en el preset**. Una comuna sin cobertura debe decidir qué pasa con un pedido a esa comuna (Q6).
- Pestaña **Lista** con casillas por comuna, agrupadas por zona. Es la vía accesible por teclado y la única en móvil.
- El conteo (`34`, `18`) y el color de cada comuna se actualizan en tiempo real.

**Tarifas.**
- Una tarifa general por zona: dos campos (`Cobras`, `Pagas`) y el resultado `Te queda`. Cuando el margen es positivo se muestra en texto normal; en cero o negativo, en color de atención (`--warning`), no en rojo.
- "Diferenciar por plataforma" está apagado por defecto. Al encenderlo, cada zona se expande en una fila por plataforma activa en el paso 3, prellenada con el valor general. No se reescribe nada.
- La fila de Shopify depende de H4/Q5: mientras el modelo de tarifa sea por `tipo_pedido`, esa fila no se muestra (Shopify se cobra como same-day, es decir, como "Pedidos propios").

**Valores sugeridos** (a validar con couriers reales, Q9): Zona 1 cobras $3.500 / pagas $2.400; Zona 2 cobras $5.500 / pagas $3.800. Los montos deben salir de una sola constante, no de cadenas repartidas por la pantalla.

**Copy y justificación.**

| Elemento | Texto | Por qué |
|---|---|---|
| Título | `Zonas y tarifas` | |
| Encabezado de zona | `Zona 1 · Gran Santiago urbano` (nombre editable en línea) y contador `34` | Nombre y tamaño de la zona. |
| Columnas | `Cobras`, `Pagas`, `Te queda` | Son las tres cifras del motor entrega→dinero. Sin explicación. |
| Porcentaje `(31 %)` | Sí | El margen en % es lo que compara zonas de un vistazo. |
| Toggle | `Diferenciar por plataforma` | Nombra la acción. |
| Pestañas | `Mapa` / `Lista` | |
| Pincel | `Zona 1`, `Zona 2`, `Sin cobertura` | Los nombres reales de las zonas, editables. |
| Ayudas o tooltips sobre el margen | *(vacías)* | Se ve en vivo, no requiere narración. |

**Validación.**

| Caso | Tratamiento | Texto |
|---|---|---|
| `Cobras` vacío o 0 | Bloquea | `Ingresa un monto.` |
| `Pagas` vacío o 0 | Bloquea. Un `monto_conductor_clp` en 0 fue el bug que dejó toda liquidación en $0 (`accionCrearTarifa`, comentario en línea 56). | `Ingresa un monto.` |
| Margen negativo | **No bloquea.** El campo `Te queda` se pinta en atención. | `Pierdes $X por entrega.` (solo cuando es negativo) |
| Montos no enteros | Se ignoran decimales | — |
| Zona sin comunas | Bloquea al continuar | `Asigna al menos una comuna.` |

**Formato.** CLP con separador de miles (`$3.500`), `inputMode="numeric"`, `tabular-nums`. Los montos son enteros.

**Estados.**

| Estado | Tratamiento |
|---|---|
| Cargando | Mapa gris con skeleton; las dos zonas aparecen con los valores sugeridos ya escritos |
| Error de guardado | Banner: `No pudimos guardar. Reintenta.` La zona y las tarifas se guardan **en una sola operación** (ver sección 6), así un fallo no deja zonas sin tarifa. |
| Móvil | Se invierte el orden: primero las dos tarjetas de zona con sus cifras y luego un botón `Ver comunas`, que abre una hoja con la Lista. No se pinta sobre un mapa de 320 px. |

**Nota de honestidad hacia el dueño.** Si el backend de H4 no se corrige antes del lanzamiento, esta pantalla **no debe mostrar dos tarifas por zona** porque el motor cobraría una sola. La alternativa transitoria es mostrar una tarifa general y esconder el mapa de zonas.

---

### 3.8 Cierre: Listo

Pantalla breve de confirmación. No es un checklist: es el resumen de lo que se acaba de decidir, con cada renglón editable.

```
     Todo listo, Despachos del Sur

     Bodega        Av. Los Leones 1234, Providencia
     Servicios     Pedidos propios · Mercado Libre Flex
     Horario       16:00 a 21:00
     Zonas         Gran Santiago urbano $3.500 · Periferia $5.500

                                                  [ Entrar ]
```

| Elemento | Texto | Por qué |
|---|---|---|
| Título | `Todo listo, {nombre comercial}` | Es la única frase de cierre; personaliza sin adjetivos. |
| Renglones | Etiqueta gris + valor | El valor es dato real, no promesa. Cada renglón es un enlace al paso correspondiente. |
| Botón | `Entrar` | |
| Sin subtítulo, sin "Siguientes pasos" | | Lo que sigue lo dice el dashboard, con una sola acción (sección 9). |

Al pulsar `Entrar`, el servidor valida que los cuatro pasos sigan completos, fija `puesta_en_marcha_completada_en = now()` y registra en bitácora `identidad.puesta_en_marcha_completada` con `actorUsuarioId`. Luego navega a `/dashboard`.

---

## 4. Microinteracciones y movimiento

Se reutilizan los tokens de `globals.css`: `--motion-instant` 100 ms, `--motion-fast` 160 ms, `--motion-base` 220 ms, `--motion-slow` 320 ms, `--motion-page` 400 ms. No hay librería de animación en `package.json`, así que todo es CSS.

| Elemento | Movimiento | Duración | Easing |
|---|---|---|---|
| Cambio de paso | Sale la pantalla actual (opacidad 1 a 0, desplazamiento −8 px) y entra la siguiente (opacidad 0 a 1, +12 px a 0) | 220 ms (`--motion-base`) | `cubic-bezier(0.2, 0, 0, 1)` |
| Barra de progreso | El segmento se rellena de izquierda a derecha con `--brand` | 320 ms (`--motion-slow`) | `ease-out` |
| Aparición del pin | Cae 8 px con opacidad 0 a 1 | 160 ms (`--motion-fast`) | `ease-out` |
| `flyTo` del mapa | Vuelo hacia la coordenada | 280 ms | `ease-in-out` |
| Pintar una comuna | Transición de color de relleno | 160 ms | `linear` |
| Cifra `Te queda` | Cambio de valor con interpolación numérica | 200 ms | `ease-out`, `tabular-nums` |
| Botón al guardar | Spinner interno; sin cambio de ancho | Hasta que responde el servidor | — |
| Error de campo | Aparece con opacidad 0 a 1 | 100 ms (`--motion-instant`) | — |
| Salida a `/dashboard` | Fundido cruzado | 400 ms (`--motion-page`) | `ease-out` |

**`prefers-reduced-motion: reduce`.**
- Todo desplazamiento se elimina; se conserva solo un fundido de 100 ms.
- La barra rellena sin animar.
- El `flyTo` pasa a `jumpTo`; el pin aparece sin caída.
- La interpolación numérica se elimina y el valor cambia de inmediato.

**Lo que no hay:** confeti, sonidos, íconos animados, contadores de "pasos restantes", texto que se escribe solo.

---

## 5. Foco, teclado y accesibilidad

- Al entrar a un paso, el foco va al primer campo (o al título si no hay campos).
- `Enter` en el último campo equivale a `Continuar`.
- Los errores usan `role="alert"` y llevan el foco al primer campo con error.
- El mapa no es la única vía de nada: la bodega admite escribir dirección, y las comunas admiten la pestaña Lista.
- Color nunca es el único portador de significado: las zonas llevan nombre y conteo; el margen en atención lleva el texto `Pierdes $X por entrega.`.
- Contraste: se usan los pares de `globals.css` (`--brand` sobre blanco cumple AAA; `--warning-foreground` oscuro sobre fondo naranja).

---

## 6. Cómo se guarda y se retoma el avance

**Regla.** Cada `Continuar` persiste el paso en el servidor. No hay borrador de servidor a medio paso: lo que no se ha continuado no está guardado.

**Qué se pierde al cerrar la pestaña.** Como mucho, los campos de una pantalla (2 a 4 valores). Mitigación barata: guardar los valores no confirmados en `sessionStorage` por paso y restaurarlos al volver.

**Cómo se sabe en qué paso va.** El estado se **deriva de los datos**, no de un contador que se pueda desincronizar:

| Paso | Completo cuando |
|---|---|
| 1 Tu empresa | `razon_social` y `rut` no vacíos, y hay `telefono_contacto` o `email_contacto` |
| 2 Tu bodega | Existe una fila activa de `courier_bodegas` con `es_principal` y `geo_estado = 'resuelto'` |
| 3 Tu operación | Existe fila en `courier_config_operacion` con horas válidas (H6) |
| 4 Zonas y tarifas | Hay al menos una zona activa con comunas y al menos una tarifa activa por cada plataforma habilitada |

Al entrar a `/puesta-en-marcha` el servidor calcula el primer paso incompleto y redirige ahí. Volver a pasos anteriores es libre (`?paso=`); saltar adelante de un paso incompleto **no**: el servidor redirige al primero incompleto.

**Editar un paso ya completado.** Los cambios sobreescriben. Para tarifas, mientras no exista ningún pedido que haga referencia a la tarifa, se actualiza en el lugar; pasado ese punto rige el versionado por vigencia del motor. En la puesta en marcha aún no hay pedidos, así que basta con actualizar. `backend` decide si conviene una operación única `guardarZonasYTarifas` (transacción o RPC) para no dejar zonas sin tarifas.

**Bitácora.** Cada tarifa creada sigue registrando `identidad.tarifa_creada` (con autor, patrón vigente). Se agrega `identidad.puesta_en_marcha_completada`. Los pasos de empresa y bodega ya registran su propia acción.

**Si el usuario cierra sesión a mitad.** Al volver, entra directo al primer paso incompleto. No hay pantalla de "retomar".

---

## 7. Disparadores just-in-time de lo fiscal

**Qué sale de la puesta en marcha y adónde va:**

| Dato | Va a | Cuándo se pide |
|---|---|---|
| Giro, dirección fiscal, comuna, actividad económica (`CAMPOS_EMISOR`) | Hoja "Antes de facturar" | Al pulsar **Emitir factura** por primera vez |
| Proveedor DTE y certificado | Hoja "Antes de facturar" | Ídem |
| Folios CAF | Hoja "Antes de facturar", **solo si** el proveedor no los gestiona (`proveedorGestionaFolios`) | Ídem |
| Cuenta bancaria (`courier_datos_cobro`) | Hoja "Antes de facturar" como último renglón omitible | Ídem |
| Retención de boleta de terceros (`courier_config_payout`) | Hoja "Antes de pagar" | Al pulsar **Pagar** o **Aprobar** en la primera liquidación de un conductor independiente |
| Periodicidad de facturación | Se queda con su valor por defecto (mensual). No hay disparador. Editable en `/configuracion/tarifas?seccion=periodos`. | — |
| Pago por visita a bodega | No se pide. La migración `20260816000002` ya cae al monto de la tarifa de entrega. | — |
| Conciliación bancaria (Fintoc) | La pantalla `/dinero/cobranza`, con su estado vacío que enseña su acción | Al entrar |
| Plan de Rutax | Fuera de este flujo (Q5) | — |

**Disparador 1: "Antes de facturar".**
- **Dónde:** botón **Emitir factura** en `dinero/periodos`.
- **Qué pasa:** si falta algo fiscal, el clic no emite; abre una hoja lateral (no una redirección). Muestra **solo los renglones que faltan**, uno por vez, con paso `1 de 3`.
- **Al terminar el último renglón** la hoja se cierra y el botón queda listo para emitir. El clic ya hecho **no** emite solo: la emisión sigue exigiendo la acción humana (regla de CLAUDE.md, "Compuerta de aprobación de facturación").
- **Servidor:** `emitirFacturaPeriodo` debe rechazar por sí mismo si falta algo fiscal (preflight, patrón vigente). La hoja es cortesía, no la barrera.
- **Reutiliza** los formularios existentes de DTE, folios y datos del emisor, movidos fuera de `/onboarding/*` (sección 10).
- **Cerrar un período NO dispara nada fiscal.** El cierre solo cierra y dispara conciliación (regla vigente). Pedir datos fiscales ahí sería fricción sin necesidad. La consecuencia es que el dueño descubre la falta al emitir, no al cerrar.

**Disparador 2: "Antes de pagar".**
- **Dónde:** acción de pago o aprobación en `dinero/liquidaciones`.
- **Qué pasa:** si el conductor es independiente y no hay `courier_config_payout`, la hoja pide el porcentaje de retención con la tasa vigente del año como sugerencia. La tasa exacta la confirma `seguridad-cumplimiento`, no este documento (Q11).

**Copy de las hojas** (mínimo):

| Elemento | Texto |
|---|---|
| Título de hoja de factura | `Antes de facturar` |
| Título de hoja de pago | `Antes de pagar` |
| Indicador | `1 de 3` |
| Botón | `Continuar` |
| Renglón bancario | Botón secundario `Después` (único omitible) |

No hay párrafo que explique por qué se pide. El título ya lo dice.

**Aviso pasivo.** En `dinero/periodos`, mientras haya un período cerrado sin emitir y falte lo fiscal, la fila del período muestra en su botón el mismo estado que abrirá la hoja. No se agrega banner global.

---

## 8. Regla de bloqueo en el layout

**Problema técnico (H7).** `(tenant)/layout.tsx` no sabe la ruta actual. Un `redirect('/puesta-en-marcha')` dentro de él entraría en bucle, porque `/puesta-en-marcha` se renderiza dentro del mismo layout.

**Solución recomendada.** Separar el layout en dos capas con un grupo de rutas (los nombres entre paréntesis no cambian las URL):

```
src/app/(tenant)/
  layout.tsx                 <- solo guardas de sesión/tipo de usuario (las que ya hace)
  puesta-en-marcha/          <- ruta bloqueada: marco propio, SIN AppShell
    layout.tsx
    page.tsx
  (operativo)/
    layout.tsx               <- AppShell + gate: si falta puesta en marcha -> redirect('/puesta-en-marcha')
    dashboard/  operaciones/  manifiestos/  dinero/  configuracion/  equipo/  ...   <- se mueven aquí
```

**Costo.** Mover todas las pantallas existentes de `(tenant)` a `(tenant)/(operativo)` es un cambio mecánico y grande de rutas de archivo, sin efecto en las URL. El nombre `(operativo)` evita chocar con el grupo `(app)/` heredado que CLAUDE.md marca para limpiar.

**Alternativa descartada:** poner el gate en un `proxy.ts`/middleware con cookie. Complica la sesión y no da más seguridad (el aislamiento real es RLS, no esta pantalla).

**Quién es bloqueado.**
- **Dueño con la puesta en marcha incompleta:** redirect a `/puesta-en-marcha`.
- **Otro rol interno** (supervisor, coordinador, administración) de un courier no terminado: no puede completar por sí mismo. Ve una pantalla mínima con el nombre del courier y `Cerrar sesión`. Sin texto explicativo largo (Q12: qué texto exacto).
- **Couriers ya existentes: no se bloquean.** Al desplegar, una migración marca `puesta_en_marcha_completada_en = now()` para todos los tenants existentes. Solo los tenants creados después pasan por el bloqueo. Sin esto se bloquearía a un courier que ya opera.

**Rutas permitidas mientras esté bloqueado:**

| Ruta | Motivo |
|---|---|
| `/puesta-en-marcha` y sus Server Actions | El flujo |
| Cerrar sesión (`cerrarSesion`) | Salida siempre disponible |
| `/auth/*`, `/login` | Autenticación |
| `/terminos`, `/privacidad` | Enlaces legales (públicas) |
| El endpoint de previsualizar ubicación y tiles/glifos/topojson del mapa | El paso 2 y 4 |
| `/api/inngest` y webhooks | No dependen de la sesión de usuario |

Todo lo demás bajo `(tenant)/(operativo)` redirige. **Impersonación del backstage:** usa la sesión del courier, por lo que pasa por el mismo bloqueo, y eso es correcto: soporte puede completar la puesta en marcha en nombre del dueño.

**El gate es una lectura.** `puesta_en_marcha_completada_en` en `courier_config_operacion`: una consulta con `head: true`, en vez de las cinco de `resolverBloqueoOperativo` que corren hoy en cada navegación.

---

## 9. Dashboard vacío: una sola siguiente acción

**Dónde.** `/dashboard`, para el dueño, mientras no haya un pedido real.

**Regla.** Se evalúa en orden y se muestra **la primera** que aplique. Nunca dos.

| # | Condición | Acción | CTA |
|---|---|---|---|
| 1 | Sin sellers | Invitar al primer seller | `Copiar enlace` (enlace permanente de autoservicio, ya existe en `/sellers/enlace`) + `Invitar por correo` |
| 2 | Sin conductores activos | Sumar al primer conductor | `Invitar conductor` |
| 3 | Con seller y conductor, sin pedidos | Esperar el primer pedido | Estado pasivo + `Crear pedido de prueba` (existe `actionCrearSameDayPrueba`, ver Q13) |
| — | Hay al menos un pedido real | **No se muestra** | — |

```
     +--------------------------------------------------------+
     |                                                        |
     |   Invita a tu primer seller                            |
     |                                                        |
     |   [ Copiar enlace ]       Invitar por correo           |
     |                                                        |
     +--------------------------------------------------------+
```

**Copy y justificación.**

| Elemento | Texto | Por qué |
|---|---|---|
| Título 1 | `Invita a tu primer seller` | Verbo + objeto, sin más. |
| Título 2 | `Suma a tu primer conductor` | Idem. |
| Título 3 | `Esperando el primer pedido` | Estado, no tarea. |
| Cuerpo | *(vacío)* | El título y el botón bastan. |
| CTA 1 | `Copiar enlace` | Un clic para pegar en WhatsApp; es el camino más corto (objetivo transversal de reducir clics y mensajes). Confirmación: el botón cambia a `Copiado` 1,5 s. |

**Qué no hay.** No hay barra de completitud, no hay "2 de 5 tareas", no hay lista de las acciones futuras. La grilla de KPIs del dashboard **no se renderiza** hasta el primer pedido: mostrar métricas en cero es ruido. Al llegar el primer pedido, la tarjeta se apaga (desaparece con fundido de 220 ms) y el dashboard normal aparece.

**Se apaga para siempre** con el primer pedido real y no vuelve, incluso si luego se borran pedidos. Se deriva de la existencia de pedidos, sin flag adicional.

**Módulos vacíos.** `/sellers` y `/conductores` sin datos usan `EstadoVacio` (`components/onboarding/estado-pantalla.tsx`, que hay que **reubicar**, H13) con **la misma acción** que el dashboard. Sin texto largo: un título y el botón.

**Roles.** Solo el dueño ve la tarjeta. Los demás roles ven los estados vacíos de los módulos, sin la tarjeta.

**Sidebar.** Los ítems de módulos vacíos permanecen visibles y sin insignias. No se esconde navegación.

---

## 10. Qué se borra del código actual

**Se elimina (asistente y checklist):**
- `src/app/(tenant)/onboarding/page.tsx`, `lista-pasos.tsx`, `marco-paso.tsx`, `pasos.ts`, `pasos.test.ts`.
- `src/components/onboarding/banner-onboarding.tsx` y su uso en `(tenant)/layout.tsx` (líneas 28, 301-311 y el render del banner).
- El ítem de navegación "Puesta en marcha" (`layout.tsx:209`) y el ícono `puesta-en-marcha` de `iconos-nav.ts`.
- `resolverEstadoOnboarding` y `EstadoOnboardingCourier` de `estado.ts` (catorce consultas ya sin lector).
- `resolverBloqueoOperativo`: se reemplaza por la lectura única del gate (sección 8). Sellers, conductores, DTE y tarifas dejan de ser condición de "poder operar".

**Se conserva y se reubica (no se puede borrar sin romper otras pantallas):**
- `onboarding/dte/*`, `onboarding/folios/*`, `onboarding/cobranza/*` y `onboarding/tarifas/actions.ts`. Se mueven a una ruta neutra como `/configuracion/facturacion/*`, porque son el destino de los disparadores JIT.
- Los enlaces que hoy apuntan a `/onboarding/folios` y `/onboarding/cobranza` se retargetan: `dinero/periodos/page.tsx:246`, `dinero/liquidaciones/page.tsx:307`, `dinero/cobranza/page.tsx:180`, `dashboard/page.tsx:517`, `lib/avisos/obtener-avisos.ts:114`.
- Los textos de error que citan `/onboarding/tarifas`: `operacion/pedidos.ts:1189`, `portal/pedidos/nuevo/actions.ts:81` y la prueba `pedidos.test.ts:1602`.
- `acciones-datos-courier.ts`: `accionGuardarDatosEmisor`, `accionGuardarDatosCobro` y `accionGuardarRetencion` se reubican junto a sus hojas JIT. `accionGuardarContacto` se reutiliza en el paso 1.
- `components/onboarding/estado-pantalla.tsx` (`EstadoVacio`, `EstadoError`, `EstadoCargando`): usado por `panel-equipo`, `panel-conexion-ml`, `configuracion/plan`, `seccion-mis-bodegas`. Se mueve a `components/ui/` o `components/estado/`.
- `src/modules/identidad/onboarding.ts` (alta de tenant, activación de perfil): **no se toca**.

**Se agrega:**
- La ruta `/puesta-en-marcha` y su layout sin `AppShell` (sección 8).
- La tabla `courier_config_operacion` (H6) con su migración, backfill de tenants existentes y pgTAP de aislamiento.
- La acción de previsualizar ubicación (H8).
- El cambio a `resolverTarifaVigente` por comuna→zona (H4) y la ampliación de la acción de tarifas para `zona_id` (H5).
- La tarjeta `SiguienteAccion` del dashboard.

---

## 11. Criterios para el frontend

1. Sin `AppShell` en `/puesta-en-marcha`; contenido de 480 px, salvo el paso 4 a 960 px.
2. Ningún texto fuera de las tablas de este documento sin pasar por `copywriter` (regla dura de CLAUDE.md). Todo texto que aquí quedó "vacío" se queda vacío.
3. Fechas y horas siempre por `src/lib/formato-cl.ts`. Las horas de salida y corte se guardan como `time` local de Santiago, sin zona.
4. RUT con `enmascararRut`, `limpiarMascaraRut` y `esRutValido` (ya en `registro`).
5. Comunas siempre desde `src/lib/ui/comunas-rm.ts`; CLP con el helper de `src/lib/ui/formato-moneda.ts`; nombre de fuente con `etiqueta-fuente-pedido.ts`.
6. MapLibre 5.24.0 (clavado; no subir a 6.x). Nodos que MapLibre marca con sus clases se posicionan con estilos en línea, no con utilidades de Tailwind (gotcha de capas CSS de CLAUDE.md).
7. Dos pruebas manuales obligatorias antes de cerrar (regla del proyecto: una pantalla no se cierra sin verla): el flujo completo en móvil de 360 px y en escritorio, y el paso 4 con las 52 comunas pintadas.
8. Revisar overflow en la hoja "Antes de facturar" en viewport bajo (regla del proyecto para modales).
9. Objetivos táctiles de 48 px en `pointer-coarse`, barra de acción fija con `safe-area-inset-bottom`.
10. El gate del layout se prueba con pruebas de ruta: dueño con puesta en marcha pendiente, dueño completo, otro rol, y tenant existente (backfill).

---

## 12. Preguntas abiertas reales

| # | Pregunta | Por qué importa | Quién decide |
|---|---|---|---|
| Q1 | ¿La razón social se pide aquí (como propone este documento) o se difiere a "Antes de facturar" con el resto del emisor? Hoy `resolverBloqueoOperativo` la exige. | Añade un campo al paso 1. Diferirla lo deja en dos: teléfono y correo. | Usuario |
| Q2 | ¿Qué significa exactamente `hora_corte` en `ventanas_corte`? ¿Es el corte de **ingreso** de pedidos para comprometer el mismo día, o el fin del **reparto**? Y `Salida a reparto`, ¿dónde vive? | El resolvedor de ventanas debe usar el horario del courier como respaldo cuando un seller no tiene ventana propia. | `arquitecto` |
| Q3 | ¿`monto_clp` y `monto_conductor_clp` son netos o con IVA? | El `Te queda` es engañoso si las bases difieren, y la etiqueta debe decir la base. | Usuario y `backend` |
| Q4 | ¿Se guardan los servicios en `courier_config_operacion` o se derivan de las tarifas? | Derivar evita un estado que se pueda desincronizar, pero Shopify no se puede derivar hasta que el modelo distinga la plataforma. | `arquitecto` |
| Q5 | ¿Se cambia el modelo de tarifa para separar Shopify de pedidos propios? ¿Y qué pasa con el plan de suscripción a Rutax que se retira del asistente? ¿El tenant arranca en prueba automáticamente? | Determina si la fila de Shopify aparece en el paso 4, y quién inicia la suscripción si ya no es un paso. | `arquitecto` y usuario |
| Q6 | Comunas remotas de Periferia (Alhué, San Pedro, María Pinto, Melipilla, Curacaví): ¿se cobran como el resto, van a una tercera zona o quedan "Sin cobertura"? Y ¿qué hace el sistema con un pedido a una comuna sin cobertura: lo rechaza, lo marca, lo cobra con Periferia? | Un pedido Flex llega desde ML sin poder rechazarse. Una comuna sin tarifa se entrega y no se cobra. | Usuario |
| Q7 | Con Google, ¿el correo escrito en el registro debe coincidir con el de la cuenta Google? No verifiqué `auth/callback`. | Define un error posible en el registro. | `backend` |
| Q8 | ¿El texto "Rutax trata los datos de tus conductores y destinatarios por encargo tuyo" debe estar en el registro por exigencia legal o basta la política? | Es el único párrafo de consentimiento que se propone borrar. | `seguridad-cumplimiento` |
| Q9 | Valores sugeridos de tarifa ($3.500/$2.400 y $5.500/$3.800) y el presupuesto de 4 minutos: son supuestos míos, no medidos. | Un valor sugerido erróneo se acepta sin mirar y se cobra. | Usuario, con 2 o 3 couriers reales |
| Q10 | ¿El CTA de la portada ya lleva a `/registro`? El comentario de `src/app/page.tsx` habla de "brecha #9" (el registro no tenía enlaces entrantes). No verifiqué si se cerró. | El recorrido completo empieza ahí. | `frontend` |
| Q11 | Tasa de retención de boleta a sugerir en "Antes de pagar". | Es un dato legal que cambia por año. | `seguridad-cumplimiento` |
| Q12 | Pantalla del rol no dueño mientras la empresa no termina la puesta en marcha: ¿qué se le dice, y cómo se avisa al dueño? | Hoy no hay caso, porque el dueño es el primer usuario. Aparece si backstage crea el courier y alguien más entra primero. | Usuario |
| Q13 | ¿El pedido de prueba cuenta como "primer pedido real" y apaga la tarjeta del dashboard? | Si cuenta, el dueño que prueba pierde la guía sin haber recibido nada real. | Usuario |

---

## 13. Lo que no verifiqué

- No abrí el navegador. Nada de esto es una pantalla probada; es un diseño sobre lectura de código.
- No leí `auth/callback` completo, `acciones-datos-courier.ts` completo, ni el `dashboard/page.tsx` entero.
- No confirmé si el basemap y los glifos están publicados en producción (H10).
- No confirmé cómo se resuelve la tarifa de un pedido Flex (H12).

---

## Archivos relevantes (rutas absolutas)

- `C:\Users\jorge\Desktop\SaaS Courier Again\src\app\login\formulario-login.tsx`
- `C:\Users\jorge\Desktop\SaaS Courier Again\src\app\login\page.tsx`
- `C:\Users\jorge\Desktop\SaaS Courier Again\src\app\registro\formulario-alta-empresa.tsx`
- `C:\Users\jorge\Desktop\SaaS Courier Again\src\app\page.tsx`
- `C:\Users\jorge\Desktop\SaaS Courier Again\src\app\(tenant)\layout.tsx`
- `C:\Users\jorge\Desktop\SaaS Courier Again\src\app\(tenant)\onboarding\pasos.ts`
- `C:\Users\jorge\Desktop\SaaS Courier Again\src\app\(tenant)\onboarding\estado.ts`
- `C:\Users\jorge\Desktop\SaaS Courier Again\src\app\(tenant)\onboarding\acciones-datos-courier.ts`
- `C:\Users\jorge\Desktop\SaaS Courier Again\src\components\onboarding\banner-onboarding.tsx`
- `C:\Users\jorge\Desktop\SaaS Courier Again\src\components\onboarding\estado-pantalla.tsx`
- `C:\Users\jorge\Desktop\SaaS Courier Again\src\app\(tenant)\configuracion\tarifas\actions.ts`
- `C:\Users\jorge\Desktop\SaaS Courier Again\src\app\(tenant)\configuracion\zonas\actions.ts`
- `C:\Users\jorge\Desktop\SaaS Courier Again\src\app\(tenant)\configuracion\bodegas\actions.ts`
- `C:\Users\jorge\Desktop\SaaS Courier Again\src\modules\operacion\tarifas.ts`
- `C:\Users\jorge\Desktop\SaaS Courier Again\src\modules\dinero\jobs\generar-lineas.ts`
- `C:\Users\jorge\Desktop\SaaS Courier Again\src\modules\integraciones\geocoding\resolver-coordenada.ts`
- `C:\Users\jorge\Desktop\SaaS Courier Again\src\lib\ui\comunas-rm.ts`
- `C:\Users\jorge\Desktop\SaaS Courier Again\src\lib\ui\etiqueta-fuente-pedido.ts`
- `C:\Users\jorge\Desktop\SaaS Courier Again\src\app\globals.css`
- `C:\Users\jorge\Desktop\SaaS Courier Again\supabase\migrations\20260613000004_identidad_zonas_ventanas_corte.sql`
- `C:\Users\jorge\Desktop\SaaS Courier Again\supabase\migrations\20260813000002_identidad_bodegas_seller_courier.sql`
- `C:\Users\jorge\Desktop\SaaS Courier Again\supabase\migrations\20260101000004_tarifas_conexiones_bitacora.sql`
- `C:\Users\jorge\Desktop\SaaS Courier Again\supabase\migrations\20260828000002_identidad_datos_emisor_cobro_contacto.sql`

---

## 14. Decisiones del usuario sobre las preguntas abiertas (2026-09-28)

- **Q1 — Razón social:** se pide **antes de facturar**, junto al resto del emisor. El paso 1 no la pide.
- **Q3 — Base de los montos:** **netos, sin IVA**. Cobro y pago al conductor en la misma base; el IVA se suma en la factura.
- **Q6 — Comuna sin zona:** **se cobra como Periferia y se avisa** al courier. Nunca una entrega sin cobrar.
- **Q9 — Valores sugeridos (netos):** Gran Santiago urbano cobras $3.500 / pagas $2.400. Periferia cobras $4.000 / pagas $2.900.
- **Tarifa por plataforma y hallazgo H12:** resueltos por la propuesta de `arquitecto` — función única `identidad.resolver_tarifa` (seller > fuente > régimen legado > general; zona > sin zona), fila general obligatoria. H12 verificado en producción: latente (0 pedidos Flex asignados por Rutax), se arregla con la misma función antes del asistente.

# Plan de acción — retiro en bodega + ruteo

> Documento de **ejecución**. El alcance y las decisiones de producto viven en
> `@docs/arquitectura/retiro-y-ruteo.md` — si algo se contradice, manda ese.
>
> **Reescrito el 2026-08-13** tras verificar etapa por etapa contra `master` @ `825d3f0`.
> La versión anterior se había levantado desde una rama quince commits atrás y varias de sus
> afirmaciones eran falsas. Todo lo que sigue está comprobado contra el código de esa referencia,
> con archivo y línea. Lo que no se pudo comprobar está marcado como tal.

## Cómo leer este plan

**Son dos repos y una sola operación.**

| Repo | Qué aporta |
|---|---|
| `SaaS Courier Again` | Base de datos, jobs, pantallas del courier y del seller, y las rutas API que consume la app |
| `Desktop/rutax-conductor` | La app nativa del conductor: retiro, escaneo, ruta |

El retiro *ocurre* en la app; el resto del sistema solo lo consume. Cada etapa que toca la app se
entrega junto con sus rutas API, o no funciona ninguna de las dos mitades.

Cada etapa lleva **qué incluye · qué se demuestra al terminarla · quién · esfuerzo · qué puede salir
mal**. El esfuerzo es en días de trabajo enfocado, no en calendario.

---

# Los dos bloqueadores previos a todo — ✅ AMBOS RESUELTOS (2026-08-13)

**B1 · ~~El repo de la app del conductor no tiene remoto~~ — RESUELTO (2026-08-13).** Los 6 commits
están publicados en `novalinksolution-rutax/rutax-conductor` (privado, misma org que el repo web),
con `master` rastreando `origin/master`. Se revisó el contenido completo de la historia antes de
empujar: `.env` está en `.gitignore` y lo único trackeado es `.env.example`, con placeholders — sin
secretos.

**Repo separado y no monorepo, a propósito.** Los ciclos de release son incompatibles (Vercel
despliega en minutos; una app nativa pasa por EAS build y revisión de tienda), el CI del repo web ya
corre typecheck + lint + ~2.700 pruebas + build de Next, y sobre todo **el acoplamiento real es por
HTTP, no por código**: la app llega al backend por `EXPO_PUBLIC_API_URL` y no importa un solo archivo
del otro repo. Un monorepo no habría eliminado la desincronización de contratos, solo la habría
escondido — eso se ataja con pruebas de contrato a ambos lados.

⚠️ **Cabo abierto:** el `.env` de la app apunta a entorno local. Para builds de EAS, las variables van
en `eas.json` o en EAS Secrets, nunca en el repo. Se resuelve al armar el primer build, no antes.

**B2 · ~~Nadie modela la bodega del courier~~ — RESUELTO (2026-08-13).** Era el origen de toda ruta y
no existía: ninguna dirección del courier en todo el esquema (`identidad.tenants` no la tenía,
`identidad.sellers` tampoco), y ninguna etapa la creaba. Hoy es `identidad.courier_bodegas`,
migración `20260813000002`. Ver la sección de las etapas 2 y 2b.

---

# Estado verificado al 2026-08-13

## ✅ Hecho y desplegado

| Qué | Evidencia |
|---|---|
| **Etapa 0** — auto-asignación apagada | Guarda en `manifiestos/actions.ts:208,217`; el botón ya no se importa. Había **dos** botones, no uno |
| **Etapa 1** — ingesta diaria de Flex | Verificada en producción con datos reales: 39 pedidos de 110 órdenes, sin fallos de consulta |
| **Tope de cuentas ML 3→10** (mitad de la etapa 2) | `20260812000003`, con aserción defensiva que aborta si no toma efecto |
| **Campo `situacion_retiro`** | `20260812000002` — enum, columna, `retirado_en`, CHECK, índice parcial, pgTAP |
| **Cancelación desde ML** | Detección, evento tipado, aplicación del estado, desactivación de la parada, incidencia y dinero: **todo hecho**. Faltan solo tres cosas (ver Etapa 10) |
| **Re-atribución de línea de liquidación** | `reatribucion-liquidacion.ts` + `generar-lineas.ts:950-1037` + migración `20260812000001`. **La regla "quien entrega cobra la entrega" ya la impone el código** |
| **Etapas 2 y 2b** — bodegas del seller y del courier | 2026-08-13, **sin desplegar**. Migración `20260813000002` + 35 pgTAP. Ver sección propia más abajo |
| **Regresión de conciliación** (encontrada al verificar la etapa 2) | `20260812000001` repuso el CHECK copiando la lista **anterior** al 11-ago y borró `linea_liquidacion_sin_pedido_entregado`. Restituida por `20260813000003`. Ver más abajo |
| **Guardia contra cobro fantasma** | `pedidos.ts:727-731`: un pedido que llega a `entregado`/`fallido` **sin conductor asignado en Rutax** refleja el estado pero **no publica el evento de dinero**. Acotado a los estados automáticos; los manuales siguen facturando |

## ⚠️ El campo `situacion_retiro` está instalado pero INERTE

Esquema, índice, tipo y pgTAP existen. Pero **nadie lo escribe, ninguna consulta lo filtra y ninguna
pantalla lo muestra** — los helpers de interfaz están escritos y no los importa nadie.

Consecuencia que fija el orden de trabajo: los pedidos Flex reales nacieron en `pendiente` y **no hay
ningún camino para llevarlos a `retirado`** hasta que exista la etapa 3. **La etapa 6 no se puede
encender antes que la 3**, o la bandeja de asignación se ve vacía.

## Lo que queda de la etapa 1

1. **Límite de concurrencia del job de geocoding.** Los jobs de ML sí lo declaran; el de geocoding
   solo tiene idempotencia. A 1.000 pedidos son 1.000 ejecuciones concurrentes contra Google.
2. **Backfill de geocoding de los pedidos viejos.** ⬆️ **Sube a prerrequisito de la etapa 7.** Los
   Flex nuevos entran con coordenada de ML, pero los anteriores al 11-ago guardan el **centroide de
   su comuna marcado como resuelto**, y el job es no-op salvo que el estado sea `pendiente`: hay que
   resetearlo primero. Rutear sobre eso produce rutas que visitan el centro de la comuna varias
   veces, y se va a leer como "el motor está malo".

---

# Las etapas

## Etapas 2 y 2b · Bodegas — ✅ **HECHAS (2026-08-13), sin desplegar**

Se construyeron juntas. Migración `20260813000002_identidad_bodegas_seller_courier.sql`, aplicada
desde cero tres veces y con **35 pgTAP** de aislamiento verdes.

**Decisión de modelo: DOS tablas hermanas, no una con discriminador.** `identidad.seller_bodegas`
(donde se retira, un seller tiene varias, FK compuesta `(tenant_id, seller_id)`) e
`identidad.courier_bodegas` (de dónde sale la flota). El argumento que decide no es estético: las
etapas 3 y 7 necesitan FKs que se excluyen —la sesión de retiro apunta a bodega *del seller*, el
origen de ruta a bodega *del courier*— y con tabla única ambas quedan flojas y hay que apretarlas
con triggers. Y **hay plata colgando de una y no de la otra**: el retiro se paga por visita a bodega
del seller, así que con tabla única un bug puede pagarle a un conductor por "visitar" la bodega
propia del courier. Con dos tablas eso es un error de tipo, no de datos.

**Lo que quedó dentro:** `unique (tenant_id, id)` en AMBAS —es lo que evita re-migrar en las etapas
3 y 7, y hay precedente literal de haberlo olvidado (`sellers_tenant_id_id_uk` hubo que agregarla
después)—, `revoke delete` porque la baja es `activa = false` (detrás cuelgan actas que respaldan
pagos), guard `solo_interno_edita` en `insert or update or delete`, política de select **enumerada**
(nunca `tipo_usuario <> 'seller'`, que ya mordió dos veces), y aserción defensiva que aborta si
falta cualquiera de esas piezas.

**Geocoding síncrono en la Server Action, sin job.** Una bodega no es un pedido: son ~10-40 filas
por tenant, hay un humano esperando en el formulario, y si queda mal es el origen de *toda* ruta. Se
extrajo `resolverCoordenadaConCache` del job (`integraciones/geocoding/resolver-coordenada.ts`), que
ahora sirve a los dos llamadores compartiendo el mismo caché. No bloquea: si el geocoder falla, la
bodega se guarda igual con su `geo_estado`.

**RBAC: capacidad propia `gestionar_bodegas`** — dueño, supervisor y coordinador; **NO
administración**. Decisión del usuario: una bodega no es config financiera, y el caso que la decide
es de terreno (entra un seller nuevo, o el conductor está parado en una bodega que nadie cargó).
Reusar `gestionar_tarifas` habría dejado el gate al revés en las dos puntas. Verificado en
navegador: el coordinador ve en Configuración solo "Puesta en marcha" y "Bodegas".

**Pantallas:** `(tenant)/configuracion/bodegas` con dos pestañas, y `/portal/bodegas` de solo
lectura. El seller **nunca ve `geo_estado`**: no puede corregir la dirección, así que el aviso solo
generaría una llamada al courier.

**Prueba del tope de cuentas ML: hecha** (`portal/conectar-ml/tope-cuentas-ml.test.ts`). Ata
`MAX_CUENTAS_ML` con la función SQL, y lleva un caso que guarda el propio regex — sin él, un cambio
de estilo en el SQL dejaría la prueba pasando por vacuidad.

**Seeds:** los tres siembran bodegas, con los cuatro valores de `geo_estado`, activas e inactivas,
contacto en sus cuatro combinaciones, y bodega principal en los 6 tenants extra del backstage (con
un solo tenant poblado, una consulta que se olvide del `tenant_id` devuelve lo mismo que la
correcta). Las 22 coordenadas se verificaron **punto-en-polígono** contra el TopoJSON DPA 2023: dos
caían dentro de la caja envolvente de su comuna pero fuera del polígono, y se corrigieron.

**Bug encontrado y corregido en la verificación visual:** la tarjeta trataba todo lo que no fuera
`resuelto` con el mismo texto, así que `fuera_cobertura` —donde la dirección es correcta— decía
"conviene revisar que la dirección esté bien escrita", y `pendiente` mostraba "Ubicando dirección…"
junto a ese mismo texto, contradiciéndose. Ahora cada estado dice lo suyo y `fuera_cobertura` no
ofrece "Reintentar ubicación", que ahí no cambiaría nada.

## Desvío · La regresión de conciliación que apareció al verificar la etapa 2

No es de este alcance, pero salió de él y toca dinero, así que se cerró en el momento.

`dinero.eventos_conciliacion.tipo_diferencia` es `text` + CHECK, y **cada migración que agrega un
tipo repone la lista entera**. `20260811000002` agregó `linea_liquidacion_sin_pedido_entregado` (16
tipos); al día siguiente `20260812000001` repuso la lista para agregar el suyo, copió la versión
**anterior** al 11-ago, y el tipo del día antes desapareció. Volvieron a ser 16 — mismo conteo,
distinta lista, que es lo que lo hace invisible.

**Por qué importaba:** `generar-lineas.ts:616` emite ese tipo con `bloquea_pago = true` cuando a un
conductor se le emitió o pagó la liquidación de una entrega que después se canceló en ML. El INSERT
chocaba con 23514 y el writer lanza **dentro de un `step.run`**, así que tumbaba el job de dinero. Y
la bitácora se escribe ANTES del INSERT: quedaba asiento de auditoría de un evento que nunca existió.
El mecanismo que impide pagar una entrega que no ocurrió se caía justo cuando tenía que actuar.

**Dos hallazgos colaterales del arreglo:**
- El enum vestigial `tipo_diferencia_conciliacion` estaba roto **en espejo**: le faltaba el tipo del
  12-ago que el CHECK sí tenía. Cada mitad sin lo de la otra.
- El pgTAP del tipo **se estaba tapando a sí mismo**: su bloque B reponía el CHECK a mitad de
  transacción con la lista del 11-ago —la propia trampa que vigila— y por eso solo caían 4 de 18
  subtests.

**Cerrado con cuatro redes:** migración `20260813000003` con los 17 y aserción **semántica** (copia
la expresión real del constraint e intenta insertar cada valor, más uno inventado que debe ser
rechazado); pgTAP nuevo con `set_eq` sobre el **conjunto exacto**, nunca un conteo; y
`src/modules/dinero/conciliacion-tipos-sql.test.ts`, que ata la lista SQL con
`TipoDiferenciaConciliacion` y además vigila la SERIE de reposiciones para detectar que una migración
encogió la lista. Barrido de las 8 declaraciones históricas: **hubo una sola pérdida**.

⚠️ **Pendiente para el usuario:** auditar en producción si el job vino cayendo desde el 12-ago, y
sobre todo si hay líneas de liquidación vivas de pedidos cancelados con liquidación ya emitida o
pagada — eso es plata que debió quedar bloqueada. La consulta está preparada.

## Etapa 3 · Retiro: base de datos y API — ✅ **HECHA (2026-08-13), sin desplegar**

Migración `20260813000004` (3 tablas, 2 funciones, 62 pgTAP nuevas → 706 en total) y la capa de API
en `src/modules/operacion/retiro/` + `src/app/api/conductor/retiros/` (116 pruebas). **`situacion_retiro`
deja de ser un campo muerto**: las dos funciones `security definer` son sus únicos escritores.

**Tres decisiones que se rompen fácil por descuido:**
- **El QR va en tabla aparte deny-all** (`bultos_retiro_qr`), no como columna con permiso por
  columna. El patrón de GRANT por columna ya filtró dos veces en este repo; `revoke all` es más
  fuerte, más barato de verificar, y no se rompe cuando alguien agregue una columna en las etapas 8
  o 10. Además el ciclo de vida difiere: el QR se purga, el acta sobrevive porque respalda un pago.
- **AAD = `tenant_id + ':' + bulto_id`**, ambos inmutables. El alcance proponía `tenant_id||pedido_id`
  y **no sirve**: `pedido_id` es nulo en el escaneo sin resolver y cambia cuando un job lo resuelve
  — una AAD que muta deja el criptograma ilegible para siempre.
- **No se tocó `pedidos_select`.** El conductor recibe un DTO de seis campos, ninguno personal.
  Ampliar esa política habría puesto nombre, dirección y teléfono de los ~400 destinatarios del día
  en manos de cada conductor.

**Dos comportamientos de infraestructura MEDIDOS, no supuestos** (los dos sorprenden):
1. `ignoreDuplicates: true` sin `onConflict` **no cubre los índices únicos secundarios**: PostgREST
   arbitra por PRIMARY KEY. El segundo escaneo del mismo bulto llega con `escaneo_id` nuevo, no
   choca por PK, y devuelve **409/23505** contra el índice de `(sesión, código)`. Capturar ese 23505
   y re-buscar la fila es el ÚNICO camino que ocurre, y es lo que hace que un duplicado se fusione
   sin error.
2. **Un índice PARCIAL no sirve como árbitro de `ON CONFLICT`** sin repetir su predicado, sintaxis
   que supabase-js no expone. Falla con 42P10 y falla SIEMPRE, no solo ante duplicado. Por eso abrir
   una visita va por INSERT liso capturando 23505.

**Lo que queda fuera a propósito**, para las etapas que corresponden: el consumidor del evento
`operacion/bulto-retiro.sin-pedido` (resolución diferida contra ML — es de `integraciones`), la
regeneración del QR y sus cinco controles, la purga del QR (etapa 10) y la publicación en vivo de
las tablas nuevas (etapa 5).

## ~~Etapa 3 · Retiro: base de datos y API~~ — lo que decía antes de construirse

Tablas de sesión de retiro y bultos escaneados, modeladas sobre `cierres_conductor` (registro
paralelo que **no** mueve la máquina de estados de Flex). El string del QR **cifrado** y con
**permiso por columna**. Idempotencia doble: por identificador de escaneo y por `(retiro, código)` —
un duplicado **se fusiona, no da error**. Endpoint de escaneos **por lote** (hasta 50) con
**resultado por elemento**. Resolución del código con **DTO mínimo** que no amplía el acceso del
conductor. Al cerrar la visita, `situacion_retiro` pasa a `retirado`.

**Un código que Rutax no puede procesar contra su ingesta se guarda igual.** Nunca se pierde un
escaneo.

**Abarata:** los tres moldes que hacían falta ya existen y están probados — permiso por columna
(cuatro migraciones, la más completa es `20260807000001`, que además trata la vista `public`, que es
donde el patrón ya filtró dos veces), cifrado (`integraciones/secretos/cifrado.ts`) y redacción de
logs (`lib/observabilidad/redaccion.ts`, donde entran `hash_code`, `qr_payload` y `qr`).

**Encarece — y esto el plan anterior lo subestimaba:** ~~de las **10 rutas Bearer del conductor que ya
están en producción, ninguna tiene prueba de rechazo cruzado entre couriers.**~~ **RESUELTO: son 9,
no 10, y las nueve ya tienen su prueba de cruce (2026-08-13). Al escribirlas apareció un bug real de
aislamiento —un conductor podía cerrar la ruta de un colega— ya corregido.** Hay un solo archivo de
pruebas en toda esa carpeta y cubre 401/403, no cruce de tenant. Como esas rutas usan cliente de
servicio y **saltan RLS**, el aislamiento de todas ellas descansa en un filtro que nadie verifica.
El molde de prueba de cruce sí existe, en otras tres rutas de otra área.

**Hallazgo colateral:** `evidencias/[evidenciaId]/url/route.ts` es **la única de las diez que no
comprueba si el conductor está activo** — un conductor suspendido todavía obtiene la URL firmada de
sus fotos. Y devuelve 403 ante cualquier error, enmascarando fallas internas.

**Quién.** `arquitecto` → `base-datos-rls` → `backend` → `qa` · **Esfuerzo.** **7–9 días**
(el plan decía 5–7; la diferencia es el andamiaje de pruebas por endpoint, que hay que armar igual).

## Etapa 4 · El retiro en la app del conductor

### Los tres arreglos previos — **los tres siguen vivos, verificados**

1. **Carrera al sincronizar.** `offline-queue.ts:86` lee la cola completa, hace I/O de red por cada
   elemento, y `:125` la **sobrescribe entera**. Todo lo que se encole en esa ventana se pierde. No
   hay lock, versión ni reconciliación por id.
2. **"Salir" borra la cola sin preguntar.** `useAuth.tsx:80-85` llama `limpiarCola()` antes de cerrar
   sesión. El botón vive en `_layout.tsx:34-41`, dentro de `screenOptions`, o sea en **todas** las
   pantallas — pero el arreglo es de **un solo punto**. Que es descuido y no decisión lo prueba que
   la misma app **sí** pide confirmación para lo mismo cuando es explícito
   (`manifiesto/index.tsx:139-144`).
3. **El 401 dispara el cierre de sesión, y eso borra la cola.** Y tiene **tres puntos de fuga**, no
   uno: `manifiesto/index.tsx:98`, `:115` y `:132`.
4. **No hay detección de conectividad.** Ni `netinfo` ni `expo-network`. El único disparo automático
   es volver de segundo plano: **recuperar señal con la app abierta no sincroniza nada**.

### Lo que abarata

**`expo-camera` ya está instalado** (`~17.0.10`) y **los permisos de cámara ya están declarados** en
iOS y Android. Falta el plugin en `app.json` y ajustar el copy del permiso, que hoy habla solo de
fotografiar evidencias. La captura actual usa `expo-image-picker`, inservible para ráfaga.

### Lo que hay que construir

"Carga del día" (entra por la tarjeta donde hoy el recolector ve "sin ruta asignada"), la visita con
esperado/escaneado/faltantes, el visor en ráfaga con contador gigante y anti-rebote, y una **cola
propia del retiro que nunca descarta sola** — un escaneo no se puede volver a capturar, así que al
agotar reintentos pasa a "requiere atención", visible.

**Nunca depende de la red para aceptar un código** y **en la bodega no se bloquea al conductor
jamás.**

**Quién.** `ux-ui` → `frontend` · **Esfuerzo.** 1,5–2 días los arreglos + **6–8 días** la etapa.

**Qué puede salir mal.** El courier piloto **no usa ninguna app hoy**: la pantalla tiene que
funcionar sin capacitación. Probar el escaneo en un iPhone físico. Y ojo con la batería: desmontar la
cámara entre bultos.

## Etapa 5 · Preparación del día — **queda todo, y depende de la 3 y la 4**

Pantalla en vivo en `(tenant)`, dentro de `operacion` — **no** en `contexto`: la Torre es de solo
lectura por regla dura y ésta escribe. Retiros en curso, acumulado por comuna creciendo solo, y la
asignación ahí mismo.

**Tres arreglos obligatorios, los tres verificados:**

- **Tope máximo de espera en el refresco en vivo.** `indicador-en-vivo.tsx:58-61` es un debounce puro
  sin `maxWait`: cada evento cancela el anterior. Con lotes de escaneo entrando cada menos de 800 ms
  sostenidos, no dispara nunca. *(Corrección al plan anterior: dije "congelada minutos" y era
  dramatización — hace falta flujo sostenido. El defecto es real, el arreglo es el mismo.)* Son ~6
  líneas y **arregla las seis pantallas que lo usan**.
- **Migración de publicación en vivo para las tablas nuevas.** Hoy solo hay tres tablas publicadas
  (`pedidos`, `incidencias`, `manifiestos`). Sin eso el "en vivo" no emite nada y **falla en
  silencio**.
- **Agregación por comuna en la base.** Hoy **no existe ninguna función de agregación**: todo se
  cuenta en memoria. De paso elimina el truncamiento silencioso.

**Quién.** `ux-ui` → `frontend` + `backend` · **Esfuerzo.** 5–6 días.

## Etapa 6 · Asignación en bloque

Filtro de comuna **multi-selección** (hoy acepta una sola, y en la pantalla de asignar es texto libre
con `ilike`). **Solo se ofrece lo que está `retirado`** — ésa es la reja, y el campo ya existe.
Selección rápida, barra con contador vivo, manifiesto como subproducto, escritura **en bloque y
transaccional**.

**Verificado que sigue en pie:**
- La pantalla de asignar **corta en 100 sin avisar ni paginar**, y encima **miente sobre el total**:
  imprime "N pedidos disponibles" con el largo ya truncado.
- "Seleccionar todos" toma solo lo cargado.
- Los contadores por estado se calculan sobre la página — *(corrección: eso está en `/operaciones`,
  no en la pantalla de asignar)*.
- La paginación de `/operaciones` **pierde los filtros de comuna y conductor**, que son justo los dos
  del enlace profundo desde la Torre.
- Asignar en bloque mete todos los identificadores en un `.in()` **sin lotear** (revienta por URL
  demasiado larga al volumen del piloto), recorre un bucle secuencial con hasta 3 viajes por pedido,
  y **sin transacción**: si el pedido 200 falla, los 199 anteriores quedan aplicados.

**Corrección importante al plan anterior — y el bug real es peor.** Dije que la selección se pierde
al cambiar de filtro. **Es falso**: el estado sobrevive porque la navegación es suave. Lo que ocurre
es peor: la selección **se vuelve invisible**, y la advertencia de reasignación se calcula solo sobre
lo visible mientras se envían **todos** los identificadores marcados. Un pedido seleccionado bajo un
filtro anterior **se reasigna sin que aparezca ninguna advertencia**. El trabajo cambia de "persistir
la selección" a "hacerla visible fuera de filtro y arreglar la advertencia".

**A favor:** la bitácora ya está bien — un asiento por lote con su autor.

**Quién.** `ux-ui` → `frontend` + `backend` · **Esfuerzo.** 6–7 días.

## Deuda previa a la etapa 6 · La marca de asignación que no se apaga

**Confirmado exhaustivamente:** solo tres puntos del repo ponen `activa: false`, y **ninguna
transición a entregado, fallido o devuelto la toca**. No hay trigger que lo haga. Toda asignación que
terminó en entrega queda activa para siempre; a 400 pedidos/día la tabla cruza las 1.000 filas en
~2,5 días.

**Corrección al plan anterior: de las cuatro consultas que le atribuí, solo dos son reales.**

| Consulta | Veredicto |
|---|---|
| Carga por conductor | Defecto real, pero es **código muerto** — vive dentro de la auto-asignación desactivada. **Se borra, no se arregla** |
| Redistribución por caída de conductor | **Real y viva.** Es la única que hay que arreglar |
| Cumplimiento por seller | Rota, pero **por su propio volumen de pedidos**, no por asignaciones fósiles. Arreglo distinto |
| Ficha de dinero del conductor | Rota, pero por acumulación histórica de líneas de liquidación sin ventana de fecha. Arreglo distinto |

**Decisión que hay que tomar a propósito:** apagar `activa` al entregar **haría desaparecer las
paradas ya entregadas de la pantalla del conductor**, porque la versión web lista todo lo activo sin
filtrar por estado. La app nativa ya se defiende sola. No descubrirlo en terreno.

**Abarata:** `desactivarAsignacionActivaPedido` ya existe y trae documentado el orden correcto.

**Esfuerzo.** 2–3 días, incluida la migración de respaldo para las históricas.

## Etapa 7 · El ruteo

Motor en **TypeScript puro** — vecino cercano + 2-opt + Or-opt. **US$0/mes.** Envuelto tras un
puerto que imita a `PuertoGeocoding`, **asíncrono desde el día uno**.

**Abarata más de lo que el plan acreditaba:** el helper de distancia **ya existe con 11 pruebas**
(`lib/geo/distancia.ts`), y el molde para el punto de término también — `operacion.ubicacion_conductor`
es exactamente la estructura pedida: una fila por conductor, sin histórico, con el comentario de
minimización ya escrito.

⚠️ **`distanciaEnMetros` devuelve METROS.** El plan anterior hablaba de "kilómetros estimados" en la
barra de asignación: quien lo asuma saca un número mil veces más grande.

**Sigue en pie:** el orden es alfabético, se aplica en **tres** puntos de render y **no se persiste
en ninguna parte**; no hay columna de secuencia en ninguna de las dos tablas candidatas.

**Dónde persistir la secuencia:** lo natural es la fila activa de `asignaciones_pedido`, porque el
orden es por pedido. Pero esa tabla arrastra la deuda de `activa`. **Si la etapa 6 no paga esa deuda,
la secuencia va en tabla propia.**

**Prerrequisitos duros:** la etapa 2b (origen de la ruta) y el backfill de geocoding.

**Riesgo principal — y no es el algoritmo:** es la calidad del dato de entrada. Correr el backfill y
medir cuántos pedidos quedan sin coordenada real **antes** de mostrarle una ruta a nadie.

**Riesgo secundario:** el punto de término es dato personal bajo la Ley 21.431 y arrastra revisión de
`seguridad-cumplimiento`. No dejarlo para el final.

**Esfuerzo.** **7–9 días** (el plan decía 5–7), más 1–2 si la bodega del courier no se hizo antes.

## Etapa 8 · El dinero del retiro

Se paga **por visita a bodega**. La línea no cuelga de ningún pedido: cuelga de la visita.

**La afirmación central del plan resistió la verificación palabra por palabra:** `pedido_id` es
`not null unique` en **las dos** tablas de líneas, y ninguna de las seis migraciones que las tocan lo
altera. No existe discriminador de tipo de hecho.

**Confirmado también:** el motor se dispara por **estado del pedido**, no por entrega efectiva. La
entrega llega al motor solo a través del cambio de estado.

**Hallazgo que abarata el diseño:** la RLS de `lineas_liquidacion` **no depende de `pedido_id`** —
filtra por tenant y por conductor. Una línea sin pedido queda correctamente aislada **sin tocar una
sola política**. Eso mata el argumento a favor de una tabla separada, que pagaría duplicar todo el
ciclo de vida a cambio de un aislamiento ya resuelto. **Se mantiene la tabla única con discriminador.**

**Dos ajustes al diseño:**
- El unique parcial debe ser `where tipo_hecho = 'entrega'`, **no** `where pedido_id is not null` — si
  algún día una línea de retiro quisiera referenciar un pedido de contexto, la segunda forma lo
  prohibiría sin motivo.
- Renombrar `fecha_entrega` → `fecha_hecho` en el mismo movimiento. Guardar la fecha de una visita en
  una columna llamada "fecha de entrega" es el tipo de nombre engañoso que este proyecto ya pagó caro
  tres veces.

**⚠️ Riesgo que hay que mirar antes de escribir la migración:** el `UNIQUE` sostiene la idempotencia
del motor (`ON CONFLICT (pedido_id) DO NOTHING`). Al volverlo parcial, PostgreSQL exige que el índice
coincida con el predicado inferido, **y si no, el `ON CONFLICT` falla en tiempo de ejecución, no de
migración**.

**Corrección al plan:** las cinco direcciones que daba para los detectores están **desfasadas** —
tres son correctas, dos apuntan a código que ya no es eso. Y son **más de cinco**: hay consumidores
en el job de liquidación, en el de payout confirmado, en el preflight y en las consultas de pantalla.
Los que filtran por `pedido_id` no se rompen **por accidente** (nunca la encuentran); los que filtran
por `liquidacion_id` **sí la traen**. Conviene el filtro explícito incluso donde hoy no haría falta.

**Bug latente concreto:** el PDF de liquidación hace `l.pedidoId.slice(0, 8)`. Con `pedido_id`
nullable eso **lanza excepción al generar el PDF**, y el manejo de errores dejaría la liquidación
emitida sin documento. Es el papel con el que el conductor discute su plata.

**Dependencia dura:** **no se puede construir antes que la etapa 3** — la línea cuelga de la tabla de
visitas, y el CHECK cruzado la necesita.

**Esfuerzo.** **6–8 días** (el plan decía 5–6).

## Etapa 9 · Traspaso entre conductores — **la mitad de dinero YA ESTÁ HECHA**

**Corrección al plan:** el "bug vivo de atribución de pago" que listaba **ya está resuelto**, y con
exactamente la semántica que esta etapa necesita: si el traspaso mueve la asignación **antes** de la
entrega, la línea se re-atribuye sola; si la liquidación ya se emitió, no se muta nada y queda
excepción en la bandeja. **La regla "quien entrega cobra la entrega" ya la impone el código.**

**Y hay que borrar una contradicción:** la etapa decía "definición pendiente: el conductor no puede
ser el autor de una acción que mueve plata". La **Definición 1 del alcance ya la cerró**: el traspaso
es **libre**, sin aprobación, y **el autor es quien escanea**. La regla de auditoría exige saber
quién, no exige que alguien apruebe.

**Lo que queda:** el camino propio de traspaso (agregar pedidos a un manifiesto **exige que esté en
borrador**, confirmado, y a esa hora el del receptor ya está confirmado), la capacidad RBAC del
conductor, el endpoint Bearer con su prueba de cruce, y la bitácora **antes** del efecto — hoy la de
asignación va **después**, así que colgarse de ahí heredaría el orden equivocado.

**Esfuerzo.** 2–3 días en el repo web, más la parte de la app.

## Etapa 10 · Cierre de jornada, cancelaciones y retención

**Las cancelaciones están mucho más avanzadas de lo que decía el plan.** Detección, evento tipado,
aplicación del estado, desactivación de la parada, incidencia y dinero: **todo hecho**, con bitácora
antes del efecto e idempotencia. Faltan tres cosas:

1. **Aviso al coordinador** — no existe ningún aviso de cancelación ni de incidencia. Y la
   descripción de la incidencia dice "mientras el conductor lo llevaba" **sin decir cuál conductor**.
2. **Rastro visible para el conductor** — hoy la parada **se evapora**, confirmado por prueba. Es
   exactamente lo que el diseño quiere evitar: el conductor cree que la app perdió un pedido.
3. **La marca de "en poder del courier"** y la lista de cierre.

*(Detalle: la incidencia se abre con tipo "otro" porque el catálogo no tiene un tipo para esto.)*

**El cierre del día sigue sin existir.** Y el agujero es real, verificado: el detector de integridad
**excluye los fallidos a propósito**, y la transición `fallido → devuelto` existe y está probada pero
**ninguna pantalla la dispara**. Nadie cierra el pedido no entregado.

**Retención:** el job de purga existe y sirve de molde (90 días imagen, 365 metadatos, lotes bajo el
techo de filas, bitácora por courier). **No purga pedidos**: eso hay que escribirlo. Y confirmado el
aviso del plan — si el paso del QR hereda las retenciones por cobro impago, un período impago lo
mantiene vivo meses. **Va como paso propio.**

*(Bug preexistente que conviene arreglar mientras se toca ese archivo: el primer paso pagina por
desplazamiento con un predicado que su propio `UPDATE` invalida, así que salta filas y omite imágenes
vencidas. El segundo paso sí lo hace bien.)*

**Esfuerzo.** 3–4 días.

---

# Transversales

Lo que el plan anterior trataba como "de paso" y no lo es. **Total: 6–7 días.**

| Qué | Estado verificado | Esfuerzo |
|---|---|---|
| **Exportación de datos** | Truncada en 1.000 sin error, **conteo sobre lo truncado, y auditado en bitácora como completo**. Pasivo de cumplimiento, no de interfaz. Faltan 5 tablas que sí existen *(corrección: `ajustes_liquidacion` no es una tabla, sacar de la lista)* | 1 día |
| **Cron de incidencias sin gestión** | Global, **sin filtro de courier**, sin fecha, sin paginar. *(Corrección al plan: no es que "no notifique más allá de la fila 1.000" — **hoy no notifica a nadie**, el correo es un TODO explícito)* | incluido arriba |
| **Pruebas de aislamiento por endpoint** | **Cero** para las 10 rutas del conductor. El molde existe en otras tres rutas | 1–1,5 días |
| **Portabilidad del conductor** | No existe. El único camino de exportación está tras una capacidad del courier. La ley da 15 días hábiles | 1,5–2 días |
| **Mandato de tratamiento + registro de actividades** | No existen en `docs/`. **La Ley 21.719 entra en vigencia el 1-dic-2026** | 1 día, con `seguridad-cumplimiento` |
| **Regeneración del QR + 5 controles** | Cero. Nada que reaprovechar | 1,5–2 días |
| **Helper de paginación** | Existe, con 8 consumidores — **ninguno en `operacion`** | dentro de cada etapa |

**Reglas que siguen mandando en todo:** el POD de Flex no se toca; nunca se dice "hacer el match"
(Rutax **procesa lo que retira contra lo que ya tiene ingestado**); los ~400 escaneos diarios **no**
van a bitácora, sí el cierre de visita, el traspaso, la línea de retiro, la asignación en bloque (un
asiento por lote) y la regeneración de QR.

---

# Orden y dependencias

```
B1 Remoto para el repo de la app  ·  B2 Bodega del courier (2b)
                    │
2 Bodegas del seller ──────────────┐
                    │              │
3 Retiro: base de datos y API      │   ← desbloquea situacion_retiro
                    │              │
4 Retiro en la app (+3 arreglos)   │
                    │              │
5 Preparación del día              │
                    │              │
6 Asignación en bloque  ← deuda de la marca de asignación
                    │
7 Ruteo  ← 2b + backfill de geocoding
                    │
8 Dinero del retiro  ← depende de 3
                    │
9 Traspaso   ·   10 Cierre de jornada   ·   Transversales
```

**Primer día útil para el courier:** al terminar la 7 tiene el ciclo completo — retira escaneando, el
coordinador asigna desde Rutax, y el conductor sale con su ruta ordenada sin digitar nada.

**Esfuerzo total revisado: 55–75 días** de trabajo enfocado. El plan anterior decía 40–55; la
diferencia son las pruebas de aislamiento que faltaban para rutas ya en producción, la deuda
transversal que no era "de paso", la bodega del courier que no existía, y estimaciones más honestas
en las etapas 3, 7 y 8.

---

# Definiciones cerradas

1. **El traspaso entre conductores es LIBRE.** Sin aprobación. El autor es quien escanea.
2. **Ningún pedido puede quedar sin coordenada.** Si ocurre, se resuelve en la bodega del courier
   antes de asignar, desde la pantalla de Preparación.
3. **El canal de avisos de ML que reporta el primer escaneo** se prueba cuando toque; el diseño no
   depende de eso.
4. **La regeneración del QR se construye, sin consultar a ML.** Los cinco controles cumplen doble
   función: evitan el mal uso y son la evidencia de que el uso fue legítimo.
5. **La auto-asignación se elimina** cuando la etapa 6 esté en uso.
6. **El retiro se paga por visita a bodega.**
7. **Punto de término:** el conductor pone la dirección donde quiere terminar. Opcional y revocable;
   si no la define, la ruta termina en su última parada, y **nada delata quién no la definió**.
8. **Retención del `no procesado`:** archivar a los 7 días, despersonalizar a los 30, **no eliminar**.

# Decisiones abiertas

1. **¿Apagar `activa` al entregar oculta las paradas entregadas en la pantalla web del conductor?**
   Hay que decidir si se filtra por estado o se conserva el progreso visible.
2. **¿Dónde vive la secuencia de paradas** — en la fila activa de asignación, o en tabla propia?
   Depende de si la etapa 6 paga la deuda de `activa`.
3. **¿El `same-day` debe exigir escaneo para volverse asignable?** Hoy nace `pendiente` como todo lo
   demás, coherente con "todos los pedidos pasan por el mismo flujo".

# Riesgos que hay que aceptar

**El más grande no es técnico: es la adopción.** El courier piloto no usa ninguna aplicación hoy.
Todo depende de que diez conductores abran una app y escaneen.

**Las distancias son en línea recta.** El reordenamiento manual no es un lujo.

**El aislamiento de las rutas del conductor descansa en código sin pruebas.** Diez rutas en
producción, cliente de servicio que salta RLS, y un filtro que nadie verifica.

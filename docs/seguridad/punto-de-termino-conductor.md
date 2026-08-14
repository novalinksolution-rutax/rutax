# Punto de término de ruta del conductor — revisión de privacidad previa a construir

> Revisión de `seguridad-cumplimiento`, 2026-08-14. **Previa a construir**, no auditoría de algo hecho.
> Objeto: la etapa 7 de `docs/arquitectura/retiro-y-ruteo-plan.md` va a guardar dónde termina la ruta
> el conductor — es decir, su domicilio. El alcance (`docs/arquitectura/retiro-y-ruteo.md` §4 y
> Decisiones de cierre) ya exigía pasar por aquí.
>
> **Este documento manda sobre la etapa 7 en todo lo que toque el punto de término.** Si el plan de
> ejecución dice otra cosa, gana esto.

---

## 0. Veredicto

**SE PUEDE CONSTRUIR**, con condiciones. Ninguna es cara; dos son estructurales y hay que tomarlas
antes de la primera migración, no después.

| # | Condición | Dónde se detalla |
|---|---|---|
| C1 | Tabla propia `operacion.punto_termino_conductor`, RLS **solo el propio conductor**, sin rama `interno`, sin vista en `public` y sin un solo `grant` a `authenticated` | §6 |
| C2 | Se guarda **coordenada redondeada + comuna**. **Nunca el texto de la dirección**, y el geocoding **no puede tocar el caché global** | §3 |
| C3 | El ancla entra en el **cálculo** de la ruta y **jamás** en el artefacto que ve el coordinador: ni DTO, ni polilínea, ni encuadre del mapa, ni totales, ni ETA, ni PDF, ni exportación | §4 |
| C4 | Consentimiento **propio y separado** del rastreo en vivo (`finalidad` en `consentimientos_ubicacion`), revocable en un toque desde la app | §5 |
| C5 | Purga: al revocar, al desvincular y por inactividad. **No basta `activa = false`** | §7 |
| C6 | pgTAP por tabla + prueba Vitest que compare el DTO de dos conductores, con y sin ancla | §6.3 |

**Y una condición que no es de la etapa 7 sino de hoy:** el rastreo de ubicación que ya existe puede
estar guardando el domicilio del conductor **sin consentimiento para esa finalidad y sin límite de
tiempo**. Es un problema vivo, más urgente que lo que se va a construir. Va en §1 y su severidad es
**ALTA**. No bloquea escribir la etapa 7; **sí** debe cerrarse antes de que la etapa 7 llegue a
producción, y honestamente antes que eso, porque el código ya está desplegado.

---

## 1. URGENTE — el rastreo que YA existe puede estar guardando el domicilio

### 1.1 La cadena, verificada en código

| Paso | Qué hace | Dónde |
|---|---|---|
| 1 | La PWA pinguea la posición cada 90 s mientras el manifiesto está `en_ruta` y la pestaña está visible | `src/app/conductor/manifiesto/ping-ubicacion.tsx:32,71-88` |
| 2 | El servidor escribe si hay manifiesto `en_ruta` **de hoy** y consentimiento vigente. No comprueba que la posición tenga nada que ver con una entrega | `src/modules/operacion/ubicacion-conductor.ts:66-129` |
| 3 | La fila se borra en **tres** sitios: al completar el manifiesto, al desmontar el componente y al revocar el consentimiento | `manifiestos.ts:475`, `ping-ubicacion.tsx:125-132`, `consentimiento-ubicacion.ts:188` |
| 4 | **Ningún job la purga.** `purgar-evidencias.ts:16-19` afirma que "no hay nada que purgar"; `manifiestos.ts:470-473` tiene un `TODO` pidiendo exactamente ese job | — |

Los tres borrados del paso 3 fallan juntos en el mismo escenario, que además es el escenario normal:

- **Completar el manifiesto es un acto manual que nadie tiene incentivo para hacer**, y en Flex el
  estado lo gobierna Mercado Envíos. Un manifiesto que se queda en `en_ruta` no dispara nada.
- El borrado al desmontar es una Server Action lanzada en el `cleanup` de un `useEffect`, con
  `.catch(() => undefined)`: al cerrar la pestaña o apagar el teléfono, muchas veces no llega al
  servidor. Además solo se registra si al **montar** ya había consentimiento y ruta.
- Revocar el consentimiento **no tiene interfaz**: `actionRevocarConsentimientoUbicacion` existe
  (`src/app/conductor/manifiesto/[pedidoId]/actions.ts:407`) y **ningún componente la importa**.

**Conclusión:** la última posición del día sobrevive sin límite de tiempo. Y la última posición del
día es, con frecuencia, la casa — basta que el conductor mire la app en el sofá al llegar.

### 1.2 Lo que agrava el hallazgo: nadie lee ese dato

`grep` sobre todo `src/`: los únicos accesos a `operacion.ubicacion_conductor` son el módulo que
escribe y el comentario del job de purga. **Ninguna pantalla la consulta.** Ni `(tenant)`, ni la
Torre, ni el portal.

Es decir: hoy se recoge la posición GPS de un trabajador cada 90 segundos para escribirla en una
tabla que nadie mira. Bajo la Ley 21.431 (el tratamiento debe quedar en el contexto del servicio que
presta) y bajo la Ley 21.719, que entra a regir el **1-dic-2026** (finalidad y proporcionalidad), un
tratamiento sin finalidad no se defiende con ningún argumento.

Además, el texto de consentimiento que se le muestra al conductor promete un uso que no ocurre:
*"Solo los coordinadores de tu courier pueden verla"* (`ping-ubicacion.tsx:197`). Nadie la ve.

### 1.3 Un tercer detalle: cualquier usuario interno puede leerla por la API

La política `ubicacion_conductor_select` (`20260613000008_operacion_pod_tracking.sql:431-441`) admite
a **cualquier** `interno` del tenant, sin distinguir capacidad RBAC, y `public.ubicacion_conductor`
tiene `grant select ... to authenticated`. Como ninguna pantalla la usa, no hay gate de aplicación
que valga: el camino es PostgREST directo. Administración —que no tiene ninguna razón operativa para
saber dónde está un conductor— puede consultarla.

### 1.4 Hallazgos y recomendación

| ID | Hallazgo | Severidad | Recomendación concreta |
|---|---|---|---|
| H-1 | La última posición sobrevive sin límite si el manifiesto no se completa; puede ser el domicilio | **ALTA** | Job Inngest nuevo `operacion/purgarUbicacionesRancias`, **cron horario**, que borre toda fila con `actualizado_en < now() - interval '2 hours'`. Un conductor en ruta pinguea cada 90 s: una fila de más de 2 h es basura por definición. El job diario de 03:30 **no alcanza** — dejaría el domicilio en la base de 21:00 a 03:30 |
| H-2 | Se recoge un dato personal que ninguna pantalla usa | **ALTA** | **Apagar el ping** hasta que exista la pantalla que lo justifique. Es gratis: no hay funcionalidad que perder. Si se prefiere conservarlo, escribir primero la pantalla y su capacidad RBAC |
| H-3 | El consentimiento no se puede revocar desde ninguna interfaz | **MEDIA** | Cablear `actionRevocarConsentimientoUbicacion` a un control visible en la app del conductor. Un consentimiento que no se puede retirar no es consentimiento |
| H-4 | El texto de consentimiento describe un uso inexistente | **MEDIA** | Corregir el texto y **subir** `VERSION_TEXTO_CONSENTIMIENTO_UBICACION` (hoy `"v1"`), que para eso existe |
| H-5 | La RLS admite a cualquier `interno`, sin capacidad RBAC, y el `grant` está abierto a `authenticated` | **MEDIA** | **DIFERIDO a propósito (2026-08-14)** — ver abajo |

### H-5: por qué se deja el `grant` puesto

Se intentó revocar el `SELECT` a `authenticated` junto con el retiro del ping, y **se revirtió**. El
revoke rompe tres archivos pgTAP (`rls_aislamiento_pod_y_ubicacion`, `rls_aislamiento_pod_tracking`,
`rls_aislamiento_consentimiento_pod`) que ejercitan el aislamiento de esta tabla leyendo la vista de
`public` como seller y como conductor: sin el grant, la lectura falla por permisos y los tests
abortan antes de comprobar nada.

El intercambio real era **perder cobertura de aislamiento que funciona a cambio de prolijidad**. El
riesgo que H-5 describe ya está cerrado por otra vía y de forma más fuerte: la tabla quedó **vacía**,
**no tiene ningún escritor** (`ubicacion-conductor.ts` ya no existe) y hay una prueba que falla si
alguien vuelve a escribirle (`ubicacion-conductor-retirado.test.ts`). Un `grant` de lectura sobre una
tabla sin filas no expone nada.

**Cuándo sí hay que cerrarlo:** si alguna vez se reconstruye el rastreo. Ahí el grant deja de ser
inocuo, y esos tres pgTAP hay que reescribirlos contra el modelo nuevo de todas formas.
| H-6 | `purgar-evidencias.ts:16-19` afirma que no hay nada que purgar. Es falso, y es la razón por la que H-1 pasó inadvertido | **BAJA** | Corregir el comentario al implementar H-1 |

### 1.5 Cómo saber si hoy hay domicilios guardados en producción

Sin mirar una sola coordenada — para contar el problema no hace falta verlo:

```sql
select u.conductor_id, u.actualizado_en
from operacion.ubicacion_conductor u
left join operacion.manifiestos m
  on  m.driver_id       = u.conductor_id
  and m.tenant_id       = u.tenant_id
  and m.estado          = 'en_ruta'
  and m.fecha_operacion = (now() at time zone 'America/Santiago')::date
where m.id is null;
```

Toda fila devuelta es una posición conservada sin turno activo que la justifique. **Correr esto antes
de decidir la urgencia.** Atenuante conocido: en producción la superficie operativa real es la app
Expo, que **no** pinguea (usa `expo-location` solo para el POD, en el punto de entrega), así que el
camino de la PWA puede estar de hecho inactivo. Eso reduce la exposición real; no reduce el hallazgo,
porque el camino sigue vivo y desplegado.

### 1.6 Nota al margen que conviene no perder

`operacion.pruebas_entrega` y `operacion.evidencias_entrega` guardan la coordenada del conductor en
**cada** entrega, con su hora, y las conservan **365 días** (`purgar-evidencias.ts:49`). Eso es un
recorrido reconstruible del trabajador, punto por punto, durante un año. Es defendible —es la prueba
de la entrega, y la geocerca es su razón de ser— pero **desmiente la frase de `CLAUDE.md`** *"no se
guarda recorrido del conductor: sigue habiendo una sola fila por conductor, la última posición, sin
histórico"*. La frase es cierta de `ubicacion_conductor` y falsa del sistema. No cambia ninguna
decisión de la etapa 7 (esos puntos están en la puerta del destinatario, no en la casa del
conductor), pero conviene corregirla para que nadie razone sobre una premisa equivocada.

---

## 2. El molde: qué copiar de `ubicacion_conductor` y qué no

El plan dice que `operacion.ubicacion_conductor` es "exactamente la estructura pedida". **Verificado:
la forma sí sirve; la política no del todo, y el ciclo de vida es justamente lo que falló.**

### Lo que SÍ se copia

| Rasgo | Por qué |
|---|---|
| PK = `conductor_id`, una fila por conductor | Hace el histórico **inexpresable**. No es una promesa del código: es el esquema. Es el rasgo más valioso del molde |
| `tenant_id` + FK compuesta `(tenant_id, conductor_id)` contra `identidad.conductores` | Impide que una fila apunte a un conductor de otro courier |
| `enable` + **`force`** row level security | `force` también aplica al owner de la tabla. Está bien puesto |
| Escritura exclusiva de `service_role`: sin política de INSERT/UPDATE y `revoke` explícito | Defensa en profundidad ya probada en pgTAP (`rls_aislamiento_pod_tracking.test.sql:390`) |
| `comment on table` con la razón de la minimización escrita | Es lo que hace que el siguiente que llegue no agregue una tabla de histórico |

### Lo que NO se copia

| Defecto del molde | Qué hacer en su lugar |
|---|---|
| **Rama `interno` en la política SELECT.** Ahí es discutible; aquí es incompatible con el diseño | La política del punto de término **no lleva rama `interno`**. Solo el propio conductor (§6.1) |
| **Vista espejo en `public` con `grant select to authenticated`** | **No se crea vista.** Ningún cliente necesita PostgREST sobre esta tabla: la app Expo entra por rutas Bearer con `service_role` y la PWA por Server Actions. Cero `grant` a `authenticated` |
| **El borrado depende de que alguien complete un manifiesto** | El punto de término no cuelga de la jornada; su ciclo de vida es el consentimiento y el vínculo laboral (§7) |
| **No hay job de purga** (el `TODO` de `manifiestos.ts:470`) | La purga se escribe **junto con** la tabla, en la misma entrega. No después |
| **El consentimiento no distingue finalidades** | `finalidad` como columna, y el chequeo por finalidad (§5.1) |

---

## 3. Qué se guarda — coordenada sí, texto no

**Recomendación: coordenada redondeada a 3 decimales + nombre de comuna. Sin el texto de la
dirección.**

El argumento a favor del texto era doble y los dos lados se caen:

1. *"El conductor necesita reconocer lo que guardó."* Lo reconoce mejor con **un pin en un mapa y el
   nombre de la comuna** que con una cadena de texto. Y el pin es además la forma de **capturarlo**:
   si el conductor marca el punto en el mapa, no existe nunca una dirección que escribir, ni que
   mandarle a un tercero, ni que guardar.
2. *"Hace falta para re-geocodificar."* Solo hace falta re-geocodificar si el texto es la fuente de
   verdad. Si la fuente de verdad es la coordenada, no hay nada que recalcular jamás. El único caso
   real —que el conductor se cambie de casa— se resuelve marcando otro pin, que es más rápido que
   corregir una dirección.

Y hay una razón que decide sola:

> **El texto de la dirección no puede pasar por `resolverCoordenadaConCache`.**
> `integraciones.geocoding_cache` es un caché **global, sin `tenant_id`, que guarda
> `direccion_norm` en claro** (migración `20260613000003`: columnas `clave_hash`, `direccion_norm`,
> `comuna_norm`) y **no tiene purga**: está diseñado para vivir para siempre y para que dos tenants
> compartan el HIT. Meter ahí el domicilio de un conductor significa que (a) queda escrito
> permanentemente en una tabla compartida entre couriers, y (b) **borrar el punto de término no lo
> borra**: la promesa de borrado sería falsa el día que alguien la revise.
> El caché es `deny-all` para sesiones de usuario, así que no hay fuga de confidencialidad hoy. El
> problema es de finalidad y de retención, y no se arregla con RLS.

**Regla, entonces:**

- Vía preferente: **pin en el mapa**. No hay dirección, no hay geocoding, no hay tercero, no hay caché.
- Si alguna vez se admite escribir una dirección: se geocodifica **en memoria dentro del request**,
  por una vía que **no lee ni escribe** `geocoding_cache` (un flag explícito `sinCache: true` en el
  helper, o una llamada directa al puerto), la cadena **muere con el request** y solo se persiste la
  coordenada. Esto hay que decidirlo antes de escribir el código, porque el atajo natural —"reuso lo
  de bodegas"— es exactamente lo que no se puede hacer.

**Precisión: 3 decimales (~110 m).** Suficiente de sobra para sesgar la última parada, e insuficiente
para señalar una casa: identifica una manzana, no un domicilio. **El redondeo se impone en la base**,
con un trigger `BEFORE INSERT OR UPDATE` que haga `round(new.lat::numeric, 3)::double precision`, no
en TypeScript: así un escritor con un bug no puede guardar la coordenada fina. (Se prefiere el
trigger sobre un `CHECK` porque comparar `double precision` por igualdad tras redondear es frágil, y
sobre `numeric(6,3)` porque supabase-js devuelve `numeric` como cadena, y eso es un pie de banco para
el solver.)

**La comuna** se deriva de la coordenada con el catálogo de comunas de la RM que ya vive en
`src/lib/ui/`, y existe solo para que el conductor reconozca su propio punto. No se muestra a nadie más.

---

## 4. Quién puede verlo — el problema de segundo orden

Aquí es donde la RLS no alcanza, y es la parte que hay que leer entera.

### 4.1 La respuesta corta

**El coordinador no ve nada: ni la coordenada, ni la comuna, ni un indicio de que exista.**

Y no porque una política lo esconda, sino porque **el ancla no forma parte de la ruta**. La ruta que
se persiste y se muestra es la **secuencia de las 25-30 paradas**. El punto de término es un
**parámetro del cálculo**, igual que la fórmula de haversine: entra en la función de costo y no sale
por el otro lado.

Esa distinción es la que hace posible cumplir la condición dura del alcance —*"nada delata quién no
la definió"*—, y conviene entender por qué: **no se cumple escondiendo un campo, se cumple haciendo
que la salida sea idéntica en los dos casos.** Si el coordinador recibe la misma estructura, con los
mismos campos y los mismos totales, tanto para un conductor con ancla como para uno sin ella, no hay
nada que delatar. Si en cambio la salida trae el ancla y la interfaz decide no pintarla, la
diferencia ya viajó al navegador y basta abrir las herramientas de desarrollo.

### 4.2 Y por qué esto no es cortesía

Bajo la Ley 21.431 el domicilio particular **no** está en el contexto del servicio que el conductor
presta: la base de licitud tiene que ser el consentimiento. Y un consentimiento prestado bajo
subordinación laboral solo se sostiene si es **realmente libre** — o sea, si negarse no tiene costo
ni queda a la vista del jefe. Por eso *"nada delata quién no la definió"* no es una preferencia de
producto: **es la condición que hace válido el consentimiento**. Si el coordinador puede ver quién
declinó, el consentimiento de todos los demás queda contaminado.

### 4.3 Los canales de fuga, uno por uno

Todos son obligatorios. El segundo es el que se rompe en la práctica.

| # | Canal | Regla |
|---|---|---|
| 1 | **La columna** | RLS sin rama `interno` y sin `grant` a `authenticated` (§6) |
| 2 | **El DTO de la ruta** (servidor → navegador del coordinador) | **El camino más probable de fuga.** El solver corre en el servidor con `service_role`, que bypasea RLS; nada impide serializar el ancla en las props. El tipo de la ruta **no debe tener un campo donde quepa**: `RutaCalculada { paradas: Parada[]; distanciaTotalM: number }` y nada más. El ancla solo existe dentro de la función que resuelve el orden, y esa función **devuelve el orden, no los nodos** |
| 3 | **La polilínea del mapa** | Termina en la última parada. Nunca se dibuja el tramo final |
| 4 | **El encuadre del mapa** (`fitBounds`) | Se calcula **solo sobre las paradas**. Un encuadre que incluya el ancla delata el sector aunque no se pinte el punto: el mapa se aleja hacia Puente Alto y eso se ve |
| 5 | **Totales de distancia y duración** | Se calculan de bodega a **última parada**. Si incluyen el tramo a casa, comparar los totales de dos conductores con las mismas paradas revela quién tiene ancla y a qué distancia. Es una fuga silenciosa y aritmética |
| 6 | **ETA / "hora estimada de término de jornada"** | Igual: hasta la última parada |
| 7 | **Manifiesto impreso / PDF / CSV** | Sin ancla, sin comuna, sin tramo final |
| 8 | **Exportación RNF-13 del courier** (`api/courier/exportar-datos`) | La tabla **no se agrega** a `TABLAS_A_EXPORTAR`, con comentario explicando por qué. Esa exportación se la lleva el dueño del courier en un JSON |
| 9 | **Bitácora de auditoría** | El asiento registra el hecho (`conductor.punto_termino.definido` / `.revocado`) **sin la coordenada**. Agregar a `CLAVES_PROHIBIDAS` (`src/modules/identidad/auditoria.ts:50`): `punto_termino`, `punto_termino_lat`, `punto_termino_long`, `lat`, `long`, `latitud`, `longitud`. Antes de agregar `lat`/`long`, comprobar con un `grep` que ningún asiento legítimo las use |
| 10 | **Supabase Realtime** | La tabla **no** se agrega a la publicación. El patrón del repo es señal sin payload; aquí ni siquiera señal |
| 11 | **Torre de control** | Hoy no dibuja conductores. Que no empiece: `alcance-v2` es de solo lectura y no amplía exposición de datos personales |
| 12 | **Sentry / observabilidad** | Nunca pasar la entrada del solver como contexto de un error. Un `capturarError` con el input adjunto publica el ancla en un servicio externo |
| 13 | **Traspaso de ruta entre conductores** | El ancla **nunca viaja con la ruta**. Si se recalcula, se usa la del **receptor**; si se continúa tal cual, no se añade tramo final de nadie. Como solo se persiste el orden, esto sale gratis — siempre que no se persista el ancla en la ruta |
| 14 | **"Ver la ruta como la ve el conductor"** | No se construye. Si algún día se construye, va sin ancla |
| 15 | **La app del conductor** | Sí ve su punto: es suyo. Es el único lugar donde se muestra |

### 4.4 El residuo que ningún control elimina, y qué hacer con él

Queda un canal que no se puede cerrar: **el orden de las paradas**. Si la ruta termina cerca de la
casa, un coordinador que mire muchas rutas del mismo conductor a lo largo de semanas puede inferir
"este tipo vive para el lado de Maipú".

- **Resolución de la inferencia: una comuna o un sector, no una dirección.** Y requiere observación
  repetida y deliberada.
- **Es información que el jefe casi siempre ya tiene**: contrató a la persona y, si es dependiente,
  tiene su domicilio en el contrato.
- **Ningún control técnico lo elimina**, porque es la funcionalidad misma: el conductor pidió
  terminar cerca de su casa.

Por lo tanto: se **acepta como residuo**, y se **declara en el texto de consentimiento**. Que el
conductor sepa exactamente qué compra es lo que hace informado el consentimiento:

> *"Tu jefe no va a ver tu dirección ni el punto que marcaste. Lo que sí va a notar, con el tiempo,
> es que tus rutas tienden a terminar por tu sector."*

Si más adelante ese residuo incomoda, la mitigación existe y es acotada: que el ancla decida
**únicamente cuál de las últimas paradas candidatas va al final**, con un tope de kilómetros
añadidos, en vez de gobernar la forma de toda la ruta. No se pide para la v1.

---

## 5. Consentimiento, revocación y borrado

### 5.1 Consentimiento propio, no el del rastreo

El plan proponía reusar `operacion.consentimientos_ubicacion`. **Se reusa la tabla, no el registro.**
Son dos tratamientos distintos —dónde estás durante el turno / dónde vives— y mezclarlos rompe en las
dos direcciones: revocar el rastreo apagaría el punto de término sin que nadie lo pidiera, y tener
vigente el del rastreo se leería como permiso para guardar la casa.

```sql
alter table operacion.consentimientos_ubicacion
  add column if not exists finalidad text not null default 'rastreo_en_ruta';

alter table operacion.consentimientos_ubicacion
  drop constraint if exists consentimientos_ubicacion_finalidad_valida;
alter table operacion.consentimientos_ubicacion
  add constraint consentimientos_ubicacion_finalidad_valida
  check (finalidad in ('rastreo_en_ruta', 'punto_termino_ruta'));

create index if not exists idx_consentimientos_ubicacion_vigente_finalidad
  on operacion.consentimientos_ubicacion (tenant_id, conductor_id, finalidad, otorgado_en desc);
```

El `default` backfilea bien las filas existentes: todas son consentimientos de rastreo.

**Trampa que hay que evitar en el mismo movimiento.** `tieneConsentimientoVigente()`
(`src/modules/operacion/consentimiento-ubicacion.ts:207`) hoy consulta **sin filtrar finalidad**. Si
se agrega la columna y no se toca la función, un consentimiento de punto de término empieza a
autorizar el ping de rastreo. Al agregar el parámetro:

- **`finalidad` va como parámetro obligatorio, sin valor por defecto en TypeScript.** Un parámetro
  opcional deja compilar las llamadas viejas y el error aparece en producción; uno obligatorio obliga
  al compilador a mostrar las dos mitades.
- `registrarConsentimientoUbicacion` y `revocarConsentimientoUbicacion` reciben y filtran igual.
- `revocarConsentimientoUbicacion` hoy borra la ubicación en vivo al final (`:188`). Con finalidades,
  cada revocación borra **lo suyo**: rastreo borra `ubicacion_conductor`, punto de término borra
  `punto_termino_conductor`.
- Prueba unitaria: otorgar `punto_termino_ruta` y verificar que
  `tieneConsentimientoVigente(..., 'rastreo_en_ruta')` devuelve `false`.

### 5.2 Qué tiene que decir el texto

Lo escribe `copywriter`; el contenido obligatorio es este, y la versión sube en
`VERSION_TEXTO_CONSENTIMIENTO_UBICACION`:

1. Qué se guarda: **un punto aproximado**, no una dirección, no el recorrido.
2. Para qué: **solo** para ordenar las paradas de modo que la última quede cerca.
3. Quién lo ve: **nadie más que él**. Ni el coordinador, ni el dueño, ni el seller.
4. Que es **opcional**, que se puede quitar cuando quiera y que **no pasa nada si no lo define**: la
   ruta simplemente termina en la última parada.
5. El residuo del §4.4, dicho con todas sus letras.
6. Cuánto dura y cuándo se borra solo.

### 5.3 Revocación

- Un control visible en la app del conductor, junto al punto. **Un toque, sin confirmación en
  cadena, sin preguntar por qué.**
- Al revocar, en este orden: bitácora primero (invariante de `CLAUDE.md`), luego `revocado_en` en el
  consentimiento, luego **DELETE** de la fila. No `activa = false`: no hay nada colgando de este dato
  —ni plata, ni prueba, ni respaldo contable— así que conservar la fila sería conservar el domicilio
  sin motivo. **Aquí `activa = false` no alcanza; se borra de verdad.**
- Idempotente: revocar dos veces no falla.

### 5.4 Desvinculación del conductor

Cuando el conductor deja de trabajar con el courier —`identidad.conductores.estado` distinto de
activo, o baja lógica— **se borra la fila**, sin esperar a ningún job. El vínculo laboral era la
única razón por la que ese dato existía.

La FK ya lleva `on delete cascade` para el borrado físico, que en este proyecto casi no ocurre: la
baja es lógica. Por eso el borrado hay que dispararlo **explícitamente en la acción que da de baja al
conductor**, y además dejarlo cubierto por el job de purga (§7) como red.

### 5.5 Portabilidad (no bloquea la etapa 7, sí la fecha del 1-dic-2026)

El conductor tiene derecho a pedir sus datos, y hoy **la única exportación del repo es la del
courier**. El punto de término tiene que quedar en la exportación **del conductor** cuando exista —
nunca en la del courier (§4.3, canal 8). Es la deuda ya anotada como 2.14 en `retiro-y-ruteo.md`; se
menciona aquí para que quien construya la etapa 7 no la dé por resuelta.

---

## 6. RLS: la política concreta y contra qué se prueba

### 6.1 Tabla y política

```sql
create table if not exists operacion.punto_termino_conductor (
  conductor_id    uuid primary key references identidad.conductores (id) on delete cascade,
  tenant_id       uuid not null references identidad.tenants (id) on delete restrict,

  -- Redondeadas a 3 decimales (~110 m) por trigger. Ver §3.
  lat             double precision not null,
  long            double precision not null,

  -- Solo para que el conductor reconozca su propio punto. No se muestra a nadie más.
  comuna          text,

  definido_en     timestamptz not null default now(),
  actualizado_en  timestamptz not null default now(),

  constraint punto_termino_conductor_pertenece_al_tenant
    foreign key (tenant_id, conductor_id)
    references identidad.conductores (tenant_id, id)
    deferrable initially immediate
);

alter table operacion.punto_termino_conductor enable row level security;
alter table operacion.punto_termino_conductor force row level security;

drop policy if exists punto_termino_conductor_select on operacion.punto_termino_conductor;
create policy punto_termino_conductor_select
  on operacion.punto_termino_conductor
  for select
  to authenticated
  using (
    tenant_id = identidad.claim_tenant_id()
    and identidad.claim_tipo_usuario() = 'conductor'
    and conductor_id = identidad.claim_driver_id()
  );

-- Sin política de INSERT/UPDATE/DELETE: escribe solo service_role.
revoke all on operacion.punto_termino_conductor from authenticated, anon, public;
grant select, insert, update, delete on operacion.punto_termino_conductor to service_role;
```

Cuatro decisiones que no son de estilo:

1. **No hay rama `interno`.** Ni dueño, ni supervisor, ni coordinador, ni administración.
2. **No hay rama `super_admin`.** La impersonation auditada de `plataforma` no debe abrir esta puerta.
3. **No se crea vista en `public` ni se otorga nada a `authenticated`.** Ningún cliente la consulta
   por PostgREST: la app Expo va por rutas Bearer y la PWA por Server Actions, ambas con
   `service_role`. La política queda escrita igual —inerte hoy, correcta el día que alguien agregue
   una vista sin pensar.
4. **`tenant_id` va igual**, aunque la política no lo necesitara: dar de alta un courier agrega filas
   aquí, o sea es tabla de negocio, y el test mecánico de `CLAUDE.md` no admite discusión.

### 6.2 Dónde está la protección de verdad

La RLS aquí cubre el acceso directo por la API. **No cubre el riesgo principal**, porque el solver
corre con `service_role` y bypasea RLS por diseño. La protección real es el límite del módulo:

- una función `obtenerAnclaFinRuta(tenantId, conductorId)` en `operacion`, único lector del ancla;
- el solver la recibe como parámetro y **devuelve el orden de las paradas**, no los nodos;
- el tipo de la ruta que sale hacia `app/**` no tiene campo donde quepa una coordenada de término.

### 6.3 Contra qué se prueba

**pgTAP** (`supabase/tests/database/rls_aislamiento_punto_termino.test.sql`), con dos tenants y los
cuatro tipos de usuario:

1. Conductor A ve su propia fila.
2. Conductor A **no** ve la fila del conductor B del mismo tenant.
3. Usuario **interno** del tenant A: `permission denied` (no hay `grant`). Si algún día lo hay,
   `is_empty`.
4. **Seller**: `permission denied` / `is_empty`.
5. Conductor del tenant B: cero filas del tenant A.
6. INSERT/UPDATE/DELETE con JWT de conductor sobre su propia fila: **rechazado**.
7. El trigger de redondeo: insertar `-33.456789` y comprobar que queda `-33.457`.
8. Sumar la tabla al Test 3 de `rls_cobertura_meta.test.sql` (toda tabla nueva con RLS declarada).

**Vitest**, y esta es la prueba que traduce una regla de privacidad en algo mecánico:

9. Dos conductores con **exactamente las mismas paradas**, uno con ancla y otro sin ella. Serializar
   los dos DTO de ruta y afirmar que tienen **las mismas claves**, el **mismo `distanciaTotalM`**, y
   que en ninguno aparece un número igual a la coordenada del ancla. Es la comprobación de que "nada
   delata quién no la definió" sobrevive a un refactor.
10. Rechazo cruzado entre tenants en el endpoint Bearer que define/borra el punto (las rutas Bearer
    corren con `service_role`, así que pgTAP no las cubre — es el aviso 1.7 de `retiro-y-ruteo.md`).

---

## 7. Retención y purga

El molde es `src/modules/operacion/jobs/purgar-evidencias.ts`: lotes por debajo del techo de 1.000
filas de PostgREST, un asiento de bitácora **por courier** y no por fila, y borrado en orden seguro.

Lo que **no** se copia de ese molde: las **retenciones legales**. Ahí una evidencia sobrevive si hay
incidencia abierta o cobro impago, porque prueba algo. El punto de término **no prueba nada**: no
respalda un pago, no defiende un cobro, no tiene valor contable. **Nunca se retiene por un asunto
abierto** y no pasa por `pedidosConRetencion()`.

| Evento | Qué ocurre | Quién lo dispara |
|---|---|---|
| El conductor revoca | DELETE inmediato | La acción de revocación (§5.3) |
| El conductor define otro punto | UPDATE de la misma fila. Nunca una fila nueva | La acción de definición |
| El conductor se desvincula | DELETE inmediato | La acción de baja, más el job como red |
| Sin actividad **90 días** (ninguna ruta ni manifiesto) | DELETE | Job de purga |
| Baja del tenant | DELETE | Offboarding |

90 días alinea con la retención de imágenes ya vigente y con lo decidido para el piloto. Un conductor
que no trabaja hace tres meses no necesita que se le guarde dónde vive.

**Dos pasos nuevos de purga**, ambos con su propio asiento de bitácora y sin heredar retenciones:

- `purgar-punto-termino-inactivo` — lo de la tabla de arriba; cabe como paso del job diario.
- `purgar-ubicaciones-rancias` — el hallazgo H-1. **Va en un job horario propio**, no en el diario de
  las 03:30: con cadencia diaria el domicilio se queda en la base toda la noche, que es justo cuando
  el conductor está en su casa.

---

## 8. Lo prohibido (lista dura)

Esto es lo que no se puede hacer, dicho para que quede en el documento y no haya que interpretarlo.

1. **No se guarda histórico del punto de término.** Una fila por conductor, PK `conductor_id`. Ni
   tabla de versiones, ni columna `anterior`, ni "por si acaso". Un cambio de casa pisa el dato.
2. **No se guarda el texto de la dirección** del conductor en ninguna columna, de ninguna tabla.
3. **No se hace pasar la dirección del conductor por `resolverCoordenadaConCache`** ni por ninguna
   otra vía que escriba en `integraciones.geocoding_cache` (global, en claro, sin purga, sin
   `tenant_id`).
4. **No se pone el punto de término como columna de `identidad.conductores`.** Esa política deja a
   cualquier usuario interno leer la fila completa (`conductores_select`,
   `20260101000002_sellers_conductores.sql:199-210`), que es exactamente lo contrario de lo que se
   necesita.
5. **No se infiere el domicilio desde el rastreo.** Nada puede derivar, sugerir ni pre-rellenar el
   punto de término a partir de `ubicacion_conductor`, de `pruebas_entrega.geo_*`, de
   `evidencias_entrega` ni de ninguna posición capturada. El punto lo define el conductor, a mano, o
   no existe.
6. **No se guarda recorrido del conductor.** Ni tabla de trail, ni `ubicacion_conductor` con
   histórico, ni "solo un par de puntos para depurar".
7. **El punto de término no aparece en la exportación del courier** (`TABLAS_A_EXPORTAR`), ni en el
   manifiesto, ni en un PDF, ni en un CSV, ni en un correo, ni en un aviso de la campanita.
8. **No aparece en la bitácora de auditoría** como valor: se registra el hecho, nunca la coordenada.
9. **No aparece en la URL.** Nunca como query param, nunca como segmento de ruta.
10. **No viaja en el DTO de la ruta** hacia el navegador del coordinador, aunque la interfaz no lo
    pinte.
11. **La interfaz del coordinador no puede distinguir** a un conductor que definió su punto de uno
    que no: ni badge, ni campo vacío, ni tooltip, ni orden distinto en la lista, ni total de
    kilómetros diferente.
12. **No se publica la tabla en Realtime** ni se manda a Sentry como contexto de error.
13. **No se ofrece "usar mi última ubicación conocida"** como atajo para definir el punto: convierte
    el rastreo del turno en captura de domicilio, que es el hallazgo H-1 hecho funcionalidad.
14. **No se hace obligatorio.** Ni bloqueando una pantalla, ni con recordatorios repetidos, ni
    condicionando la asignación. Un consentimiento con costo no es consentimiento.

---

## 9. Lo que quedó fuera de esta revisión

- **La numeración exacta del artículo de la Ley 21.431 no se pudo confirmar contra fuente oficial en
  esta sesión.** Se intentó tres veces: BCN (`leychile`, idNorma 1173544) no entrega texto
  renderizable al fetch, y el dictamen de la Dirección del Trabajo que lo interpreta (ORD. N°1831/39,
  19-oct-2022) publica el contenido solo como PDF. `retiro-y-ruteo.md` §1.4 cita "art. 152 quinquies
  D"; **esa cita queda marcada como no verificada**. Lo que sí está confirmado, y es lo que sostiene
  este documento: la Ley 21.431 (publicada el 11-mar-2022) regula el tratamiento de datos personales
  de los trabajadores de plataformas digitales y acota su finalidad al contexto del servicio
  prestado, y la Ley 21.719 entra en vigencia el **1-dic-2026**. **Pendiente:** bajar el PDF del
  ORD. N°1831/39 y fijar la numeración antes de que este documento se use frente a un tercero
  (auditoría, cliente, abogado).
- **No se corrió la consulta de §1.5 contra producción.** Sin eso no se sabe si hoy hay domicilios
  guardados; solo que el camino existe y no tiene tope de tiempo.
- No se revisó la app Expo más allá de confirmar que **no** envía pings de ubicación y que usa
  `expo-location` solo en el POD (`app/(main)/manifiesto/[pedidoId]/index.tsx:59-61`).
- No se revisó el resto del alcance de retiro y ruteo (QR, dinero del retiro, ingesta): esta revisión
  se acotó al punto de término y al rastreo existente.

---

## 10. Checklist de release de la etapa 7

Ninguno de estos ítems es opcional. Si alguno queda abierto, la etapa 7 **no sale a producción**.

- [ ] H-1 cerrado: job horario que purga ubicaciones rancias, y consulta de §1.5 corrida en producción.
- [ ] H-2 decidido: el ping se apaga, o existe la pantalla que lo justifica con su capacidad RBAC.
- [ ] H-3 cerrado: el conductor puede revocar desde la app.
- [ ] Tabla `punto_termino_conductor` con la RLS de §6.1, sin vista en `public`, sin `grant` a `authenticated`.
- [ ] Trigger de redondeo a 3 decimales, con su prueba.
- [ ] `finalidad` en `consentimientos_ubicacion` **y** `tieneConsentimientoVigente` filtrando por ella, en la misma entrega, con el parámetro obligatorio.
- [ ] Texto de consentimiento nuevo, con el residuo del §4.4 declarado, y versión subida.
- [ ] Borrado al revocar y al desvincular, más los dos pasos de purga.
- [ ] Los 15 canales del §4.3 revisados uno por uno contra el código que se escribió.
- [ ] pgTAP (8 aserciones) y Vitest (2 pruebas), incluida la de los dos DTO idénticos.
- [ ] `CLAVES_PROHIBIDAS` actualizada.
- [ ] La tabla **no** está en `TABLAS_A_EXPORTAR`, y hay un comentario que explica por qué.

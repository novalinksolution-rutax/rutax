# Asignación en bloque — diseño de flujo (Etapa 6)

> Estado: diseño de UX, listo para `frontend` y `backend`. Ruta: `(tenant)/preparacion/asignar`.
> Alcance y decisiones de producto: `docs/arquitectura/retiro-y-ruteo.md` §4.
> Plan de ejecución: `docs/arquitectura/retiro-y-ruteo-plan.md`, Etapa 6.
> Pantalla madre: `docs/ux/etapa-5-preparacion-del-dia.md` (§12 reservó el lugar donde esto entra).

## 0. Propósito, en una frase

El coordinador filtra el universo de lo ya retirado, selecciona un bloque y lo asigna a un conductor
con un clic — muchas veces por la mañana, en lotes chicos, nunca de una sola vez al final — y la
pantalla nunca lo deja adivinando qué pasó con un pedido que desapareció de su vista o que no se
pudo asignar.

## 1. El flujo, narrado un día completo

Continúa el mismo día que narra `etapa-5-preparacion-del-dia.md`, con las mismas cifras, para que
los dos documentos describan una sola operación.

1. **09:10.** Va una sola visita cerrada, 12 bultos de Ñuñoa. En `/preparacion`, el bloque
   "Asignación" dice *"12 pedidos retirados sin asignar"*. Es poco: no hace nada.
2. **10:05.** Ya son 142 en Ñuñoa, 98 en Providencia, 44 en Renca. Hace clic sobre la fila **Ñuñoa**
   de "Carga por comuna" —ahora es un enlace— y entra a la bandeja con el filtro puesto. Agrega
   Providencia y Las Condes (multi-selección). Ve 40 sin asignar. Aprieta **"Seleccionar los 40 de
   este filtro"**, destilda 10, elige a **Pedro Soto** y asigna. Ninguno estaba asignado antes, así
   que no hay diálogo: *"30 pedidos asignados a Pedro Soto."*
3. **10:06.** Sin salir, cambia el chip de estado a **"Sin asignar"**: quedan exactamente los 10 que
   dejó. Los selecciona, elige a **María Rojas** y asigna. Dos lotes, cero pedidos digitados, cero
   vueltas a Manifiestos.
4. **11:40.** Cierra una visita en Renca. Filtra Renca: 22 sin asignar y **1 ya asignado a Pedro
   Soto**. Selecciona los 23, elige a **Diego Vera**. Aparece el diálogo: *"Vas a mover 1 pedido de
   Pedro Soto."* Confirma.
5. **13:10.** Un pedido que dejó seleccionado hace rato resulta cancelado en Mercado Libre mientras
   tanto. El resultado no dice "8 de 9": dice *"1 no se pudo asignar: cambió de estado antes de
   confirmar"*, con el código a la vista. No tiene que ir a buscarlo.
6. **15:58.** El bloque en `/preparacion` dice *"Todo lo retirado hoy ya está asignado."* Listo antes
   de las 16:00.

## 2. Dónde encaja

### 2.1 Ruta propia, no widget embebido

El bloque "Asignación" de `/preparacion` **se queda donde está y con la misma caja**, pero deja de
ser un enlace estático: pasa a ser un resumen en vivo con una sola acción, que abre la pantalla de
trabajo real en **`/preparacion/asignar`**.

La bandeja —filtros, tabla, selección masiva, barra de acción— no cabe en una columna de 320 px, ni
debería: es una herramienta con sus propias confirmaciones, no un dato para mirar de reojo. Tres
razones además del espacio:

1. **Precedente:** la pantalla que se retira ya era una ruta propia, con la misma complejidad.
2. **Resiliencia a la interrupción.** Es una mañana con el teléfono sonando y el seller apurando.
   Una URL sobrevive a un refresh y se puede volver a abrir; un modal no.
3. **El patrón de filtros del proyecto es Server Component + `searchParams`.** Meterlo en una
   `Sheet` obligaría a reconstruir esa lectura como client-side, duplicando lógica que ya funciona.

- **Metadata:** `title: "Asignar pedidos"`. **Ancho:** normal (`max-w-6xl`), no entra a `rutasAnchas`.
- **RBAC: `puedeAsignarYReasignarPedidos`** — capacidad existente, no hace falta una nueva. Los tres
  roles que llegan a `/preparacion` la tienen; `administracion` no tiene ninguna de las dos, así que
  ni ve el botón ni puede entrar por URL.
- **Breadcrumb:** `← Volver a Preparación del día`. **No entra al sidebar**: es pantalla de trabajo,
  no destino de primer nivel.

### 2.2 El enlace profundo por comuna — se cierra un pendiente

`etapa-5-preparacion-del-dia.md` §12 decidió **no** enlazar por comuna porque no había a qué
enlazar. Esa razón se cae en cuanto existe esta ruta. Cada fila de "Carga por comuna" pasa a enlazar
a `/preparacion/asignar?comuna=X`, con esa comuna precargada y ajustable. Es gratis y ahorra el
primer paso del flujo más común.

### 2.3 Qué se retira

`/manifiestos/nuevo` y `/manifiestos/[id]/asignar` **quedan sin función** y se retiran: toda
asignación pasa por aquí. `/manifiestos` (la lista) y `/manifiestos/[id]` (el detalle: confirmar,
ver estado) **no se tocan** — siguen siendo "qué manifiestos existen hoy y en qué estado"; solo
cambia cómo se llenan. El botón "Agregar pedidos" del detalle redirige a `/preparacion/asignar` con
ese conductor preseleccionado.

## 3. El contrato de datos

Por pedido asignable: `id`, **código visible** (`ml_shipment_id ?? codigo_interno` — nunca
`tracking_token`), comuna de destino, seller, estado (`pendiente_asignacion` o `asignado`) y, si
está asignado, **a qué conductor**.

La reja que no se muestra como columna pero gobierna todo: **`situacion_retiro = 'retirado'`**. Por
construcción todo lo que aparece ya la cumple; una columna que siempre dijera "Retirado" sería ruido.

**Resuelto (era el hueco §15.1 del diseño):** el manifiesto es **subproducto**. Al asignar, el
backend busca-o-crea el manifiesto de `(conductor, fecha de hoy)` en estado `borrador`, y todo lote
sucesivo al mismo conductor en el mismo día se acumula ahí. La confirmación del manifiesto ocurre al
despacho, no antes — si ocurriera antes de las 16:00, esta pantalla no podría seguir agregando.

**Resuelto (era el hueco §15.5):** el defecto del escaneo posterior al cierre —que dejaba pedidos sin
llegar nunca a `retirado`— **ya está corregido** (2026-08-14). Esta pantalla se apoya en ese campo,
así que era dependencia dura.

## 4. Los estados de la bandeja

**`cargando`** — esqueleto con la forma final (§11), nunca spinner.

**`sin_acceso`** — bloque `ShieldAlert`, mismo patrón que `/preparacion` y la Torre.
`No tienes permiso para asignar pedidos` / `Asignar pedidos es para el dueño, el supervisor y el
coordinador de tráfico.`

**`error_carga`** — `role="alert"`, `bg-destructive-subtle`, un solo bloque (aquí hay una sola fuente
de datos, a diferencia de `/preparacion`).

**`arranque_vacio_global`** — cero pedidos `retirado` en todo el tenant hoy, sin filtros. No es un
error ni una lista incompleta: es la mañana antes de que cierre la primera visita. Reemplazo completo
del área de filtros y tabla, con `EmptyState` tono `arranque`, icono `Boxes`:
`Todavía no hay pedidos para asignar` / `Los conductores están retirando en bodega. En cuanto cierren
una visita, sus pedidos van a aparecer acá.` / botón `Volver a Preparación del día`.

**`filtro_sin_resultados`** — hay retirados, pero no con este filtro. Tono distinto a propósito:
esto sí es "prueba otra búsqueda". Icono `SearchX`:
`Ningún pedido retirado coincide con estos filtros` / `Prueba ampliando la comuna, el seller o el
texto de búsqueda.` / botón `Limpiar filtros`.

**Con resultados** — filtros + tabla + paginación. La barra inferior aparece solo con selección
activa, superpuesta, sin recolocar el layout.

## 5. Filtros

```
Comuna (3) ▾    Seller: Todos ▾    [Buscar por código      ]   ○Todos ●Sin asignar ○Asignados    Limpiar filtros
```

1. **Comuna, multi-selección.** No existe un componente así en el repo; se compone con `Popover` +
   `Checkbox` ya disponibles, **sin dependencia nueva**. La lista **no es el catálogo completo de la
   RM** —serían ~52 filas casi todas en cero— sino las comunas que hoy tienen al menos un pedido
   retirado, cada una con su conteo (`Ñuñoa · 56`). Trigger: `Comuna` sin selección, `Comuna (3)` con
   tres. Dentro: `Seleccionar todas` / `Limpiar`.
2. **Seller** — `Select` simple, `Todos los sellers` + lista.
3. **Buscar por código** — texto libre contra `ilike '%texto%'`, no exacto: el coordinador suele
   recordar solo los últimos dígitos de un id de Flex, que son largos.
4. **Estado** — chip `Todos` / `Sin asignar` / `Asignados`, sobre los valores reales del enum.
   **No estaba en el contrato original y se agrega a propósito:** sin él, el ejemplo canónico del
   alcance ("filtra 40, asigna 30 a uno y 10 a otro") obliga a destildar 10 a mano cada vez; con él,
   después del primer lote basta un clic para aislar lo que queda.

## 6. La selección — el corazón de esta etapa

### 6.1 Qué se rompe hoy, y por qué

Hoy la selección es un `Set<string>` de ids. Al cambiar el filtro la navegación es suave (el `Set`
sobrevive), pero **la tabla solo puede pintar checkboxes sobre las filas cargadas ahora**. Un pedido
marcado bajo un filtro anterior sigue en el `Set` —sigue viajando en el envío— pero deja de tener
dónde mostrarse. Y la advertencia se calcula así:

```ts
pedidosDisponibles.filter(pd => seleccionados.has(pd.pedido.id) && pd.pedido.estado === "asignado")
```

`pedidosDisponibles` es la lista **actual**. Si el pedido ya no está ahí, el filtro nunca lo
encuentra: la advertencia no dispara aunque el id sí se envíe.

**La raíz:** la fuente de verdad de "qué hay seleccionado" y la de "qué se está mostrando" son la
misma variable. En cuanto divergen, todo lo que depende de "lo visible" queda ciego.

### 6.2 El arreglo: la selección guarda su propia foto

La selección pasa a ser **`Map<string, PedidoSeleccionado>`**, donde cada entrada guarda una foto
mínima tomada al marcarlo:

```ts
PedidoSeleccionado = {
  pedidoId, codigoVisible, comuna, sellerNombre,
  estado: 'pendiente_asignacion' | 'asignado',
  conductorActualId: string | null,
  conductorActualNombre: string | null,
}
```

Con eso, dos cosas dejan de depender de lo que esté renderizado:

- **La barra y el panel de selección** leen del `Map`, nunca de la lista filtrada. Un pedido
  seleccionado bajo otro filtro se sigue viendo, en otro lado, pero se ve.
- **La advertencia de reasignación** itera el `Map` completo. Ya no existe ninguna lista "visible"
  que consultar: el `Map` **es** la selección, siempre.

Una sola decisión resuelve las dos mitades del bug, y las resuelve **por construcción**: no hay
forma de volver a escribir el filtro equivocado, porque no hay dos listas entre las que elegir.

### 6.3 Cómo se ve, en todo momento

Barra inferior sticky, apenas hay 1+ seleccionado:

```
┌──────────────────────────────────────────────────────────────────────────┐
│  Ver selección (43)   3 fuera de este filtro    Vaciar selección         │
│                                        [ Elegir conductor ▾ ]  [Asignar]  │
└──────────────────────────────────────────────────────────────────────────┘
```

- **`Ver selección (43)`** — botón, no texto muerto. El número es el tamaño del `Map`, no de lo
  visible. Abre el panel lateral.
- **`3 fuera de este filtro`** — aparece solo si la selección excede lo visible marcado. Es la
  respuesta literal a "cómo se ve una selección que incluye cosas que no están en pantalla": una
  frase corta, siempre presente, sin abrir nada. Tono neutro, no es alarma.
- **Selector de conductor** — cada opción `{nombre} · {N} hoy`, para no sobrecargar a nadie más allá
  del rango real de 25-30 paradas. **Persiste entre envíos**: casi siempre el lote siguiente es para
  el mismo conductor. Los conductores marcados `disponible` van primero.
- **`Asignar`** — deshabilitado hasta que haya conductor y selección.

Panel **"Ver selección"** (`Sheet` derecha), agrupado por comuna:

```
┌─────────────────────────────────┐
│ Pedidos seleccionados       [x] │
│ 43 en total                     │
├─────────────────────────────────┤
│ Ñuñoa                            │
│ ┌───────────────────────────┐   │
│ │ 44760788901        [x]    │   │
│ │ Comercial Andes            │   │
│ │ Con Pedro Soto             │   │
│ └───────────────────────────┘   │
│ Renca                            │
│ ┌───────────────────────────┐   │
│ │ RX-7K2M-9PQR       [x]    │   │
│ │ Full Import SpA            │   │
│ │ Fuera del filtro actual    │   │
│ └───────────────────────────┘   │
├─────────────────────────────────┤
│ Vaciar toda la selección  Cerrar│
└─────────────────────────────────┘
```

Cada fila con `[x]` individual para deseleccionar sin volver a la tabla. `Con {conductor}` en tono
advertencia si ya está asignado — el riesgo se ve **antes** del diálogo. `Fuera del filtro actual` en
tono neutro: la otra mitad de hacer visible lo invisible.

### 6.4 "Seleccionar todos" — nunca ambiguo

Dos niveles, nunca uno solo:

- **Checkbox de cabecera** — solo las filas de la **página actual**. Soporta `indeterminate` cuando
  la página está parcialmente marcada.
- **Aviso sobre la tabla**, solo si el total filtrado excede la página:
  `Mostrando 50 de 143 pedidos que cumplen este filtro. [Seleccionar los 143]`
  Al pulsarlo se resuelven **todos** los ids del filtro vía `leerTodasLasFilas`/`leerPorLotesDeIds`,
  nunca un `.select()` suelto que se trunca en 1.000 filas sin avisar. Luego el texto cambia a
  `Los 143 pedidos de este filtro están seleccionados. [Deseleccionar todos]`.

**Nunca** se repite el patrón actual ("N pedidos disponibles" con el largo ya truncado en 100). El
contador usa siempre el total real con `count: 'exact'`.

## 7. El flujo de asignar

**7.1 Disparo.** Botón `Asignar` de la barra, con conductor ya elegido.

**7.2 ¿Hay reasignación?** Se filtra el `Map` **completo** por `estado === 'asignado' &&
conductorActualId !== conductorElegidoId`. Si está vacío, va directo al envío — sin fricción para el
caso más común.

**7.3 Diálogo, solo si hay reasignación.** Agrupado **por conductor de origen**, que es lo que lo
hace legible con decenas de pedidos:

```
┌──────────────────────────────────────────────────┐
│ ⚠  Vas a mover pedidos de otro conductor          │
│    Estos pedidos ya están asignados a otra        │
│    persona. Si continúas, se los vas a quitar y   │
│    van a quedar con Diego Vera.                   │
│                                                    │
│    Pedro Soto — 1 pedido                          │
│    · 44760788901 · Ñuñoa                          │
│    María Rojas — 4 pedidos                        │
│    · 44760788850 · Providencia   ...              │
│                                                    │
│         [ Cancelar ]  [ Confirmar de todos modos ]│
└──────────────────────────────────────────────────┘
```

**No pide motivo escrito.** El traspaso es libre por decisión ya tomada del alcance, ocurre varias
veces por hora, y pedir justificación sería fricción sin respaldo en el resto del sistema. Lo
no-negociable es que el coordinador **vea a quién se lo está quitando**.

**7.4 Envío.** Server Action con conductor + la lista completa del `Map`. La escritura va por una
sola función SQL transaccional: o se aplican todos o no se aplica ninguno.

**7.5 El resultado — nunca "28 de 30" a secas.**

Sin omisiones, `toast.success`: `30 pedidos asignados a Pedro Soto`, con sub-línea condicional
`5 de ellos venían de otro conductor.`

Con omisiones, un `Dialog` que **no se autocierra** — hay algo que el coordinador tiene que leer, no
algo que pueda perderse en una esquina:

```
┌──────────────────────────────────────────────────────┐
│ Resultado de la asignación                            │
│ 8 pedidos quedaron con Ana Muñoz                       │
│ 2 reasignados desde otro conductor                     │
│ ──────────────────────────────────────────────────    │
│ 1 ya estaba con Ana Muñoz — no hizo falta cambiar nada │
│ · 44760788933 · Las Condes                             │
│ ──────────────────────────────────────────────────    │
│ ⚠ 1 no se pudo asignar                                 │
│ · 44760788940 · Las Condes                             │
│   Cambió de estado antes de confirmar. Revisa el       │
│   pedido.                        [ Ver pedido ]        │
│                                          [ Cerrar ]    │
└──────────────────────────────────────────────────────┘
```

**Por qué tres bloques y no un solo balde de "omitidos":** el backend devuelve tres motivos juntos,
pero para el coordinador no son la misma noticia. "Ya estaba con este conductor" **no es un
problema** — es el sistema confirmando que su intención ya estaba lograda. Darle el mismo tono que a
"se canceló" entrena a temerle a un resultado parcial que en realidad es un éxito.

| Motivo del backend | Bloque | Tono | Acción |
|---|---|---|---|
| éxito | "N pedidos quedaron con {conductor}" | éxito | — |
| `ya_estaba_en_manifiesto` | línea propia | neutro | — |
| `no_retirado` | "no se pudo asignar" | ámbar | — |
| `estado_no_asignable` | "no se pudo asignar" | ámbar | `Ver pedido` |

**Nunca rojo**: nada de esto es una incidencia abierta. El tope de severidad es ámbar.

**Qué pasa con la selección al cerrar:** los que terminaron bien salen del `Map`. Los que de verdad
no se pudieron asignar **se quedan seleccionados**, en la barra y en el panel, para que el
coordinador actúe sin volver a buscarlos. Es la respuesta concreta a "obliga a ir a buscarlos a
mano": no, porque nunca los pierde de la mano.

## 8. Tiempo real: aviso, NO refresco automático

`/preparacion` se refresca sola y está bien: es de solo lectura, nadie tiene el dedo sobre un
checkbox. **Aquí copiar ese patrón sería dañino:** si la tabla se re-renderiza mientras el
coordinador va haciendo clics, **las filas se mueven bajo el cursor y el clic siguiente cae sobre el
pedido equivocado**.

`IndicadorEnVivo` sigue activo con las mismas tres tablas, pero la señal enciende un aviso discreto
que el coordinador dispara cuando él decide:

```
┌──────────────────────────────────────────────────┐
│  Hay pedidos nuevos disponibles.   [ Actualizar ] │
└──────────────────────────────────────────────────┘
```

La selección vive en un `Map` por id, no por posición, así que sobrevive al refresco sin problema —
justamente el diseño que lo hace seguro. El conteo de la cabecera sí puede seguir actualizándose
solo: ahí nadie hace clic.

## 9. Wireframe — escritorio (≥1024px)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ ← Volver a Preparación del día                                               │
│ Asignar pedidos                                                 ● En vivo    │
│ Solo se muestran pedidos ya retirados en bodega. Lo que todavía no se        │
│ escaneó no aparece acá.                                                      │
│ 143 pedidos retirados hoy · 66 sin asignar                                   │
├──────────────────────────────────────────────────────────────────────────────┤
│ Comuna (3) ▾   Seller: Todos ▾   [Buscar por código   ]  ○Todos ●Sin asignar │
│                                                            Limpiar filtros    │
├──────────────────────────────────────────────────────────────────────────────┤
│  Hay pedidos nuevos disponibles.                              [ Actualizar ] │
├──────────────────────────────────────────────────────────────────────────────┤
│ Mostrando 50 de 66 pedidos que cumplen este filtro.  [ Seleccionar los 66 ]  │
├─┬────────────────┬───────────────┬──────────────────┬────────────────────────┤
│☐│ Código          │ Comuna        │ Seller            │ Estado                │
├─┼────────────────┼───────────────┼──────────────────┼────────────────────────┤
│☑│ 44760788897     │ Ñuñoa         │ Comercial Andes   │ Sin asignar            │
│☑│ 44760788901     │ Ñuñoa         │ Comercial Andes   │ ⚠ Asignado a Pedro Soto│
│☐│ RX-7K2M-9PQR    │ Providencia   │ Full Import SpA   │ Sin asignar            │
│ │       ⋮ (paginado, 50 por página)                                          │
├─┴────────────────┴───────────────┴──────────────────┴────────────────────────┤
│                                          Página 1 de 2   [Anterior][Siguiente]│
└──────────────────────────────────────────────────────────────────────────────┘
┌──────────────────────────────────────────────────────────────────────────────┐
│  Ver selección (43)   3 fuera de este filtro    Vaciar selección             │
│                                        [ Elegir conductor ▾ ]     [ Asignar ] │
└──────────────────────────────────────────────────────────────────────────────┘
```

Cuando el seller tiene más de una cuenta ML conectada, bajo la comuna aparece el mismo chip discreto
que ya usa `/operaciones` — solo si hay pluralidad real, en silencio si no la hay.

## 10. Wireframe — móvil (<1024px)

Los filtros se agrupan tras un botón que abre una `Sheet` desde abajo. La tabla se vuelve lista de
tarjetas, mismo criterio que `/preparacion`.

```
┌───────────────────────────┐
│ ☰   Rutax                 │
├───────────────────────────┤
│ ← Volver a Preparación     │
│ Asignar pedidos             │
│ Solo pedidos ya retirados   │
│ en bodega.        ● En vivo│
│ 143 retirados · 66 sin      │
│ asignar                     │
├───────────────────────────┤
│ [ Filtros (3) ▾ ]  [Buscar]│
├───────────────────────────┤
│ Mostrando 50 de 66.         │
│ [ Seleccionar los 66 ]      │
├───────────────────────────┤
│ ┌───────────────────────┐ │
│ │ ☑ 44760788897          │ │
│ │   Ñuñoa                │ │
│ │   Comercial Andes      │ │
│ │   Sin asignar          │ │
│ └───────────────────────┘ │
│ ┌───────────────────────┐ │
│ │ ☑ 44760788901          │ │
│ │   Ñuñoa · Comercial A. │ │
│ │   ⚠ Asignado a Pedro   │ │
│ └───────────────────────┘ │
│          ⋮ (scroll)        │
├───────────────────────────┤
│ Página 1 de 2 [ < ] [ > ]  │
└───────────────────────────┘
┌───────────────────────────┐
│ Ver selección (43)          │
│ 3 fuera de este filtro      │
│ [ Elegir conductor ▾ ]      │
│ [       Asignar        ]    │
└───────────────────────────┘
```

## 11. El bloque en `/preparacion`, actualizado

Reemplaza solo el contenido de `_componentes/bloque-asignacion.tsx`. La caja, su posición y su
encabezado no cambian.

```
┌────────────────────────────┐        ┌────────────────────────────┐
│ ASIGNACIÓN                  │        │ ASIGNACIÓN                  │
│ 66                          │   o    │ Todo lo retirado hoy ya     │
│ pedidos retirados sin       │        │ está asignado.              │
│ asignar                     │        │                             │
│ [    Asignar pedidos    ]   │        │ [    Asignar pedidos    ]   │
└────────────────────────────┘        └────────────────────────────┘
```

El botón sigue presente en cero: no es un estado de error, y el coordinador puede querer entrar a
revisar reasignaciones o a esperar el próximo lote sin que el botón aparezca y desaparezca.

## 12. `loading.tsx`

Forma final con `<Skeleton>`, nunca spinner: breadcrumb, título + subtítulo, cuatro filtros en fila,
ocho filas de tabla, paginación. Sin barra inferior — no hay selección posible antes de los datos.

## 13. Glosario de textos exactos

**Cabecera** — `Volver a Preparación del día` · H1 `Asignar pedidos` · explicación fija, siempre
visible: `Solo se muestran pedidos ya retirados en bodega. Lo que todavía no se escaneó no aparece
acá.` · subtítulo `{total} pedidos retirados hoy · {sinAsignar} sin asignar`.

**Filtros** — `Comuna` / `Comuna ({n})` · `Seleccionar todas` · `Limpiar` · `Todos los sellers` ·
`Buscar por código de envío` · `Todos` / `Sin asignar` / `Asignados` · `Limpiar filtros`.

**Aviso de novedades** — `Hay pedidos nuevos disponibles.` / `Actualizar`.

**Aviso de truncamiento** — `Mostrando {pageSize} de {total} pedidos que cumplen este filtro.` /
`Seleccionar los {total}` → `Los {total} pedidos de este filtro están seleccionados.` /
`Deseleccionar todos`.

**Fila** — `Sin asignar` (neutro) · `Asignado a {conductor}` (ámbar, con `AlertTriangle`).

**Barra** — `Ver selección ({n})` · `{n} fuera de este filtro` · `Vaciar selección` ·
`Elegir conductor` · opción `{nombre} · {n} hoy` · `Asignar`.

**Panel** — `Pedidos seleccionados` · `{n} en total` · `Con {conductor}` · `Fuera del filtro actual`
· `Vaciar toda la selección` · `Cerrar`.

**Diálogo de reasignación** — `Vas a mover pedidos de otro conductor` / `Estos pedidos ya están
asignados a otra persona. Si continúas, se los vas a quitar y van a quedar con {conductorElegido}.`
/ `{conductorActual} — {n} pedidos` / `Cancelar` · `Confirmar de todos modos ({n})`.

**Resultado** — `{n} pedidos asignados a {conductor}` + `{r} de ellos venían de otro conductor.` ·
`Resultado de la asignación` · `{n} pedidos quedaron con {conductor}` · `{r} reasignados desde otro
conductor` · `{n} ya estaba con {conductor} — no hizo falta cambiar nada` · `{n} no se pudo
asignar` · motivo `no_retirado`: `Ya no figura como retirado. Puede haber vuelto a la bandeja de
candidatos.` · motivo `estado_no_asignable`: `Cambió de estado antes de confirmar (por ejemplo, se
canceló). Revisa el pedido.` + `Ver pedido` · `Cerrar`.

**Vacíos** — ver §4. **Error** — `No pudimos cargar los pedidos para asignar. Intenta recargar la
página.` **Sin acceso** — ver §4.

**Bloque en `/preparacion`** — `{n} pedidos retirados sin asignar` / `Todo lo retirado hoy ya está
asignado.` / `Asignar pedidos`.

Pluralización explícita siempre: 1 → singular, 0 o 2+ → plural. Nunca un `(s)` literal en pantalla.

## 14. Qué queda fuera, a propósito

- **Clustering o sugerencia automática de reparto.** La selección masiva por filtros **es** la
  feature; el algoritmo no existe y no se va a construir.
- **Secuenciación de las paradas** — es la Etapa 7, sobre pedidos ya asignados aquí.
- **Traspaso conductor-a-conductor por escaneo físico** (Etapa 9) — otro actor y otro canal. Esta
  pantalla resuelve la reasignación *administrativa*, antes de las 16:00.
- **"Cuántos faltan por retirar".** Mismo argumento que cerró la Etapa 5: un seller despacha con
  varios couriers, así que un "esperado" contra los candidatos de ML es una alarma falsa. Esta
  pantalla cuenta lo que **ya** está en poder del courier.
- **Desglose Flex / same-day** — hoy producción tiene cero same-day; sería una columna de ceros.
- **Cuenta ML como filtro** — se muestra como dato, no como filtro. No hay evidencia de que el
  coordinador necesite filtrar por cuenta al armar un bloque por zona.
- **Ordenar por columnas** y **selección por rango con shift+clic** — mejoras de pulido. El orden por
  defecto (comuna, luego código) ya sirve al caso real. Vale la pena reconsiderar el shift+clic si a
  volumen alto aparece el caso "los primeros 30 de 90 que no se separan por comuna".
- **Motivo escrito para una reasignación** — ver §7.3.
- **Cualquier dato personal del destinatario** — ni nombre, ni dirección, ni teléfono, en ninguna
  fila, tarjeta, panel ni diálogo.

## 15. Criterios de aceptación

- [ ] Ruta `(tenant)/preparacion/asignar/page.tsx` + `loading.tsx`, `max-w-6xl`, dentro del `AppShell`.
- [ ] Gate `puedeAsignarYReasignarPedidos` en la página **y** condicionando el botón del bloque.
- [ ] La bandeja filtra **siempre** por `situacion_retiro = 'retirado'` **y** `estado IN
      ('pendiente_asignacion','asignado')` — las dos rejas juntas, nunca una sola.
- [ ] El conteo de cabecera y el aviso de truncamiento usan `count: 'exact'`, **nunca** `.length` de
      una consulta que pudo truncarse en 1.000 filas.
- [ ] "Seleccionar los N del filtro" resuelve ids con `leerTodasLasFilas`/`leerPorLotesDeIds`.
- [ ] Selección como `Map<pedidoId, PedidoSeleccionado>` con foto propia por ítem — **nunca** un
      `Set<string>` de ids sueltos.
- [ ] La advertencia de reasignación itera el `Map` completo, **nunca** la lista renderizada.
- [ ] La barra y el panel leen del `Map`, no de la página visible.
- [ ] El aviso "Hay pedidos nuevos" es la única superficie de tiempo real sobre la tabla — **nunca**
      un refresco automático mientras hay selección activa.
- [ ] El resultado itemiza cada omisión con código, comuna y motivo, con tres niveles de severidad
      distintos — nunca un conteo agregado sin detalle.
- [ ] Rojo reservado a la incidencia abierta. El tope aquí es ámbar.
- [ ] Ningún dato personal del destinatario. Nunca `bultos_retiro_qr` ni `hash_code`.
- [ ] Un asiento de bitácora por lote, con su autor. La escritura del lote es transaccional: o todos
      o ninguno.
- [ ] El selector de comuna se compone con `Popover` + `Checkbox` existentes, sin dependencia nueva.
- [ ] Checkbox de cabecera con estado `indeterminate` en selección parcial de página.
- [ ] `aria-label` por checkbox de fila (`Seleccionar pedido {codigoVisible}`), `role="alert"` en el
      banner de error.
- [ ] `tabular-nums` en las cifras; pluralización explícita en todo texto con conteo.

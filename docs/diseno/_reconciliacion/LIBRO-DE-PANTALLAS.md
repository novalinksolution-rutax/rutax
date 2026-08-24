# El libro de pantallas

Las **73 pantallas** del producto contra su tablero, con veredicto. Es el segundo libro del
rediseño: `CHECKLIST-REDISENO.md` lleva la cuenta de los **componentes** y sigue siendo válido en
ese eje; éste lleva la de las **pantallas**, que es el eje que faltaba y por el que se coló que el
dashboard operativo nunca se rediseñara.

De aquí en adelante **el trabajo se pide por pantalla**, no por componente. El checklist deja de
ser la cola.

Levantado el 23-08-2026 contra los 31 tableros de `docs/diseno/pantallas/`. El detalle de cada
ficha —qué muestra el tablero, qué tiene el código con `archivo:línea`, y el delta— está en los
seis archivos `01-` a `06-` de esta carpeta. Acá va solo el veredicto y el orden.

## El recuento

| Veredicto | Pantallas | Qué significa |
|---|---|---|
| `FALTA PIEZA` | 38 | La estructura está; faltan piezas enumerables |
| `PANTALLA DISTINTA` | **22** | El tablero propone otra organización. **Se rehace**, no se parcha |
| `NO EXISTE` | 8 | La ruta no está en el repo |
| `IGUAL` | 5 | Coincide con la estructura del tablero |

⚠️ **`IGUAL` no cierra una pantalla.** Es un veredicto de lectura de código: dice que la
estructura coincide, no que se vea como el tablero. Ver la regla de cierre, abajo.

## La regla de cierre

**Ninguna pantalla se da por cerrada sin abrirla en el navegador y compararla con su tablero**,
en 1440 y en 390, en claro y en oscuro. Decisión del usuario, 23-08.

Existe porque el riesgo de este libro es exactamente ése: que el código dé por listo un diseño
que nadie miró. El tablero sigue siendo la autoridad visual; este libro solo dice cuál abrir.

## Las cuatro decisiones tomadas al levantarlo

1. **El orden de trabajo es por bloque, en el orden de los tableros** — B1 → B8.
2. **El punto de término del conductor queda fuera del rediseño.** El tablero B1b lo dibuja en el
   detalle del manifiesto; una revisión de privacidad propia (Ley 21.431,
   `docs/seguridad/punto-de-termino-conductor.md` §4) lo prohíbe. Se ve con el alcance de ruteo,
   que ya tenía a `seguridad-cumplimiento` como compuerta previa. La pantalla se construye sin él.
3. **«Ayer a esta hora» sale de lo que declara la app** — `pruebas_entrega.capturado_en` y
   `cierres_conductor`, la misma fuente que la Torre. Sin migración. Consecuencia asumida: el
   dashboard puede ir por delante de `/operaciones`, igual que la Torre.
4. **Cobranza queda congelada.** El atribuidor del tablero reparte un pago entre varios períodos y
   la base no lo modela (`pagos_recibidos` tiene un solo `periodo_cobro_id`, y re-atribuir reversa
   la imputación previa). No se toca la pantalla hasta decidir el esquema.

---

# La marca · hecha el 23-08-2026

**No estaba en ninguna parte del producto**, y lo levantó una pregunta del usuario en medio del
bloque 1. Vale la pena dejar escrito qué se encontró, porque es transversal y no de una pantalla:

- El sidebar dibujaba un **cuadrado con degradado navy→morado** y la inicial del courier — patrón
  del sistema anterior, que rompía dos reglas del nuevo a la vez: «fuera de los seis tonos de estado
  el producto es tinta y papel, no hay acento decorativo» y la sombra en algo que no flota.
- El avatar del usuario tenía **el mismo degradado**. Un avatar no es un estado: no tiene color que
  gastar.
- La pantalla sin sesión ponía la marca como **texto plano**.
- Y sí existían assets, pero **de la identidad anterior**: un monograma «R» de favicon y un wordmark
  sin usar, con `themeColor: #2a3ca0` — el navy viejo pintando la barra del navegador en móvil.

**El símbolo es «dos reglas que calzan»** (ruta de marca 1a): dos barras de 15×5 sobre retícula de
24, una desde cada eje, traslapadas ocho unidades en el centro. Ese traslape es el cuadre.

Lo notable es que **el producto ya había heredado todas las consecuencias de la marca sin haber
puesto nunca la marca**: «el símbolo son dos reglas que calzan, así que el producto separa con
reglas, no con tarjetas ni sombras» — de esa frase vienen el radio de 0 a 4 px, la sombra solo en lo
que flota y que una tabla de mil filas no tenga un borde redondeado que dibujar.

**Lo construido** — `src/components/ui/marca-rutax.tsx`:

- `SimboloRutax` con la geometría exacta del manual. La tinta va por `currentColor`, así que hereda
  del contexto; el acento por token, así que cambia con el tema.
- Las tres versiones: `completa` (símbolo + logotipo + descriptor, mín. 148 px), `reducida`
  (mín. 84 px) y `simbolo` (mín. 16 px). No hay una cuarta: si no cabe la reducida cabe el símbolo,
  y si no cabe el símbolo a 16 px ese sitio no lleva marca.
- `FirmadoPorRutax` — la fila de cierre de las superficies que firma el courier.

**La regla 42, aplicada:** Rutax firma el backoffice; el courier firma la pantalla sin sesión que le
toca y **el seguimiento del comprador**, donde Rutax entra abajo como fila de cierre — «la misma
barra que cierra una liquidación cierra la pantalla. Es un lugar estructural, no un pie de página, y
por eso no compite con la marca de arriba».

*Sin logo del courier —el caso real de hoy— el nombre de fantasía es el titular. No hay hueco ni
caja vacía; el día que se pueda subir un logo, entra y nada más se mueve.*

**Verificado en pantalla:** el símbolo sale con su geometría exacta, en claro tinta `#0B1114` +
acento `#00B89A`, y en oscuro la tinta baja a `#E9F2F3` — **no sube a blanco puro**, que es regla
del manual y no un descuido. Cero degradados en toda la página.

⚠️ **No se pudo ejercitar** la firma del seguimiento público: los datos de demo no tienen ningún
pedido con `tracking_token` —son todos Flex, y esa pantalla tiene frontera dura contra Flex—.

# La cola, por bloque

## B1 · Operación del courier · 8 pantallas

| Pantalla | Ruta | Veredicto |
|---|---|---|
| Dashboard operativo | `(tenant)/dashboard` | ✅ **HECHA** — 23-08, ver abajo |
| Conductores | `(tenant)/conductores` | ✅ **HECHA** — 23-08, ver abajo |
| Crear pedido same-day | `(tenant)/operaciones/nuevo` | ✅ **HECHA** — 23-08, ver abajo |
| Incidencias | `(tenant)/operaciones/incidencias` | ✅ **HECHA** — 23-08, ver abajo |
| Torre de control | `(tenant)/torre-de-control` | ✅ **HECHA** — 23-08, ver abajo |
| Preparación del día | `(tenant)/preparacion` | ✅ **HECHA** — 23-08, ver abajo |
| Manifiestos · listado | `(tenant)/manifiestos` | ✅ **HECHA** — 23-08, ver abajo |
| Detalle del manifiesto | `(tenant)/manifiestos/[manifiestoId]` | ✅ **HECHA** — 23-08, ver abajo |

**Lo que hay que resolver antes de construir:** cuatro cifras del tablero no existen en ninguna
capa de datos — «en ruta ahora» y «conductores con ruta» del contrato de la Torre, «paradas» y
«avance» del listado de manifiestos, y los denominadores de Preparación.

### ✅ Dashboard operativo · hecho el 23-08-2026

El mosaico de ocho magnitudes, verificado en el navegador contra `B1c` en 1440 y 390, claro y
oscuro. Componente nuevo: `src/components/ui/mosaico-magnitudes.tsx`.

**Decisiones que se tomaron construyéndolo**, todas del usuario y todas con consecuencia:

1. **El 68 % es entregados sobre el TOTAL del día**, no la tasa de éxito sobre lo ya cerrado, que
   es lo que el código calculaba. A media tarde la segunda da 97 % con un cuarto del día hecho.
2. **«Por cobrar» y «por pagar» son todo lo pendiente**, no lo que está en un estado. Un período
   facturado y sin pagar es la deuda más urgente, no la menos.
3. **«En ruta ahora» cuenta solo los pedidos de hoy**, para que las ocho cifras compartan universo
   y ninguna se pise con «rezagados de ayer».
4. **«Ayer a esta hora» sale de lo que declara la app** —`pruebas_entrega` y `cierres_conductor`,
   la misma fuente que la Torre—, y **la línea se omite si no hay cierres**: nunca «ayer a esta
   hora, 0 %», que se leería como desastre.
5. **La franja de folios se queda como franja**, única excepción declarada al patrón: no es una
   magnitud del día, es un bloqueo.
6. **Se retiran** distribución por estado, paquetes por comuna, cortes próximos, accesos rápidos,
   la franja de analítica financiera y la banda de la Torre.

**Dos cosas que el tablero pide y el dato no da**, resueltas diciendo lo que el dato sí sabe:

- «Despacho salió a las 16:02» → **«asignación lista a las 15:48»**. `operacion.manifiestos` tiene
  `confirmado_en` y `completado_en` y **ninguna marca del paso a `en_ruta`**. La alternativa era
  agregar la columna; el usuario eligió usar lo que hay.
- «Vega Norte, desde el 19-08» → **«sin sincronizar desde el 19-08»**. No existe columna de cuándo
  se cayó una conexión, solo `ultima_sync_exitosa_en`, que es la última vez que SÍ funcionó.

🐞 **Y un defecto que se encontró debajo:** `obtenerMetricasDelDia` leía los pedidos del día **sin
paginar**, así que PostgREST la cortaba en 1000 filas sin avisar. Un courier con más de mil pedidos
en un día veía un total truncado, una tasa calculada sobre una muestra arbitraria y un top de
comunas incompleto, los tres sin un error en los logs. Con el mosaico colgando de esa función, el
truncamiento pasaba de invisible a decisorio. Corregido, junto con el mismo patrón en
`obtenerSlaPorSeller`, que ahora lee una ventana de un mes.

### ✅ Conductores · hecho el 23-08-2026

Tabla de seis columnas + cajón lateral de 352 px, donde había una pila de tarjetas-acordeón.
Verificado en el navegador contra `B1c`: las proporciones de columna salen exactas, el cajón mide
352 px, y en oscuro la fila seleccionada lleva su `inset 2px` en acento.

**Lo que trajo de nuevo:**

1. **RUT, relación y zonas en la fila.** Los tres datos ya estaban en base y la proyección no los
   traía — las zonas, además, se pedían con una consulta por tarjeta al desplegarla, así que no
   podían mostrarse en el listado. Ahora van en una sola consulta para todos.
2. **Un eje por columna.** «En nómina» y «disponible hoy» eran dos `Badge` pegados, que es lo que
   prohíbe la regla nº 4 del bloque. Ahora la columna `HOY` muestra un valor de tres y estar fuera
   de la nómina se lee además por la **trama diagonal de 4 px a 135°** de toda la fila.
3. **«Sacar de la nómina» y «Reincorporar», que no existían.** El estado `inactivo` se dibujaba
   hace meses y **nada en el repo lo escribía**: un estado al que nadie podía llegar ni del que
   nadie podía salir. Peldaño 2 de fricción —consecuencia dicha y motivo escrito—, bitácora con
   autor antes del efecto, y **bloqueado con su motivo en pantalla** si tiene ruta de hoy sin
   cerrar o liquidaciones sin pagar. Gate propio: `gestionar_liquidaciones_conductores`.
4. **Estampador `− N +`** para el cupo, en vez de campo de texto con «Guardar».
5. **Los datos bancarios no se renderizan** para quien no puede editarlos, en vez de mostrarse en
   gris.

**Lo que se dejó fuera, y no por descuido:**

- ⛔ **«Última posición · 16:38 · Ñuñoa»** del cajón. `operacion.ubicacion_conductor` **dejó de
  escribirse el 2026-08-14** por decisión del usuario tras una revisión de privacidad —la última
  posición del día sobrevivía indefinidamente y muchas veces era el domicilio del conductor, Ley
  21.431— y hay un candado de regresión que hace fallar la suite si alguien vuelve a consultar esa
  tabla. El tablero se dibujó sin esa decisión a la vista. Volver a mostrarla es una decisión
  nueva.
**El teléfono, en su segunda pasada.** El tablero no dibuja esta pantalla en 390 y a seis columnas
es inservible: la primera colapsa a 24 px y el documento desborda 79 px. La primera solución
—esconder tres columnas— era justo la reducción que P1 prohíbe. Ahora aplica la regla al pie:

> «La fila se convierte en **ficha de tres líneas**: estado y origen arriba, destinatario a 16 px,
> y la línea mono con lo que se cayó. Lo que cae reaparece bajo el destinatario. **Destinatario y
> código nunca caen.**»

Traducido a conductores: distintivo + relación arriba, nombre a 16 px, y
`19012345-6 · 30 paradas · Ñuñoa, Maipú` en mono. **Nada se esconde, se reacomoda.**

✅ Y sale de ahí `src/components/ui/ficha-fila-390.tsx`, **uno de los nueve componentes de §8 que
no tenían ni rastro en el código**. Queda hecho para los ~15 listados que vienen, en vez de que
cada pantalla improvise su propio teléfono. No es interactiva a propósito: el enlace y el foco son
de la fila que la contiene, o habría dos objetos tocables anidados.

### ✅ Crear pedido same-day · hecho el 23-08-2026

Pantalla propia en `(tenant)/operaciones/nuevo`, con los cuatro grupos del tablero en su orden,
campos de 52 px y ayuda permanente bajo cada uno.

**El tablero abre con la decisión entera: «Peldaño 1: no lleva modal.»** Y el modal se retiró **sin
tocar `operaciones/page.tsx`**, que tiene trabajo en curso: `FormularioPedidoSameDay` conserva su
nombre y su firma, y ahora es un enlace a la ruta nueva. Es el patrón de convivencia del proyecto,
con el motivo extra de no pisarle el trabajo a nadie.

**El patrón que da nombre a la pantalla, construido:** los dos avisos —fuera de hora de corte y
seller sin tarifa— se resuelven **al elegir el seller**, viven pegados a su campo, no bloquean, y
el de corte trae «Reagendar para mañana» como acción. Antes los dos llegaban *después* de enviar,
y el de tarifa además impedía crear el pedido.

**El geocoding cambió de forma, por decisión del usuario.** El tablero pedía «Ubicando la
dirección…» con espera de 15 s dentro de la creación —lo que habría exigido tocar `pedidos.ts`, que
es intocable—. En su lugar: **autocompletado mientras se escribe, restringido a Chile**. Al elegir
de la lista, la dirección viene normalizada, **con su comuna y su coordenada**, y queda validada en
ese momento. Piezas nuevas:

- `integraciones/geocoding/autocompletado.ts` — puerto **aparte** de `PuertoGeocoding`: es otro
  producto de Google (Places, no Geocoding), se factura por *sesión de tecleo*, y agregarle métodos
  al puerto existente habría roto todos sus dobles de prueba.
- `components/ui/campo-direccion.tsx` — el combobox. Conserva el texto libre a propósito: hay
  direcciones que ningún proveedor conoce y bloquear el envío dejaría al courier sin crear el
  pedido.
- La coordenada elegida **se guarda después de crear**, y no hay carrera con el job: su primer paso
  es «si `geo_estado != 'pendiente'` → no-op». La cobertura se calcula con `calcularCobertura`, la
  misma función del job, no con una copia.

**Lo que el tablero pedía y no se pudo comprobar en el navegador:** el aviso en línea exige elegir
un seller, y el control de Radix no responde a interacción programática en este entorno (el foco
queda en `BODY`). Se fijó la lógica con `reglas-alta.test.ts` —8 pruebas, verificadas por mutación—
incluida la trampa de comparar horas como texto: `"9:30" > "16:00"` es **verdadero** en cadenas, y
eso haría aparecer «se va mañana» a las nueve y media de la mañana.

⚠️ **Antes de producción:** la llave de Google necesita **Places API (New)** habilitada además de
Geocoding — son dos productos y se habilitan por separado. Si falta, el campo degrada a texto libre
y el pedido se geocodifica como siempre.

**Contradicción del tablero, resuelta:** decía «Colina no tiene tarifa» (por comuna) y el motor
resuelve **por seller**. El aviso dice lo que el sistema sabe: «{Seller} no tiene tarifa vigente».

### ✅ Incidencias · hecho el 23-08-2026

La bandeja de P6, donde había un filtrado plano con un botón «Gestionar» por fila.

**La decisión del tablero, construida: se agrupa por tiempo sin gestionar, no por tipo.** Al
supervisor no le sirve saber que hay cuatro «no estaba en casa» — le sirve saber cuál lleva cinco
horas sin que nadie la mire, porque **esa ya disparó un aviso** al centro de avisos y al correo, y
es la que el seller va a reclamar. La cabecera del grupo lo dice, para que nadie tenga que saberlo
de memoria. El umbral de 4 h ya existía; lo que no existía era usarlo para ordenar la pantalla.

**El estado dejó de ser un `Select` y pasó a ser cajones con su cuenta**, con `cerradas` como cajón
**excluido** — no pertenece al conjunto operativo. Verificado en pantalla: la barra declara «2 en
los grupos de arriba · 1 cerradas · 3 en total», que es exactamente la regla de que *la interfaz no
puede mentir sobre que la suma no cuadra*.

**El panel de caso**, completo y verificado abierto: la cita textual del reporte, su autor y su
hora, el conteo de fotos con enlace, las banderas **COBRO** y **LIQ** —nunca `FACT`/`PAGO`, que son
de otro objeto— con su explicación leída **de la fila y no del tipo** (la fila puede haberse
reclasificado, y es la que el motor usa), `PASAR A` con solo los destinos válidos **y el motivo de
por qué falta el que falta**, y dos salidas de cierre.

🔗 **Las dos salidas cierran el cabo suelto que CLAUDE.md tenía anotado.** «Devolver al seller» y
«Reagendar para mañana» resuelven la incidencia **y mueven el pedido**: resolver la incidencia sin
tocar el pedido es exactamente cómo se produce el caso documentado —queda en `fallido`, nunca llega
a `devuelto`, y su línea de cobro sigue viva mientras el supervisor cree que cerró el caso—.
Las dos piden motivo, dicen su consecuencia antes de apretarse y quedan en bitácora con su autor.

**Reclasificar se reusa, no se duplica:** el mismo `DialogReclasificarIncidencia` del detalle del
pedido, y la explicación del efecto en el dinero pasó a `explicarAfectacionIncidencia` compartido —
dos redacciones de una regla de dinero divergen el día que alguien toque una.

**El teléfono ya no costó nada:** segunda pantalla que usa `ficha de fila 390`. Tres líneas, sin
desborde, con todo lo que cae reapareciendo en la línea mono.

⚠️ **Anotado, no construido:** reagendar mueve la fecha de compromiso, que es contra la que se mide
el SLA de ese pedido. Está dicho en pantalla antes de apretar, pero **no hay una decisión tomada
sobre qué debería pasar con el SLA de un pedido reagendado por incidencia**.

### ✅ Torre de control · hecho el 23-08-2026

Lo que se hizo es lo que ninguna pieza de pantalla podía resolver sola: **tres cifras que no
existían en el contrato del composer**.

**Las cuatro magnitudes son ahora las del tablero.** Salieron «Entregados hoy» —complemento de la
primera, ya se lee ahí— y «Cerca del corte»; entraron «En ruta ahora» y «Conductores con ruta
7 de 9». Verificado con datos: **«por entregar 2» y «en ruta ahora 1»**, o sea un pedido pendiente
cuyo manifiesto todavía no salió. Esa diferencia es la pregunta de las 16:30 y antes no se podía
ver. Y la cifra de incidencias trae su segunda línea: «1 · 1 sin gestionar».

⚠️ **Con «cerca del corte» se fue la única señal de riesgo de la franja.** `enRiesgoDeCorte` sigue
calculándose y sigue marcando comunas en el mapa y en la lista; lo que se retiró es su cifra
agregada. Decisión del usuario.

**El panel pasó de tres pestañas a dos**, con su cuenta en el rótulo. `Incidencias` salió: su cifra
vive arriba y su bandeja es una pantalla propia — tenerla acá repetía la cifra y ofrecía media
gestión en una pantalla que declara ser de solo lectura.

**La fila de conductor está completa:** iniciales, porcentaje escrito junto a la barra, y «le queda
carga en Providencia». Y aparecen **los conductores disponibles sin ruta, apagados** — eso es lo
que hace accionable la fracción «1 de 12»: los que faltan se nombran en vez de ser una resta.

*(El tablero muestra ahí «no disponible hoy»; se construyó al revés a propósito —disponible y sin
ruta— porque ese es el conjunto que explica el denominador de la fracción, y es a quien todavía se
le puede asignar.)*

**La ficha del seleccionado** al pie del panel, con «Conductores acá» derivado de los puntos del
mapa, y su salida a `/operaciones?comuna=…`. **La línea de discrepancia Torre ↔ Pedidos**, que
hasta hoy solo vivía en comentarios de código. Y el distintivo **SOLO LECTURA** con trama en la
cabecera, que es lo que explica por qué esta pantalla no tiene un solo control que cambie algo.

**El mapa, cerrado el mismo día:**

- **Leyenda** al pie del lienzo, dentro del contenedor para que acompañe también en pantalla
  completa. La rampa **no lleva cortes escritos**: es de cuartiles del día —el paso 3 puede ser 14
  pendientes un martes y 60 un CyberMonday—, así que dice los **extremos reales de hoy**. Es una
  magnitud y no un índice (regla 3), y se duplica sola el día que la operación se duplique. Cuando
  el mínimo y el máximo coinciden se muestra el número solo: «1 → 1» se lee como un rango roto.
  ⛔ **Sin «última posición del conductor»**, que el tablero sí incluye: ese rastreo está apagado
  desde el 14-08 con candado de regresión, y anunciar en la leyenda un símbolo que el mapa nunca
  pinta sería hacerla mentir.
- **Distintivo de nivel** —`NIVEL 1 · COMUNA · 12 comunas`— **junto a** las migas y no en su lugar:
  las migas además navegan, y eso el tablero no lo dibuja.
- **En teléfono el mapa se pliega, no se retira.** El motivo escrito para retirarlo era el panel de
  340 px aplastándolo a 124 px; bajo `lg` ese panel no se renderiza, así que a ancho completo y con
  alto propio sí es un mapa. Verificado: lienzo de 341×276 al abrirlo, sin desborde. Arranca
  cerrado — quien entra desde el teléfono viene a ver cuántos faltan.

Verificado en claro y en oscuro: la rampa cambia entera entre temas (`#DBF8F2→#007D69` contra
`#04302A→#00D6B4`) y el rojo de incidencia a `#FF6B57`.

**Queda pendiente, y no es del mapa:** `src/modules/contexto/mensajes-estado.ts` sigue sin
consumidor — los estados de pantalla están repartidos a mano en `torre.tsx`.

**No se pudo ejercitar en el navegador:** las pestañas de Radix no responden a interacción
programática en este entorno. La ficha se verificó llegando al mismo estado por otra vía —elegir la
comuna en la lista angosta y ensanchar sin recargar—, que es lo que la hizo comprobable.


### ✅ Preparación del día · hecho el 23-08-2026

La pantalla ya tenía el patrón exacto del tablero. Lo que le faltaba era **el otro lado de la
conciliación**.

**«128» no dice nada. «128 de ~190» dice que faltan 62 y que el despacho no puede salir.** El
alcance define el retiro como «una conciliación de bodega: lo esperado vs. lo efectivamente
cargado», y hasta hoy la pantalla solo sabía la mitad. Lo esperado se deriva de los pedidos del
día —`src/modules/operacion/retiro/expectativa.ts`— y alimenta el denominador de la franja **y el
de cada visita**.

🐞 **Un bug que solo se vio en pantalla:** la primera versión contaba los pedidos *pendientes de
retiro*, así que el denominador se encogía a medida que el numerador crecía. La tarjeta decía
literalmente **«4 de ~1 escaneados»**. Lo esperado tiene que incluir lo ya retirado — es el
denominador de una conciliación, no una cola de trabajo.

**Las cuatro magnitudes son ahora las del tablero**: salieron «De vuelta» —complemento de «visitas
en curso»— y «Sin novedades» —que ahora vive pegada a la visita que la provoca, que es donde se
puede actuar—, y entraron «Comunas con carga» y «Sin tarifa».

**El aviso de tarifa es la pieza que conecta esta pantalla con el dinero.** Un seller sin tarifa
vigente genera entregas que se hacen y no se facturan; eso se descubre acá, con el bulto todavía en
bodega, o no se descubre hasta el cierre del período. Lleva su acción pegada.
*(Por SELLER y no por comuna: misma contradicción del tablero que en «Crear pedido same-day», y se
resuelve igual — el aviso dice lo que el sistema puede verificar.)*

**El cálculo de conductores necesarios** (`NUEVO`, aprobado): `ceil(bultos × 12 min ÷ minutos hasta
las 21:00)`, con **sus supuestos declarados al lado**. Una estimación con los supuestos escondidos
se lee como una instrucción. Cuatro pruebas, incluida la que impide que la fórmula escupa un número
absurdo cuando la ventana ya se cerró.

**Los dos relojes, no uno.** «Abierta hace 41 min» —la del tablero, avisa sobre una hora— **y**
«sin escanear hace 14 min» —la que ya existía, detecta a alguien trabado mientras pasa—. Ninguna
reemplaza a la otra: una visita larga puede ir bien, y una corta detenida no. Decisión del usuario.

**Y el resto del delta:** jerarquía de la tarjeta invertida a **seller · bodega arriba** (el
coordinador busca «¿ya llegó lo de Vega Norte?», no «¿dónde anda Muñoz?»), distintivo abierta /
cerrada, visitas cerradas colapsadas a una línea, barras en la carga por comuna, cuenta regresiva
al despacho en la cabecera, y el vacío con su acción.

**Se conservó el bloque «Asignación»**, que el tablero no contempla: es la salida natural de esta
pantalla hacia la carrera contra las 16:00, y el tablero no dibuja nada que lo reemplace. Decisión
del usuario.

⚠️ **Queda pendiente:** ante una falla de lectura la franja cae a guiones; el tablero pide que las
cifras «se queden con su última hora conocida». Eso exige guardar el último valor conocido en
alguna parte y no se construyó.


### ✅ Manifiestos · hecho el 23-08-2026

El listado no podía responder la pregunta con la que se entra a él —**«¿quién va atrasado?»**—
porque **no consultaba ni una parada**: `operacion.manifiestos` guarda quién, cuándo y en qué
estado, y las paradas viven en `asignaciones_pedido`. Sin paradas no hay avance, y sin avance el
listado es un índice de documentos.

**Lo que trajo:** cajones con su cuenta (`cancelado` como excluido, fuera de la suma), las tres
columnas que faltaban —`PARADAS`, `AVANCE` y `SALIDA`—, el chevrón de fila, y el subtítulo
«23-08 · 7 de 12 conductores con ruta». **La identidad de la fila pasó a ser el CONDUCTOR**, con el
nombre del manifiesto debajo: nadie busca «Manifiesto 2026-08-21-03», se busca a quién le tocó qué.

**El umbral de avance depende de la hora, y por eso significa algo.** Bajo 40 % es falla **solo
desde las 18:00**: a las 16:15 todos van en 5 % y pintar la tabla de rojo ahí la deja sin significar
nada a las 20:00, que es cuando importa. Cuatro pruebas lo fijan, incluida la que impide que un
manifiesto en borrador se lea como atrasado — `null` es «nada que medir», no «cero por ciento».

**Las dos filas especiales del tablero, construidas:**

- `Borrador` usa su celda de avance —vacía de todas formas— para decir **qué ve el conductor**:
  «Sin confirmar. El conductor ve “tu ruta todavía no está lista”». Cierra un callejón real: hoy esa
  pregunta llega por teléfono a las 15:50 y el coordinador no tiene dónde mirarla.
- `Cancelado` dice **dónde quedaron sus paradas**: «Redistribuido · 18 paradas a 3 conductores», y
  en tono de atención las que quedaron sin nadie — que es lo único que de verdad hay que mirar.

⚠️ **Y ahí una decisión que importa más de lo que parece:** eso se resuelve **con las asignaciones,
no con la bitácora**. La bitácora lo registra, pero está indexada por conductor y por fecha —no por
manifiesto—, no dice a cuántos conductores fueron, y sobre todo es un registro de auditoría: usarlo
como fuente de datos lo convierte en un contrato que nadie sabe que está firmando, y se rompe
callado el día que alguien cambie qué guarda ese `detalle`.

**Queda pendiente:** el filtro por conductor y el patrón de filtros colapsados con cuenta.


### ✅ Detalle del manifiesto · hecho el 23-08-2026

La pantalla tenía **una sola columna** y las acciones sueltas bajo la tabla. Ahora son dos: la
ancha con la secuencia, la angosta con `ACCIONES`, `ZONA DE CONSECUENCIA · TODO EN LA BITÁCORA` y
`BITÁCORA`. El título pasó a ser el **conductor** —se entra acá para ver la ruta de alguien— con el
nombre del documento debajo, y los distintivos `28 paradas · 12 cerradas`.

**El panel de recálculo antes de guardar es la pieza nueva.** Antes el coordinador movía una parada,
veía cambiar el total y tenía que decidir de cabeza si eso rompía el turno. Ahora ve
`Orden actual 143,3 km` / `Con tu cambio 170,7 km · +27,4 km` y, debajo, la respuesta a la pregunta
real: **«sigues cerrando antes de las 21:00, con 1 h 20 de margen»** — o, si se pasa, la hora a la
que cierra y cuánto se excede.

⚠️ **Los supuestos van escritos al lado del número, siempre** («16 paradas abiertas a 12 min cada
una y 15 km/h, con distancias en línea recta»). Es la misma regla que el cálculo de conductores de
Preparación: una estimación con los supuestos escondidos se lee como una instrucción. Nueve pruebas
en `holgura-ruta.test.ts` fijan la aritmética, incluidas las dos que costó ver en pantalla — que el
reloj arranca en el despacho y no «ahora» cuando todavía no son las 16:00, y que el margen negativo
no se recorta a cero.

🐞 **«Cierras a las 25:43».** La primera versión seguía contando pasada la medianoche. Se vio en
pantalla y no se lee: nadie mira un reloj de 25 horas. Ahora da la vuelta y dice «01:43 **de
mañana**» — la magnitud del exceso ya la lleva la frase de margen.

**Las paradas cerradas quedaron rayadas y sin controles**, y la primera abierta se rotula
`Siguiente`. Ese rótulo va **al lado** del distintivo de estado y no dentro: «siguiente» es posición
en la ruta, no estado del pedido, y son ejes independientes (regla 4). Reordenar solo afecta a las
pendientes: mover una entrega ya hecha no cambia nada en la calle y sí ensucia la secuencia que el
conductor está siguiendo.

**`DIRECCIÓN` pasó delante de `DESTINATARIO`** y dejó de esconderse bajo `sm` — es el orden de la
app del conductor, y el que usa quien va siguiendo la ruta. El nombre sirve al llegar; la dirección,
para saber a dónde.

⚠️ **El reparo `Colina · sin tarifa` NO se resuelve mirando `tarifa_aplicable_id`.** Es el campo
obvio y da una respuesta falsa: lo escriben el alta same-day y la ingesta de Shopify, y **la ingesta
de Mercado Libre no lo escribe nunca**. En un courier cuya operación es Flex entera se habrían
pintado de reparo las treinta paradas, todas falsas — y la próxima vez nadie mira el reparo
verdadero. Se resuelve como el motor: **por seller y régimen**, a la fecha de operación, con una
consulta por par y no por parada.

**Los tres actos de la pantalla subieron de peldaño.** Cancelar el manifiesto y quitar una parada
piden **motivo** y dicen su consecuencia en número; «se cayó el conductor» —que redistribuye— llegó
a esta pantalla con motivo y **tarjeta de resultado en bloque**, no en un aviso que se va: las
paradas que quedaron sin receptor son lo único accionable y se perderían.

🐞 **Tres defectos que no eran de diseño, encontrados al construir:**

1. **`actionCancelarManifiesto` no comprobaba ninguna capacidad.** Hacía un `update` con
   `service_role` —que se salta RLS—, así que cualquier sesión autenticada podía cancelar un
   manifiesto invocándola. Confirmar y completar sí la tenían; cancelar, la irreversible de las
   tres, no. Y **no dejaba una línea de bitácora**: ni quién ni por qué.
2. **`redistribuir` fallaba SIEMPRE**, en su primer paso: pedía `conductores.nombre` y la columna es
   `nombre_completo`. El conductor quedaba marcado no disponible y sus paradas sin mover.
   Encontrado ejecutándolo en el navegador; ninguna prueba lo cubría porque el pool se lee con un
   doble.
3. **Quitar una parada se ejecutaba al primer clic** y sin rastro. A las 15:50, con treinta filas,
   ese botón devuelve un pedido a la bandeja sin conductor y hay que ir a buscarlo a Operaciones.

**El vacío y la falla de lectura ya no son el mismo estado.** `cargarPedidosAsignados` devolvía `[]`
ante cualquier error, así que una consulta caída se leía como «este manifiesto no tiene pedidos» —
con la flota por salir, una invitación a cancelarlo. Ahora devuelve `null` y la pantalla dice **«no
lo canceles ni redistribuyas hasta poder verlas»**, y apaga la zona de consecuencia entera.

**Y el vacío dice qué ve el conductor, según el estado.** «J. Tapia ve “tu ruta todavía no está
lista”» es lo que ve un conductor con manifiesto **en borrador**; escribirlo bajo uno completado
—que fue el primer intento, y se vio en pantalla— es pedirle al coordinador que agregue paradas a
una ruta cerrada.

**La bitácora de la ruta lee dos orígenes.** «Se cayó el conductor» se registra contra la entidad
`conductor` —ahí pertenece, porque mueve paradas de varios manifiestos— pero **se ejecuta desde esta
pantalla**. Leyendo solo `manifiesto`, el coordinador redistribuía 15 paradas y el recuadro de abajo
seguía diciendo «todavía no hay movimientos». Las del conductor se acotan a la ventana operativa del
día, que llega hasta las 06:00 del día siguiente: el corte es 21:00–22:00 y el cierre puede pasarse
de las doce.

**Y el resto del delta:** los tres diálogos escritos a mano —sin atrapar el foco, sin cerrar con
Escape— pasaron al `Dialog` del sistema; los cuatro `window.location.reload()` pasaron a
`router.refresh()` (recargar perdía el orden de ruta sin guardar del panel de al lado); los
controles de la fila miden 48 px en el teléfono; y las dos fechas que salían en ISO crudo
(`2026-08-24` en el encabezado y en `F. COMPROMISO`) se escriben con el helper de fechas **civiles**
— pasarlas por los de instante las corre un día, porque medianoche UTC del 24 es el 23 por la tarde
en Santiago.

⛔ **El punto de término del conductor no aparece, y no es un olvido.** El tablero lo pone en el
subtítulo (`Bodega Quilicura → punto de término en Ñuñoa`). Bajo subordinación laboral el
consentimiento solo es libre si negarse no queda a la vista del jefe, así que la salida tiene que
ser idéntica exista o no
(`docs/seguridad/punto-de-termino-conductor.md` §4). Mostrarlo reabre esa revisión.

**Queda pendiente:** `Imprimir la hoja de ruta` — diferida al bloque 8 por decisión del usuario, que
es donde vive el manifiesto impreso.


## B2 · Dinero · 5 pantallas

| Pantalla | Ruta | Veredicto |
|---|---|---|
| Períodos de cobro | `(tenant)/dinero/periodos` | ✅ **HECHA** — 23-08, ver abajo |
| Liquidaciones | `(tenant)/dinero/liquidaciones` | ✅ **HECHA** — 23-08, ver abajo |
| Detalle del período | `(tenant)/dinero/periodos/[periodoId]` | ✅ **HECHA** — 23-08, ver abajo |
| Detalle de la liquidación | `(tenant)/dinero/liquidaciones/[liquidacionId]` | ✅ **HECHA** — 23-08, ver abajo |
| Cobranza | `(tenant)/dinero/cobranza` | **CONGELADA** — decisión 4 |

**El hallazgo del bloque:** la selección múltiple no vive en la tabla en ninguno de los dos
listados; es un panel-checklist paralelo. `BarraSeleccion` y `BarraCajones` están construidas y
solo se usan desde `kitchen-sink`.


### ✅ Dinero · las cuatro pantallas vivas · hecho el 23-08-2026

**Una sola lista, en los dos listados.** Había DOS del mismo dato: la tabla, sin casillas, y el
checklist del panel `AprobacionLote` encima — y la selección de una no tenía relación con la otra:
se podía filtrar la tabla a un seller y facturar, desde el panel, períodos de otro. El panel se
retiró; la ceremonia (peldaño 3, monto en el título, frase a escribir, preflight consolidado) se
extrajo intacta a `CeremoniaLote` y ahora cuelga de la barra de selección. Selección en tres
niveles: fila · página · conjunto filtrado.

**`BarraCajones` gana un cajón TRANSVERSAL.** «Con problemas» y «Pago rechazado» **cruzan** los
estados —un período facturado también puede tener problema; una liquidación con el pago rechazado
sigue `emitida`—, así que sus filas ya están contadas a la izquierda. Meterlos entre los demás daba
«35 en los grupos de arriba» sobre 27 filas. Van tras el separador, no suman, y la barra lo declara.
Es distinto del `excluido`, que está FUERA de los grupos.

🐞 **Cuatro defectos que no eran de diseño:**

1. **La pantalla de liquidaciones nunca mostró un pago en curso.** Dos errores apilados en la misma
   consulta, cada uno suficiente: ordenaba por `created_at` (la columna es `creado_en`) y filtraba
   por un estado `'procesando'` que **no existe** en el enum `estado_payout`. PostgREST rechazaba
   las dos cosas, el error se descartaba al desestructurar, y el mapa de payouts quedaba vacío
   siempre. «Pago en proceso», «Pago confirmado» y el rechazo del banco no aparecieron nunca — y un
   pago en tránsito invisible se ve igual que uno que no existe, así que se podía transferir dos
   veces. El `'procesando'` fantasma venía de `ejecutar-payout.ts`, donde era una comparación
   muerta; se retiró de ahí también, porque es de donde se copió.
2. **El cajón «Con problemas» de períodos contaba y al pulsarlo limpiaba los filtros** — su `href`
   era la ruta pelada. Y contaba solo los DTE rechazados por el SII, no las excepciones que impiden
   emitir.
3. **La fila bloqueada no existía.** Un período cerrado con una excepción de conciliación no se
   puede emitir, y eso se descubría recién en el preflight: con la ceremonia abierta y el monto ya
   escrito en el título.
4. **El detalle del período mostraba DOS totales distintos del mismo período** — «$13.566» en la
   cifra grande (de `monto_total_clp`) y «$11.400» en el total de la tabla (suma de las líneas).
   Manda el de las líneas: es el que va a la factura y el que ya excluye las anuladas. Si el
   guardado quedó viejo, se dice, porque es el que muestra el listado.

⚠️ **El bloqueo de la fila espeja EXACTAMENTE a `bloqueaFacturacion`, y eso es más ancho de lo que
parece.** Dos cosas se copian y no se simplifican: el estado no es `pendiente` sino los cuatro NO
terminales, y el vínculo es `periodo_cobro_id = X` **OR** `seller_id = Y` — una excepción que nombra
un período **trae su `seller_id` igual**, así que bloquea todos los períodos de ese seller. La
primera versión contaba «la del período o la del seller, sin duplicar», dejó tres filas
seleccionables, y el preflight las rechazó las tres con la ceremonia abierta. Visto en pantalla.

**Los impuestos se conservan, rotulados** (decisión del usuario). La regla 22 dice que Rutax no
muestra impuestos, y sigue: significa que Rutax no CALCULA un IVA para mostrarlo. `Neto · IVA ·
Total` del DTE emitido y `Bruto · Retención · Líquido` del payout son cifras de documentos que ya
existen —las declaró el proveedor DTE ante el SII, o se le retuvo al conductor en su boleta— y el
courier las necesita para cuadrar. Van bajo un rótulo que dice de dónde salen: «Según el documento
emitido», «Lo que se transfirió». Y la ceremonia del lote también rotula: su monto es el **total con
IVA**, distinto del **neto** que muestra la barra de selección de la que viene.

**Lo demás del delta, por pantalla:**

- **Períodos:** cinco columnas con `SELLER Y PERÍODO` fusionado y su RUT, rótulo `NETO`, bajada de
  contexto que dice lo que va a pasar solo («2 períodos vencieron y cierran en la próxima pasada» —
  el tablero decía «cierre sugerido», pero no hay nada que sugerir: el cron cierra a las 02:00).
- **Detalle del período:** rótulo `TOTAL NETO A FACTURAR` con su composición a la vista (vivía solo
  dentro del modal de emisión), bloques `QUÉ VE EL SELLER` —seis pruebas, y la primera frase es la
  que sorprende: **el seller ya ve el período abierto**— y `BITÁCORA`, exportación a CSV con `;` y
  BOM para Excel en español, RUT y autor del cierre, la causa del ajuste nombrada por el código del
  pedido, y el estado de falla de lectura que ya no se disfraza de «período vacío».
- **Liquidaciones:** columnas `COMPOSICIÓN` («N entregas · N visitas» — al conductor se le paga por
  las dos cosas desde la etapa 8, y el listado contaba solo entregas) y `AJUSTES (NETO)`, que sale
  de la celda del monto para poder compararse entre filas. Indicador de banco que dice qué pasa si
  sigues: «los pagos no salen del banco todavía».
- **Detalle de la liquidación:** rótulo `NETO A PAGAR` con su resta, el **autor del ajuste dentro de
  su fila** —estaba, pero a media pantalla del «−$8.000» que explica—, y el ajuste manual y el pago
  traídos a esta pantalla: vivían solo en el listado, o sea que había que volver a la lista para
  actuar sobre lo que se acababa de leer.

**Dos cosas que se vieron solo en pantalla:** `BloqueComposicion` con un único sumando escribía
«4.200 entregas», que es el mismo número de arriba con una palabra al lado — ahora no se dibuja bajo
dos términos. Y el total de la liquidación decía «Neto a pagar (neto)», porque `TablaFinanciera` le
agrega su rótulo al concepto.

**Queda anotado:** el motivo del rechazo bancario **no se traduce**. `payouts_conductor` guarda el
texto crudo del proveedor y **no un código**; adivinar la causa sobre una cadena que el proveedor
puede cambiar sin avisar mostraría un motivo equivocado sobre una transferencia que no salió.
Traducirlo de verdad exige que el adaptador persista un código — trabajo de integración, no de
pantalla. Y la fila «Mínimo de facturación no alcanzado» que el tablero dibuja en la tabla
financiera **no existe como línea**: el motor la detecta como excepción de conciliación
(`minimo_omitido`) y nunca agrega un cargo, así que dibujarla inventaría plata.

## B3 · Configuración y puesta en marcha · 12 pantallas

| Pantalla | Ruta | Veredicto |
|---|---|---|
| El asistente | `(tenant)/onboarding` | ✅ **HECHA** — 23-08, ver abajo |
| Final del asistente · «Ya puedes operar» | `(tenant)/onboarding/listo` | ✅ **HECHA** — 23-08, ver abajo |
| El cuerpo del paso · DTE, folios, tarifas, cobranza | `(tenant)/onboarding/*` | ✅ **HECHA** — 23-08, ver abajo |
| Tarifas | `(tenant)/configuracion/tarifas` | ⚠️ **PARCIAL** — 23-08, ver abajo |
| Zonas y ventanas de corte | `(tenant)/configuracion/zonas` | ✅ **HECHA** — 23-08, ver abajo |
| Bodegas | `(tenant)/configuracion/bodegas` | ⚠️ **PARCIAL** — 23-08, ver abajo |
| Equipo | `(tenant)/equipo` | ✅ **HECHA** — 23-08, ver abajo |
| Exportar datos | `(tenant)/configuracion/exportar-datos` | ✅ **HECHA** — 23-08, ver abajo |
| Sellers | `(tenant)/sellers` + `sellers/[sellerId]` | ✅ **HECHA** — 23-08, ver abajo |
| Retiro | `(tenant)/configuracion/retiro` | ✅ **HECHA** — 23-08, ver abajo |
| Integraciones | `(tenant)/configuracion/api` | ✅ **HECHA** — 23-08, ver abajo |
| Mi plan | `(tenant)/configuracion/plan` | ⚠️ **PARCIAL** — solo homologación |


### ✅ Configuración · las nueve pantallas · hecho el 23-08-2026

**Una sola anatomía, donde había cuatro dialectos.** El ancho se decidía pantalla por pantalla
—`max-w-2xl`, `max-w-3xl` o ninguno—, la cabecera llevaba o no llevaba acción sin criterio, y el
estado «sin permiso» estaba copiado y pegado con variantes en cada archivo. Nada de eso era una
decisión: era el orden en que se fueron escribiendo. Ahora las nueve pasan por
`PantallaConfiguracion` y `SinPermisoConfiguracion`.

⚠️ **El texto de «sin permiso» se pasa entero y no por partes.** Armarlo con un objeto y un
artículo obliga a adivinar género y número desde el código, y produce «las tarifas lo pueden ver».
El español no se arma por plantilla.

🐞 **El bug de datos del bloque: editar una ventana de corte la sobrescribía con valores por
defecto.** Los cinco campos arrancaban en constantes literales —`useState("14:00")`, `"30"`,
`"60"`, `"97"`— y el mismo formulario servía para crear y para editar. Como el guardado es un
upsert por `(tenant, seller, zona, tipo)`, **abrir «editar» y guardar pisaba la ventana vigente**,
sin avisar. No es cosmético: la hora de corte y el objetivo de SLA gobiernan el semáforo de
cumplimiento y el cálculo de riesgo del día. Un courier que cortaba a las 17:30 y entraba a mirar
su configuración salía cortando a las 14:00. Ahora cada fila abre la suya, precargada, y el título
dice cuál se está editando.

🐞 **«Gestión de rol próximamente», literal, en la celda de acciones de Equipo** — única ocurrencia
de esa palabra en todo `src/`. Y al lado, el estado **«Suspendido» dibujado sin que nada llevara a
él ni saliera de él**. Faltaban tres Server Actions, no tres botones. Las tres existen ahora, con
bitácora antes del efecto y `actorUsuarioId`: cambiar el rol, suspender y reactivar. Ninguna se
puede aplicar sobre uno mismo — degradarse o suspenderse solo deja al tenant sin quién ejerza la
gestión.

**El diálogo de cambio de rol sale del catálogo, no de un texto.** Qué pierde, qué gana y qué sigue
sin tener se calculan por **diferencia de conjuntos** sobre `MATRIZ_ROL_CAPACIDADES`. Las cuatro
descripciones de rol estaban escritas a mano, con un comentario que admitía ser «un resumen fiel que
debe revisarse si el mapa cambia» — un resumen que hay que acordarse de revisar es un resumen que va
a mentir. Diez pruebas en `capacidades-legibles.test.ts`, incluida la que exige que **las 33
capacidades del catálogo tengan frase**.

*«Sigue sin tener» no es relleno:* sin esa tercera lista, quien aprueba tiene que acordarse del
catálogo entero para saber qué NO está pasando.

🐞 **«Exportar datos» era la única pantalla del bloque que expulsaba en silencio**
(`redirect("/dashboard")` sin permiso). Quien llegaba por un enlace directo pensaba que el enlace
estaba roto. Ahora explica, y muestra el rastro de la última exportación — el dato estaba en la
bitácora desde siempre y no se mostraba.

**La ficha del seller, que no existía.** El listado era terminal: ninguna fila navegaba a ninguna
parte, aunque el seller tiene pedidos, bodegas, tarifas, períodos y conexiones repartidos en cinco
pantallas. La ficha los reúne y **enlaza a la pantalla que manda sobre cada dato** — no calcula
ninguna cifra nueva, porque una segunda aritmética se desincroniza de la primera. Cada bloque
declara su vacío con la consecuencia escrita: «no tiene bodegas» no dice nada, «el conductor no sabe
adónde ir a retirar» sí. Y muestra la salud de **cada** cuenta de ML: el listado enseña la de la
primera y pierde el resto.

**Y las piezas que faltaban:** renombrar zona (una zona se podía crear y desactivar, no renombrar);
activar/desactivar una ventana de corte (el estado se pintaba sin transiciones — su única salida era
accidental, porque el upsert fuerza `activa: true`); la explicación al pie de cada campo de la
ventana, que dice qué produce y no qué es; el recuento en la cabecera de Equipo; la frase de Retiro
sobre el lado vacío del modelo («al seller todavía no se le cobra el retiro: eso es a propósito»); y
el nombre de Integraciones homologado con el de la navegación, que era el tercero.

**Decisión del usuario:** Sellers se queda en el grupo «Clientes» y no baja a Configuración. El
código tenía razón: un seller es el cliente del courier —se le factura, tiene portal propio y
períodos de cobro—, no un parámetro al lado de «zonas» y «folios».

⚠️ **Queda pendiente, y es deuda declarada:**

- **Tarifas** recibió la homologación y su copy en lenguaje de negocio, pero **no** el eje
  «programada», los tres contadores-filtro, la fusión de las dos tablas en una ni la reactivación de
  una tarifa inactiva. Esa última es de los «cinco estados sin salida» y sigue abierta: inactivar es
  una puerta de un solo sentido.
- **Bodegas**: falta el conteo en la pestaña y el orden del tablero («Mis bodegas» primero).
- **Mi plan**: solo homologación; faltan «Cliente desde el …», el rótulo de periodicidad y el aviso
  embebido con acción al 100 % de consumo.
- **Exportar datos** sigue siendo **síncrono**. El tablero lo quiere asíncrono; eso exige un job y
  una notificación, y el copy actual dice lo que de verdad pasa en vez de prometer un aviso que no
  llega.
- **Radix Select no responde a interacción programática en este entorno**, así que el selector de
  rol del diálogo se verificó por sus pruebas y forzando el estado inicial — el resto del diálogo sí
  se vio en pantalla, con sus tres listas.


🐞 **Y un defecto vivo en producción, no una brecha de diseño:** el aviso de configuración
pendiente **no desaparece nunca, para ningún courier**. `completo` exige
`estado_certificacion = 'activo'` (`onboarding/estado.ts:155`) y los únicos escritores de esa
columna escriben `pendiente` y `en_proceso`. No existe el job ni el endpoint que la cierre.
Además el conteo miente en dos lugares: `estado.ts:168` fija `totalPasos: 2` mientras la pantalla
renderiza cinco tarjetas. **Cerrado el 23-08 — ver abajo.**


### ✅ Puesta en marcha · las tres fichas de B3a · hecho el 23-08-2026

🐞 **El defecto que hacía que nada de esto sirviera: el aviso de configuración pendiente no
desaparecía nunca, para ningún courier.** El asistente se cerraba con
`estado_certificacion = 'activo'` y **nada en el sistema escribe ese valor**: los únicos escritores
ponen `pendiente` (al elegir proveedor) y `en_proceso` (al cargar el certificado); no existe el job
ni el endpoint que confirme con el proveedor. `completo` era `false` para siempre, por muy
configurado que estuviera el courier.

Se cierra tratando **el certificado cargado como listo** (decisión del usuario): con el certificado
Rutax puede firmar, y eso es verdad operativa. `activo` queda reservado para cuando exista la
confirmación del proveedor, y mientras tanto no bloquea a nadie.

🐞 **Y el conteo doble, en la misma pantalla y a 25 px de distancia:** la barra decía «1 de 2 pasos
críticos» mientras el grid dibujaba cinco tarjetas. Ahora hay **un solo conteo, sobre los cinco
pasos que se ven**. Lo que decide si el courier puede operar es otra pregunta, y se dice con otras
palabras — nunca con un número que compita con ése.

**El asistente es lista + cuerpo en la misma pantalla.** Cinco pasos numerados del 1 al 5, cada uno
con su **dato real** en vez de un rótulo de estado —«3 rangos vigentes», «sin tarifas: una entrega
se hace y no se puede cobrar»—, y el paso elegido se abre debajo sin que la lista se vaya. El paso
activo viaja en la URL (`?paso=folios`): así funciona el botón «atrás», el enlace se puede
compartir, y guardar no manda al dueño de vuelta al principio.

**Las cuatro rutas de paso pasan a redirigir al asistente.** Se conservan porque hay enlaces
guardados —en correos, en documentación, en el historial— pero dejan de ser pantalla: mantener dos
implementaciones del mismo formulario significa que la de menos tráfico se queda atrás sin que nadie
lo note.

**El marco del paso trae las tres cosas que faltaban en las cuatro pantallas:** «PASO 2 DE 5 ·
depende del paso 1, que ya está listo» —la dependencia se declara esté cumplida o no; decirlo solo
cuando falla convierte la ausencia en silencio—, el botón «Seguir con …» que permite avanzar sin
cerrar el paso actual, y la promesa «se guarda solo, puedes salir cuando quieras».

**El paso bloqueado muestra sus campos, atenuados.** Folios depende de DTE, y antes ese caso
escondía todo detrás de un estado vacío. Ahora el dueño ve qué le van a pedir, con el motivo escrito
y el enlace al paso que falta. 🐞 *Visto en pantalla:* el panel de folios repetía el mismo mensaje
que el marco, uno debajo del otro; ahora enumera lo que se va a pedir, que es lo que el marco no
puede decir.

**«Ya puedes operar» es una pantalla, no una tarjeta verde.** Lo que había era una `Card` encima de
las cinco tarjetas, que seguían ahí — el único momento en que se puede decir «terminaste» se veía
igual que cualquier otro estado. La pantalla nueva trae el resumen con el dato de cada paso, el
aviso de que **la emisión al SII sigue simulada** (un courier que cree que está emitiendo y no lo
está se entera con el primer reclamo), y **los tres primeros trabajos reales** en el orden en que
ocurren: invitar al primer seller, dar de alta conductores, ir al panel. No se entra sin haber
terminado: si falta un paso crítico, redirige.

**El aviso del marco nombra el paso.** Decía «tu cuenta tiene 2 pasos pendientes», un conteo que
además no cuadraba con las cinco tarjetas de destino. Ahora dice «te falta configurar la facturación
para poder operar»: se lee de paso, sin entrar, y es la misma regla que pide la pantalla de cierre
para cuando un paso se rompe después.

**`/configuracion` deja de redirigir y tiene su índice** (decisión del usuario). Antes era la 404
del framework, después una redirección declarada provisional. La pregunta que trae a alguien acá no
es «dónde están las tarifas» sino «qué me falta configurar», así que cada renglón lleva su dato
real. 🐞 *Dos errores míos, vistos en pantalla:* contaba sobre `identidad.usuarios`, tabla que no
existe —es `usuarios_perfil`—, y sin acotar a `tipo_usuario = 'interno'` habría contado también los
perfiles de seller, conductor y super-admin como «personas con acceso».

**Catorce pruebas** en `pasos.test.ts` fijan el orden, la numeración, qué pasos son críticos, el
bloqueo de folios y su motivo, y el «siguiente pendiente» — incluida la vuelta a la lista, que es el
caso real: el dueño abre el paso 4 por el medio y sin ella el botón «Seguir con…» desaparece justo
ahí.

**Queda anotado:** los estados `activo` y `con_problemas` del certificado siguen sin escritor. Ya no
bloquean a nadie, pero el día que exista la confirmación del proveedor —y su espejo, el vencimiento
del certificado— hay que escribirlos, y `dteListo` puede volver a exigir `activo`. Y las nueve
pantallas de configuración siguen con sus cuatro dialectos de anatomía: es el delta transversal de
B3b y no se tocó en esta pasada.

## B4 · Portal del seller · 10 pantallas

| Pantalla | Ruta | Veredicto |
|---|---|---|
| Inicio del portal | `portal` | ✅ hecha 24-08 |
| Bienvenida | `portal/bienvenida` | ✅ hecha 24-08 |
| Mis pedidos | `portal/pedidos` | ✅ hecha 24-08 · cajones + buscador |
| Detalle del pedido · same-day | `portal/pedidos/[pedidoId]` | ✅ hecha 24-08 |
| Mis cobros y su detalle | `portal/cobros` · `cobros/[periodoId]` | ✅ hecha 24-08 |
| Mis incidencias | `portal/incidencias` | ✅ hecha 24-08 · con «Reportar» |
| Pedido Flex · variante | misma ruta | ✅ hecha 24-08 · aviso + n.º de venta |
| Cobro ya facturado · variante | misma ruta | ✅ hecha 24-08 · dos acciones |
| Nuevo pedido same-day | `portal/pedidos/nuevo` | ✅ hecha 24-08 |
| Bodegas | `portal/bodegas` | ✅ hecha 24-08 |

### Hecho el 24-08-2026 — las diez, de corrido

Decisiones del usuario en esta pasada: **las 10 pantallas de corrido** · los **siete tipos** de
incidencia, en el idioma del seller (no una taxonomía propia: si el courier y el seller
clasificaran distinto, la misma incidencia se contaría de dos formas) · el detalle del cobro
**solo agrupado por concepto**, como el tablero, sin la lista de 285 filas.

**Lo que se construyó de cero:**

- `lib/ui/vocabulario-portal.ts` (+ 17 pruebas) — el idioma del seller. `estadoPedidoParaSeller`
  funde los pares manual/automático y dice «Nadie recibió» donde el courier dice «Fallido»; el
  **tono no cambia**, solo la palabra, así que el mismo hecho se pinta igual en las dos
  superficies. Trae además `textoLlegada`, los **cuatro cajones** (`GRUPOS_PEDIDO_PORTAL`) y
  `hitoLineaPortal`.
- `portal/acciones-incidencias.ts` + `incidencias/dialogo-reportar.tsx` (+ 8 pruebas) —
  **la promesa rota de la bienvenida, cumplida.** Tres barreras: sesión de seller · la capacidad
  nueva `reportar_incidencias_propias` (un gate de lectura no autoriza un alta) · **el pedido es
  suyo**, comprobado contra `seller_id` antes de abrir nada, porque `abrirIncidencia` valida
  tenant y no seller. `esAccionManual: false`: ese flag exige la capacidad del supervisor.
- `dinero/listado-periodos.ts::netoPorPeriodoDesdeLineas` (+ 4 pruebas) — el total de cada
  período, sumado desde sus líneas vivas, en tandas de 100 ids.

**Los defectos que salieron al mirar las pantallas, no al leer los tableros:**

| Qué | Dónde |
|---|---|
| El «IVA 19 %» calculado como residuo del total guardado — podía imprimirse **negativo** | `cobros/[periodoId]` |
| `notas_resolucion` leída de la base y descartada: el seller no veía cómo se resolvió su incidencia | `incidencias` |
| **Dos totales para el mismo período**: $13.566 en la lista (el guardado, con la línea anulada dentro) y $11.400 al abrirlo | `cobros` |
| El pie decía «cuando *cierre* y facture» sobre un período que el encabezado declaraba **Cerrado**: eran dos casos y los estados son tres | `cobros/[periodoId]` |
| El aviso de corte vivía **dentro de un acordeón cerrado**: no se veía nunca. Sube junto al botón, que es donde ocurre la consecuencia | `pedidos/nuevo` |
| «Entrega flex» y «Entrega same_day» — el identificador de la tarifa impreso crudo | `pedidos/[pedidoId]` |
| «Sin respuesta hace 1813 h» | `incidencias` |
| La línea de tiempo decía «Fallido» tres centímetros debajo de un distintivo que decía «Nadie recibió» | `pedidos/[pedidoId]` |
| El propio nombre del seller repetido en cada fila de su propia tabla («Entrega Flex – FalabellaTech Ltda.») | `cobros/[periodoId]` |
| Tres pestañas con un nombre y su `h1` con otro; «Estado de cuenta» se cortaba en «Estado de cuen…» en la barra del teléfono | `cobros` · `pedidos/nuevo` · layout |
| Dos contadores en cero («Abiertos: 0 · Facturados: 0») encima de una tabla con una fila cerrada, que ninguno contaba | `cobros` |

**Un texto que se retiró por regla, no por estilo:** el bloque de efecto en el cobro tenía un
`sr-only` con la frase completa del sistema, que nombra **también la liquidación del conductor**.
El texto para lectores de pantalla es la interfaz igual que el resto (regla 66), así que se
recortó a la mitad que le corresponde al seller.

**Lo que el tablero pedía y no se hizo, con su motivo:** el enlace directo «Ver en Mercado Libre».
La URL de detalle de una venta no está documentada, y un enlace roto desde el portal es peor que
no tenerlo — en su lugar la hoja da el **número de venta**, que es con lo que el seller la
encuentra. Queda como deuda para cuando se verifique la URL contra una cuenta real.

## B5 · App del conductor · fuera de este repo

Las 12 pantallas viven en `Desktop/rutax-conductor`. Las 5 rutas de `/conductor` de este repo eran
la PWA. **Ningún tablero cubre la PWA a propósito.**

**Son dos tableros, no uno.** `Rutax B5 App del conductor` —el día a día, ya hecho— y
`Rutax B5b Entrada del conductor`, que llegó el 24-08 después del censo y **está en cola**: la
puerta de la app, que ningún tablero cubría.

### Hecho el 24-08-2026 — el cimiento y el retiro en bodega

Decisiones del usuario: **construir los cinco NUEVO** (#22 a #26, «todo lo que está pendiente») ·
cortar el bloque por **el cimiento y el retiro en bodega** primero · y **retirar la PWA ya,
asumiendo la pérdida**.

#### El cimiento · repo `rutax-conductor`

Lo primero del bloque y lo no negociable: **los dos sistemas de color eran dos productos**. El repo
tenía el suyo, «Light Pro» — `primary` navy `#1E3A5F`, `accent` azul `#2563EB`, radios de 8 a 20 px
y tres niveles de sombra— y **no compartía un solo valor** con el sistema de Rutax (teal, radio 3,
cero sombras).

- `src/tema/paletas.ts` — las **tres paletas** transcritas de `rx-tokens.css`: `sol` (blanco y negro
  puros, 21:1), `dia` (el oscuro base del producto, 16,7:1) y `noche` (blanco tope `#B9C6C4`, que
  baja el pico de luminancia un 38 %). Están **copiadas a mano y no se pueden importar**: los repos
  están separados a propósito. La red es `paletas.test.ts`, que comprueba las *propiedades* que el
  sistema declara —contrastes, «Noche tiene dos niveles de texto y no tres», «Sol no tiene
  grises»— y no que los strings existan.
- `src/tema/resolucion.ts` (+ 22 pruebas) — manual > sensor con histéresis > hora, con el mínimo de
  permanencia de 90 s. **El caso que obliga a que sean tres temas está fijado como prueba**: el
  subterráneo a las 17:00 cae en *Día*, no en *Noche*. El atardecer de Santiago **se calcula**
  (NOAA): entre junio (17:44) y diciembre (20:53) se mueve más de tres horas, y una constante
  dejaría la app en Noche a las 18:00 de un 21-dic con sol pleno.
- `src/senales-vocabulario.ts` + `senales.ts` (+ 8 pruebas) — **las cuatro señales, que no existían
  ninguna**: cero `Haptics`, cero audio en todo el repo. Se distinguen por **cantidad y duración de
  pulsos**, no por tono: un tono distinto no se distingue con guantes ni con un montacargas al lado.
  El tono se **sintetiza** como WAV en `data:` en vez de empaquetar cuatro archivos. Va por el
  **canal de alerta**, no el de multimedia — si fuera multimedia bajaría con la radio del conductor
  y desaparecería justo en la bodega ruidosa.
- `src/tema/escala.ts` (+ 7 pruebas) — cuatro pasos (100/115/130/150 %). **Nunca reduce** y **los
  objetivos táctiles nunca bajan de 56 px**: si el botón creciera con la letra, en 100 % quedaría
  más chico que el mínimo.
- `src/theme.ts` pasa a ser **puente**, apuntado al tema Día, porque sus nombres están en ~460
  lugares de 22 pantallas. Es el patrón de convivencia del repo web. ⚠️ **El puente no cambia de
  tema**: una pantalla que lea `colors` como constante se queda en Día. Migrar una es cambiar dos
  líneas (`useColores` + `useEstilosCompat`), y lo que falta se lee de una.

#### El retiro en bodega

- **La mitad que faltaba**, y era la que convierte el escaneo en una conciliación: la app solo sabía
  contar lo escaneado. `listarEsperadosDeSeller` (repo web, + 6 pruebas) devuelve la **lista** —no un
  conteo— porque al cerrar con faltantes hay que **nombrarlos**. Sus criterios son los mismos que los
  del panel del coordinador, a propósito y con prueba.
- `retiro-conciliacion.ts` (+ 11 pruebas). 🐞 **«Te quedan» sale de los faltantes, NO de una resta**:
  con una resta, escanear un bulto sorpresa bajaría el contador sin que ningún esperado apareciera, y
  llegaría a cero con bultos todavía en el piso de la bodega.
- Las **tres cifras** arriba (`Escaneados · Pendientes · Te quedan`), el **acuse de 34 px** que se lee
  de reojo, y el **registro** con el repetido marcado y la hora en que se había escaneado antes.
  Reemplazan un contador de un número y un *feed* de cinco filas que obligaba a **leer** para saber
  si el bulto entró — 130 veces por bodega.
- La hoja de **cerrar con faltantes** los lista. Un `Alert` del sistema no puede, y sin la lista el
  conductor sale a recorrer la bodega sin saber qué busca.
- El botón dice **el número**, no «cerrar»: lo que se firma es «38 de 42».

🐞 **Seis `<StatusBar style="light" />` locales** pisaban la barra del tema en la pantalla de retiro.
Bajo Sol el fondo es blanco: reloj y batería quedaban en blanco sobre blanco.

#### El retiro de la PWA · repo web

Se fueron las 5 rutas de `/conductor` (~1.900 líneas) y `conductor-nav.tsx`. **Las 18 rutas de
`/api/conductor/*` no se tocaron.** Quedan corregidos los cuatro sitios que apuntaban a la PWA: el
redirect de `(tenant)/layout.tsx`, el enlace «Ver como lo ve el conductor» del detalle de manifiesto,
`manifest.ts` (`start_url` a la raíz, y deja de llamarse «Rutax — Conductor») y `page.tsx`.

⚠️ **DEUDA ABIERTA, asumida por decisión del usuario.** Dos de las cinco pantallas retiradas **no
existen todavía en la app nativa**:

1. **Mis liquidaciones** (brecha #19) — el conductor vuelve a preguntar por WhatsApp cuánto le toca.
2. **Punto de término** — el consentimiento de tres pasos ya no se puede *iniciar* desde ninguna
   parte. Va en la app nativa, dentro de este mismo bloque.

**Lo que NO se retiró, y por qué:** el botón de **borrar** el punto de término. Revocar no es una
funcionalidad, es una condición: la Ley 21.431 exige que el dato personal que alguien entregó se
pueda retirar cuando quiera. Quitar la pantalla que lo *captura* es una decisión de producto; quitar
la que lo *borra* deja sin salida a quien ya dijo que sí. `DELETE /api/conductor/punto-termino` ya
existía; `/conductor` es su único acceso humano hasta que la app nativa tenga el suyo. Verificado en
el navegador: borra y deja **dos entradas en bitácora, las dos con autor**.

🐞 Encontrado en pantalla: «Hola .» — `nombreCompleto` sale de `user_metadata` del JWT y el conductor
de demo no lo tiene ahí.

### Hecho el 24-08-2026 (segunda pasada) — las del día a día

Decisiones del usuario: **las del día a día primero** · las **tres notificaciones con su mitad de
servidor** · «marcarme disponible» **pasa a ser solo del conductor**.

#### Las primitivas, primero

`src/components/ui.tsx` sigue al tema. Es la migración de mayor palanca del bloque: la usan las
once pantallas, así que un botón deja de ser azul en las once a la vez. Con ella se van las
sombras, los radios bajan de 16–20 px a 3, y los botones pasan a 56 px mínimo creciendo con la
escala de texto. Las variantes bajan de seis a cuatro: `accent` y `success` eran el mismo botón con
dos azules, y un botón verde de acción choca con la gramática de estados, donde verde es «terminó
bien». Los seis nombres se siguen aceptando para no romper las once pantallas.

#### Manifiesto del día

| Qué | Por qué |
|---|---|
| «73 %» → **«7 de 24 cerradas · 17 van»** | Un porcentaje no responde ninguna de las dos preguntas del conductor, y para sacarlas hay que multiplicar de cabeza |
| Filas de 70 px con el número grande | Es lo que compara contra la etiqueta del bulto, de reojo |
| Deslizar a la izquierda con **seguro del 45 % + vibración** | Un guante rozando la pantalla no llega a la mitad. Y **no ejecuta**: abre la parada con la hoja lista, porque un fallo exige motivo y evidencia |
| **Borrador con salida** (brecha #18) | Decía «vuelve en unos minutos» y nada más. Ahora muestra lo asignado por comuna y las dos acciones que sí existen |
| La falla de lectura, en orden | Primero «las que ya cerraste están guardadas», después el motivo. Era un `Alert` genérico que se cierra y deja la pantalla igual de vacía |
| Esqueleto con el alto real | La lista no salta al llegar los datos |

#### Detalle de parada · la jerarquía estaba invertida

Abría con «Destinatario» en grande y la dirección debajo, en texto de cuerpo. Esa es la jerarquía
de una ficha de cliente, no la de alguien manejando: **el conductor abre esta hoja para llegar**.
Ahora la dirección va en el tamaño más grande de la pantalla con el botón de navegar debajo, después
los bultos, y quien recibe **al final**.

Y la **regla 68** deja de ser una nota al pie: en Flex el botón ya no dice «Entregar» sino
**«Registrar mi entrega»**, porque eso es literalmente lo que hace — la prueba oficial la gobierna
Mercado Envíos. Una interfaz que ofrece la misma acción en los dos regímenes promete algo que en uno
no cumple.

#### La asistencia pasa al conductor

`conductores.disponible` decidía quién entra en la asignación y **solo el coordinador podía
tocarlo**: se definía por WhatsApp y alguien lo transcribía, así que el campo describía una creencia.
Ahora se marca desde la app. Se retiran el interruptor, su Server Action **y** la función del
módulo — las tres, porque una Server Action sin llamador sigue siendo un endpoint.

⚠️ **Contrapartida asumida:** si un conductor no se marca y no contesta, el coordinador no puede
meterlo en la auto-asignación. Está dicho en la pantalla, donde estaba el interruptor.

🐞 Y una contradicción que apareció al abrirla: tres líneas debajo del «desde acá no se puede marcar
por él» seguía ofreciendo «Marcar como no disponible». La regla real es **asimétrica** y ahora está
escrita: ponerse disponible es del conductor; sacarlo sigue siendo del coordinador, pero por el
camino de «se cayó a mitad de ruta», que no es asistencia sino respuesta a un incidente.

#### Las notificaciones · y las dos que no tienen disparador

Se construyó la mitad de servidor completa: tabla `identidad.dispositivos_conductor` **deny-all con
11 aserciones pgTAP**, el puerto de Expo aislado (+ 13 pruebas), `notificarConductor`, y las rutas
`PUT/DELETE /api/conductor/dispositivo`. En la app: el permiso se pide **al cerrar la primera
parada** y no al abrir (regla 13), el token se refresca si el sistema lo rota, el toque valida su
destino contra lista blanca, y cerrar sesión da de baja el teléfono.

🔎 **Hallazgo: de las tres del tablero, solo una tiene disparador en este sistema.**

| Aviso | Estado |
|---|---|
| «Tu ruta está lista» | ✅ Conectado a `confirmarManifiesto` |
| «Te traspasaron bultos» | ❌ **No hay quién lo dispare.** El traspaso es **del receptor**: Pedro escanea los bultos que Juan le pasa (`crearTraspaso(conductorReceptorId, codigos)`). Nadie empuja carga a nadie |
| «Tienes un retiro nuevo» | ❌ **No hay quién lo dispare.** El coordinador nunca asigna una visita: el conductor abre la suya eligiendo bodega |

Los textos y el envío de los tres están construidos y probados; lo que falta es el hecho que los
origine.

🔎 **Y con eso cae NUEVO #26.** El tablero dice que el traspaso «hoy es unilateral y el receptor se
enteraba al ver bultos nuevos en su manifiesto». **En el código no es así**: el receptor escanea, o
sea que las dos voluntades ya están presentes por construcción (regla 15 cumplida). Construir «el
que entrega empuja y el que recibe acepta» no arreglaría nada — **agregaría** el flujo unilateral que
la regla prohíbe. Se deja sin construir, con este motivo.

#### Lo que queda del bloque 6

### Hecho el 24-08-2026 (tercera pasada) — las siete que quedaban

#### Mis liquidaciones · la deuda que dejó el retiro de la PWA (brecha #19)

Ruta `GET /api/conductor/liquidaciones` (+ `?id=` para el detalle) y sus dos pantallas.

⚠️ `listarLiquidaciones` acepta `driverId` **opcional**: sin él devuelve las de todo el tenant. Acá
va siempre y sale del token — con `service_role` bypaseando RLS, olvidarlo le mostraría a un
conductor lo que gana cada uno de sus compañeros. El detalle repite la comprobación sobre la fila
leída, porque `obtenerLiquidacion` filtra por tenant y **no** por conductor.

🔎 **El neto no existe como columna.** La fila guarda `monto_total_clp`, `bono_clp` y
`penalizacion_clp` por separado, y el neto es `total + bono − penalización` —una cuenta que hasta
hoy hacía cada pantalla por su lado. Mostrar solo `montoTotalClp` le habría enseñado al conductor
una cifra distinta de la que le llega al banco cada vez que hubo un ajuste.

**El ajuste va firmado.** `dinero.liquidaciones` guarda el motivo pero **no quién lo puso**: el autor
está en la bitácora (`dinero.liquidacion_ajustada`). `resolverAutorDeAjuste` lo lee, y solo si hay
ajuste. El motivo es el que Administración escribió sabiendo que él lo iba a leer; un descuento
firmado se discute con una persona, uno anónimo se discute con «el sistema» — y esa conversación
termina en el teléfono del coordinador.

#### Punto de término · y el tablero se corrige contra el documento de seguridad

🔎 **El tablero dibuja un campo de dirección; no se puede construir, y no es de estilo.** El paso 2
del tablero muestra «Av. Vicuña Mackenna 1240» escrita a mano. Para convertir ese texto en
coordenada habría que geocodificarlo, y el camino natural —`resolverCoordenadaConCache`— escribe en
`integraciones.geocoding_cache`, que es **global, sin `tenant_id`, guarda la dirección en claro y no
tiene purga**. El domicilio del conductor quedaría escrito para siempre en una tabla compartida
entre couriers, y **«puedes borrarlo cuando quieras» sería falso**.

`docs/seguridad/punto-de-termino-conductor.md` §3 ya lo prohíbe y el servidor ya lo impone: `PUT
/api/conductor/punto-termino` acepta **solo dos números**. Así que el paso 2 es **pin en el mapa**,
con «usar dónde estoy ahora» —que es GPS, no geocoding— conservado del tablero.

Los tres pasos, con lo que exige §5.2: el 1 no pide nada, explica · el 2 **no persiste nada** (si
vuelve atrás no queda rastro) · el 3 con casilla **nunca premarcada** y texto versionado. El texto
está en `punto-termino.ts` **con 15 pruebas**, y una comprueba que siga estando **el residuo del
§4.4** —que el jefe va a notar que sus rutas terminan por su sector—. Es el que suena mal y por eso
se borra primero; sin él, el consentimiento no es informado.

Revocar es **un toque**, sin confirmación en cadena y sin preguntar por qué (§5.3).

#### Histórico de retiros · parada de retiro · permisos · guardado sin confirmar

- **Histórico** — `GET /api/conductor/retiros/historico?mes=`, actas cerradas por mes, con **las dos
  cifras** («27 de 31», no «27»). Vive en su app y no solo en el backoffice porque **respalda su pago
  por visita**: si la lista está solo del lado del courier, revisarla es pedírsela a quien le paga.
- **Parada de retiro** — misma jerarquía que una parada de entrega, otro cuerpo: pendientes y **cómo
  entrar**. «Portón lateral, timbre 2, preguntar por Marcela» es la mitad que el courier ya tenía
  guardada y que nadie había puesto donde se usa. Y «se paga como visita, esté vacía o no» va
  **antes** de entrar: dicho después, el conductor que llega a una bodega vacía cree que perdió el
  viaje y la próxima vez no va.
- **Permisos** — los cuatro, y **negar no es lo mismo en los cuatro**. Solo la cámara bloquea; sin
  galería se dispara la foto, sin ubicación se registra sin coordenada y queda anotado, sin avisos la
  app funciona igual. Tratarlos como el mismo problema enseña que los permisos son ruido, y entonces
  no se lee el que sí importa. La salida es **abrir los ajustes**, no explicar tres niveles de menú.
- **Guardado sin confirmar** — la cola existe y funciona; lo que cambia es cómo se **expresa**: decía
  «N por enviar · toca para reintentar», que le pide al conductor administrar un buzón. Ahora dice
  las tres cosas en orden: ya está guardado · se reintenta solo, sigue con la siguiente · **y cerrar
  la app ahora lo pierde**. Ni verde ni rojo mientras espera. Se retira «Limpiar»: descartar
  evidencia no confirmada no es de rutina, y ofrecerla a un toque del aviso invita a usarla para
  hacer callar la franja.

#### Lo que queda del bloque 6, ahora

Las doce pantallas están construidas.

### La adopción del tema, terminada el 24-08-2026

**Ninguna pantalla del repo Expo lee ya `colors` como constante.** Se migraron los 16 archivos que
quedaban —Torre móvil, login, splash, evidencia, traspaso, listado de retiros, cámara y el layout
del stack— y con ellos se fueron **todas las sombras** y **todos los hexadecimales sueltos**.

Lo que apareció al barrer, y no era solo color:

- **El login y el splash estaban construidos sobre un supuesto que ya no vale**: fondo navy con
  texto blanco. Por eso tenían `#ffffff22`, `#ffffff33`, `#ffffffb0` y `#ffffff99` — blancos
  translúcidos que solo funcionan sobre un fondo oscuro fijo. Con el sistema nuevo el fondo es el
  del tema, y **bajo Sol es blanco**: el texto habría quedado blanco sobre blanco.
- **La cabecera del stack seguía en navy**, y es lo que el conductor ve en *todas* las pantallas.
- **`ESTADO_PUNTO` de la Torre era una constante de módulo** con los colores pegados: se resolvía
  una vez al importar el archivo y se quedaba en el tema que hubiera entonces. Pasa a ser función de
  la paleta, y se parte en dos: la **palabra** de cada estado no depende del tema —`etiquetaDePunto`
  arma el texto del lector de pantalla y no tiene color— y obligarla a pedir una paleta la habría
  convertido en un hook por nada.
- **Cuatro azules de «Light Pro»** (`#BFDBFE`, `#1D4ED8`) repartidos en cuatro pantallas, que en
  Noche pintaban celeste claro sobre `#05080A`.
- **`color="#fff"` sobre rellenos de color.** Un blanco fijo sobre el teal de Sol queda en 2,4:1.
  Ahora es `fgOnAccent`, que es el texto que el sistema define para ir encima del acento.

**Dos excepciones, las dos con motivo escrito:** el negro del visor de la cámara —un fondo de tema
alrededor de una imagen de cámara delata el recorte y, bajo Sol, el marco blanco arruina la
exposición— y **la sombra del marcador del mapa**, la única que queda en la app: sobre un mapa no hay
escalón de fondo ni borde que sirvan de elevación, porque el fondo es el plano de la ciudad y cambia
bajo el marcador.

**La red que impide que vuelva:** `src/tema/adopcion.test.ts` barre `app/` y `src/` y falla si
aparece un `import { colors }`, un `shadow.sm`, un hexadecimal suelto o un `<StatusBar>` de pantalla.
No comprueba estética — comprueba que el mecanismo siga enchufado.

⚠️ **Nada de la app se ha visto en pantalla.** Necesita un build de EAS con los siete módulos
nativos nuevos. Lo verificado es `tsc`, las 184 pruebas del repo Expo y las 3.839 del web.

**NUEVO #26** queda descartado con motivo (ver la pasada anterior): el flujo que pide ya está
resuelto de otra forma.

### ⏳ B5b · La entrada del conductor · EN COLA desde el 24-08-2026

Tablero nuevo, traído de Claude Design el 24-08 y guardado en
`docs/diseno/pantallas/Rutax B5b Entrada del conductor.dc.html` (41 KB). **No estaba en el censo del
23-08:** los 31 tableros de entonces no cubrían la puerta de la app —B5 entra directo al manifiesto
del día—, así que estas tres pantallas no están contadas en el recuento de arriba.

Es **la cuarta puerta del producto**. Ya eran tres —backoffice, portal, backstage— y ésta es la
única sin contraseña, la única con Google y la única que no vence por tiempo. Lleva marca **Rutax**,
no del courier: de las cuatro, solo el portal del seller lleva la del courier.

**Qué trae:** tres pantallas —la puerta con los dos caminos, el código de 6 dígitos, la entrada de
1,4 s— más **seis estados**: cuenta de Google no registrada, código malo o vencido, correo no
registrado, sin señal, suspendido, y el progreso con pasos nombrados. En tema **Sol** (la primera
vez real es a las 16:00, en la bodega) y **Noche**. **Sin componentes nuevos:** reusa `pantalla sin
sesión`, `progreso con pasos nombrados` y el campo de código de 6 casillas del backstage, con
objetivos de 60 px.

| Pantalla | Dónde vive hoy | Veredicto |
|---|---|---|
| La puerta · Google o correo | `rutax-conductor` → `app/login.tsx` | **PANTALLA DISTINTA** |
| El código · 6 casillas | — | **NO EXISTE** |
| La entrada · «Hola, Carlos» · 1,4 s | — | **NO EXISTE** |

**Lo verificado en código — confirma el tablero y le agrega una mitad que la ficha no menciona:**

- La app **sí pide contraseña hoy**: `useAuth.tsx:58` llama a `signInWithPassword`. No hay Google y
  no hay código.
- **Y el alta del conductor, en ESTE repo, está construida encima de esa contraseña.** El texto del
  formulario dice literal «un enlace para que **defina su contraseña**»
  (`src/app/(tenant)/conductores/[id]/acceso-app-conductor.tsx:235`). O sea que **#31 no es solo la
  pantalla de la app**: se lleva por delante el flujo de invitación del backoffice y su copy. Eso
  **sí es trabajo de este repo**, y el tablero no lo dice.

**Tres marcados NUEVO — bloqueados por decisión tuya, como los otros treinta** (anexo A del
checklist, que queda en 33):

- **#31 · Entrar con Google, y correo con código como respaldo.** No necesita SMS: el envío de correo
  ya existe en el producto.
- **#32 · La sesión no vence por tiempo** — vence cuando el courier suspende al conductor o cuando
  él sale. Es decisión de seguridad tanto como de diseño.
- **#33 · La ayuda de campo del alta** tiene que decir que ese correo es el que va a usar para
  entrar, y que si usa Gmail sea ese mismo. Es una **corrección al formulario de B1c**, no una
  pantalla nueva — y es lo que evita el error más probable del día uno.

**Cuatro reglas nuevas, 81 a 84** — hay que sumarlas a las 80 del anexo D antes de medir deuda
contra ellas:

- **81.** En la app del conductor no hay contraseñas: Google, o correo con código de un solo uso.
- **82.** Un mensaje de error no ofrece un contacto que no tenemos: sin sesión no sabemos de qué
  courier es, así que se nombra a quién buscar, no un teléfono que no existe.
- **83.** Cuando una autenticación falla por identidad, **se muestra con qué identidad se intentó y
  se fuerza el selector del proveedor externo**. Sin eso el siguiente intento repite el error solo.
  Es el mismo problema que la segunda cuenta de Mercado Libre en el portal del seller — con la
  diferencia de que ahí **ML no deja forzar el selector** y acá Google sí.
- **84.** La app del conductor lleva marca Rutax, y es la excepción declarada a la regla 42: la marca
  es del courier cuando la ve su cliente, y es nuestra cuando la superficie es una herramienta
  interna.

**Dos decisiones abiertas, y las dos van ANTES de construir:**

1. **El conductor que no tiene ningún correo.** Pasa. Hoy el alta lo exige y todo el flujo cuelga de
   él. La salida —que el coordinador le cree uno, o un identificador que el courier controle—
   **cambia el formulario de alta**, así que no se puede dejar para después.
2. **El cambio de teléfono.** El flujo funciona solo (entra con su misma cuenta en el aparato nuevo);
   falta decidir si la sesión anterior **se cierra sola** —el tablero lo recomienda: un teléfono
   perdido con la app abierta ve direcciones de clientes— y si el coordinador se entera.

**No se diseñó, a propósito:** Apple ID (entra como tercer botón en la misma pantalla si el piloto
muestra conductores con iPhone, sin rediseñarla), biometría (el teléfono ya tiene la del sistema) y
registro autónomo (a esta app solo se entra si el courier te dio de alta; un conductor
autoregistrado es un conductor sin tarifa y sin relación laboral declarada).

⚠️ **La regla de cierre pesa más acá que en el resto del libro:** la app **no se ha visto nunca en
pantalla** y ver estas tres exige un build de EAS. No se cierran con `tsc` y pruebas.

## B6 · Backstage · 16 pantallas

| Pantalla | Ruta | Veredicto |
|---|---|---|
| Couriers | `admin/couriers` | **PANTALLA DISTINTA** |
| Ficha del courier | `admin/couriers/[tenantId]` | **PANTALLA DISTINTA** |
| Métricas del producto | `admin/metricas` | **PANTALLA DISTINTA** |
| Estado del sistema | `admin/salud` — hoy es telemetría de jobs | **PANTALLA DISTINTA** |
| Crear un courier | — | **NO EXISTE** |
| Equipo de Rutax | — | **NO EXISTE** |
| Sesiones de soporte | — | **NO EXISTE** |
| Salud de integraciones | — | **NO EXISTE** |
| Patrón `sesión suplantada` | `app-shell/banner-suplantacion.tsx` | FALTA PIEZA |
| Suscripciones y cobros | `admin/suscripciones` | FALTA PIEZA |
| Planes | `admin/planes` | FALTA PIEZA |
| Bitácora de auditoría | `admin/bitacora` | FALTA PIEZA |
| Avisos a couriers | `admin/comunicaciones` | FALTA PIEZA |
| Mi cuenta | `admin/seguridad` — solo la mitad de MFA | FALTA PIEZA |
| Interruptor de emisión real | `admin/suscripciones/[id]/entitlements-overrides.tsx` | FALTA PIEZA |
| Detalle de suscripción | `admin/suscripciones/[suscripcionId]` | FALTA PIEZA · *la tiene el código, no el tablero* |

**Dos brechas que no son de pantalla:** la sesión de soporte vive en una cookie firmada, así que
ningún admin puede listarla ni cerrarla en remoto · la salud de conexiones existe solo por courier
y solo para ML, con Shopify ya desplegado y sin vista.

**Y tres cosas que el tablero da por rotas y ya no lo están:** los `confirm()` del backstage son
**1, no 6** (`entitlements-overrides.tsx:199`); el banner de suplantación ya vive en el marco
(`admin/layout.tsx:137-145`); la etiqueta térmica ya se rehizo con pruebas.

## B7 · Sin sesión · 16 pantallas

| Pantalla | Ruta | Veredicto |
|---|---|---|
| Seguimiento público | `tracking/[token]` | **PANTALLA DISTINTA** |
| Login del backoffice | `login` | **PANTALLA DISTINTA** |
| Login del portal | — hoy es un `redirect` al del backoffice | **NO EXISTE** |
| Marco `pantalla sin sesión` | `components/ui/pantalla-sin-sesion.tsx` | FALTA PIEZA |
| Backstage · segundo factor | `admin/login` · `admin/seguridad` | FALTA PIEZA |
| Los seis estados del acceso | `lib/identidad/error-login.ts` | FALTA PIEZA |
| Activación pendiente | `registro/revisa-tu-correo` | FALTA PIEZA |
| Aceptar invitación · y sus 5 errores | `invitacion/[token]` | FALTA PIEZA |
| Recuperar contraseña | `recuperar-contrasena` | FALTA PIEZA |
| Restablecer contraseña | `restablecer-contrasena` | FALTA PIEZA |
| Tarjeta de enlace compartido | `tracking/[token]/opengraph-image.tsx` | FALTA PIEZA |
| No encontrado | `not-found.tsx` | FALTA PIEZA |
| Error general | `error.tsx` | FALTA PIEZA |
| Sin conexión | `offline` | FALTA PIEZA |
| Legales | `(legal)/terminos` · `(legal)/privacidad` | FALTA PIEZA |
| Registro del courier | `registro` | IGUAL |

🐞 **El seguimiento público lleva el nombre del seller como titular**
(`tracking/[token]/page.tsx:195`). Rompe la regla 42 —la marca es del dueño de la relación, que
acá es el courier— y la 66 —el comprador no ve al seller— **en la misma línea**. Es la única
pantalla que ve alguien que no es cliente de nadie.

Y el caso `courier` de la regla 42 **no está ejercido en ningún punto del producto**, porque el
login del portal no existe: redirige al del backoffice.

## B8 · Piezas impresas · 7 piezas

| Pieza | Ruta | Veredicto |
|---|---|---|
| Manifiesto impreso | — | **NO EXISTE** |
| Factura electrónica PDF | — la emite el proveedor DTE, `pdfUrl: null` | **NO EXISTE** |
| Etiqueta carta, dos por hoja | `operacion/etiqueta-same-day-pdf.tsx` | **PANTALLA DISTINTA** |
| Liquidación del conductor PDF | `dinero/liquidacion-pdf.tsx` | **PANTALLA DISTINTA** |
| Etiqueta térmica 10×15 | `operacion/etiqueta-same-day-pdf.tsx` | FALTA PIEZA |
| Controles de impresión | `operaciones/[pedidoId]/boton-descargar-etiqueta.tsx` · `portal/pedidos/bloque-etiqueta.tsx` | FALTA PIEZA |
| Comprobante de suscripción | `plataforma/comprobante-pago-pdf.tsx` | *la tiene el código, no el tablero* |

**Cero navy hardcodeado** en las tres piezas vivas: los hex salen del bloque `@media print` de
`rx-tokens.css:609-628`, con el token anotado al lado. La única excepción es `#FFF6DE` en
`comprobante-pago-pdf.tsx:77`, que no calza con `--rx-attention-bg: #FFF3D6`.

**La factura PDF exige una decisión de arquitectura antes que de diseño:** hoy el documento lo
genera el proveedor DTE. Dibujarla implica decidir si Rutax arma su propia representación impresa.

---

# Lo que este libro deja pendiente de decidir

1. **Las cuatro cifras del B1 que no tienen dato.** ¿Se construyen o la pantalla dice otra cosa?
2. **La factura electrónica en PDF.** ¿Rutax arma su propia representación, o se conserva la del
   proveedor y el tablero pierde?
3. **`/kitchen-sink` y `/offline`** no las dibuja ningún tablero, y `kitchen-sink` ya quedó
   restringida a desarrollo.
4. **El multi-período de cobranza**, congelado por la decisión 4, necesita su propio diseño de
   imputación y reversa antes de volver a la cola.

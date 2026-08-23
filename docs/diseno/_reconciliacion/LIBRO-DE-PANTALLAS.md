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

# La cola, por bloque

## B1 · Operación del courier · 8 pantallas

| Pantalla | Ruta | Veredicto |
|---|---|---|
| Dashboard operativo | `(tenant)/dashboard` | ✅ **HECHA** — 23-08, ver abajo |
| Conductores | `(tenant)/conductores` | ✅ **HECHA** — 23-08, ver abajo |
| Crear pedido same-day | `(tenant)/operaciones/nuevo` | ✅ **HECHA** — 23-08, ver abajo |
| Incidencias | `(tenant)/operaciones/incidencias` | ✅ **HECHA** — 23-08, ver abajo |
| Torre de control | `(tenant)/torre-de-control` | FALTA PIEZA |
| Preparación del día | `(tenant)/preparacion` | FALTA PIEZA |
| Manifiestos · listado | `(tenant)/manifiestos` | FALTA PIEZA |
| Detalle del manifiesto | `(tenant)/manifiestos/[manifiestoId]` | FALTA PIEZA |

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

## B2 · Dinero · 5 pantallas

| Pantalla | Ruta | Veredicto |
|---|---|---|
| Períodos de cobro | `(tenant)/dinero/periodos` | **PANTALLA DISTINTA** |
| Liquidaciones | `(tenant)/dinero/liquidaciones` | **PANTALLA DISTINTA** |
| Detalle del período | `(tenant)/dinero/periodos/[periodoId]` | FALTA PIEZA |
| Detalle de la liquidación | `(tenant)/dinero/liquidaciones/[liquidacionId]` | FALTA PIEZA |
| Cobranza | `(tenant)/dinero/cobranza` | **CONGELADA** — decisión 4 |

**El hallazgo del bloque:** la selección múltiple no vive en la tabla en ninguno de los dos
listados; es un panel-checklist paralelo. `BarraSeleccion` y `BarraCajones` están construidas y
solo se usan desde `kitchen-sink`.

## B3 · Configuración y puesta en marcha · 12 pantallas

| Pantalla | Ruta | Veredicto |
|---|---|---|
| El asistente | `(tenant)/onboarding` | **PANTALLA DISTINTA** |
| Final del asistente · «Ya puedes operar» | — | **NO EXISTE** |
| El cuerpo del paso · DTE, folios, tarifas, cobranza | `(tenant)/onboarding/*` | FALTA PIEZA |
| Tarifas | `(tenant)/configuracion/tarifas` | FALTA PIEZA |
| Zonas y ventanas de corte | `(tenant)/configuracion/zonas` | FALTA PIEZA |
| Bodegas | `(tenant)/configuracion/bodegas` | FALTA PIEZA |
| Equipo | `(tenant)/equipo` | FALTA PIEZA |
| Exportar datos | `(tenant)/configuracion/exportar-datos` | FALTA PIEZA |
| Sellers | `(tenant)/sellers` | FALTA PIEZA |
| Retiro | `(tenant)/configuracion/retiro` | IGUAL |
| Integraciones | `(tenant)/configuracion/api` | IGUAL |
| Mi plan | `(tenant)/configuracion/plan` | IGUAL |

🐞 **Y un defecto vivo en producción, no una brecha de diseño:** el aviso de configuración
pendiente **no desaparece nunca, para ningún courier**. `completo` exige
`estado_certificacion = 'activo'` (`onboarding/estado.ts:155`) y los únicos escritores de esa
columna escriben `pendiente` y `en_proceso`. No existe el job ni el endpoint que la cierre.
Además el conteo miente en dos lugares: `estado.ts:168` fija `totalPasos: 2` mientras la pantalla
renderiza cinco tarjetas.

## B4 · Portal del seller · 10 pantallas

| Pantalla | Ruta | Veredicto |
|---|---|---|
| Inicio del portal | `portal` | **PANTALLA DISTINTA** |
| Bienvenida | `portal/bienvenida` | **PANTALLA DISTINTA** |
| Mis pedidos | `portal/pedidos` | **PANTALLA DISTINTA** |
| Detalle del pedido · same-day | `portal/pedidos/[pedidoId]` | **PANTALLA DISTINTA** |
| Mis cobros y su detalle | `portal/cobros` · `cobros/[periodoId]` | **PANTALLA DISTINTA** |
| Mis incidencias | `portal/incidencias` | **PANTALLA DISTINTA** |
| Pedido Flex · variante | misma ruta | FALTA PIEZA |
| Cobro ya facturado · variante | misma ruta | FALTA PIEZA |
| Nuevo pedido same-day | `portal/pedidos/nuevo` | FALTA PIEZA |
| Bodegas | `portal/bodegas` | IGUAL |

**Tres cosas del bloque:** «Reportar un problema» no existe pese a que la bienvenida lo promete ·
`notas_resolucion` se lee de la base y se descarta (`portal/incidencias/page.tsx:114`) · el
«IVA 19 %» que el tablero manda retirar sigue calculándose como residuo
(`portal/cobros/[periodoId]/page.tsx:298`), contra la regla 22.

## B5 · App del conductor · fuera de este repo

Las 12 pantallas viven en `Desktop/rutax-conductor`. Las 5 rutas de `/conductor` de este repo son
la PWA, marcada para retiro. **Ningún tablero cubre la PWA a propósito.**

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

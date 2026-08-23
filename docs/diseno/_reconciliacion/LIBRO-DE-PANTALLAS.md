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
| Dashboard operativo | `(tenant)/dashboard` | **PANTALLA DISTINTA** |
| Conductores | `(tenant)/conductores` | **PANTALLA DISTINTA** |
| Crear pedido same-day | `(tenant)/operaciones` · modal, sin ruta propia | **PANTALLA DISTINTA** |
| Incidencias | `(tenant)/operaciones/incidencias` | **PANTALLA DISTINTA** |
| Torre de control | `(tenant)/torre-de-control` | FALTA PIEZA |
| Preparación del día | `(tenant)/preparacion` | FALTA PIEZA |
| Manifiestos · listado | `(tenant)/manifiestos` | FALTA PIEZA |
| Detalle del manifiesto | `(tenant)/manifiestos/[manifiestoId]` | FALTA PIEZA |

**Lo que hay que resolver antes de construir:** cuatro cifras del tablero no existen en ninguna
capa de datos — «en ruta ahora» y «conductores con ruta» del contrato de la Torre, «paradas» y
«avance» del listado de manifiestos, y los denominadores de Preparación.

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

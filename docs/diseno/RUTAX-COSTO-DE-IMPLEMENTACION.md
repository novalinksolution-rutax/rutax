# Rutax · Costo de implementacion, componente por componente

**Version 1.0 · 22 de agosto de 2026**

> Artefacto importado desde Claude Design (proyecto `184f328b`). Se conserva
> tal cual: es la fuente de verdad del presupuesto de implementacion.

Este documento existe para presupuestar, no para recortar el diseno. Todo lo que esta aca esta disenado; lo que declara es **cuanto cuesta llegar a ello desde lo que el producto ya tiene**.

## Punto de partida real

Next.js, Tailwind y shadcn/ui. **30 componentes en uso en 84 pantallas.**

## Los tres niveles de costo

| Nivel | Que significa | Esfuerzo tipico |
|---|---|---|
| **RE-ESTILO** | El componente existe y su comportamiento sirve. Se cambian tokens, espaciado y tipografia. No se toca la logica. | horas |
| **EXTENDER** | El componente existe pero le falta comportamiento o variantes. Se conserva su base y se le agrega. | 1-3 dias |
| **DE CERO** | No existe nada equivalente, o lo que existe resuelve otro problema. | 3 dias a 2 semanas |

## Resumen

| Nivel | Componentes | % |
|---|---|---|
| **RE-ESTILO** | 31 | 31% |
| **EXTENDER** | 27 | 27% |
| **DE CERO** | 42 | 42% |
| **Total** | **100** | |

**Lectura del numero:** el 58% del catalogo sale de lo que ya existe. El 42% de cero se concentra en tres frentes que hoy el producto no tiene: **el sistema de estado con sus 29 vocabularios**, **la trastienda de dinero** y **la app del conductor** (nativa, no comparte codigo con la web).

## Reparto por bloque

| Bloque | Componentes | Re-estilo | Extender | De cero |
|---|---|---|---|---|
| 1 · Primitivas y controles de formulario | 19 | 8 | 6 | 5 |
| 2 · Estado y etiquetado | 10 | 1 | 3 | 6 |
| 3 · Tablas y listados | 14 | 4 | 4 | 6 |
| 4 · Contenedores y superficies | 17 | 8 | 3 | 6 |
| 5 · Marco y navegacion | 8 | 0 | 3 | 5 |
| 6 · Retroalimentacion y estados de pantalla | 12 | 6 | 2 | 4 |
| 7 · Flujos y patrones compuestos | 11 | 0 | 2 | 9 |
| 8 · Sub-sistemas especializados | 17 | 2 | 1 | 14 |

## Los 30 existentes: que pasa con cada uno

**29 de los 30 sobreviven.** El unico que se reemplaza es `badge-estado`, y es el correcto: es el componente que sostiene el sistema de estado entero, y su modelo de datos no soporta 29 vocabularios ni el eje multiple.

| Existente | Destino |
|---|---|
| `alert` | Base de `aviso embebido` · EXTENDER a 6 tonos |
| `avatar` | RE-ESTILO |
| `badge` | Base de `etiqueta`, `procedencia`, `contador` · RE-ESTILO + EXTENDER |
| `badge-estado` | **SE REEMPLAZA** |
| `button` | RE-ESTILO + variante de peldano 3 |
| `card` | RE-ESTILO |
| `chart` | RE-ESTILO + paleta categorica nueva |
| `checkbox` | RE-ESTILO + variante tactil de 56 px |
| `data-table` | Base de todas las tablas · EXTENDER en seleccion y densidad |
| `dialog` | RE-ESTILO |
| `dialog-confirmacion-dinero` | Base de `modal de acto explicito` · EXTENDER a los 3 peldanos |
| `dropdown-menu` | RE-ESTILO |
| `empty-state` | EXTENDER a 3 tonos con cifra y hora |
| `input` | RE-ESTILO + variantes de monto, numerico y busqueda |
| `kpi-card` | Base de `mosaico de magnitudes` · RE-ESTILO |
| `label` | RE-ESTILO |
| `monto-clp` | Base de `campo de monto` · EXTENDER |
| `pagination` | RE-ESTILO |
| `popover` | RE-ESTILO |
| `progress` | RE-ESTILO · el de pasos nombrados es aparte |
| `select` | RE-ESTILO + seleccion multiple |
| `separator` | RE-ESTILO |
| `sheet` | Base de `panel lateral` y `hoja movil` · RE-ESTILO + EXTENDER |
| `skeleton` | RE-ESTILO |
| `sonner` | RE-ESTILO · con la regla nueva: **ningun error de dinero va aca** |
| `table` | RE-ESTILO |
| `table-skeleton` | RE-ESTILO |
| `tabs` | RE-ESTILO · la barra de cajones es otro componente |
| `textarea` | RE-ESTILO |
| `tooltip` | RE-ESTILO |

## Orden de construccion

No es un plan de proyecto: es la dependencia tecnica. Cada bloque desbloquea al siguiente.

| Orden | Bloque | Que contiene | Desbloquea |
|---|---|---|---|
| **1** | **Tokens y primitivas** | `tokens.css` + los 8 re-estilos de formulario + `interruptor` | Todo |
| **2** | **Estado** | `distintivo de estado`, `inerte con trama`, `procedencia`, `glifo de direccion`, `banderas` | 61 pantallas. **Es la dependencia mas ancha del proyecto** |
| **3** | **Tablas** | `seleccion multiple`, `barra de cajones`, `seleccion tactil`, `barra de seleccion` | P1, P2 y los 7 listados |
| **4** | **Marco** | `nav colapsable`, `nav inferior`, `centro de avisos`, `buscador global` | Todas las del courier |
| **5** | **Dinero** | `tabla financiera`, `bloque de composicion`, `escalera de friccion`, `verificacion previa`, `atribuidor` | Los 5 del bloque 2 y las 4 anulaciones |
| **6** | **App del conductor** | Los 3 temas, `modulo de captura`, `verificacion por escaneo`, sonido y vibracion, push | Las 12 de B5 y P5 |
| **7** | **Sub-sistemas** | Cartografia, graficos, impresos, correos | B1a, B8 y los 16 correos |
| **8** | **Sin sesion y sitio** | `pantalla sin sesion`, `tarjeta de enlace`, el sitio comercial | B7 y las 6 paginas del sitio |

**Restriccion de realidad que ordena todo esto:** se construye sobre un producto en produccion con clientes reales, asi que lo nuevo y lo viejo van a convivir meses. El bloque 1 —tokens sobre Tailwind, extendiendo el tema en vez de reemplazarlo— es lo que hace posible esa convivencia. **Ninguna decision de este catalogo exige que todo cambie el mismo dia.**

---

*100 componentes · 31 re-estilo · 27 extender · 42 de cero.*

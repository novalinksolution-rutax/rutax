# Sistema de diseño de Rutax

> Artefacto importado desde Claude Design (proyecto 184f328b). Se conserva tal cual.
> ⚠️ Publica 15 objetos de dominio; el conteo correcto es 18 — ver RUTAX-REGISTRO-DE-OBJETOS.md v1.1.

**Versión 1.0 · 22 de agosto de 2026**
Documento único de construcción. Escrito para que un equipo lo implemente sin haber estado en las conversaciones que lo produjeron.

Idioma del producto: **español de Chile**. Nombres de token: **inglés**, porque conviven con Tailwind.
Tratamiento: **TÚ** en todo el producto y en los correos. **USTED** solo en la factura electrónica, la liquidación del conductor, los términos y la política de privacidad. La regla que separa: si lo firma la empresa ante un tercero, es usted; si es una conversación con el usuario, es tú. No se mezclan en una misma pieza.

---

## 0. Índice

1. Marca e identidad
2. Tipografía
3. Color y los cuatro temas
4. Espaciado, densidad y retícula
5. Radios y elevación
6. Iconografía
7. Movimiento
8. Catálogo de componentes
9. Sistema de estado del dominio
10. Registro de objetos de dominio
11. Sistema de etiquetas
12. Voz, tono y plantillas de mensaje
13. Sub-sistema: cartografía
14. Sub-sistema: visualización de datos
15. Sub-sistema: sonido y vibración
16. Sub-sistema: impresos
17. Accesibilidad
18. Rendimiento como restricción de diseño
19. Reglas de sistema acumuladas
20. Qué queda abierto

---

## 1. Marca e identidad

### 1.1 La ruta elegida

**Ruta 1a — «las dos líneas que cuadran».**

El símbolo son **dos rectángulos macizos desplazados**: el de arriba desplazado a la izquierda, el de abajo a la derecha, con un solape vertical de un tercio. No es una flecha, no es un camión, no es un pin de mapa.

**Qué idea del negocio representa:** las dos líneas que genera cada entrega —el cobro al seller y la liquidación al conductor— conciliadas entre sí. Leído rápido también funciona como relevo: algo que pasa de una mano a otra.

**Contra cuál de las dos ideas responde:** contra la segunda, **infraestructura financiera**. La primera —instrumento de trabajo— la sostiene el resto del sistema: la densidad, la ausencia de adorno, la tipografía. El símbolo carga el foso, no la herramienta.

**Por qué sobrevive el peor medio:** dos rectángulos macizos a 203 ppp miden 1,3 mm de alto y no pierden una línea. Es la validación que importaba: la etiqueta térmica monocroma no necesita una versión especial del símbolo.

### 1.2 Geometría

Sobre una caja de 24×24:

```
rect A: x=1  y=5  w=15 h=5
rect B: x=8  y=14 w=15 h=5
```

El rectángulo A siempre en el color de primer plano del tema; el B en el acento. En monocromo, los dos en el mismo color.

### 1.3 Versiones y tamaños mínimos

| Versión | Composición | Tamaño mínimo |
|---|---|---|
| **Completa** | Símbolo + logotipo «Rutax» en Chivo 700, tracking −0,032em, alineados por la base del rectángulo B | 96 px de ancho |
| **Reducida** | Símbolo + logotipo, símbolo a 60% de la altura de la caja tipográfica | 64 px de ancho |
| **Solo símbolo** | Los dos rectángulos | 16 px (favicon) · 11 px en impreso |

El espacio libre alrededor es **la altura de un rectángulo** (5 unidades de la caja de 24).

### 1.4 Comportamiento por fondo

- **Fondo claro:** rect A en `#0B1114`, rect B en `#00B89A`.
- **Fondo oscuro:** rect A en `#E9F2F3`, rect B en `#00D6B4`.
- **Monocromo:** los dos rectángulos en el mismo tinte, 100% de cobertura. Sin trama, sin gris. Es la versión de la térmica y del fax.
- **Sobre marca ajena:** en la pantalla de seguimiento público el símbolo va **en un solo tono neutro** (`#4C5F65` claro, `#9EB0B6` oscuro) a 13 px, con el logotipo a 12 px. No compite con la marca del courier.

### 1.5 El «powered by» como pieza

Es el único canal de Rutax hacia consumidores finales, y cada entrega genera una impresión. No es una línea de pie: es un bloque con separador superior, la frase **«Despacho gestionado con»** en 11 px y el par símbolo + logotipo en un solo tono a 12–13 px. Va al pie del seguimiento público, del portal del seller y de los correos dirigidos al seller, al conductor y al comprador.

### 1.6 Aplicaciones críticas

| Aplicación | Tratamiento |
|---|---|
| **Favicon 16 px** | Solo símbolo, dos rectángulos, sin caja. A ese tamaño cada rectángulo mide 3 px de alto: es el límite y funciona. |
| **Ícono de la app del conductor** | Solo símbolo centrado sobre `#0B1114`, con el rectángulo B en `#00D6B4`. Sin nombre: en la pantalla de inicio el nombre lo pone el sistema operativo. |
| **Encabezado del producto** | Versión reducida a 16–19 px de símbolo, a la izquierda, seguida de un separador vertical y el nombre de la pantalla. |
| **Firma de correo** | Versión completa a 96 px cuando Rutax es el remitente; bloque «powered by» cuando el remitente es el courier. |
| **Imagen para compartir** | 1200×630. Nombre del courier a 40 px (o 34 px si hay logo del courier, que entra a la izquierda en un cuadrado de 52 px), Rutax a 13 px arriba a la derecha, y una barra de acento de 96×4 px al pie. |
| **Etiqueta térmica 10×15** | Solo símbolo a 11 px + logotipo a 11 px, al pie, en negro pleno. |

**Regla dura:** el logo del courier es **una mejora opcional, no el supuesto**. Hoy el sistema solo guarda su nombre de fantasía en texto. Ninguna pieza puede verse incompleta sin logo ajeno.

---

## 2. Tipografía

### 2.1 Las dos familias

| Familia | Uso | Pesos |
|---|---|---|
| **Chivo** | Todo el texto de interfaz, títulos, cuerpo, botones, etiquetas | 400 · 500 · 600 · 700 |
| **Azeret Mono** | Toda cifra comparable en columna, códigos, horas, rótulos en caja alta con tracking | 400 · 500 · 600 |

Los cuatro pesos de Chivo y los tres de Azeret Mono **no son negociables**: el 500 sostiene los rótulos y el 600 mono sostiene todas las cifras. Subconjuntar de menos deja negrita sintética justo en una columna de números.

Respaldo: `Chivo, system-ui, sans-serif` y `"Azeret Mono", ui-monospace, monospace`.

### 2.2 La escala

```css
--rx-text-9:    9px;    /* SOLO etiqueta mono en caja alta con tracking .08–.12em:
                           cabecera de tabla, rótulo de bandera. Nunca cuerpo. */
--rx-text-10:   10.5px; /* código secundario, rótulo dentro de distintivo */
--rx-text-11:   11.5px; /* metadato mono, pie de tarjeta */
--rx-text-12:   12.5px; /* cuerpo denso: nota, descripción de columna */
--rx-text-13:   13.5px; /* cuerpo por defecto del backoffice */
--rx-text-14:   14px;   /* cuerpo del portal del seller y de los correos */
--rx-text-15:   15px;   /* cuerpo de la app del conductor */
--rx-text-16:   16px;   /* fila de la app, botón principal */
--rx-text-17:   17px;   /* título de tarjeta */
--rx-text-19:   19px;   /* título de panel */
--rx-text-21:   21px;   /* título de pantalla en móvil */
--rx-text-22:   22px;   /* título de página */
--rx-text-26:   26px;   /* cifra destacada, título de ceremonia */
--rx-text-30:   30px;   /* magnitud de mosaico */
--rx-text-34:   34px;   /* total de documento */
--rx-text-40:   40px;   /* código de envío en etiqueta térmica */
--rx-text-50:   50px;   /* titular del sitio comercial (solo ahí) */
```

**Interlineado:** 1 para cifras aisladas · 1,25 para títulos · 1,45–1,6 para cuerpo · 1,7–1,85 para bloques de composición en mono.
**Tracking:** −0,036em a −0,012em en títulos según tamaño (más grande, más cerrado). 0 en cuerpo. +0,08 a +0,16em en rótulos mono en caja alta.

### 2.3 La escala para números

Este producto muestra montos, cantidades de bultos y horas todo el día, y las cifras se comparan en columna.

- **Toda cifra comparable va en Azeret Mono**, alineada a la derecha, con cifras tabulares.
- **Montos en pesos chilenos: miles con punto, sin decimales.** `$ 812.600`. El signo `$` va separado por un espacio fino y **no se repite en cada fila** de una tabla: va en el rótulo de la columna o en el total.
- **Negativos con signo menos real** (`−8.000`, U+2212), nunca paréntesis, nunca solo color.
- **Jerarquía de cifra en tabla financiera:** celda 12,5px/400 → subtotal 12,5px/600 con fondo tenue → total 18px/600 con regla de 2 px encima → cifra destacada de encabezado 26–34px/600.
- **Fechas:** `21-08` en tabla, `21-08-2026` en documento, «21 de agosto» en prosa y en correos. Horas en 24 h: `16:04`.
- **Porcentajes** con una decimal solo cuando el objetivo la tiene: `96,2%` contra objetivo `97%`.

### 2.4 Escala de texto de la app del conductor

Cuatro pasos: **100 · 115 · 130 · 150%**. Respetan el ajuste del sistema operativo y lo pueden subir. Escalan cuerpo y rótulos; **los objetivos táctiles no bajan nunca de 56 px** y las cifras no se reflotan: en 150% las tarjetas crecen en alto.

---

## 3. Color y los cuatro temas

Paleta **Señal**: un neutro frío levemente verdoso, un solo acento teal, y cinco tonos de estado. Ningún gradiente. Ningún color decorativo.

### 3.1 Tema oscuro (base del producto)

```css
--rx-bg:            #0B1114;
--rx-bg-raised:     #0E1518;
--rx-bg-sunken:     #070C0E;
--rx-bg-inset:      #131C21;
--rx-line-subtle:   #1B272C;
--rx-line:          #2A3A41;
--rx-line-strong:   #E9F2F3;
--rx-fg:            #E9F2F3;  /* 16,7:1 sobre bg */
--rx-fg-muted:      #9EB0B6;  /*  8,5:1 */
--rx-fg-subtle:     #7E9198;  /*  5,3:1 — solo sobre --rx-bg */
--rx-accent:        #00D6B4;
--rx-accent-soft:   #5FE3CB;
--rx-accent-deep:   #04302A;
--rx-accent-line:   #0A5F52;
--rx-on-accent:     #04231E;
--rx-fg-link:       #5FE3CB;
--rx-focus:         #00D6B4;
```

### 3.2 Tema claro (primera clase, no derivado)

```css
--rx-bg:            #F1F6F6;
--rx-bg-raised:     #FFFFFF;
--rx-bg-sunken:     #E6EEEF;
--rx-bg-inset:      #E4EDEE;
--rx-line-subtle:   #DCE7E8;
--rx-line:          #C6D6D8;
--rx-line-strong:   #0B1114;
--rx-fg:            #0B1114;  /* 17,4:1 sobre bg */
--rx-fg-muted:      #4C5F65;  /*  6,2:1 */
--rx-fg-subtle:     #56666B;  /*  5,1:1 */
--rx-accent:        #00B89A;  /* SOLO relleno, borde y glifo */
--rx-accent-text:   #007D69;  /* 4,7:1 — el teal cuando es texto */
--rx-accent-deep:   #DBF8F2;
--rx-accent-line:   #97E8D9;
--rx-on-accent:     #04231E;
--rx-fg-link:       #007D69;
--rx-focus:         #007D69;
```

**Regla dura del acento:** `#00B89A` y `#00D6B4` sirven para fondo, borde y glifo. **Nunca para texto en tema claro** — no cumplen contraste. El teal como texto es siempre `#007D69`.

**Regla dura de los grises:** `--rx-fg-subtle` solo se usa sobre `--rx-bg`. Sobre `bg-raised`, `bg-sunken` o cualquier rampa de mapa baja de 4,5:1, y ahí va `--rx-fg-muted`.

### 3.3 Los seis tonos de estado

Cada tono es un trío: **glifo · texto · fondo · borde**. El glifo es lo que hace que el color no sea el único portador de significado.

| Tono | Significa | Glifo | Oscuro (fg / bg / line) | Claro (fg / bg / line) |
|---|---|---|---|---|
| **balanced** | terminó bien, cuadra | dos barras del símbolo | `#00D6B4` / `#04302A` / `#0A5F52` | `#007D69` / `#DBF8F2` / `#97E8D9` |
| **progress** | en curso, avanzando | triángulo apuntando a la derecha | `#43C9FF` / `#07293A` / `#145273` | `#0075A8` / `#E1F5FF` / `#A9E0FA` |
| **attention** | mira esto, no es error | rombo | `#FFC53D` / `#33260A` / `#66490F` | `#8A5B00` / `#FFF3D6` / `#FFD98A` |
| **fault** | se rompió, hay que actuar | cruz | `#FF6B57` / `#35130F` / `#66271E` | `#C2361F` / `#FFE7E3` / `#FFBCB0` |
| **neutral** | existe, sin juicio | círculo abierto | `#9EB0B6` / `#1A252A` / `#2A3A41` | `#4C5F65` / `#E6EEEF` / `#C9D8DA` |
| **inert** | fuera de juego a propósito | cuadrado tachado + **trama diagonal** | `#7E9198` / trama `#1A252A`–`#131C21` / `#22333A` | `#56666B` / trama `#DCE7E8`–`#E6EEEF` / `#DCE7E8` |

```css
--rx-flag-off: #7E9198; /* oscuro */  /* #56666B en claro — bandera apagada */
```

**El tono `inert` lleva trama diagonal de 3 px además del color.** Es lo que hace que «cancelado», «inactivo» y «suspendido» se distingan de «vacío» en blanco y negro y en un monitor mal calibrado.

**El rojo está reservado.** En la Torre de control, `fault` es exclusivamente la incidencia abierta. Nada decorativo puede usarlo.

### 3.4 Los dos temas de la app del conductor

Este usuario necesita cosas opuestas dentro del mismo turno, y dos paletas no alcanzan. La app tiene **tres temas**: el oscuro base (§3.1) más estos dos.

**`rx-sol`** — a las 16:00, con sol directo sobre la pantalla:

```css
--rx-bg: #FFFFFF;  --rx-fg: #000000;   /* 21:1 */
--rx-line: #000000;
```
Es el único lugar del sistema donde se usan los extremos puros. Bajo sol directo la pantalla pierde ~40% de contraste percibido y el fondo teñido desaparece: **los distintivos van en sólido pleno** —fondo del tono, glifo y texto en negro o blanco puro—, nunca teñidos.

**`rx-noche`** — a las 21:30, en la calle a oscuras:

```css
--rx-bg: #05080A;  --rx-bg-raised: #0A1012;  --rx-bg-inset: #101A1C;
--rx-line-subtle: #16211E;  --rx-line: #22333A;
--rx-fg: #B9C6C4;        /* 11,4:1 — blanco tope, −38% de pico de luminancia */
--rx-fg-muted: #7C8A88;  /*  5,6:1 */
--rx-accent: #3E6B63;    /* teal desaturado, sin rastro en la retina */
```
**Este tema tiene dos niveles de texto, no tres.** El tercer gris no cumple AA sobre `#05080A`, así que no existe. Es más honesto que publicar un valor que no se sostiene.

### 3.5 Cómo se decide el tema en la app

`Automático` es el valor por defecto y combina tres señales, en este orden de autoridad:

1. **La preferencia manual gana siempre**, y por eso caduca: rige **hasta el fin del turno** y después vuelve a automático. Un ajuste que se olvida encendido es peor que no tenerlo.
2. **El sensor de luz manda sobre la hora**, con histéresis: entra a Sol sobre **8.000 lux**, sale bajo **3.000**, y hay un **mínimo de 90 s** de permanencia antes de poder cambiar. Eso resuelve el subterráneo a las 17:00: baja la luz, el tema pasa a Día —no a Noche, porque la hora dice que es tarde— y al salir vuelve a Sol, sin parpadeo.
3. **La hora fija el borde inferior:** después del atardecer de Santiago —calculado, no fijado en una hora— el techo es Noche aunque el sensor vea una luminaria.

El cruce dura 200 ms con `ease-standard`. Con movimiento reducido el cruce es inmediato y se anuncia con la etiqueta del tema en la barra superior. La barra de estado del sistema sigue al tema, y el color de fondo se declara al sistema operativo para que el rebote de scroll no aparezca blanco a las 21:30.

**Los tres temas comparten la misma disposición, los mismos glifos y las mismas posiciones.** Lo único que cambia son los valores de color y el pico de luminancia.

### 3.6 Qué recursos dependen del tema

Fuera de los tokens, solo estos, y hay que declararlos pieza por pieza:

- La **trama diagonal** del tono `inert` y del bloque bancario.
- El **rayado** de la fila inactiva.
- El **fondo de la fila programada** (`progress-bg`).
- El **riel** de las barras de progreso y consumo (`line-subtle`).
- Las **tarjetas de paso del asistente** (`bg-raised` + borde de tono).
- El **distintivo de estado**: en claro necesita fondo teñido, en oscuro se sostiene con el borde.

**Ninguna columna, ancho, orden ni disposición cambia entre temas en ninguna pantalla del producto.** Si una decisión de disposición solo funciona en uno, está mal resuelta.

### 3.7 La única excepción

El **banner de sesión suplantada** del backstage conserva `#C2361F` con texto blanco en los dos temas. Es el único elemento del sistema que no cambia entre temas, y es a propósito: si el equipo trabaja de noche y el banner se atenuara, dejaría de gritar justo cuando más cansado está quien lo mira.

---

## 4. Espaciado, densidad y retícula

### 4.1 Escala de espaciado

Base 4, con pasos impares donde el ritmo óptico lo pide:

```
3 · 5 · 7 · 9 · 11 · 14 · 18 · 22 · 26 · 34 · 44 · 52
```

Uso: 5–7 entre elementos de una misma línea · 9–11 dentro de un control · 14–18 entre bloques hermanos · 22–26 entre secciones de un panel · 34–52 en padding de página.

**Todo grupo de hermanos se dispone con flex o grid y `gap`.** Nunca con márgenes por elemento ni espacios en el marcado: el `gap` sobrevive a reordenar, borrar y duplicar.

### 4.2 Densidad por superficie

| Superficie | Alto de fila | Cuerpo | Objetivo táctil | Por qué |
|---|---|---|---|---|
| **Backstage de Rutax** | 32 px | 11,5 px | — | Uso interno; quien mira compara empresas entre sí. La única superficie donde la densidad gana a la comodidad. |
| **Backoffice · escritorio** | 40–44 px | 13,5 px | 32 px | Tablas de mil filas, diez horas de monitor. |
| **Backoffice · táctil** | 56 px | 13,5 px | **56 px** | La misma tabla de pie en la bodega. La densidad la decide el puntero, no el ancho. |
| **Portal del seller** | 52 px | 14 px | 48 px | Visitas cortas desde el teléfono, entre otras cosas. |
| **App del conductor** | 60–70 px | 15–16 px | **56 px mínimo** | Una mano, sol directo, a veces con guantes. |
| **Sitio comercial** | — | 14–16 px | 48 px | Lectura, no operación. |

**Regla de superficie:** el portal del seller **no gana densidad al crecer el ancho: gana aire**. Ninguna de sus pantallas agrega columnas en escritorio. Es la diferencia de contexto con el backoffice.

### 4.3 Los tres tamaños del backoffice y la regla que los une

Escritorio **1440**, tablet **1024**, teléfono **390**.

Las columnas caen **en orden inverso a la jerarquía canónica del objeto** y reaparecen bajo el identificador, en mono, cuando el ancho no alcanza. **Destinatario y código de envío nunca caen.** En 390 la fila se convierte en ficha de tres líneas. El teléfono no es una reducción: es donde el coordinador trabaja de pie en la bodega.

### 4.4 Marco de la aplicación

- **Escritorio:** navegación lateral colapsable (212 px abierta, 56 px colapsada).
- **Tablet:** lateral oculta tras botón.
- **Teléfono:** barra inferior de **cuatro destinos derivados del rol**. Los del coordinador no son los de Administración.
- **Configuración:** navegación anidada que **reemplaza** la principal, con retorno explícito arriba. Entrar en configuración es un modo, no una página.

---

## 5. Radios y elevación

### 5.1 Radios

```css
--rx-radius-badge:  2px;   /* distintivo de estado, etiqueta */
--rx-radius-ctrl:   3px;   /* botón, campo, tarjeta, panel, modal */
--rx-radius-pill:   999px; /* interruptor, punto de mapa, contador circular */
--rx-radius-flat:   0;     /* tabla, fila, encabezado, sección de página */
```

Cuatro valores y ninguno más. Las tablas y las secciones de página van a 0: un producto de trabajo con esquinas redondeadas en todas partes pierde la retícula.

### 5.2 Elevación

**No hay sombras.** La jerarquía se construye con tres recursos:

1. **Escalón de fondo** — `bg-sunken` → `bg` → `bg-raised`.
2. **Borde** — `line-subtle` para separar hermanos, `line` para delimitar contenedores, 2 px del tono para marcar pertenencia.
3. **Regla de acento de 2 px** en el borde superior de un bloque, que es el único subrayado del sistema.

**La única excepción:** el modal, que lleva un velo de `rgba(7,12,14,.72)` detrás. No una sombra: un velo.

---

## 6. Iconografía

### 6.1 La familia

**Glifos geométricos propios**, dibujados sobre una caja de 12×12 y usados a 8 · 10 · 11 · 12 · 14 · 16 · 19 px. Dos construcciones: **macizo** (el glifo de estado, el símbolo de marca) y **trazo de 1,6–2 px** (contorno, círculo abierto, cuadrado tachado).

No se usa una familia de íconos de terceros. La razón es de sistema: los seis glifos de estado tienen que ser distinguibles a 8 px en una tabla densa y a 34 px en un acuse de escaneo, y ninguna familia general cumple las dos cosas con la misma forma.

**Nunca se dibujan ilustraciones ni íconos figurativos.** Cero camiones, cero cajas, cero repartidores.

### 6.2 Cuándo un ícono va solo y cuándo necesita etiqueta

| Contexto | Regla |
|---|---|
| Fila de tabla densa | Ícono solo, **si el mismo ícono aparece en la leyenda de la columna o en la cabecera**. |
| Distintivo de estado | **Siempre ícono + etiqueta.** El color nunca es el único portador; el glifo tampoco. |
| Acción de dinero | **Siempre etiqueta, con el verbo y el monto.** Un ícono sin etiqueta en una acción de dinero es una ambigüedad que cuesta plata. |
| Barra de herramientas de escritorio | Ícono solo con tooltip, si la acción es reversible. |
| Acción táctil | **Siempre etiqueta.** No hay hover que rescate al que no entendió. |
| Navegación inferior móvil | Ícono + etiqueta, siempre. |
| App del conductor | Etiqueta siempre, salvo el acuse de escaneo, que es glifo grande a propósito para leerse de reojo. |

### 6.3 Estados vacíos

**Ícono del sistema y texto. Sin ilustración: está decidido.** Un dibujo genérico es lo que más rápido hace que un producto de trabajo se vea como plantilla, y en una herramienta de diez horas al día los dibujos cansan antes que el texto.

Los más de 40 estados vacíos se agrupan en **tres tonos que significan cosas opuestas** y se distinguen por color, glifo y redacción:

| Tono | Glifo | Habla en | Cierra con |
|---|---|---|---|
| **Arranque** | círculo abierto, `neutral` | futuro: «van a aparecer» | la acción que lo llena |
| **Buena noticia** | dos barras del símbolo, `balanced` | presente afirmativo | **una cifra y la hora de la última revisión** |
| **Filtro sin resultados** | cuadrado tachado, `inert` | presente, nombrando el filtro | «Limpiar los filtros» y cuántos hay afuera |

**El de buena noticia siempre trae un número.** «Sin incidencias» solo no se lee como tranquilidad; «Las 34 entregas de hoy van sin problemas · última revisión 16:04» sí. Un número es lo que convierte «no hay nada» en «revisamos y está bien».

**Molde:** titular de **4 palabras máximo**, cuerpo de **24 máximo**. Lo fija el vacío de filtro en 390 px, que es el más largo del sistema.

---

## 7. Movimiento

**La postura: movimiento funcional, más una firma de marca acotada a cuatro momentos.** Se anima lo que comunica algo —un cambio de estado, una relación causa-efecto, un progreso real—. Nada decorativo. En una tabla de mil filas cualquier animación es un impuesto que paga alguien que lleva diez horas ahí.

### 7.1 Tokens

```css
--rx-dur-instant: 90ms;   /* acuse de toque, cambio de casilla */
--rx-dur-quick:   120ms;  /* hover, foco, aparición de tooltip */
--rx-dur-base:    200ms;  /* cambio de estado en sitio, cruce de tema */
--rx-dur-panel:   240ms;  /* apertura de panel lateral, pulso de confirmación */
--rx-dur-grave:   320ms;  /* ceremonia irreversible */

--rx-ease-standard: cubic-bezier(.2, 0, .3, 1);   /* casi todo */
--rx-ease-entrada:  cubic-bezier(.16, 1, .3, 1);  /* algo que llega y se queda */
--rx-ease-salida:   cubic-bezier(.4, 0, 1, 1);    /* algo que se va */
--rx-ease-gravedad: cubic-bezier(.34, 0, .2, 1);  /* peldaño 3, sin rebote */
```

**Ninguna curva tiene rebote.** Un rebote en una confirmación de dinero es una falta de respeto al momento.

### 7.2 Qué se anima y qué no

**Se anima:** el cambio de estado de una fila que ya está en pantalla · la apertura y el cierre de un panel o modal · un progreso real con paso nombrado · la aparición de un resultado que el usuario provocó · la confirmación de algo que estaba pendiente.

**No se anima:** la entrada de filas nuevas en una tabla (se anuncian, no se insertan) · el reordenamiento de una lista bajo el dedo · nada durante un desplazamiento · el contenido de una celda al recalcularse · ninguna cifra que sea la prueba de algo.

### 7.3 Los cuatro momentos de firma, encadenados en un día

**Un día del courier, de punta a punta:**

**15:50 · El resultado de la asignación en bloque.** El coordinador asigna 30 pedidos a un conductor. Las filas seleccionadas no desaparecen una por una: la selección se **contrae hacia una tarjeta de resultado** que crece desde la barra de selección, 240 ms, `ease-entrada`. La tarjeta trae el conteo, la composición —«30 asignados · 24 paradas · 2 comunas»— y el detalle de lo que no se pudo. Es el momento de más alivio del día y hoy termina en una lista seca.

**16:05 · La apertura del panel de detalle.** El gesto más repetido del producto. El panel entra desde el borde derecho en 240 ms con `ease-entrada`, y **el contenido no se desliza con él**: aparece cuando el panel ya llegó, con un desfase de 60 ms en el bloque de encabezado. Presupuesto mínimo, carácter máximo: lo único que da carácter es que el encabezado llegue un instante después, como si el panel se abriera y luego se llenara.

**18:40 · El cierre de una parada en la app.** La única recompensa del conductor en un turno de treinta paradas. El botón se convierte en el estado: el rótulo cruza a «Entregado» en 200 ms, la tarjeta de la parada recibe un **pulso de acento de 240 ms** que va del borde al centro, y el contador del día sube con un cambio de cifra —no un contador rodando—. Total: 440 ms. Vale los milisegundos de batería que cuesta porque es lo único del turno que celebra algo.

**23:10 · La confirmación irreversible.** Acá el movimiento sirve a la gravedad, no al deleite. El modal entra en **320 ms con `ease-gravedad`**, sin escala y sin rebote, solo opacidad y 8 px de desplazamiento vertical. El velo oscurece en 200 ms. **El paso atrás se cierra:** escape y clic fuera no hacen nada, y el botón de confirmar permanece deshabilitado hasta que el acto explícito esté completo. Al confirmar, el modal **no se cierra: se convierte en comprobante** —el mismo contenedor, otro contenido, cruce de 200 ms— con el folio consumido a la vista. Es el gesto que dice «ya ocurrió y no hay vuelta».

### 7.4 Equivalencia entre web y app nativa

| Decisión | Web | App nativa |
|---|---|---|
| Cambio de estado en sitio | `transition` de 200 ms sobre color y fondo | animación de propiedad de 200 ms, misma curva |
| Panel de detalle | `transform: translateX` + opacidad, 240 ms | presentación modal por hoja, 240 ms, sin efecto de arrastre del sistema |
| Pulso de confirmación | `@keyframes` de opacidad sobre un pseudo-elemento | animación de capa, sin re-dibujo de la vista |
| Ceremonia irreversible | 320 ms, velo `rgba(7,12,14,.72)` | 320 ms, mismo velo, **con el gesto de descarte del sistema desactivado** |
| Curvas | los cuatro `cubic-bezier` de §7.1 | los mismos cuatro, declarados como curvas de tiempo propias, no las del sistema |

**La regla:** se traduce la **duración y la curva**, no la técnica. Si la plataforma tiene una animación propia que dura otra cosa, se desactiva y se usa la nuestra.

### 7.5 Presupuesto de la app del conductor

El movimiento compite ahí contra la batería, que no le llega al final del turno. **Va solo esto:**

- Progreso con paso nombrado: «obteniendo ubicación», «subiendo fotos», «registrando».
- El momento en que un envío pendiente por fin se confirma: pulso verde de 240 ms.
- El cierre de parada (§7.3).
- **Gestos con respuesta al dedo**, con seguro contra el guante: deslizar una parada exige recorrer **el 45% del ancho** y suelta con vibración; tirar para actualizar exige 72 px.

Nada más. Ni transiciones entre pantallas, ni animación de lista, ni esqueletos animados: el esqueleto de la app es estático.

### 7.6 Con «reducir movimiento» activado

No se apaga: **se sustituye el movimiento por otra señal.**

| En vez de | Va |
|---|---|
| Contracción de la selección hacia la tarjeta | La tarjeta aparece de inmediato, con un borde de 2 px que la señala |
| Deslizamiento del panel | El panel aparece de inmediato; el foco salta a su encabezado |
| Pulso de confirmación | Cambio de fondo permanente por 3 s + anuncio para lector de pantalla |
| Cambio de tema con cruce | Cambio inmediato + etiqueta del tema en la barra superior |
| Ceremonia de 320 ms | Aparición inmediata, y el botón de confirmar espera 600 ms antes de habilitarse — la pausa la pone el sistema, no la animación |
| Las cuatro animaciones del sitio | Sus versiones estáticas diseñadas (§20 del sitio) |

---

## 8. Catálogo de componentes

**92 componentes.** El costo declarado es contra la base real: Next.js, Tailwind y shadcn/ui, con 30 componentes en uso.

Leyenda: **RE** = se logra re-estilando uno existente · **EXT** = extender uno existente con variantes o estados nuevos · **CERO** = construir desde cero.

### 8.1 Controles y formulario

| Componente | Variantes y estados | Costo |
|---|---|---|
| `botón` | primario · secundario · terciario · peligro · peligro-grave · fantasma; reposo, hover, foco visible, activo, deshabilitado con motivo, cargando, con conteo, **con monto en segunda línea** | RE |
| `campo de texto` | los nueve estados; con prefijo, con sufijo, con ayuda, con contador | RE |
| `área de texto` | los nueve; con mínimo de caracteres declarado | RE |
| `campo de moneda chilena` | miles con punto en vivo, sin decimales, prefijo `$` fijo, alineado a la derecha, mono | EXT |
| `campo numérico` | con paso, con unidad, con mínimo y máximo declarados | EXT |
| `selector` | los nueve; con búsqueda; con grupos | RE |
| `selector múltiple` | con conteo, con «seleccionar todo», con límite y su aviso | EXT |
| `casilla` | los nueve; indeterminada; **28 px con 56 de área táctil** en la app | RE |
| `interruptor` | los nueve; con etiqueta de consecuencia | RE |
| `selector de fecha` | **día exacto · rango con calendario · atajos rápidos, los tres en un mismo control**; con rango inválido | CERO |
| `campo de búsqueda` | los nueve; con conteo de resultados; con limpiar | RE |
| `campo de archivo` | los nueve; con tipo declarado y su advertencia | EXT |
| `grupo de chips de selección` | pick-any; con límite | EXT |
| `credencial de una sola vez` | mostrada · copiada · advertencia previa | CERO |

### 8.2 Datos y tabla

| Componente | Variantes y estados | Costo |
|---|---|---|
| `tabla` | densidades 32 / 40 / 56; ordenamiento; columnas fijas; los nueve estados | EXT |
| `tabla con selección múltiple` | selección por casilla, por rango con teclado, **y los tres niveles táctiles** | EXT |
| `selección táctil en tres niveles` | toque en fila · toque en cabecera de grupo · barrido vertical sobre la columna de casillas | CERO |
| `barra de selección persistente` | conteo · **composición de lo seleccionado** · acciones · congelamiento del refresco | CERO |
| `ficha de fila 390` | tres líneas; con distintivo; con acción táctil | CERO |
| `esqueleto de tabla` | con el alto de fila real, pulso de opacidad, **sin brillo que barre** | RE |
| `paginación` | numérica · «cargar más» · con truncamiento declarado | RE |
| `barra de cajones con excluido` | contadores sobre el conjunto filtrado, separador, cajón excluido en `inert` con el total real | CERO |
| `barra de chips de filtro con URL visible` | aplicado sólido / disponible punteado; URL pegable | CERO |
| `franja de cambios pendientes` | conteo acumulado; dos largos (390 y escritorio) | CERO |
| `marcador de fila actualizada` | 8 s, pulso de borde | CERO |
| `tabla financiera` | agrupada por concepto con subtotal; total con regla de 2 px; negativo con causa en la fila; variante impresa | CERO |
| `bloque de composición` | la resta a la vista, en mono | CERO |
| `fila vigente / programada` | vigente · programada en `progress` con su fecha · inactiva con trama y reactivación | CERO |
| `atribuidor de pago` | movimientos ↔ períodos; calce exacto, parcial, excedente, descartado | CERO |
| `verificación por escaneo` | escaneados / pendientes / te quedan; **registro de escaneo** con repetido marcado; cierre con faltantes | CERO |
| `mosaico de magnitudes` | 2 a 8 tarjetas; con delta; teñida por estado; reducida a 2 para el portal | EXT |
| `indicador de folio disponible` | normal · pocos · agotados | CERO |
| `gráfico` | los 5 permitidos de §14; cargando, sin datos suficientes, rango ilegible | EXT |

### 8.3 Estado y retroalimentación

| Componente | Variantes y estados | Costo |
|---|---|---|
| `distintivo de estado` | los 6 tonos × (con glifo, con glifo y etiqueta, solo glifo con leyenda); densidades 10,5 / 12 / 13,5 | EXT |
| `etiqueta` | neutra · con borde · con trama; removible | RE |
| `bandera` | encendida · apagada (`--rx-flag-off`); pares COBRO/LIQ y FACT/PAGO | CERO |
| `aviso embebido` | los 6 tonos; con acción, con dos acciones, sin acción; **persistente** para todo error de dinero | RE |
| `notificación temporal` | éxito · atención · falla de red; con deshacer; **prohibida para errores de dinero** | RE |
| `barra de progreso` | determinada · indeterminada · **con paso nombrado**; riel `line-subtle` | RE |
| `esqueleto` | bloque · línea · fila · tarjeta; estático en la app | RE |
| `estado vacío` | los 3 tonos; **con cifra y hora de última revisión en el de buena noticia** | EXT |
| `lectura fallida en línea` | conserva el último valor conocido y su hora; nunca pone 0 | CERO |
| `sin permiso, con salida` | dice qué falta y a quién pedírselo | CERO |
| `bloque registrado sin confirmar` | reintentando · confirmado · advertencia de cierre de app | CERO |
| `acuse de escaneo` | correcto · repetido · no corresponde; sólido pleno en tema Sol | CERO |
| `indicador de modo de pruebas` | distintivo permanente con trama | CERO |
| `centro de avisos` | lista, no leído, agrupado por día | CERO |

### 8.4 Contenedores y navegación

| Componente | Variantes y estados | Costo |
|---|---|---|
| `tarjeta` | plana · elevada por fondo · teñida por estado · con regla de acento | RE |
| `panel lateral` | 380 / 430 / 520 px; con pie fijo; **con zona de consecuencia** | RE |
| `página de detalle` | encabezado canónico · cuerpo · zona de consecuencia al pie | EXT |
| `modal` | informativo · confirmación · **acto explícito** (no se cierra por accidente) · comprobante | EXT |
| `modal de acto explícito` | escribir nombre · escribir monto · escribir palabra clave; con 2FA | CERO |
| `verificación previa` | sin hallazgos · con hallazgos · bloqueante sin salida | CERO |
| `menú desplegable` | con grupos, con destructiva separada, con deshabilitada y motivo | RE |
| `popover` | informativo · de ayuda contextual · de filtro | RE |
| `pestañas` | horizontales · con conteo · desbordadas con desplazamiento | RE |
| `migas y retorno` | migas en escritorio · retorno explícito en móvil y en configuración | RE |
| `navegación lateral colapsable` | abierta 212 / colapsada 56; con grupos; **anidada de configuración** | RE |
| `navegación inferior móvil` | 4 destinos **derivados del rol** | CERO |
| `hoja inferior` | media · completa; con arrastre; con pie fijo | RE |
| `asistente por pasos` | 5 pasos × 4 estados; dependencia declarada; guardado automático; **pantalla de cierre obligatoria** | CERO |
| `pantalla de cierre de asistente` | resumen de los cinco pasos + tres primeros trabajos reales | CERO |
| `formulario de configuración` | secciones con guardado explícito; vigente contra nuevo; desactivar con vuelta | CERO |
| `formulario de alta con aviso en línea` | el aviso pegado al campo que lo provoca | EXT |
| `pantalla sin sesión` | marca Rutax · marca del courier · neutra | CERO |
| `sesión suplantada` | puerta con motivo · **banner en el marco** · salida y vencimiento | CERO |
| `bloque de capacidades` | pierde / gana / sigue sin tener | CERO |
| `bloque de trazabilidad` | autor, fecha, motivo; por fila y por objeto | CERO |
| `bloque de bitácora del objeto` | lista cronológica, solo lectura | CERO |
| `hoja de consentimiento` | 3 pasos; casilla nunca premarcada; texto versionado | CERO |
| `módulo de captura` | cámara directa · adjuntar de galería con selección múltiple · fotos tomadas con eliminar · límite declarado | CERO |
| `tarjeta de salud de conexión` | sana · vence pronto · caída (3 causas indistinguibles) · fila para backstage | CERO |
| `bloque de falla externa` | qué se rompió sin poder decir qué, y qué hacer igual | CERO |
| `tarjeta de resultado en bloque` | qué se hizo, qué no y por qué | CERO |
| `selector de tema de tres estados` | Sol · Día · Noche · Automático | CERO |
| `escala de texto de cuatro pasos` | 100 / 115 / 130 / 150% | CERO |
| `tarjeta de enlace compartido` | con logo del courier y sin él | CERO |

### 8.5 Resumen de costo

| Costo | Cantidad |
|---|---|
| **RE** — re-estilar uno existente | 24 |
| **EXT** — extender con variantes o estados nuevos | 21 |
| **CERO** — construir desde cero | 47 |

Los 47 de cero se concentran en tres frentes: **dinero** (tabla financiera, composición, atribuidor, folios), **la app del conductor** (captura, escaneo, temas, consentimiento) y **los patrones de sistema** (asistente, formulario de configuración, sesión suplantada, acto explícito).

---

## 9. Sistema de estado del dominio

29 vocabularios, ~147 valores. La enumeración completa vive en el tablero `Rutax Estados.dc.html`; acá va la **gramática que los gobierna**, que es lo que permite resolver un valor nuevo sin preguntar.

### 9.1 La gramática

**Un valor de estado = un tono (§3.3) + un glifo + una etiqueta en el idioma del usuario.** Nada más. No hay colores por vocabulario: hay seis tonos y todos los vocabularios los comparten. Eso es lo que hace que un supervisor que entra por un aviso entienda una pantalla que nunca vio.

La asignación de tono responde a **una sola pregunta: ¿qué tiene que hacer quien lo ve?**

| Si… | Tono |
|---|---|
| Terminó y cuadra | `balanced` |
| Está avanzando por sí solo | `progress` |
| Va a necesitar una decisión, pero no ahora | `attention` |
| Necesita una acción ahora y alguien pierde algo si no | `fault` |
| Existe y no pide nada | `neutral` |
| Está fuera de juego a propósito | `inert` |

### 9.2 Ejes independientes en una misma fila

Un pedido tiene a la vez **cuatro estados que son cuatro preguntas distintas** y no se pueden mezclar en un mismo indicador:

| Eje | Pregunta | Dónde va |
|---|---|---|
| **Ciclo** | ¿dónde está el paquete? | Distintivo con glifo y etiqueta, primera columna |
| **Situación de retiro** | ¿lo retiramos? | Etiqueta de texto en la columna de origen |
| **Estado de dirección** | ¿sabemos dónde va? | **Glifo solo**, delante del destinatario, con leyenda en la cabecera |
| **Procedencia** | ¿de dónde entró? | Etiqueta mono en caja alta, con borde, sin color |

**Regla:** un solo eje puede usar distintivo con color. Los otros usan glifo, etiqueta de texto o posición. Cuatro distintivos de color en una fila no se leen.

### 9.3 Los casos difíciles, resueltos

**«Aceptado con observaciones» del SII.** No es éxito ni error y no puede leerse como ninguno de los dos. Va en `attention` con el glifo de rombo y **etiqueta de dos partes**: «Aceptada · con observaciones». El cuerpo dice lo único que importa: *es válida, se puede cobrar, y hay algo que conviene corregir para la próxima*. Nunca en `fault`: una factura válida en rojo hace que Administración la reemita y consuma otro folio.

**Las tres situaciones de retiro.** Ninguna es una alarma: que un paquete no se retire es el desenlace normal de la mitad de los casos.
- *Retirado* → `neutral`, no `balanced`. Es lo esperado, no un logro.
- *No retirado* → `neutral` con etiqueta explícita. **No es falla.**
- *Retiro parcial* → `attention`, porque hay una diferencia que alguien tiene que mirar.

**Los tres vacíos de buen estado** —sin incidencias, todo cuadra, sin diferencias— son `balanced` con cifra y hora (§6.3). Hoy se ven igual que un error y son lo contrario.

**El rojo de la Torre.** `fault` está reservado a la incidencia abierta, que es lo único accionable de esa pantalla. Nada más en ese mapa puede usarlo: ni la carga alta de una comuna, ni un conductor detenido, ni un punto seleccionado.

### 9.4 El color nunca es el único portador

En todo distintivo: **tono + glifo + etiqueta**. En toda fila: el eje principal con color, los demás sin. En el mapa: color + forma + tamaño. En un gráfico: color + patrón + rótulo directo. En impreso: peso + regla + trama.

---

## 10. Registro de objetos de dominio

**18 objetos.** El registro `RUTAX-REGISTRO-DE-OBJETOS.md` v1.1 corrige la cuenta: `suscripción y plan`, `conexión de fuente` y `movimiento bancario` estaban tratados como campos de otro objeto y tienen canónica, vocabulario y estados propios. La tabla de abajo lista los 15 originales; los tres agregados están en el registro con el mismo detalle. Para cada uno: **una representación canónica, variantes por densidad derivadas de ella, variantes por rol, y un vocabulario único**. Ningún bloque de trabajo puede redefinir un objeto: se derivan variantes y se declaran.

### 10.1 La canónica

**Orden y jerarquía de identificación, una sola definición por objeto:**

| Objeto | Canónica (en orden) |
|---|---|
| **pedido** | destinatario · código de envío · comuna · estado de ciclo · seller · fecha de compromiso · procedencia |
| **bulto** | código de bulto · n.º de N · pedido al que pertenece |
| **manifiesto** | conductor · fecha · n.º de paradas · estado |
| **parada** | n.º de parada · dirección · comuna · n.º de bultos · estado |
| **retiro** | bodega · seller · fecha · escaneados de pendientes · estado |
| **seller** | nombre de fantasía · RUT · estado de conexión |
| **conductor** | nombre · RUT · relación (dependiente / independiente) · disponibilidad |
| **courier** | razón social · RUT · plan |
| **bodega** | nombre · dirección · comuna · dueño (courier o seller) |
| **zona** | nombre · n.º de comunas · activa |
| **período de cobro** | seller · período · estado · total neto · folio si existe |
| **liquidación** | conductor · período · estado · neto a pagar |
| **línea de dinero** | concepto · cantidad · unitario · monto · signo |
| **excepción** | categoría · tipo · diferencia · estado · vencimiento · asignado a |
| **usuario y rol** | nombre · correo · rol · estado |

### 10.2 Variantes por densidad

Todas derivadas de la canónica, quitando de atrás hacia adelante:

| Densidad | Qué conserva |
|---|---|
| **fila de tabla** | la canónica completa, una columna por campo |
| **tarjeta** | los primeros 4 campos + estado |
| **encabezado de detalle** | los 2 primeros en grande + el resto como metadato mono |
| **punto en mapa** | **solo el código de envío** (regla legal) + estado por color y forma |
| **línea de correo** | los 2 primeros + estado en palabras |
| **elemento de lista en móvil** | 3 líneas: identificador, contexto, estado |
| **línea impresa** | los 2 primeros + lo que la pieza necesite; **nunca montos en la etiqueta** |
| **vitrina** (sitio comercial) | datos de demostración, **nunca reales**; sin dirección ni teléfono aunque sea una maqueta |

### 10.3 Variantes por rol y reglas de privacidad duras

| Objeto | Coordinador / Supervisor | Administración | Seller | Conductor | Comprador final | Backstage |
|---|---|---|---|---|---|---|
| **pedido** | todo | todo + dinero | sin conductor, sin tarifa, **sin lo que se paga al conductor**; con dirección | dirección y teléfono de su parada | **solo código, comuna, estado y ventana** | todo + empresa |
| **liquidación** | no la ve | todo | no la ve | solo la suya, con motivos completos | — | todo + empresa |
| **período** | no lo ve | todo | el suyo, mismas líneas y mismo neto | — | — | todo + empresa |
| **conductor** | nombre y disponibilidad | + datos bancarios | **nunca** | el suyo | **nunca** | todo |
| **punto de entrega en mapa** | **solo código de envío** | — | — | — | — | solo código |

**Reglas legales, sin excepción:**
1. En el mapa de la Torre se muestra el **código de envío**, nunca la dirección ni el nombre del destinatario.
2. Del conductor solo existe **su última posición**. No hay recorrido histórico y no se puede dibujar uno.
3. En el seguimiento público **no va el nombre de quien recibió**. La fórmula es «Lo recibió alguien en el domicilio».
4. El **punto de término** del conductor es dato personal bajo la Ley 21.431: consentimiento en tres pasos, versionado, revocable.

---

## 11. Sistema de etiquetas

Un concepto, un nombre, igual en las cinco superficies. La única excepción declarada está al final.

| Concepto | Nombre en la interfaz | Nunca |
|---|---|---|
| Envío que un seller manda a un comprador | **pedido** | orden, envío, shipment, guía |
| Hoja de ruta de un conductor en un día | **manifiesto** | hoja de ruta, planilla, viaje |
| Visita a una dirección en una ruta | **parada** | punto, destino, visita |
| Ir a buscar bultos a la bodega de un seller | **retiro** | recolección, pickup, collect |
| Unidad física con su código | **bulto** | paquete, ítem, unidad |
| Cliente del courier que vende | **seller** | vendedor, cliente, tienda |
| Quien reparte | **conductor** | repartidor, driver, chofer |
| Mes de facturación de un seller | **período** | ciclo, mes, corte |
| Lo que se le cobra al seller por una entrega | **línea de cobro** | cargo, venta, factura |
| Lo que se le paga al conductor por una entrega | **línea de liquidación** | pago, honorario, comisión |
| Calce entre entregas, cobros y pagos | **conciliación** | cuadratura, matching |
| Caso de dinero que no cuadra | **excepción** | diferencia (es su campo, no su nombre), problema |
| Número autorizado por el SII | **folio** | número, correlativo |
| Hora hasta la que se reciben pedidos del día | **ventana de corte** | cutoff, hora límite, SLA |
| Agrupación de comunas para tarificar | **zona** | sector, área, región |
| Unidad territorial de Santiago | **comuna** | ciudad, distrito, barrio |
| Lugar desde donde sale la flota | **bodega** | centro, depósito, almacén |
| Dirección donde el conductor termina su jornada | **punto de término** | casa, destino final, home |
| De dónde entró el pedido | **fuente** (y su valor: Flex, Shopify, same-day) | canal, integración, origen del sistema |

**La única excepción, declarada:** el **portal del seller** puede usar otra etiqueta visible para un mismo valor de estado —«En camino» en vez de «En ruta», «Nadie recibió» en vez de «No entregado», «Andes Express la está viendo» en vez de «En gestión»— siempre que conserve tono y glifo. Es la única superficie con este permiso, porque su lector no sabe de logística y no tiene por qué.

En el **seguimiento público** el estado es una **traducción** con la misma regla: mismo tono, mismo glifo, otra redacción, y nunca el motivo de una falla.

---

## 12. Voz, tono y plantillas de mensaje

### 12.1 La voz

**Un compañero de trabajo competente que no te hace perder tiempo.** Dice qué pasó, qué significa y qué hacer. No celebra, no se disculpa de más, no explica su propia arquitectura.

Cuatro rasgos: **directo** (sujeto, verbo, objeto) · **específico** (números y nombres antes que adjetivos) · **honesto** (dice lo que no sabe y lo que no puede) · **respetuoso del oficio** (usa las palabras del dominio, no las traduce a jerga de software).

### 12.2 El tono por contexto

| Contexto | Tono |
|---|---|
| Operación normal | Neutro y breve. Una línea. |
| Confirmación irreversible | Grave y descriptivo. Nunca «¿estás seguro?»: describe la consecuencia. |
| Error nuestro | Se asume sin dramatizar: «fue un problema nuestro, no tuyo». |
| Error del usuario | **Nunca lo culpa.** Dice qué falta, no qué hizo mal. |
| Buena noticia | Afirmativa y con cifra. No festeja. |
| App del conductor | Más corto todavía, con el número primero. Se lee de reojo. |
| Portal del seller | Cero jerga. Explica lo que un no logístico no sabe. |
| Comprador final | Una frase, sin detalle interno. |
| Documentos tributarios y legales | **USTED**, formal, con plazos. |

### 12.3 Reglas duras de redacción

- **Títulos y botones en mayúscula solo inicial.** «Emitir la factura», no «Emitir La Factura» ni «EMITIR».
- **Las acciones se nombran con el verbo y el objeto:** «Anular el cobro», no «Anular». El botón que confirma dice lo que hace; **cuando hay dinero, lo dice con el monto**.
- **El botón que cancela dice «Volver»**, nunca «Cancelar»: en este dominio cancelar es cancelar un pedido. Cuando hay una salida mejor, esa es el rótulo: «Revisar los 3 problemas», «Seguir escaneando».
- **Cifras y fechas:** §2.3.
- **Jerga que se conserva** porque el usuario la usa: folio, manifiesto, bulto, seller, comuna, boleta de honorarios, SII.
- **Jerga que se traduce** porque solo la usa el sistema: *token* → credencial · *webhook* → aviso automático · *geocodificar* → ubicar la dirección · *sync* → sincronizar · *timeout* → no respondió · *payload*, *endpoint*, *retry* → no aparecen nunca.
- **Nunca:** decir solo «error» · culpar a quien lo usa · mostrar códigos, nombres de tabla o mensajes crudos de un proveedor externo · signos de exclamación en la interfaz.

### 12.4 Las ocho plantillas

Claves: `módulo.acción.tipo`. El contenido completo —25+ confirmaciones, 142 éxitos, 53 errores, 44 vacíos, 12 advertencias, 8 ayudas, 3 push, 16 correos— vive en `Rutax Mensajes.dc.html`.

**1 · Éxito.** *Verbo en pasado + objeto nombrado + consecuencia cuando existe.* Una línea, 40–70 caracteres; los de dinero hasta 90 y **siempre con monto y contraparte**.
> «30 pedidos asignados a C. Vera · 24 paradas en su ruta»
> «Transferiste $ 323.400 a Carlos Vera · Banco de Chile ···4821»
> «Factura 1041 emitida a Vega Norte SpA por $ 966.994 · aceptada por el SII»

**2 · Error.** *Qué pasó + qué sigue funcionando + qué hacer.* Seis familias, cada una con su lugar: validación pegada al campo · permiso y límite embebidos · estado e integración embebidos junto a lo afectado · red en notificación temporal.
> «El Servicio de Impuestos Internos no está respondiendo. No se emitió nada y no se consumió ningún folio. Vuelve a intentar en unos minutos.»
> «El banco rechazó la transferencia a C. Vera: el RUT no coincide con la cuenta. Corrige sus datos bancarios y vuelve a pagar.»
> «No pudimos cargar los pedidos. Esto no significa que no haya: significa que no los pudimos leer.»

**3 · Advertencia que no es error.** *Tono `attention`, no bloquea, y la última frase dice que se puede seguir.*
> «Estás creando este pedido después de la hora de corte. La ventana de Vega Norte cierra a las 16:00 y ya son las 16:24. El pedido se crea igual y sale mañana.»
> «Antes de seguir: cierra tu sesión de Mercado Libre. Si la tienes abierta allá, no te va a preguntar cuál cuenta conectar y vas a terminar conectando la misma. Ciérrala primero, o abre esto en una ventana privada.»
> «Vas en el 80% de los pedidos de tu plan: 4.000 de 5.000, y quedan 9 días.»

**4 · Confirmación irreversible.** *Título «Vas a + verbo + objeto nombrado» · cuerpo con qué cambia, a quién afecta, qué NO hace y si hay vuelta · acto explícito · botón con verbo y monto · «Volver».*
> «Vas a emitir la factura de Vega Norte SpA — Se emite ante el SII por $ 966.994 IVA incluido, consume el folio 1041 y no se puede deshacer: solo se corrige con una nota de crédito.» · escribe `VEGA NORTE SPA` · **«Emitir la factura por $ 966.994»**
> «Vas a suspender a Vía Central Ltda. — Sus 3 sellers y 2 conductores dejan de poder entrar hoy mismo… No borra datos, no cancela pedidos, no anula documentos ya emitidos y no libera folios consumidos.»
> «Vas a transferirle $ 323.400 a Carlos Vera — Sale de tu cuenta y no se puede revertir desde acá: si te equivocas, hay que pedírselo de vuelta.»

**5 · Estado vacío, en sus tres tonos.** §6.3.
> Arranque: «Todavía no tienes tarifas — Sin una tarifa las entregas no se pueden cobrar ni liquidar.» · *Crear tarifa*
> Buena noticia: «Todo cuadra — Las 427 líneas del período calzan con sus entregas y con sus pagos. Última revisión: hoy 16:04»
> Filtro: «Ningún pedido coincide — Estás filtrando por Vega Norte, Maipú y 21-08. Hay 284 pedidos hoy fuera de ese filtro.» · *Limpiar los filtros*

**6 · Ayuda de campo.** *Qué es, y qué te toca hacer. Dos párrafos máximo, en popover, sin definir un término con otro.*
> «¿Qué es un folio? — Es un número que el SII te autoriza a usar para facturar. Cada factura consume uno y no se puede reutilizar. Los descargas de su sitio y los cargas acá. Cuando se te acaban, no puedes facturar.»
> «¿Por qué la Torre muestra menos pedidos que el listado? — La Torre muestra solo lo que está en la calle con compromiso para hoy. El listado muestra todo. Las dos cifras son correctas y cuentan cosas distintas.»
> «¿Qué implica dar mi punto de término? — Se usa solo para armar tu ruta con la última parada cerca de ahí. La ve tu coordinador; no la ven los sellers ni los compradores. Es opcional y puedes borrarla cuando quieras.»

**7 · Error de validación.** *Qué falta, en imperativo amable, pegado al campo, al salir de él y nunca al escribir.*
> «Este RUT no es válido. Revisa el dígito verificador.»
> «Escribe al menos 10 caracteres. Este motivo lo va a leer el conductor.»
> «Le vas a pagar al conductor más de lo que le cobras al seller. Puedes guardarlo igual, pero revisa que sea a propósito.»

**8 · Notificación push del conductor.** *Título ≤24 caracteres, cuerpo ≤60, con el número al principio del cuerpo.*
> «Tu ruta está lista» / «24 paradas para hoy. Empieza cuando quieras.» → manifiesto
> «Te pasaron bultos» / «6 bultos de R. Muñoz. Revísalos y acepta.» → traspaso · **no se puede apagar**
> «Tienes un retiro» / «42 bultos en Vega Norte Maipú.» → parada de retiro

### 12.5 Los correos

Plantilla base de 600 px, una columna: **marca (del courier si el destinatario es su cliente; de Rutax si somos la contraparte) · titular con el hecho · párrafo de contexto · bloque de datos en mono · una sola acción · enlace de respaldo en texto · pie con por qué lo recibe y cómo dejar de recibirlo.**

- **Móvil:** una columna siempre; botón de 44 px de alto y ancho completo; cuerpo nunca bajo 14 px.
- **Modo oscuro:** los clientes invierten por su cuenta, así que la plantilla **no usa fondos casi blancos ni texto casi negro**; el botón declara su color de fondo dos veces.
- **Cliente antiguo:** degrada a una tabla de una columna con un enlace subrayado. **Ningún correo depende de una imagen**: el nombre del courier es texto.
- **Asunto:** el hecho y su número, ≤45 caracteres, sin el nombre del producto al principio y sin exclamaciones. Los de dinero llevan el monto en el asunto.

### 12.6 Accesibilidad del texto

- Toda etiqueta de campo es un `<label>` real, visible. Sin *placeholder* como etiqueta.
- Todo distintivo de estado lleva su etiqueta como texto, no como `title`.
- Los cambios de estado en sitio se anuncian en una región discreta; **los errores, en una asertiva**.
- Alt de maqueta: describe qué se ve y qué demuestra. Alt de decoración: vacío. **Ningún ícono de estado es decorativo**: todos llevan su nombre accesible.
- Un conteo que cambia solo se anuncia una vez cada 10 s como máximo, agrupado.

---

## 13. Sub-sistema: cartografía

Es el único lugar del producto donde el diseño **no puede heredar de los tokens**: la librería cartográfica no lee CSS. Todo lo que se ve en el mapa se define aparte, y si no se hace, el mapa va a ser lo único que no se parezca al producto.

### 13.1 Tema del plano

**El plano retrocede: es el escenario, no el contenido.**

| | Oscuro | Claro |
|---|---|---|
| Agua | `#070C0E` | `#E6EEEF` |
| Suelo | `#0B1114` | `#F1F6F6` |
| Parque | `#0E1518` | `#EAF2F0` |
| Calle secundaria | `#16211E` | `#DCE7E8` |
| Calle principal | `#1F2C31` | `#CDDCDE` |
| Autopista | `#2A3A41` | `#BCCFD1` |
| Rótulo de calle | `#5C6B6E` | `#7C8A88` |
| Rótulo de comuna | `#7E9198` | `#56666B` |
| Halo de rótulo | `#0B1114` a 70% | `#FFFFFF` a 70% |

Sin relieve, sin edificios en 3D, sin puntos de interés comerciales, sin iconografía de terceros. La etiqueta de comuna es lo único del plano con peso 500.

### 13.2 Los tres niveles de zoom semántico

| Nivel | Zoom | Qué aparece | Qué desaparece |
|---|---|---|---|
| **Comuna** | ≤ 11 | Polígono por comuna con su carga y su rótulo | Puntos individuales, marcadores de conductor |
| **Agrupaciones** | 12–13 | Racimos con su conteo; polígono de la comuna seleccionada como contorno | El relleno de los polígonos vecinos |
| **Punto de entrega** | ≥ 14 | Puntos individuales con su código, marcadores de conductor | Racimos, rótulo de comuna |

**El escalón se entiende de tres maneras a la vez:** el rótulo del nivel cambia en la esquina («9 comunas» → «34 grupos» → «112 entregas»), los racimos se abren con un cruce de 200 ms, y el control de zoom marca el tramo. Sin las tres, el salto se lee como que el mapa perdió datos.

### 13.3 Polígono de comuna

- **Carga** en una rampa de cuatro pasos del acento, sin escala de semáforo:
  `--rx-map-comuna-1: #04302A` · `-2: #0A5F52` · `-3: #00B89A` · `-4: #00D6B4` (oscuro); en claro `#DBF8F2` · `#97E8D9` · `#00B89A` · `#007D69`.
- **Cuando la celda lleva rótulo, la rampa corta en `comuna-3`** y el texto va en `--rx-fg`. Ningún gris sobre `comuna-4`.
- **Seleccionado:** borde de 2 px en `--rx-fg` y el relleno sube un paso. **Nunca cambia de color**: cambiar el matiz haría creer que cambió la carga.
- **Vecino:** separado por una línea de 1 px en `--rx-line`. La carga se distingue por el paso de la rampa, no por matiz.

### 13.4 Punto de entrega y marcador de conductor

- **Punto de entrega:** círculo de 8 px, relleno del tono de su estado de ciclo, borde de 1,5 px del color de fondo para que se separe de sus vecinos. **Muestra el código de envío, nunca la dirección ni el nombre.**
- **Incidencia abierta:** el mismo círculo en `fault` **con un anillo de 2 px**. Es lo único rojo del mapa y lo único con anillo.
- **Marcador de conductor:** cuadrado de 12 px rotado 45°, con la inicial. Con su **última posición y nada más**: no hay recorrido histórico y no se puede dibujar uno.
- **Cientos encimados:** por debajo de zoom 14 se agrupan en racimos con conteo; sobre 14, los que caen a menos de 12 px se apilan con un contador «+3» y se abren al tocar. **Nunca se dispersan artificialmente**: mover un punto de su coordenada real en un mapa operativo es mentir.

### 13.5 Los cuatro estados del mapa

| Estado | Tratamiento |
|---|---|
| **Sin incidencias abiertas** | Mapa normal + panel en `balanced`: «Nada atascado · los 34 pedidos en ruta van avanzando · actualizado hace 30 s» |
| **Nadie con paradas asignadas hoy** | Mapa con las comunas en su paso 1, sin puntos, y estado de arranque con la acción de asignar |
| **Sin pedidos con compromiso para hoy** | Mapa quieto y explicación de la diferencia con el listado (§12.4, ayuda) |
| **Cartografía degradada** | **Es un estado válido, no un error.** El plano no carga y el mapa queda sin fondo: los polígonos se dibujan como bloques sobre `bg-sunken`, los puntos conservan su posición relativa, y una franja `attention` dice «No pudimos cargar el mapa. Los pedidos y sus estados están bien: es solo el plano.» Todo sigue siendo operable. |

---

## 14. Sub-sistema: visualización de datos

Una paleta de gráfico mal resuelta hace ilegible una cifra de dinero.

### 14.1 Los cinco tipos permitidos, y cuándo

| Tipo | Cuándo | Nunca |
|---|---|---|
| **Barra vertical** | comparar una magnitud entre categorías o días | más de 14 barras |
| **Línea** | una serie continua en el tiempo, 2 series máximo | series con huecos |
| **Barra horizontal apilada al 100%** | composición de un total, 4 partes máximo | comparar totales |
| **Barra de progreso contra objetivo** | cumplimiento con meta pactada | sin objetivo declarado |
| **Cifra grande con delta** | una magnitud que se mira de reojo | cuando importa la forma de la curva |

**Prohibidos:** torta, dona, radar, burbuja, área apilada, eje doble, 3D. En un producto de trabajo la variedad de gráficos es ruido, no riqueza.

### 14.2 La paleta categórica

Cinco series, en este orden, y **no chocan con los colores de estado** porque ninguna usa el matiz del rojo ni del ámbar:

```css
--rx-chart-1: #00D6B4;  /* claro: #007D69 */
--rx-chart-2: #43C9FF;  /* claro: #0075A8 */
--rx-chart-3: #9EB0B6;  /* claro: #4C5F65 */
--rx-chart-4: #5FE3CB;  /* claro: #00A388 */
--rx-chart-5: #7E9198;  /* claro: #56666B */
```

**Adyacentes distinguibles:** entre `chart-1` y `chart-2` hay 90° de matiz; entre `chart-3` y `chart-5`, dos pasos de luminosidad. **Sin cambiar de significado entre temas:** la serie 1 es siempre la serie 1, con el mismo lugar en la leyenda y en el orden de apilado.

**Y el color no es el único portador:** cada serie lleva **rótulo directo sobre el trazo** (no leyenda aparte) cuando hay espacio, y patrón de trama en las barras apiladas.

### 14.3 Ejes, rótulos y cifras

- Eje Y en pesos: **sin decimales, con separador de miles**, abreviado solo sobre el millón (`$ 1,2 M`) y con el valor exacto en el tooltip.
- Eje Y **siempre desde cero** en barras. En líneas puede recortarse, y entonces **se declara con una marca de corte**.
- Cuatro marcas como máximo en el eje Y. Cuadrícula horizontal de 1 px en `line-subtle`, ninguna vertical.
- Rótulos de eje en mono 9–10,5 px. Cifras del gráfico en mono, alineadas y comparables.
- **El día de hoy va en `--rx-chart-1`; los anteriores, en `chart-3`.** Es la única jerarquía temporal del sistema.

### 14.4 Estados del gráfico

- **Cargando:** ejes y cuadrícula dibujados, área de datos con esqueleto. Nunca un spinner sobre un rectángulo vacío.
- **Sin datos suficientes:** «Se necesitan al menos 7 días para dibujar esta tendencia. Llevas 3.» — con la cifra que sí existe en grande.
- **Rango ilegible:** sobre 14 barras o 2 series, el gráfico **se niega y ofrece la tabla**: «Son 31 días: mejor míralo en tabla». Un gráfico ilegible es peor que una tabla.

### 14.5 El semáforo de cumplimiento

Es un juicio sobre el desempeño de un seller, con un objetivo pactado por contrato detrás. **El color no puede ser su único portador:**

- **Barra de progreso contra objetivo**, con el objetivo como una **marca negra de 2 px** en su posición exacta.
- **Etiqueta obligatoria con las dos cifras:** «96,2% · objetivo 97%». Nunca solo «96,2%», y nunca solo el color.
- Tono por distancia al objetivo: `balanced` en o sobre el objetivo · `attention` hasta 3 puntos abajo · `fault` más abajo.
- **Y siempre el denominador a la vista:** «de 284 entregas del mes, 273 dentro del plazo». Un porcentaje sobre 12 entregas no es una evaluación.

---

## 15. Sub-sistema: sonido y vibración

Solo en la app del conductor. Hoy no existe ninguno de los tres. El caso que los exige: **el conductor escanea hasta 130 bultos seguidos en una bodega y no puede mirar la pantalla en cada uno.**

### 15.1 El vocabulario: cuatro señales y ni una más

| Señal | Vibración | Sonido | Significado |
|---|---|---|---|
| **Escaneado correcto** | 1 pulso corto, 30 ms | tono agudo 40 ms, 1 kHz | siga |
| **Bulto repetido** | 2 pulsos cortos, 30 ms con 80 de pausa | el mismo tono, repetido | no es error; deténgase un segundo |
| **No corresponde a esta bodega** | 1 pulso largo, 220 ms | tono grave descendente, 300 ms | deténgase de verdad |
| **Visita cerrada** | 2 pulsos largos, 180 ms | tono ascendente, 400 ms | terminó · **una sola vez por retiro** |

**Las tres condiciones que cumplen:**
1. **Se distinguen sin mirar** — uno corto, dos cortos, uno largo grave, dos largos ascendentes. La distinción es de *cantidad y duración*, no de timbre: un timbre no se distingue en una bodega ruidosa.
2. **La vibración sola basta.** Con el teléfono en silencio, las cuatro señales siguen siendo distinguibles entre sí.
3. **El sonido corta** porque usa el canal de alerta, no el de multimedia — así suena aunque el conductor tenga música puesta.

**Batería:** los cuatro sonidos son tonos sintetizados, no archivos. Ninguna señal dura más de 400 ms y ninguna se repite en bucle.

### 15.2 Notificaciones push

Tres momentos, con su texto en §12.4. **La del traspaso no se puede apagar:** sin ella el traspaso se queda esperando y alguien carga bultos que no son suyos.

### 15.3 Cuándo se pide cada permiso

**Nunca todos de golpe al abrir la app.** Cada uno en el momento en que se necesita, con una frase antes:

| Permiso | Cuándo | Frase previa |
|---|---|---|
| **Cámara** | al tocar «Entregar» la primera vez | «La foto es la prueba de que entregaste. Sin ella no se cierra la parada.» |
| **Ubicación** | al abrir la primera parada | «Guardamos dónde estabas al entregar. No te seguimos entre paradas.» |
| **Galería** | al tocar «adjuntar», no antes | — |
| **Notificaciones** | al cerrar su primera parada | «Te avisamos cuando tengas trabajo · así no tienes que abrir la app a cada rato.» |

**Si ya fue denegado:** pantalla propia con la ruta exacta de los ajustes del sistema y qué se pierde. Con **galería** denegada el flujo sigue (se puede disparar); con **ubicación** denegada también (se registra sin coordenada y queda anotado); con **cámara** denegada **no se puede cerrar la parada**, y eso se dice. El permiso del sistema se pide **una sola vez más** tras un rechazo; después solo queda el camino de los ajustes.

---

## 16. Sub-sistema: impresos

**El papel tiene una sola versión.** Lo que tiene claro y oscuro son los controles que lo generan y el visor. Una térmica invertida se borra; un PDF oscuro se imprime negro.

### 16.1 Térmica monocroma de baja resolución (10×15 cm, 203 ppp)

Es un medio hostil: sin color, sin grises confiables, con texto que tiene que leerse desde una camioneta.

- **Cero grises, cero tramas de fondo, cero pesos bajo 400, ningún texto bajo 15 px.** La separación se hace con **reglas de 2 y 3 px**.
- **La comuna es más grande que el nombre** (24 px contra 17). El conductor separa bultos por comuna a las 15:50; el nombre lo necesita en la puerta, dos horas después.
- **Todo código aparece dos veces:** partido en dos líneas en mono a 40 px para leerlo a un metro, y **sin guiones bajo el código de barras** para digitarlo cuando el escáner falla.
- **Dos códigos, no uno:** QR de 2,6 cm con borde negro de 4 px como zona de silencio (los lectores de teléfono fallan sin ella) **y** código de barras lineal para las pistolas de bodega, que no leen QR.
- **La procedencia en un cuadro de 15 px** arriba a la derecha —SD, FLEX, SHOP—, porque «FLEX» significa que la prueba oficial la gobierna otra app y eso tiene que estar en el objeto físico.
- **Nunca lleva:** montos, datos del conductor, instrucciones de acceso a la bodega. El paquete pasa por manos ajenas.
- **La reimpresión se marca:** «REIMPRESA · 21-08 16:40» en una regla negra bajo el código. Un bulto con dos etiquetas se escanea dos veces y se cuenta mal.
- **La marca sobrevive** porque son dos rectángulos macizos: 1,3 mm de alto a 203 ppp, sin versión especial.
- **Versión carta:** la misma etiqueta al 62%, dos por hoja con guía de corte punteada —la única línea gris de la pieza, y es para la tijera—. Los dos bultos del mismo pedido salen en la misma hoja.

### 16.2 PDF carta, para pantalla y para papel

- Una columna de **62 caracteres** de medida, márgenes de 34–38 px de diseño (≈ 2,5 cm impresos).
- Emisor arriba a la izquierda con razón social, RUT y domicilio; **folio en un recuadro de 2 px arriba a la derecha**, que es donde lo busca cualquiera que haya visto una factura chilena.
- **Rutax al pie, en 11 px**, con la frase que declara qué hicimos. No somos el emisor y no podemos parecerlo.
- Todo negro sobre blanco, con `#3E4D53` como único gris de texto secundario (7,4:1).

### 16.3 Jerarquía de una tabla financiera impresa

No hay hover ni tooltip para explicar nada, así que la jerarquía se construye con **tres recursos y ninguno más**:

1. **Fondo tenue** (`#F7FBFB`) en las filas de subtotal.
2. **Regla de 2 px** sobre el total.
3. **Doble regla** bajo el total — la convención contable chilena, que este lector ya conoce de su boleta.

Y dos reglas de contenido:
- **Toda pieza impresa con un total lleva su composición impresa al lado** (§8.2, `bloque de composición`). En papel no hay hover que explique una cifra.
- **Un ajuste que resta plata viaja al papel con su motivo, su autor, su fecha y qué hacer si no está de acuerdo.**
- Agrupación por concepto con cantidad y unitario; **el detalle línea por línea vive en pantalla**, no en el PDF. Cuando el unitario se obtiene dividiendo, va redondeado y **el total va exacto**.

### 16.4 Piezas para trabajar

El manifiesto impreso existe porque el teléfono murió a mitad de turno. Entonces:
- **Casilla de 17 px y línea para escribir** en cada fila. Una línea invita a escribir; un espacio blanco no.
- **La hora de impresión al pie, con su advertencia:** «si hay cambios después de esta hora, no salen acá».
- **El teléfono del coordinador en 16 px, en un recuadro de 2 px.** Es el único dato que se busca con urgencia y una mano ocupada.

### 16.5 Tratamiento

**Factura y liquidación en USTED.** **Manifiesto en TÚ** — es la herramienta del conductor y nadie la firma ante un tercero. La etiqueta casi no tiene prosa. **Y el mensaje de error del PDF va en TÚ** aunque el documento vaya en usted: el error es de la app, no del documento.

---

## 17. Accesibilidad

**WCAG 2.2 AA como piso, no como aspiración.** El contexto lo exige por sí solo: sol directo en la calle y diez horas de monitor.

- **Contraste:** 4,5:1 en texto normal, 3:1 en texto grande (≥24 px o ≥19 px en 700) y en bordes de control. Los ratios reales de la paleta están en §3. Ningún gris se usa fuera del fondo para el que se calculó.
- **Foco visible:** anillo de 2 px en `--rx-focus` con 2 px de separación, en **todos** los elementos operables. Nunca `outline: none` sin reemplazo. En tema claro el anillo es `#007D69`.
- **Teclado completo:** todo se opera sin puntero. El **buscador global** se abre, se navega y se elige solo con teclado. Escape cierra paneles y menús —**salvo el modal de acto explícito**, que no se cierra por accidente y lo declara.
- **Orden de tabulación** en el orden visual. El panel de detalle mueve el foco a su encabezado al abrir y lo devuelve al disparador al cerrar. El modal atrapa el foco.
- **Objetivo táctil:** 44 px mínimo general, **56 px en la app del conductor y en el uso de pie en bodega**. Separación mínima de 8 px entre objetivos adyacentes.
- **Movimiento reducido:** §7.6. No se apaga: se sustituye.
- **Texto:** §12.6. Y la escala de la app (§2.4) llega a 150% sin romper ninguna pantalla.
- **Zoom del navegador al 200%** sin pérdida de contenido ni de función en todas las superficies web.
- **Sol directo:** verificado en el tema `rx-sol` con extremos puros y distintivos en sólido pleno.

---

## 18. Rendimiento como restricción de diseño

Hay tablas que llegan a mil filas, un mapa con cientos de puntos y pantallas que se refrescan solas mientras el usuario mira. **Un patrón que no aguante eso está mal aunque se vea bien.**

| Patrón | Al crecer |
|---|---|
| **Tabla** | Virtualización sobre 200 filas. **Truncamiento declarado siempre**, con sus dos salidas: afinar el filtro o exportar. Sobre 1.000 el mensaje cambia y la tabla exige filtro. |
| **Selección múltiple** | La selección vive por id, no por índice. Con selección activa **el refresco se congela**, y eso se dice. |
| **Refresco automático** | Mixto: lo que ya está en pantalla se actualiza en su lugar con un marcador de 8 s; **lo que entraría nuevo se anuncia en una franja con su conteo y no se inserta solo**. |
| **Mapa** | Racimos bajo zoom 14; apilado con contador sobre 14. Cientos de puntos no se dibujan uno por uno a nivel de comuna. |
| **Gráfico** | Se niega y ofrece la tabla sobre 14 barras o 2 series. |
| **Panel de detalle** | Carga el encabezado canónico primero y el cuerpo después. El usuario confirma que abrió lo correcto antes de que llegue el detalle. |
| **Esqueletos** | Respetan el alto de fila real, así que nada salta cuando llegan los datos. |
| **App del conductor** | Sin trabajo sin conexión: reintento automático con aviso. Esqueleto estático. Ninguna animación de lista. |

**Y una restricción de realidad:** esto se construye sobre un producto en producción con clientes reales, así que lo nuevo y lo viejo van a convivir meses. **Ninguna decisión de este sistema exige que todo cambie el mismo día.** Los tokens se pueden aplicar pantalla por pantalla; los componentes nuevos conviven con los viejos; los cuatro temas se agregan sin tocar el existente.

---

## 19. Reglas de sistema acumuladas

Las que rigen de aquí en adelante, en un solo lugar.

**Estado y color**
1. Todo distintivo lleva tono, glifo y etiqueta. El color nunca es el único portador.
2. Un solo eje de estado por fila usa color; los demás usan glifo, texto o posición.
3. El rojo de la Torre está reservado a la incidencia abierta.
4. Un estado sin transición de salida no se dibuja.
5. El teal no se usa como texto en tema claro.
6. `fg-subtle` solo sobre `bg`.

**Datos y dinero**
7. Toda cifra de una tabla financiera lleva su rótulo —bruto o neto— en la cabecera y en el pie.
8. Las tablas de dinero se agrupan por concepto con subtotal; el detalle completo es un enlace.
9. Todo negativo lleva signo menos real, tono falla y su causa en la misma fila.
10. El `bloque de composición` es obligatorio junto a cualquier cifra que no sea la suma trivial de una columna.
11. Rutax no muestra impuestos: los calcula y los muestra el documento tributario.
12. Los contadores nunca se ponen en cero por una lectura fallida: conservan su último valor y su hora.
13. Un motivo escrito por un interno que un externo va a leer se declara como tal en el formulario.

**Acciones**
14. Tres peldaños: reversible · destructiva reversible (motivo) · irreversible con consecuencia legal (acto explícito). La ceremonia la fija el efecto, no la frecuencia.
15. Ninguna acción se confirma con un diálogo nativo del navegador.
16. El botón que confirma dice lo que hace, con el monto cuando hay dinero. El que cancela dice «Volver».
17. Toda acción sobre la cuenta de un tercero exige motivo escrito y queda a nombre de quien la hizo.
18. El segundo factor se vuelve a pedir **por acción** cuando la acción cruza la frontera de una empresa.
19. Una bitácora de auditoría es de solo lectura para todos los roles.
20. Un traspaso entre personas necesita las dos voluntades.

**Formularios y configuración**
21. En configuración no hay autoguardado: guardado explícito por sección con acuse.
22. Todo formulario de edición llega precargado con el valor vigente.
23. Nada se borra: se desactiva, y todo lo desactivado tiene cajón y vuelta.
24. Cuando un cambio tiene fecha de vigencia, lo vigente y lo programado conviven en la misma tabla.
25. Un asistente sin pantalla de cierre no está terminado, y el estado que la dispara es el mismo que apaga el aviso del marco.
26. Un cambio de permisos se explica con el catálogo de capacidades, nunca con un texto a mano.
27. Una credencial de una sola vez lo advierte antes de generarla.
28. Un consentimiento de dato personal se pide en tres pasos y nada se guarda antes del último.

**Superficies**
29. El portal del seller no gana densidad al crecer el ancho: gana aire.
30. Un mismo valor de estado puede tener etiqueta visible distinta en el portal, conservando tono y glifo. Es la única superficie con ese permiso.
31. Toda pantalla del portal tiene una salida al courier, y el pie es el único lugar con nuestra marca.
32. Una pantalla no promete una acción que la interfaz no ofrece.
33. En una pantalla sin sesión la marca la decide el dueño de la relación.
34. El nombre del courier en texto es la versión canónica; su logo es una mejora.
35. Sin sesión, el tema lo decide el sistema operativo.
36. Una pantalla pública nunca confirma ni niega la existencia de un correo, un envío ajeno o una cuenta.
37. Cuando la fuente del pedido gobierna parte del ciclo, la interfaz lo dice y cruza.
38. Un período cerrado va en solo lectura, sin composición.
39. En el backstage, todo objeto se muestra con su empresa al lado.
40. Una preferencia del conductor no se reporta a su coordinador.

**Mensajes**
41. Ningún error de dinero va en notificación temporal.
42. Todo éxito de dinero lleva monto y contraparte.
43. Todo vacío de buena noticia lleva una cifra y la hora de la última revisión.
44. Un error de integración dice qué sigue funcionando y nunca repite el mensaje del proveedor.

**Movimiento y medios**
45. Se anima lo que comunica un cambio; nunca la entrada de filas nuevas ni una cifra que sea prueba.
46. Ninguna animación se repite en bucle en el sitio comercial.
47. Toda pieza animada tiene su versión estática diseñada.
48. La app tiene tres temas y los tres comparten disposición, glifos y posiciones.
49. La preferencia manual de tema caduca al fin del turno.
50. Bajo sol, los distintivos van en sólido pleno.
51. Toda confirmación que el conductor no puede mirar tiene señal de oído y de mano.
52. Un permiso se pide en el momento en que se usa, con una frase de para qué.
53. El papel tiene una sola versión.
54. Todo código impreso aparece dos veces: legible a distancia y digitable.
55. Una etiqueta no lleva montos, ni datos del conductor, ni instrucciones de acceso.
56. Una pieza impresa para trabajar lleva dónde escribir y la hora en que se imprimió.

---

## 20. Qué queda abierto

Decisiones que el diseño dejó planteadas y que no le corresponde cerrar:

1. **El umbral de lux (8.000) y el mínimo de permanencia (90 s)** del cambio de tema en la app: hay que ajustarlos en la calle, con un teléfono real, a las 16:00 y a las 21:30. No se ajustan en pantalla.
2. **El precio y su unidad mínima.** La unidad está decidida —por conductor al mes— y la página existe; el monto lo pone el negocio. Falta decidir si hay mínimo mensual para couriers de 1 a 5 conductores, que es donde el precio por conductor se cae.
3. **Si el courier ve que alguien de Rutax entró a su cuenta.** Hoy no se le dice, y hay un argumento de confianza para decírselo.
4. **El agrupamiento de la factura**: por comuna con unitario redondeado y total exacto (lo diseñado) o por tarifa real, que cuadra al peso. Es contable, la toma quien revise con el SII.
5. **Guardar el logo del courier** como campo opcional de configuración. La tarjeta de enlace compartido y la etiqueta ya están diseñadas para recibirlo.
6. **Los 7 días de vigencia de la invitación** y los **30 minutos de la sesión de soporte**: números puestos, hay que medirlos.
7. **Los términos y la política de privacidad**: texto legal en USTED, los escribe un abogado. La pantalla que los muestra está diseñada, con su versión y su fecha de vigencia.

**Y lo que todavía no se ha diseñado:** las cuatro anulaciones del bloque de dinero, el historial de entregas y pagos del conductor, el detalle de bodega, la ficha de seller desplegada, la Torre de control en móvil, los cuerpos completos de los 6 correos que ya existen, y el sitio comercial en tablet y teléfono.

---

*Fin del documento. Los tableros de referencia —componentes, estados, objetos, mensajes, y las pantallas por bloque— viven en el proyecto y son la fuente de la enumeración completa; este documento es la fuente de las reglas.*

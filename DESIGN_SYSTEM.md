# DESIGN_SYSTEM.md — Sistema de Diseño Rutax

> **Qué es.** El sistema de diseño propio de **Rutax**: el lenguaje visual, de movimiento y de componentes que da identidad a las tres superficies del producto (backoffice del courier, portal del seller, PWA del conductor) sobre la base técnica ya cableada en [globals.css](src/app/globals.css).
>
> **Qué NO es.** No es una copia de Linear, Stripe, Duolingo ni Notion. De esas referencias se extraen *principios* (densidad, calidad, movimiento con propósito, escalabilidad); la identidad de Rutax es propia.
>
> **De dónde sale.** Decisión de marca cerrada en [BRIEF_DECISIONES_UX.md](BRIEF_DECISIONES_UX.md) (Decisión 2: Rutax · serio · versátil · confianza · azul navy provisional) y la base técnica auditada en [UX_READINESS_REPORT.md](UX_READINESS_REPORT.md) (Fase 4).
>
> **Estado:** v1 — provisional sobre tokens shadcn. El primario es **una sola variable CSS**; refinarlo más adelante es trivial.
> **Fecha:** 2026-06-13 · **Base técnica:** Next.js 16 · React 19 · Tailwind 4 · shadcn/ui sobre Radix · tokens OKLCH + dark mode.

---

## SECCIÓN 1 — DESIGN DNA

### Cómo debe sentirse Rutax

Rutax mueve **dinero y operación de terceros**. La sensación rectora es la de una **herramienta financiera-operativa en la que se confía sin pensarlo**: sobria, precisa, sin sorpresas. El usuario interno cierra plata; el seller revisa que le cobren bien; el conductor mira su ruta del día. Ninguno quiere "una app divertida": quieren **certeza**.

Cinco atributos, traducidos a decisiones visuales concretas:

| Atributo | Qué significa para Rutax | Cómo se ve |
|---|---|---|
| **Premium** | La calidad se nota en lo invisible: alineación, ritmo del espaciado, tipografía afinada, transiciones que nunca sacuden. | Espaciado en rejilla de 4px, jerarquía tipográfica restringida, sombras de baja opacidad, bordes de 1px nítidos. |
| **Moderno** | Actual sin moda pasajera. Nada de skeuomorfismo ni degradados decorativos. | OKLCH para color perceptualmente uniforme, esquinas suaves (no pill, no cuadradas), superficie plana con elevación sutil. |
| **Profesional** | Es software de negocio: el dato manda, no la decoración. | Color de marca reservado a la acción y la navegación; el lienzo es neutro; los datos respiran. |
| **Claro** | El usuario nunca duda de dónde está, qué pasó ni qué sigue. | Una sola acción primaria por vista, estados de color semánticos inequívocos, feedback inmediato y visible. |
| **Escalable** | 41 pantallas hoy, el doble mañana, sin que el sistema se quiebre. | Todo tokenizado; componentes compuestos, no especiales; tres densidades sobre una misma base. |

### El eje propio: confianza por sobriedad

El diferenciador visual de Rutax es la **sobriedad como mensaje de confianza**. No competimos por ser la app más vistosa del rubro; competimos por ser la que **se siente la más seria con el dinero**. Cuando hay duda entre "más llamativo" y "más tranquilo", Rutax elige tranquilo. El color de marca —un azul navy profundo, no brillante— es el ancla de esa promesa: aparece donde hay una acción confiable que tomar, y se retira de todo lo demás.

### Tres voces, un sistema

El mismo sistema habla en tres densidades según la audiencia (Blueprint §4):

- **Backoffice interno (courier)** → *denso y eficiente*. Operadores que viven en la pantalla; priorizan información por pantalla y atajos. Más filas, menos aire.
- **Portal del seller** → *tranquilizador y espaciado*. Visita esporádica; necesita confianza y respuestas claras ("¿me cobraron bien?", "¿está conectado?"). Más aire, menos densidad.
- **PWA del conductor** → *mínimo y táctil*. En la calle, una mano, sol en pantalla. Lo esencial, objetivos de toque grandes, contraste alto.

No son tres diseños: es **un sistema con tres calibraciones de densidad** (ver Sección 7).

---

## SECCIÓN 2 — DESIGN PRINCIPLES

Principios operativos. Cuando un diseño dude, se resuelve con el principio, no con el gusto.

### 1. Menos ruido, más señal
Cada elemento en pantalla justifica su existencia o se va. Bordes, sombras, líneas divisorias y rellenos de color se usan solo cuando comunican estructura o estado — nunca para "rellenar". El lienzo neutro hace que el dato y la acción destaquen solos.

### 2. El color de marca es un recurso escaso
El navy de Rutax se reserva para **la acción primaria y la orientación** (navegación activa, foco, enlace). No se usa para decorar contenedores ni para "dar vida". Si todo es azul, nada lo es. Verde/ámbar/rojo existen **solo como estado semántico**, jamás como marca.

### 3. Feedback siempre visible
Ninguna acción ocurre en silencio. Toda interacción del usuario produce una respuesta perceptible en ≤100 ms (cambio de estado del control) y confirma su resultado (toast, cambio de fila, estado de carga). En un producto de dinero, "no pasó nada visible" equivale a "no confío".

### 4. Consistencia extrema
Un botón primario se ve y se comporta igual en las 41 pantallas. Mismo radio, mismo espaciado, mismas transiciones, mismos estados. La consistencia es lo que convierte 41 pantallas en *un producto*. Se logra usando los componentes del inventario (Sección 9), no creando variantes ad-hoc.

### 5. Acción antes que decoración
Ante el conflicto entre "se ve bonito" y "es claro qué hacer", gana la claridad. Una vista tiene **una** acción primaria evidente; el resto son secundarias o terciarias y se ven como tales.

### 6. La jerarquía la hace el espacio y el peso, no la línea
Preferimos separar con **espacio en blanco y peso tipográfico** antes que con líneas y cajas. Agrupamos por proximidad; jerarquizamos por tamaño y peso. Las líneas divisorias son el último recurso, no el primero.

### 7. Estados de sistema de primera clase
*Vacío, cargando, error y sin permiso* no son casos borde: son estados de diseño que toda vista de datos debe resolver explícitamente (ver Sección 9 — inventario de estados). Una tabla vacía nunca se ve "rota".

### 8. El dinero exige fricción deliberada
Las acciones irreversibles (emitir DTE, anular, liquidar) **requieren** confirmación inequívoca, lenguaje explícito y un instante de pausa. Aquí la fricción es una feature, no un defecto de UX.

---

## SECCIÓN 3 — MOTION SYSTEM

> Inspiración: el cuidado de Duolingo por el detalle del movimiento y el feedback. **No su exuberancia.** En Rutax el movimiento es discreto, funcional y rápido — confirma, orienta y suaviza, nunca entretiene ni hace esperar.

### Filosofía de movimiento
El movimiento en Rutax tiene tres trabajos y ninguno más:
1. **Confirmar** que una acción ocurrió (un botón que responde, una fila que aparece).
2. **Orientar** sobre de dónde viene y a dónde va algo (un drawer que entra desde el borde, un modal que escala desde el centro).
3. **Suavizar** cambios de estado para que no "salten" (un valor que transiciona, un color de estado que cambia).

Regla de oro: **si el movimiento hace esperar al usuario, está mal calibrado.** En un producto de productividad, la velocidad percibida es parte de la calidad.

### Duraciones

| Token | Valor | Uso |
|---|---|---|
| `--motion-instant` | **100 ms** | Estados de control: hover, press, focus. Debe sentirse inmediato. |
| `--motion-fast` | **160 ms** | Microtransiciones: toggle, checkbox, tabs, tooltip, badge que cambia. |
| `--motion-base` | **220 ms** | Estándar: dropdowns, popovers, expandir/colapsar, toasts. |
| `--motion-slow` | **320 ms** | Superficies grandes: drawers (sheet), modales, transiciones de panel. |
| `--motion-page` | **400 ms** | Máximo absoluto. Transiciones de página/sección. Nada dura más que esto. |

### Curvas (easing)

| Token | Curva | Cuándo |
|---|---|---|
| `--ease-standard` | `cubic-bezier(0.2, 0, 0, 1)` | Por defecto. Entrada decidida, salida suave. La mayoría de transiciones. |
| `--ease-out` | `cubic-bezier(0, 0, 0.2, 1)` | Elementos que **entran** (toasts, popovers, filas nuevas). Rápido al inicio. |
| `--ease-in` | `cubic-bezier(0.4, 0, 1, 1)` | Elementos que **salen** (cerrar modal/drawer). Acelera al desaparecer. |
| `--ease-emphasis` | `cubic-bezier(0.34, 1.3, 0.64, 1)` | Overshoot **sutil y excepcional**: confirmación de éxito de una acción de dinero (factura emitida, pago conciliado). El único guiño "Duolingo", usado con cuentagotas. |

### Intensidad
- **Distancia de desplazamiento corta:** los elementos se mueven 8–16px, no toda la pantalla. El drawer y el sheet son la excepción (entran desde el borde).
- **Opacidad acompaña al movimiento:** lo que entra hace fade-in junto con su desplazamiento; nunca un objeto opaco "volando".
- **Sin rebotes en lo cotidiano:** el `--ease-emphasis` se reserva para el clímax de un flujo de dinero. El 95% del producto usa `--ease-standard`.
- **Escalas sutiles:** un modal escala de `0.96 → 1`, nunca de `0.5`. Un press hunde el botón a `0.98`, no más.

### Casos de uso (catálogo)

| Interacción | Duración | Curva | Detalle |
|---|---|---|---|
| Botón hover / press | `instant` | `standard` | Fondo + leve escala `0.98` en press. |
| Foco de teclado | `instant` | `standard` | Anillo de foco aparece sin desplazamiento. |
| Checkbox / toggle | `fast` | `out` | El check se dibuja, no aparece de golpe. |
| Tabs (cambio) | `fast` | `standard` | El indicador se desliza entre pestañas. |
| Tooltip | `fast` | `out` | Fade + 4px de subida. Delay de 400 ms antes de mostrar. |
| Dropdown / Select / Popover | `base` | `out` (abrir) / `in` (cerrar) | Escala `0.98→1` desde el ancla + fade. |
| Toast (Sonner) | `base` | `out` | Entra desde abajo-derecha (interno) o arriba (conductor). |
| Acordeón / colapsable | `base` | `standard` | Altura animada + fade del contenido. |
| Modal (Dialog) | `slow` | `out`/`in` | Overlay fade + contenido escala `0.96→1`. |
| Drawer (Sheet) | `slow` | `out`/`in` | Desliza desde el borde; overlay fade simultáneo. |
| Fila nueva en tabla | `base` | `out` | Fade + 8px. Resalte breve del fondo si es resultado de una acción. |
| Éxito de acción de dinero | `base` | `emphasis` | Único overshoot permitido. Acompañado de color de éxito + toast. |
| Skeleton (carga) | `1500 ms` loop | `ease-in-out` | Pulso de opacidad `1 → 0.5 → 1`, suave, no parpadeante. |

### Accesibilidad del movimiento
**Obligatorio:** respetar `prefers-reduced-motion`. Con la preferencia activa, todas las transiciones colapsan a `≤ 1 ms` (cambio instantáneo de estado, sin desplazamiento ni escala); el feedback se conserva vía color y opacidad, no movimiento.

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

---

## SECCIÓN 4 — COMPONENT PHILOSOPHY

> Regla transversal: **claridad > decoración.** Todo componente usa los tokens (color, radio, espacio, motion); ninguno inventa valores propios. Base: las 20 primitivas shadcn/Radix ya en el repo.

### Principios comunes a todo componente
- **Estados completos siempre:** default, hover, focus (teclado), active/press, disabled, loading, error. Un componente sin sus estados está incompleto, no "terminado".
- **Foco visible y consistente:** anillo de foco con el color `--ring`, 2px, offset 2px. Nunca se elimina el outline sin reemplazo.
- **Radio único de familia:** `--radius: 0.625rem` como base; los componentes derivan de la escala `--radius-sm/md/lg`. Nada de esquinas arbitrarias.
- **Tamaño táctil:** mínimo 44×44px de área interactiva en superficies táctiles (conductor) y 32px de alto mínimo en backoffice denso.

### Buttons
- **Jerarquía de tres niveles, no más:** `primary` (navy lleno, la acción de la vista — **una** por pantalla), `secondary` (borde + fondo neutro, acciones de apoyo), `ghost` (solo texto/ícono, acciones terciarias y de tabla). Más `destructive` (rojo) para acciones peligrosas.
- **El color comunica peso, no gusto:** si hay dos botones azules llenos en una vista, uno está mal.
- **Estado de carga integrado:** el botón muestra spinner y se deshabilita en su sitio; nunca desaparece ni cambia de tamaño. El texto puede cambiar ("Emitiendo…").
- **Ícono opcional a la izquierda**, mismo color que el texto, 16px. Botón solo-ícono debe llevar `aria-label`.

### Inputs
- **Etiqueta siempre visible y arriba** (no placeholder-as-label). El placeholder es ejemplo, no etiqueta.
- **Estados claros:** default (borde neutro), focus (anillo navy), error (borde + texto rojo + mensaje debajo), disabled (atenuado), success opcional (solo cuando valida algo crítico, p. ej. RUT válido).
- **Validación inmediata pero amable:** valida al salir del campo (blur), no en cada tecla; el error se muestra junto al campo, no en un cuadro lejano. Ver Sección 6.
- **Texto de ayuda** debajo del campo, en `muted-foreground`, para formato esperado (ej.: "12.345.678-9").

### Tables
Ver Sección 5 (filosofía dedicada). En resumen: densas, escaneables, con acción por fila y sin bordes verticales.

### Cards
- **La card agrupa, no decora.** Se usa para separar un bloque de información coherente del lienzo, no para enmarcar todo.
- Fondo `--card`, borde 1px `--border`, radio `lg`, sombra mínima (o ninguna en backoffice denso). Padding generoso en seller, ajustado en interno.
- **Jerarquía interna clara:** título (peso medio) → contenido → acciones al pie alineadas a la derecha.
- No anidar cards dentro de cards. Si necesitas eso, el contenido pide otra estructura (tabla, lista, tabs).

### Drawers (Sheet)
- **Para tareas laterales sin perder contexto:** detalle de un pedido, edición de una tarifa, filtros avanzados. El usuario sigue viendo de dónde vino.
- Entra desde la **derecha** en escritorio (detalle/edición) o desde **abajo** en móvil/conductor. Ancho fijo cómodo (≈ 420–520px), no a pantalla completa.
- Overlay atenúa el fondo pero no lo oculta del todo. Cierre por botón explícito, click fuera o `Esc`.

### Modals (Dialog)
- **Solo para lo que exige toda la atención:** confirmaciones críticas e irreversibles (emitir DTE, anular, liquidar). No para formularios largos (eso es un drawer o una página).
- Bloquean la interacción de fondo (overlay sólido atenuado). Centrados, ancho contenido (≈ 400–480px).
- **Las acciones de dinero llevan copy explícito + acción destructiva diferenciada** y, cuando corresponde, un paso de confirmación (escribir/marcar) antes de habilitar el botón. Ver Sección 2, principio 8.
- Cierre por `Esc`/click-fuera **deshabilitado** en confirmaciones irreversibles: solo se sale por un botón explícito (Cancelar / Confirmar).

---

## SECCIÓN 5 — TABLE PHILOSOPHY

> Inspiración: el rigor de Linear para el escaneo y la densidad. **No su estética concreta.** En Rutax la tabla es el caballo de batalla del backoffice (pedidos, manifiestos, líneas de cobro/liquidación, conciliación): debe permitir leer cientos de filas sin fatiga y actuar rápido.

### Prioridades
1. **Escaneo rápido** por sobre todo.
2. **Densidad correcta** según audiencia.
3. **Acciones rápidas** sin abandonar la fila.

### Reglas

**Densidad y ritmo**
- Tres densidades de fila: `compact` (interno, ~36px), `comfortable` (por defecto, ~44px), `relaxed` (seller, ~52px).
- **Sin líneas verticales.** Las columnas se separan por espacio, no por bordes. Líneas horizontales finas y de bajo contraste (`--border`), o solo zebra muy sutil — nunca ambas.
- Encabezado fijo (sticky) al hacer scroll; tipografía de encabezado en mayúscula-discreta o peso medio, color `muted-foreground`.

**Alineación = tipo de dato**
- Texto y nombres → izquierda.
- **Números, montos y fechas → derecha**, en `--font-mono` con cifras tabulares (`font-variant-numeric: tabular-nums`) para que las columnas de dinero alineen por dígito. Innegociable en un producto financiero.
- Estados → badge alineado a la izquierda de su columna.

**Escaneabilidad**
- Una columna "ancla" (la que el usuario busca: nº de pedido, seller) con más peso visual.
- Estados como **badges de color semántico** (no texto suelto): el ojo encuentra "entregado" / "incidencia" por color y forma.
- Montos en negativo (descuentos, ajustes) en rojo discreto; cero en `muted`.
- Truncado con elipsis + tooltip en celdas largas; nunca romper el ritmo de la fila.

**Acciones rápidas**
- Acciones de fila en una columna a la derecha: las 1–2 más comunes como botones `ghost`/ícono visibles al hover; el resto en un `dropdown-menu` (kebab).
- **Fila clickeable** para abrir el detalle en un drawer (no navegar fuera), salvo que toda la fila sea editable.
- Selección múltiple con checkbox + barra de acciones masivas que aparece al seleccionar (para asignar conductor, marcar, exportar).

**Estados de la tabla**
- **Vacío:** ilustración mínima + frase + acción ("Aún no hay pedidos. Conecta un seller para empezar").
- **Cargando:** filas skeleton con el mismo alto que las reales (no spinner suelto), para que no salte el layout.
- **Error:** mensaje en la zona de la tabla + botón "Reintentar".
- **Filtrado sin resultados:** distinto de vacío real ("Ningún pedido coincide con estos filtros" + "Limpiar filtros").

**Herramientas de tabla**
- Filtros y búsqueda **sobre** la tabla, persistentes en la URL (compartible, recargable).
- Paginación o scroll infinito según volumen; mostrar siempre el total ("1–50 de 1.240").
- Ordenamiento por columna con indicador claro de dirección.

---

## SECCIÓN 6 — FORM PHILOSOPHY

> Inspiración: la confianza y el cuidado de Stripe en formularios de dinero. **No su layout literal.** En Rutax los formularios críticos son el onboarding del courier (certificado DTE, folios, tarifas), el alta de sellers/conductores y la cobranza: cargas donde un error cuesta plata o tiempo.

### Prioridades
1. **Confianza** — el usuario sabe que sus datos están seguros y que entiende lo que ingresa.
2. **Claridad** — un campo, una pregunta; sin ambigüedad de formato.
3. **Validación inmediata** — el error se atrapa lo antes posible y se explica cómo arreglarlo.

### Reglas

**Estructura**
- **Una columna.** Los formularios de dinero/configuración van en una sola columna; el ojo no se pierde y el orden de llenado es obvio. Dos columnas solo para pares obviamente relacionados (ciudad/región).
- **Agrupar por sentido** con secciones y subtítulos, no con cajas. Un formulario largo (onboarding) se divide en pasos (wizard) con progreso visible.
- **Etiqueta arriba del campo**, ayuda debajo. El formato esperado se muestra *antes* de que el usuario se equivoque ("RUT con guión y dígito verificador").

**Validación**
- **Inline, al salir del campo (blur)**, no en cada pulsación (evita el "rojo mientras escribo").
- **Validaciones de dominio chileno de primera clase:** RUT (formato + dígito verificador), montos en CLP (separador de miles, sin decimales), folios. El feedback positivo aparece cuando aporta confianza (✓ "RUT válido").
- El **error vive junto al campo**, en rojo, con instrucción de arreglo ("El dígito verificador no coincide"), nunca un genérico "datos inválidos" arriba.
- Validación de servidor (Zod en bordes no confiables) se refleja en el campo correspondiente, no solo en un toast.

**Confianza (lo crítico de Rutax)**
- Los campos de **secretos** (certificado digital, claves de proveedor) se marcan visualmente como sensibles, nunca muestran el valor cargado en claro, y el copy explica que se guardan cifrados (alineado al contrato del proyecto: secretos fuera de logs/URLs).
- En cargas irreversibles o de impacto financiero, **resumen antes de confirmar**: "Vas a emitir 12 facturas por $X a 8 sellers" antes del botón final.
- Estado de guardado explícito: "Guardando…" → "Guardado" con timestamp. El usuario nunca duda si quedó.

**Interacción**
- **Acción primaria abajo a la derecha** (o full-width en móvil/conductor); secundaria (Cancelar/Atrás) a su izquierda como `ghost`/`secondary`.
- El botón de envío se deshabilita mientras hay errores visibles o mientras procesa (con spinner in-situ).
- `Enter` envía en formularios cortos; en los largos/wizard, `Enter` avanza de paso, no salta al final.
- Autoguardar borradores en formularios largos cuando aplique (no perder 10 min de carga por un refresh).

---

## SECCIÓN 7 — RESPONSIVE SYSTEM

Rutax sirve tres contextos físicos distintos; el sistema responde con **una base y tres calibraciones**, no con tres diseños.

### Breakpoints

| Token | Ancho | Contexto típico |
|---|---|---|
| `sm` | ≥ 640px | Móvil grande / conductor |
| `md` | ≥ 768px | Tablet |
| `lg` | ≥ 1024px | Laptop / backoffice |
| `xl` | ≥ 1280px | Escritorio backoffice (objetivo del denso) |
| `2xl` | ≥ 1536px | Monitores amplios |

Mobile-first: el estilo base es móvil; los breakpoints **suman** densidad y columnas hacia arriba.

### Backoffice del courier (denso · `lg`+)
- Layout de **navegación lateral + barra superior** ([barra-superior.tsx](src/components/) condicionada por capacidad RBAC). Contenido a ancho cómodo con max-width para no estirar tablas infinitamente.
- Densidad `compact`/`comfortable`. Tablas con muchas columnas; drawers laterales para detalle.
- En `md` y abajo (uso ocasional desde tablet): la nav lateral colapsa a un sheet; tablas priorizan columnas clave y esconden secundarias.

### Portal del seller (tranquilizador · responsive pleno)
- Pensado para visita esporádica desde cualquier dispositivo. Layout más espaciado (`relaxed`), una columna de contenido centrada.
- En móvil, las tablas de cobros/pedidos se transforman en **listas de cards** (una fila = una card escaneable), no scroll horizontal.
- La descarga de factura (PDF) y el estado de conexión son acciones grandes y evidentes.

### PWA del conductor (mínimo · móvil primero)
- Diseño **móvil exclusivo en la práctica**, una mano, exteriores. Objetivos de toque ≥ 44px, contraste alto (legible bajo sol), tipografía grande.
- Navegación inferior fija (pulgar) con 2–3 destinos máximo (manifiesto del día, liquidaciones). Sin tablas: listas verticales de tarjetas grandes.
- Acciones primarias **full-width** y fijas al pie cuando son la tarea principal. Estados de carga claros (conectividad variable en la calle).
- Considera instalabilidad PWA (manifest/SW) — feedback de "instala la app" solo si está verificado.

### Reglas transversales
- Nada de scroll horizontal salvo dentro de una tabla densa que lo declare explícitamente.
- El contenido refluye; no se "encoge" un layout de escritorio a la fuerza.
- Imágenes/íconos vectoriales (SVG) para nitidez en cualquier densidad de pantalla.

---

## SECCIÓN 8 — ACCESSIBILITY

Estándar objetivo: **WCAG 2.2 nivel AA, apuntando a AAA donde el dato lo justifique** (es software de dinero; la legibilidad no es opcional).

### Contraste
- Texto normal: **≥ 4.5:1** contra su fondo (AA). Texto crítico de montos/estados: apuntar a **7:1** (AAA).
- Texto grande (≥ 24px o ≥ 18.66px bold): ≥ 3:1.
- Componentes y bordes de foco/estado: ≥ 3:1 contra el adyacente.
- **El color nunca es el único portador de significado:** un estado "incidencia" lleva color *y* texto/ícono; un monto negativo lleva color *y* signo. (Crítico para daltonismo y para impresión/PDF.)

### Teclado
- **Todo operable con teclado**, en orden lógico de tabulación. Foco visible siempre (anillo `--ring`, 2px, offset).
- Modales/drawers atrapan el foco mientras están abiertos y lo devuelven al disparador al cerrar. `Esc` cierra (salvo confirmaciones irreversibles, que exigen acción explícita).
- Atajos del backoffice denso documentados y no en conflicto con el lector de pantalla.

### Semántica y lectores de pantalla
- HTML semántico y roles ARIA correctos (Radix los provee; no romperlos). Botones solo-ícono con `aria-label`.
- Tablas con encabezados asociados (`scope`); estados de carga/error anunciados (`aria-live`) para que el lector informe "cargando" y "error".
- Formularios: `label` asociado a cada input; errores vinculados con `aria-describedby`; campos inválidos con `aria-invalid`.

### Movimiento y preferencias
- `prefers-reduced-motion` respetado (Sección 3).
- `prefers-color-scheme` y dark mode ya soportados; ambos temas cumplen contraste AA.
- Tamaños de fuente en unidades relativas (`rem`) que escalan con el zoom del navegador hasta 200% sin pérdida de contenido.

### Táctil (conductor)
- Objetivos ≥ 44×44px, separación suficiente entre destinos para evitar toques erróneos en movimiento.

---

## SECCIÓN 9 — COMPONENT INVENTORY

Inventario completo del sistema. **Base actual:** 20 primitivas shadcn/Radix ya en [src/components/ui/](src/components/ui/). El sistema = base + compuestos de dominio + tokens.

### Tokens (fundaciones)

| Grupo | Tokens | Estado |
|---|---|---|
| **Color** | `background`, `foreground`, `primary` (navy), `primary-foreground`, `secondary`, `muted`, `accent`, `card`, `popover`, `border`, `input`, `ring`, `destructive` + `sidebar-*` + `chart-1..5` | ✅ Cableados (OKLCH, light/dark) en [globals.css](src/app/globals.css). **Pendiente:** aplicar el navy de marca al `--primary` (hoy gris) y dar color semántico a charts. |
| **Color semántico** | `success` (verde), `warning` (ámbar), `info` (azul claro), `destructive` (rojo) + cada uno con `-foreground` y `-subtle` (fondo de badge) | 🟡 A definir como tokens propios (hoy solo `destructive` existe). |
| **Tipografía** | `--font-sans` (UI), `--font-mono`/`--font-geist-mono` (números y datos), `--font-heading` | ✅ Cableados. Escala tipográfica a formalizar. |
| **Radio** | `--radius` + `sm/md/lg/xl/2xl/3xl/4xl` derivados | ✅ Cableados. |
| **Espaciado** | escala base 4px (Tailwind) | ✅ |
| **Motion** | `--motion-*`, `--ease-*` (Sección 3) | 🟡 A cablear como tokens. |
| **Elevación** | `shadow-xs/sm/md` de baja opacidad | 🟡 A formalizar. |

### Componentes base (✅ existen — 20)

| Componente | Archivo | Notas de sistema |
|---|---|---|
| Button | [button.tsx](src/components/ui/button.tsx) | Añadir variante/estado `loading` integrado. |
| Input | [input.tsx](src/components/ui/input.tsx) | Añadir estados error/success visibles. |
| Label | [label.tsx](src/components/ui/label.tsx) | |
| Textarea | [textarea.tsx](src/components/ui/textarea.tsx) | |
| Select | [select.tsx](src/components/ui/select.tsx) | |
| Checkbox | [checkbox.tsx](src/components/ui/checkbox.tsx) | |
| Badge | [badge.tsx](src/components/ui/badge.tsx) | Mapear a color semántico de estados (reusar `traduccion-estados.ts`). |
| Card | [card.tsx](src/components/ui/card.tsx) | |
| Alert | [alert.tsx](src/components/ui/alert.tsx) | Variantes info/warning/error/success. |
| Table | [table.tsx](src/components/ui/table.tsx) | Densidades + numéricos tabulares (Sección 5). |
| Tabs | [tabs.tsx](src/components/ui/tabs.tsx) | |
| Dialog | [dialog.tsx](src/components/ui/dialog.tsx) | Modo "confirmación irreversible" para dinero. |
| Sheet | [sheet.tsx](src/components/ui/sheet.tsx) | Drawer de detalle/edición. |
| Dropdown Menu | [dropdown-menu.tsx](src/components/ui/dropdown-menu.tsx) | Menú kebab de acciones de fila. |
| Tooltip | [tooltip.tsx](src/components/ui/tooltip.tsx) | |
| Avatar | [avatar.tsx](src/components/ui/avatar.tsx) | |
| Separator | [separator.tsx](src/components/ui/separator.tsx) | Último recurso (principio 6). |
| Progress | [progress.tsx](src/components/ui/progress.tsx) | Wizard de onboarding, folios CAF. |
| Skeleton | [skeleton.tsx](src/components/ui/skeleton.tsx) | Base de estados de carga. |
| Sonner (Toast) | [sonner.tsx](src/components/ui/sonner.tsx) | Feedback de acciones (principio 3). |

### Componentes a incorporar (🟡 faltan en la base)

| Componente | Para qué | Prioridad |
|---|---|---|
| **Form** (react-hook-form + Zod resolver) | Estructura, errores inline y validación de Sección 6. | Alta |
| **Pagination** | Tablas de pedidos/líneas de gran volumen. | Alta |
| **Empty State** | Estado vacío estandarizado (ilustración + frase + acción). | Alta |
| **Data Table** (compuesto sobre Table) | Filtros, orden, selección masiva, densidades. | Alta |
| **Radio Group** | Opciones excluyentes (tipo de tarifa, método de cobro). | Media |
| **Switch** | Toggles de configuración (opt-in DTE real, alertas). | Media |
| **Calendar / Date Picker** | Rangos de período, fechas de manifiesto. | Media |
| **Command (⌘K)** | Búsqueda/atajos del backoffice denso. | Media |
| **Breadcrumb** | Orientación en flujos profundos de configuración. | Media |
| **Accordion / Collapsible** | Detalle expandible, FAQ del portal seller. | Baja |
| **Popover** | Filtros compactos, ayuda contextual. | Media |
| **Stepper / Wizard** | Onboarding del courier por pasos. | Alta |
| **Chart** | Dashboard del dueño (con color semántico, no gris). | Media |

### Patrones / compuestos de dominio (🟡 a estandarizar)

| Patrón | Descripción | Reúsa |
|---|---|---|
| **Badge de estado** | Pedido/envío/incidencia/DTE con color + texto semántico. | `lib/ui/traduccion-estados.ts` |
| **Monto CLP** | Formato moneda chilena, mono tabular, negativo en rojo. | `lib/ui/` (formato CLP) |
| **Confirmación de dinero** | Dialog irreversible con resumen + paso de confirmación. | Sección 4 |
| **BotonDescarga** | Descarga de factura/etiqueta/export (consolidar los 5 `boton-descarga-*` actuales). | Deuda menor del audit |
| **Estado de conexión ML** | Indicador salud + acción de reconexión (seller). | Flujo reconexión |
| **Centro de avisos in-app** | Notificaciones in-app (Decisión 1: sin email aún). | — |
| **Selector de comuna RM** | Catálogo de comunas de la Región Metropolitana. | `lib/ui/` |

### Catálogo de estados de vista (entregable temprano — principio 7)
Toda vista de datos debe resolver explícitamente sus cuatro estados:
- **Vacío** (sin datos aún) → distinto de **filtrado sin resultados**.
- **Cargando** → skeleton con el layout final, no spinner suelto.
- **Error** → mensaje claro + reintento.
- **Sin permiso** (RBAC) → la capacidad gobierna qué se muestra; lo no permitido no aparece (no se muestra deshabilitado con explicación de permiso, salvo decisión de UX).

---

## Cierre

Este sistema es **v1 provisional**: la identidad (navy de marca, tipografía, charts con color) se aplica sobre una base técnica ya tokenizada, así que refinarla más adelante cuesta poco (el primario es **una variable CSS**). El valor del documento no está en los valores exactos de hoy, sino en las **reglas y principios** que mantienen coherentes 41 pantallas y tres audiencias mientras el producto crece.

**Próximos pasos de implementación (UI Lead / Frontend):**
1. Aplicar el navy de marca a `--primary` en [globals.css](src/app/globals.css) y validar contraste AA en light/dark.
2. Definir tokens semánticos (`success`/`warning`/`info`) y motion (`--motion-*`, `--ease-*`).
3. Incorporar los componentes faltantes de alta prioridad (Form, Data Table, Empty State, Stepper, Pagination).
4. Estandarizar los patrones de dominio y consolidar `BotonDescarga`.
5. Levantar el catálogo de estados de vista como primer entregable del UX.

---

*Derivado de [BRIEF_DECISIONES_UX.md](BRIEF_DECISIONES_UX.md), [UX_READINESS_REPORT.md](UX_READINESS_REPORT.md), [PRODUCT_BLUEPRINT.md](PRODUCT_BLUEPRINT.md) y la base técnica en [src/app/globals.css](src/app/globals.css) / [src/components/ui/](src/components/ui/). Mantener al día al evolucionar tokens, componentes o decisiones de marca.*

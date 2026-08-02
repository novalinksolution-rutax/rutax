# Torre de control — lenguaje visual

Dirección visual propuesta para la Torre de control. Decisión del usuario
(2026-07-25): **se diseña sin la restricción del ADN vigente**, con el mejor
estándar posible, y **después el resto del SaaS se alinea a esta dirección** —
no al revés.

Pitch visual publicado: `https://claude.ai/code/artifact/a90df9b4-a06d-40df-b712-1cef7b1d083b`

> Este documento reemplaza a `DESIGN_SYSTEM.md` **solo dentro de la Torre de
> control** mientras dure la transición. El resto del producto sigue en el ADN
> Retell hasta que se apruebe la migración. No mezclar ambos en una misma
> pantalla.

---

## 1. Tesis

**El color es un dato, no una decoración.**

La interfaz es acromática — pizarra fría y luz — y lo único saturado en pantalla
es información: riesgo, estado y ola comercial. Esto resuelve de raíz el problema
que tiene todo tablero con mapa: un coroplético pinta la pantalla entera de
color, y si el cromo también tiene color, nada se lee.

Consecuencias que no se negocian:

- El acento de interfaz **nunca** pinta datos. Si pintara zonas, dejaría de
  significar "esto responde a tu clic".
- Toda escala de color lleva **codificación secundaria** (el número visible).
- La rampa de riesgo avanza en **luminancia además de tono**, para que sobreviva
  al daltonismo y a un proyector malo en la sala de operaciones.

## 2. Dark-first

Se diseña oscuro y se adapta claro, no al revés. No es preferencia estética: es
una consola que se mira ocho horas seguidas, muchas veces de madrugada, y hoy es
el estándar en interfaces de monitoreo.

El modo claro **no es una inversión de valores**. Sobre fondo claro la rampa se
recalibra: el "calmo" sube de valor y el "crítico" baja, para conservar el mismo
orden perceptual.

## 3. Tokens

### Cromo (oscuro)

| Token | Valor | Uso |
| --- | --- | --- |
| `--s-bg` | `#0B0F14` | Fondo de la consola. Nunca negro puro: produce halación en OLED |
| `--s-1` | `#131A22` | Superficie de panel |
| `--s-2` | `#1A232D` | Elevada: control, chip |
| `--s-3` | `#212D38` | Estado activo |
| `--s-line` | `#232F3B` | Línea por defecto |
| `--s-line-2` | `#31404E` | Línea enfatizada |
| `--s-tx` | `#E6EDF3` | Texto principal |
| `--s-tx-2` | `#8FA3B5` | Secundario |
| `--s-tx-3` | `#5F7286` | Metadatos |
| `--s-focus` | `#7D93FF` | Único acento: foco, selección, conductores |

### Cromo (claro)

`#FBFCFD` fondo · `#FFFFFF` superficie · `#E3E8EE` línea · `#0F1720` texto ·
`#3A4FD6` acento.

### Rampa de riesgo

| Puntaje | Oscuro | Claro | Etiqueta |
| --- | --- | --- | --- |
| 0–19 | `#33424E` | `#8FA0B8` | Calmo |
| 20–39 | `#2D7A8C` | `#3C7F90` | Bajo |
| 40–59 | `#C9A227` | `#A8861B` | Medio |
| 60–79 | `#D97036` | `#B85C28` | Alto |
| 80–100 | `#D64545` | `#B03434` | Crítico |

Aplicar con expresiones `step` de MapLibre sobre `feature-state`, no con lógica
por feature en JavaScript.

### Ola comercial

Ocre `#C9A227` sobre un lavado del 9 % hacia la derecha. Es la única banda del
producto con un degradado, y existe para que la ola se distinga de una alerta:
la ola no es un problema, es una previsión.

## 4. Tipografía

Inter Variable (UI) y una monoespaciada (datos), **auto-hospedadas** — nunca
desde CDN.

| Rol | Tamaño / peso | Uso |
| --- | --- | --- |
| Título de vista | 20 / 600 | Uno por pantalla |
| Métrica | 19 / 600 · mono | Pedidos, CLP, puntaje |
| Título de excepción | 13 / 600 | Encabezado de alerta |
| Cuerpo | 12–13 / 400 | Explicación y desglose |
| Etiqueta | 10.5 / 500 · `+0.12em` | Versalitas de sección |

**Todo número va en monoespaciada con `tabular-nums`**: hora, dinero, puntaje,
conteo. En un tablero que se refresca solo, los dígitos que cambian de ancho al
actualizarse son el delator número uno de software barato.

## 5. Movimiento

Curva única `cubic-bezier(.2, 0, 0, 1)`.

| Interacción | Duración | Detalle |
| --- | --- | --- |
| Hover de zona | 120 ms | Opacidad vía `feature-state`, jamás recargando la fuente |
| Selección de zona | 180 ms | El resto del mapa baja a 45 % — foco por atenuación, no por brillo |
| Riel de detalle | 180 ms | Entra 12 px desde la derecha con fade |
| Cámara zona → comuna | 260 ms | `easeTo`, sin vuelo cinematográfico |
| Alerta nueva | 200 ms | Fade + 8 px y resalte breve, una sola vez |

**Prohibido**: pines que laten, glow, partículas, contadores que suben solos,
tilt 3D, vista globo. Una animación infinita en un tablero que vive abierto todo
el día quema GPU y no informa nada. `prefers-reduced-motion` colapsa todo a
cambio de estado instantáneo.

**Translucidez controlada**: `backdrop-filter` solo en las superficies flotantes
sobre el mapa (conmutador de capas y leyenda), porque ahí comunica capa sobre
mapa. Es caro sobre un mapa que se mueve — nunca en paneles grandes.

## 6. Reglas de la consola

1. **Silencio por defecto.** Sin riesgo, lo dice en una línea y se calla.
2. **Tres niveles.** Mapa = *dónde*; zona = *por qué*; factor = *qué hago*.
3. **Dos capas activas como máximo.** El conmutador ofrece más; la consola lo
   impide.
4. **Teclado primero.** Paleta de comandos `⌘K`: saltar a zona, cambiar
   horizonte, encender capa, buscar pedido.
5. **La frescura es confianza.** Cada fuente muestra su edad; si se cae, la capa
   se marca degradada con su motivo.
6. **Equivalente sin mapa.** Lista de zonas por riesgo, navegable con teclado,
   sobre los mismos datos. Es accesibilidad y es la vista de celular.

## 7. Lo que se descartó a propósito

| Tendencia 2026 | Por qué no |
| --- | --- |
| Grilla bento | Fragmenta la atención. Una consola operativa necesita un lienzo dominante, no seis cajas iguales |
| Glassmorphism generalizado | Solo en superficies flotantes sobre el mapa; en paneles grandes es costo de GPU sin significado |
| IA como protagonista | A lo más, una línea de resumen generada del desglose ya calculado. El motor es determinístico y explicable |
| Mapa 3D / extrusión / globo | Impresiona en la demo y estorba al tercer día |
| Semáforo verde-ámbar-rojo | Falla en daltonismo y grita a diario. La rampa secuencial reserva el rojo para el umbral crítico |

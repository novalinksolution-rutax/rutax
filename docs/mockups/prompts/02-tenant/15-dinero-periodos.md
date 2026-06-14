## BLOQUE ADN DE DISEÑO — Rutax

Genera un mockup de interfaz de usuario (UI) de **alta fidelidad**, con aspecto de captura de pantalla de una aplicación web real, no un wireframe ni una ilustración. Es una **herramienta operativo-financiera B2B** (un SaaS serio para empresas de última milla / couriers en Chile), NO una landing de marketing: sobria, limpia, densa de información donde corresponde, profesional. Marca del producto: **Rutax**. TODO el texto en **español de Chile**, perfectamente legible y ortográficamente correcto.

**Modo claro únicamente.** Lienzo de fondo gris muy claro (casi blanco, equivalente a `oklch(0.97 0 0)`); las tarjetas y la barra superior son blancas. Sensación general: aire, alineación impecable sobre una rejilla de 4px, jerarquía construida con espacio en blanco y peso tipográfico más que con líneas y cajas.

**Tipografía:** sans-serif geométrica moderna tipo *Geist* / *Inter*, con buen interletrado. Títulos en peso semibold/bold; cuerpo en regular; etiquetas de sección en MAYÚSCULAS pequeñas, color gris medio, con tracking amplio. Todos los **números, montos, fechas y RUT en cifras tabulares monoespaciadas** (tipo *Geist Mono*), alineados por dígito.

**Paleta — fundamentalmente MONOCROMÁTICA y neutra.** Fondo gris claro, tarjetas blancas, bordes gris muy sutil de 1px (`oklch(0.922 0 0)`), esquinas redondeadas ~10px, sombras de muy baja opacidad (apenas perceptibles). Texto principal casi negro (`oklch(0.145)`), texto secundario gris medio (`oklch(0.556)`). El **único color de marca es un azul navy profundo (no brillante), `oklch(0.38 0.13 264)`**, reservado SOLO para la acción primaria (botón principal), enlaces, ítem de navegación activo y anillo de foco de teclado. El navy es un recurso escaso: si todo fuera azul, nada destacaría.

**Aparte del navy de marca, el color aparece SOLO en badges de estado y alertas.** Los badges son "pills" redondeadas, pequeñas (alto ~20px), texto en minúscula tipo oración, peso medium, con **fondo tenue (subtle) y texto del mismo tono pero más oscuro**, sin borde visible. Mapa de color de estado EXACTO (respétalo al pie de la letra; supera cualquier descripción más libre):
- **Verde** (fondo verde muy pálido + texto verde oscuro) = éxito: *entregado, entregado (corrección), completado, facturado, resuelto, conciliado, pagado, pagada, aceptado por SII*.
- **Ámbar/amarillo** (fondo ámbar pálido + texto ámbar oscuro) = advertencia / en gestión: *pendiente de asignación, devuelto, en gestión, borrador (manifiesto), pendiente (conciliación), sin atribuir, pago parcial, sobrante, por cobrar, aceptado con observaciones (SII)*.
- **Rojo** (fondo rojo pálido + texto rojo oscuro) = fallo / abierto / error: *fallido, fallido (corrección), abierta (incidencia), anulado, rechazado por SII*.
- **Azul** (fondo azul pálido + texto azul oscuro) = en proceso / informativo: *asignado, en ruta, confirmado, abierto (período), emitida (liquidación), revisado, atribuido*.
- **Gris neutro** (fondo gris claro + texto gris) = inactivo / cerrado: *cancelado, cerrada, cerrado, borrador (liquidación), ignorado, descartado, sin cobro*.
- **Navy de marca** (fondo navy muy tenue + texto navy) = etiqueta de marca puntual.
El color NUNCA es el único portador del significado: el badge siempre lleva su texto.

**Moneda:** pesos chilenos con formato `$ 1.234.567` — punto como separador de miles, sin decimales, sin sufijo "CLP". Montos negativos en rojo tenue con signo; el valor cero se muestra como "—".

**Componentes (look shadcn/ui sobre Radix):** botón primario navy relleno (texto blanco, esquinas ~8px) — UNO solo por pantalla; botones secundarios con borde gris y fondo blanco; botones terciarios solo texto. Tablas con encabezado en fondo gris muy claro, texto de encabezado gris en mayúsculas pequeñas, filas separadas por líneas horizontales finas (SIN líneas verticales), hover sutil de fila, columnas numéricas alineadas a la derecha. Tarjetas blancas con borde 1px y sombra mínima. Inputs con etiqueta arriba, borde gris, foco con anillo navy. Tabs, chips/contadores y menús con la misma familia visual. Íconos de línea estilo *lucide*, finos, gris, ~16px.

**Calidad:** alineación perfecta, espaciado consistente; nada de texto falso ilegible, nada de degradados decorativos, nada de sombras duras, nada de emojis. Pulcro, calmado, confiable — debe "sentirse serio con el dinero".

---

VISTA: `/dinero/periodos` — Períodos de cobro
DISPOSITIVO: escritorio 16:10
CONTEXTO: Tablero de períodos de cobro al seller (el corazón del módulo Dinero): chips de resumen, filtros y tabla con estado del período, montos CLP, estado de cobro y estado SII. Sub-navegación por pestañas del módulo Dinero.
ESTRUCTURA (backoffice del courier, idéntica a las demás `(tenant)`): barra lateral izquierda blanca con marca "Flex Couriers SpA" y navegación agrupada (Dashboard; OPERACIÓN; DINERO: Períodos/Liquidaciones/Conciliación/Pagos; CONFIGURACIÓN); ítem activo "Períodos". Barra superior con campana de avisos y nombre de usuario "Camila Rojas". Contenido centrado máx ~1150px sobre gris claro.
SUB-NAVEGACIÓN del módulo Dinero (fila de pestañas bajo una línea fina, encima del contenido): "Períodos de cobro" (activa), "Liquidaciones", "Conciliación" (con badge ámbar de conteo si hay pendientes). 
LAYOUT del contenido:
- Título "Períodos de cobro" (bold ~24px).
- Fila de **chips** redondeados de resumen, con número en negrita y color tenue: "Abiertos: 4" (azul), "Cerrados: 2" (gris), "Facturados: 9" (verde), "Anulados: 1" (rojo), "Con problemas: 1" (rojo).
- Barra de filtros: selectores "Seller" y "Estado", botón primario navy "Filtrar".
- Tabla dentro de tarjeta blanca. Columnas: **Seller** (negrita), **Período** (rango de fechas dd/mm/aaaa, mono), **Estado** (badge: azul "Abierto", gris "Cerrado", verde "Facturado — Folio 1042", rojo "Anulado"), **Líneas** (a la derecha), **Monto total** (a la derecha, negrita CLP), **Cobro** (badge: ámbar "Por cobrar", verde "Pagado", ámbar "Pago parcial"), **Estado SII** (badge con ícono: verde-check "Aceptado por SII", ámbar-triángulo "Aceptado con observaciones", gris-reloj "Pendiente SII"), y a la derecha acciones ("Ver detalle", "Ver PDF") o un botón "Cerrar período" si está abierto.
- Pie de tabla con conteo "Mostrando 12 de 16 períodos".
DATOS DE EJEMPLO (ilustrativos): sellers "Tienda Aurora", "ElectroHogar", "Boutique Lila"; períodos 01/06/2026 – 15/06/2026; montos $ 1.240.500, $ 860.000, $ 2.310.000.
NOTA DE CONVERGENCIA: chips, badges de estado de período/SII/cobro y montos CLP exactamente con el set. La sub-navegación por pestañas se repite igual en Conciliación y Liquidaciones. Shell idéntico al resto del backoffice.

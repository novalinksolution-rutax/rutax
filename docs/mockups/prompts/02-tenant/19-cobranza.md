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

VISTA: `/dinero/cobranza` — Revisión de pagos (cobranza courier→seller)
DISPOSITIVO: escritorio 16:10
CONTEXTO: Bandeja de pagos recibidos de los sellers que aún no calzan solos con una factura; se atribuyen al seller/período correcto o se descartan. Abajo, una sección de "conciliados recientemente" como confirmación.
ESTRUCTURA (backoffice del courier, idéntica a las demás `(tenant)`): barra lateral izquierda blanca con marca "Flex Couriers SpA" y navegación agrupada (Dashboard; OPERACIÓN; DINERO: Períodos/Liquidaciones/Conciliación/Pagos; CONFIGURACIÓN); ítem activo "Pagos". Barra superior con campana de avisos y nombre de usuario. Contenido centrado máx ~1150px sobre gris claro.
LAYOUT del contenido:
- Título "Revisión de pagos" (bold ~24px) y subtítulo gris: "Pagos recibidos de tus sellers que aún no calzan solos con una factura. Atribúyelos al seller y período correctos, o descártalos si no son cobranzas."
- Tabla "Pagos por revisar" en tarjeta. Columnas: **Fecha** (mono), **Monto** (derecha, negrita CLP), **Contraparte** (nombre + RUT mono debajo), **Seller** (o "—"), **Estado** (badge: ámbar "Sin atribuir", azul "Atribuido", ámbar "Pago parcial"/"Sobrante"), y a la derecha un menú kebab (atribuir manualmente / descartar).
- Sección "CONCILIADOS RECIENTEMENTE" (solo lectura): tabla similar con badge verde "Conciliado"; pie con enlace navy "Períodos de cobro".
- VARIANTE alternativa (referencia, bandeja vacía): tarjeta con borde punteado, ícono de check en círculo verde tenue, "No hay pagos por revisar" y "Todos los pagos recibidos se atribuyeron y conciliaron solos."
DATOS DE EJEMPLO (ilustrativos): contrapartes "Comercial ElectroHogar Ltda." (RUT 77.111.222-3), "Tienda Aurora SpA"; montos $ 860.000, $ 1.240.500; fechas 12/06/2026.
NOTA DE CONVERGENCIA: badges de estado de pago del set (ámbar/azul/verde/gris), montos CLP tabulares. Misma tabla y shell del backoffice.

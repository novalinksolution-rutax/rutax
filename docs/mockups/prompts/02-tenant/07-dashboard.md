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

VISTA: `/dashboard` — Dashboard operativo del dueño
DISPOSITIVO: escritorio 16:10
CONTEXTO: Pantalla de inicio del courier interno (dueño/admin): el pulso operativo y financiero del día de un vistazo — KPIs, distribución por estado, comunas, incidencias sin gestión y accesos rápidos.
ESTRUCTURA (backoffice del courier, idéntica en todas las vistas `(tenant)`): barra lateral izquierda fija (~240px), blanca, con la marca **"Flex Couriers SpA"** arriba; navegación AGRUPADA por objetivo, con etiquetas de grupo en mayúsculas pequeñas grises e ítems con ícono de línea: (sin grupo) **Dashboard**; grupo **OPERACIÓN** → Pedidos, Manifiestos, Incidencias; grupo **DINERO** → Períodos, Liquidaciones, Conciliación, Pagos; grupo **CONFIGURACIÓN** → Configuración, Equipo, Sellers, Exportar datos. El ítem activo va resaltado en navy tenue con texto navy. Al pie de la barra, botón discreto "Cerrar sesión" con ícono. Arriba, barra superior blanca fina con, a la derecha, un ícono de campana (centro de avisos, con punto de aviso) y el nombre del usuario "Camila Rojas". Contenido centrado en una columna de ancho máx ~1150px sobre fondo gris claro.
LAYOUT del contenido (de arriba hacia abajo), con "Dashboard" como ítem activo:
- Título "Dashboard operativo" (bold ~24px).
- Banda de alerta de folios CAF (solo si aplica): franja sólida ámbar con ícono de triángulo, texto "Folios CAF por agotarse — quedan 32 folios" y botón claro "Subir CAF".
- Sección "HOY" (etiqueta en mayúsculas pequeñas): grilla de 5 tarjetas KPI blancas, cada una con un ícono en cuadro gris arriba, número grande tabular y etiqueta: "2 de 5" Conductores listos hoy · "148" Total del día · "92%" Tasa de entrega (número en verde) · "37" En ruta ahora · "11" Pendientes de asignación (con enlace navy "Asignar ahora").
- Sección "DINERO DEL MES": a la derecha del título, "3 de 5 períodos facturados"; tres tarjetas: "Comprometido $ 8.640.000" · "Cobrado $ 5.120.000" (verde) · "Por cobrar $ 3.520.000" (ámbar).
- Sección "DISTRIBUCIÓN POR ESTADO": tarjeta con filas de barra de progreso horizontal; etiqueta de estado a la izquierda, barra (verde=Entregado, azul=En ruta, ámbar=Pendiente de asignación, etc.) y cantidad a la derecha.
- Sección "PAQUETES POR COMUNA": tarjeta con lista; cada fila con ícono de pin, nombre de comuna y un badge gris con el número.
- Sección "INCIDENCIAS SIN GESTIÓN (más de 4 horas)": tarjeta con borde rojo tenue; filas con tipo de incidencia y badge rojo "Sin gestión: 6h"; pie con enlace navy "Ver todas las incidencias".
- Sección "ACCESOS RÁPIDOS": tres botones secundarios (borde) anchos con ícono en cuadro gris: "Ver todos los pedidos", "Gestionar sellers", "Gestionar equipo".
DATOS DE EJEMPLO (ilustrativos): comunas Maipú, Las Condes, Puente Alto, Ñuñoa; incidencias "Destinatario ausente", "Dirección incorrecta"; usuaria "Camila Rojas".
NOTA DE CONVERGENCIA: el shell (barra lateral + barra superior) debe verse idéntico en todas las vistas del backoffice. Tarjetas, badges de estado y tipografía exactamente como el resto del set; los números en cifras tabulares.

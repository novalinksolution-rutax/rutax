# UX_STRATEGY.md — Estrategia de experiencia de Rutax

> **Qué es este documento.** La definición de la **experiencia ideal** del producto — no su diseño de pantallas. Establece qué debe *sentir* quien usa Rutax, cómo se comporta el sistema, cómo se mueve la información y cómo responde a cada acción. Es el contrato de experiencia que UX/UI, UX Writer y Frontend deben honrar al maquetar las pantallas existentes.
>
> **Fuente de verdad.** Derivado de [PROJECT_AUDIT.md](PROJECT_AUDIT.md), [PRODUCT_BLUEPRINT.md](PRODUCT_BLUEPRINT.md), [UX_READINESS_REPORT.md](UX_READINESS_REPORT.md) y las decisiones cerradas en [BRIEF_DECISIONES_UX.md](BRIEF_DECISIONES_UX.md). No inventa funcionalidades: viste lo que ya está implementado y verificado E2E.
>
> **Principios de referencia (analizados, no copiados).** Linear (velocidad percibida, claridad, baja fricción, minimalismo funcional) · Stripe (profesionalismo, confianza, claridad empresarial) · Duolingo (feedback inmediato, microinteracciones, detalle obsesivo) · Notion (organización, escalabilidad de información, simplicidad cognitiva).
>
> **Marca.** Rutax — serio, versátil, inspira confianza. Primario azul navy provisional. Español de Chile, CLP, zona Santiago.
>
> **Fecha:** 2026-06-13 · **Rama:** master

---

## Punto de partida: tres audiencias, una sola alma

Rutax no tiene un usuario: tiene tres, con tiempos, dispositivos y estados emocionales opuestos. La estrategia de experiencia se construye sobre esa tensión y la resuelve con un solo principio de marca expresado en tres dialectos.

| Audiencia | Contexto de uso | Estado emocional dominante | Dialecto de experiencia |
|---|---|---|---|
| **Courier interno** (dueño, supervisor, coordinador, administración) | Escritorio, sesiones largas, multi-tarea, día operativo bajo presión | "Necesito que el día salga y que el dinero cuadre" | **Denso pero legible.** Densidad de información alta, navegación por capacidad, acciones financieras con fricción deliberada. |
| **Seller** | Escritorio/móvil, visitas cortas y esporádicas, baja frecuencia | "¿Dónde está mi envío y cuánto me cobran?" | **Tranquilizador y transaccional.** Cero jerga operativa, respuestas antes que preguntas, confianza por transparencia. |
| **Conductor** | Móvil, en la calle, una mano, batería y datos limitados, **usa dos apps** | "¿Cuál es mi ruta y cuánto me toca?" | **Mínimo y a prueba de pulgar.** Lo esencial, grande, offline-tolerante, sin nada que distraiga del reparto. |

> **El alma común:** *Rutax convierte trabajo invisible (la trastienda de dinero) en certeza visible.* Las tres audiencias comparten un mismo sentimiento objetivo: **"acá los números cuadran y no tengo que revisarlos a mano."** Todo lo que sigue sirve a ese sentimiento.

---

# SECCIÓN 1 — EXPERIENCE DNA

El ADN de experiencia de Rutax. Estos principios no son aspiraciones decorativas: son reglas de decisión. Ante cualquier disyuntiva de diseño, se resuelve a favor del principio.

## 1.1 Principios UX (qué experiencia entregamos)

**P1 — El dinero antes que el mapa.** El diferenciador es el motor entrega→dinero, no el ruteo. La experiencia debe hacer *sentir* esa diferencia: lo financiero (cobros, liquidaciones, conciliación) es el héroe visual y conceptual; lo operativo (asignar, manifiestos) es el medio. Nunca enterrar el estado financiero del día bajo capas operativas.

**P2 — Mostrar el lazo, no los pasos.** El usuario no piensa en "líneas de cobro" ni "períodos cerrados"; piensa en "entregué 120 paquetes, ¿cuánto cobro y a quién?". La experiencia hace visible el **lazo completo entrega→cobro→liquidación→conciliación** como una narrativa continua, no como módulos desconectados que el usuario debe reconectar mentalmente.

**P3 — Cada rol ve su mundo, completo y nada más.** Lo que un rol no puede hacer, **no lo ve** (ya impuesto en `barra-superior.tsx` por capacidad). Esto no es solo seguridad: es simplicidad cognitiva (Notion). Un coordinador no debería intuir que existe un módulo de dinero que le está vedado; su Rutax *es* la operación, completa y sin huecos.

**P4 — Confianza por transparencia, no por opacidad.** El seller confía porque *ve* (su tracking, el desglose de su cobro, por qué se le cobró eso), no porque se le pida confiar. Stripe enseña que la claridad empresarial *es* la confianza. Nunca esconder el "por qué" de un número.

**P5 — Fricción proporcional a la consecuencia.** Casi todo debe ser rápido y de baja fricción (Linear). Pero la emisión de un DTE es **irreversible ante el SII**: ahí la fricción es una virtud, no un defecto. La experiencia calibra el esfuerzo requerido al costo de equivocarse — instantáneo para lo reversible, deliberado para lo que no tiene vuelta atrás.

**P6 — Honestidad sobre el estado real.** No prometemos lo que el sistema no hace. Hoy las notificaciones son **in-app** (no email): el copy dice "revisa tus avisos aquí", nunca "te enviaremos un correo". La confianza se rompe una sola vez.

## 1.2 Principios de interacción (cómo responde el sistema)

**I1 — Respuesta inmediata, verdad eventual.** Toda acción del usuario produce una reacción visible en <100 ms (optimismo de UI), incluso si el trabajo real corre como job idempotente en segundo plano. El sistema *nunca* se queda mudo esperando al backend.

**I2 — El estado del sistema siempre es legible.** En cualquier momento el usuario puede responder "¿qué está pasando?" sin adivinar: conexión ML sana/caída, período abierto/cerrado/facturado, pago atribuido/pendiente. Los estados ya están traducidos y coloreados (`traduccion-estados.ts`); la interacción los hace omnipresentes, no escondidos en un detalle.

**I3 — Una acción primaria por pantalla.** Cada vista tiene *una* cosa que el usuario vino a hacer, jerárquicamente dominante. Las acciones secundarias existen pero no compiten. (El conductor que abre la PWA: la acción es "ver mi ruta / listo para salir", nada más.)

**I4 — Las acciones destructivas o irreversibles se confirman; las reversibles, no.** Reasignar un pedido: directo. Emitir un DTE o una nota de crédito: confirmación explícita con consecuencia escrita. No pedir confirmación de lo trivial (erosiona la atención cuando importa de verdad).

**I5 — El trabajo pesado es del sistema, no del usuario.** Ingesta, facturación, liquidación, conciliación corren como jobs. La interacción nunca bloquea al usuario esperando un proceso pesado: se dispara, se confirma el encargo, y el resultado aparece cuando está listo.

## 1.3 Principios de simplicidad (qué quitamos)

**S1 — Densidad sin ruido.** El courier interno necesita ver mucho (Linear demuestra que densidad ≠ desorden). Simplicidad aquí no es "menos datos", es **jerarquía implacable**: lo crítico grande y arriba, lo secundario disponible pero callado. Nada decorativo compite con la información.

**S2 — El vocabulario del usuario, no el del sistema.** "Cobros", "lo que te toca", "tu ruta de hoy" — no "líneas de cobro generadas", "lineas_liquidacion", "período en estado cerrado". El modelo de datos es nuestro problema, no del usuario.

**S3 — Cero pasos ceremoniales.** Si un paso no agrega decisión ni información para el usuario, se elimina o se automatiza. El mejor onboarding del seller es el que casi no existe: invitación → conectar ML → listo.

**S4 — Progresividad: revelar a medida que se necesita.** No mostrar la complejidad de la facturación a quien solo quiere ver el dashboard. Notion enseña que la información escala cuando se divulga en capas: lo esencial primero, el detalle a un clic.

**S5 — Una sola forma de hacer cada cosa.** Cinco `boton-descarga-*` distintos son cinco formas de la misma acción: consolidar en un patrón único. Consistencia = menos carga cognitiva = más confianza.

## 1.4 Principios de feedback (Duolingo, sin gamificar)

**F1 — Nada ocurre en silencio.** Toda acción tiene acuse de recibo inmediato y específico: qué pasó, sobre qué objeto, con qué resultado. El silencio es el peor estado posible — genera la duda de "¿se guardó?".

**F2 — El feedback es específico, no genérico.** No "Operación exitosa" sino "Factura folio 1042 emitida para Comercial XYZ — $1.240.500". El detalle obsesivo de Duolingo aplicado a un contexto serio: el usuario sabe *exactamente* qué cambió en el mundo.

**F3 — El error enseña el camino de salida.** Un error nunca es un callejón: dice qué pasó, por qué, y qué hacer ahora. "No se pudo emitir: el período debe estar cerrado antes de facturar. Ciérralo primero." — no "Error 42501".

**F4 — Microinteracciones que confirman, no que entretienen.** Una transición de estado (pedido → entregado) se *anima* lo justo para que el ojo registre el cambio. No celebramos con confeti (esto es dinero serio), pero tampoco dejamos que un cambio importante pase desapercibido. El detalle se siente; no se exhibe.

**F5 — El sistema confirma el encargo de inmediato y el resultado cuando llega.** Como el trabajo es asíncrono, hay dos feedbacks: "recibido, lo estamos procesando" (instantáneo) y "listo, este es el resultado" (cuando el job termina). Ambos son explícitos.

---

# SECCIÓN 2 — EXPERIENCE GOALS

Las cinco percepciones que el usuario debe tener. Para cada una: qué significa aquí, y **cómo se logra** con lo que el producto ya hace.

## 2.1 Claridad — *"entiendo qué pasa y qué se espera de mí"*

**Qué significa en Rutax.** En cada pantalla, el usuario sabe qué está viendo, qué puede hacer, y qué significa cada número y cada estado — sin manual.

**Cómo se logra:**
- **Una acción primaria visualmente inequívoca** por pantalla (I3). El ojo encuentra "qué hago acá" en menos de un segundo.
- **Estados con lenguaje y color consistentes** en toda la app, reusando `traduccion-estados.ts` — un "entregado" verde es el mismo verde en operación, en dinero y en el portal del seller.
- **El "por qué" siempre a un clic.** El monto de un cobro despliega su desglose (tarifa + ajuste por incidencia). Nunca un número sin origen.
- **Vocabulario del usuario** (S2), no del esquema. Glosario implícito: el sistema habla como habla el courier.
- **Vacío explicado.** Una pantalla sin datos dice por qué está vacía y qué hacer (ver Sección 6).

## 2.2 Velocidad — *"esto vuela"* (percibida antes que real)

**Qué significa en Rutax.** El courier opera contra el reloj (la ruta sale en la mañana). La app debe sentirse instantánea, especialmente en las acciones repetidas decenas de veces al día (asignar, cambiar estado).

**Cómo se logra:**
- **UI optimista** (I1): la asignación de un pedido, el cambio de estado, se reflejan al instante; el job confirma después. El usuario no espera al servidor para *ver* el resultado.
- **Navegación sin recargas** y skeletons que preservan el layout (Sección 6) — la percepción de carga se reduce mostrando la estructura antes que el dato.
- **Acciones masivas donde el volumen lo pide.** Asignar muchos pedidos a un manifiesto no debe ser de a uno.
- **Atajos para el poder-usuario interno** (Linear): el supervisor que asigna 200 pedidos diarios merece teclado, no solo mouse. *(Mejora — ver Sección 7.)*
- **Lo pesado no bloquea** (I5): facturar un período devuelve el control de inmediato; el DTE se emite en segundo plano.

## 2.3 Confianza — *"acá los números cuadran"*

**Qué significa en Rutax.** Es *la* percepción central — el producto entero existe para reemplazar la desconfianza de la planilla manual. El usuario debe creer, sin verificar a mano, que cobró todo lo que entregó y pagó lo correcto.

**Cómo se logra:**
- **Transparencia del lazo** (P2/P4): se puede trazar cada peso desde la entrega que lo originó. Entregado → línea de cobro → período → factura → pago conciliado, visible de punta a punta.
- **Conciliación visible como tranquilidad, no como alarma.** "0 descuadres este período" es un mensaje de confianza tan importante como detectar uno.
- **La compuerta humana de facturación se *siente* como control** (P5): ningún DTE se emite solo; la persona aprueba, y el sistema lo deja claro.
- **Estética sobria de marca** (Stripe + navy Rutax): el profesionalismo visual comunica solidez financiera. Esto maneja dinero ajeno; debe verse como que lo sabe.
- **Honestidad de estado** (P6): si una conexión ML está caída, se dice con franqueza, no se disimula. La confianza se gana también admitiendo problemas.

## 2.4 Control — *"yo decido, el sistema ejecuta"*

**Qué significa en Rutax.** El usuario nunca siente que el sistema actúa a sus espaldas en lo que importa (el dinero). Tiene la última palabra sobre lo irreversible y puede corregir lo reversible.

**Cómo se logra:**
- **Compuerta humana explícita** en facturación: el sistema prepara, el humano emite (P5, I4).
- **Confirmaciones a la altura de la consecuencia.** Emitir DTE / nota de crédito: confirmación con la consecuencia escrita en palabras ("Esto emite un documento tributario irreversible ante el SII"). Reagendar: directo.
- **Reversa donde existe.** Atribuir/descartar un pago, corregir un estado manualmente, anular un período — el sistema ofrece la corrección y la audita.
- **Previsualización antes de comprometer.** Antes de emitir, el usuario ve qué se va a facturar (líneas, monto, seller). Nada se firma a ciegas.
- **Navegación por capacidad** (P3): el control de cada rol está acotado a su mundo; nadie puede romper lo que no le corresponde.

## 2.5 Fluidez — *"una cosa lleva a la otra sin que tenga que pensar"*

**Qué significa en Rutax.** Los flujos se encadenan según el objetivo del usuario, no según la estructura de módulos. Terminar una tarea sugiere naturalmente la siguiente.

**Cómo se logra:**
- **Continuidad del lazo** (P2): cerrar un período conduce visualmente a "revisar conciliación" y luego a "emitir factura" — el camino financiero es una corriente, no islas que el usuario debe buscar en el menú.
- **Contexto que viaja.** Desde un pedido se llega a su incidencia, su línea de cobro, su manifiesto, sin perder el hilo. Desde una factura, al seller y al período que la originó.
- **Cero callejones.** Toda pantalla terminal ofrece el siguiente paso lógico o el regreso claro. Un empty state es una invitación, no un muro.
- **Onboarding como secuencia guiada** (`banner-onboarding.tsx`): el courier nuevo es llevado de un paso al siguiente (DTE → folios → tarifas → sellers) sin tener que saber cuál sigue.

---

# SECCIÓN 3 — CUSTOMER JOURNEY

Journeys ideales **por objetivo del usuario**, no por pantalla. La pregunta de cada etapa no es "¿qué pantalla ve?" sino "¿qué quiere lograr y cómo se debe sentir?".

## 3.1 Courier / Dueño — *"que mi negocio cobre todo lo que entrega"*

| Etapa | Objetivo del usuario | Experiencia ideal | Métrica de éxito (emocional) |
|---|---|---|---|
| **Llegada** | "Quiero probar si esto me ordena el dinero" | Registro sin fricción; promesa clara desde la primera pantalla: *acá tu trastienda de dinero se cierra sola*. | "Entendí qué hace en 30 segundos." |
| **Activación** | "Dejarlo listo para operar" | Onboarding guiado como una sola secuencia con progreso visible (DTE → folios → tarifas → invitar sellers/conductores). Cada paso explica *por qué* importa. Nunca abrumar: un paso a la vez. | "Lo configuré sin llamar a soporte." |
| **Primer lazo (momento aha)** | "Ver el primer cobro generarse solo" | La primera entrega que produce su línea de cobro + liquidación, visible y trazable, es **el momento que convierte**. La experiencia debe celebrarlo con sobriedad: *"Tu primera entrega ya generó su cobro y su liquidación, conciliados."* | "Vi cuadrar el primer peso sin tocar una planilla." |
| **Uso recurrente** | "Saber, de un vistazo, cómo va el día y el dinero" | Dashboard que responde en 3 segundos: comprometido vs entregado, conductores listos, incidencias, salud de conexiones, y el estado financiero del período. Las alarmas (folios bajos, morosidad) llegan in-app, claras y accionables. | "Abro Rutax y sé si tengo que preocuparme o no." |
| **Cierre financiero** | "Facturar el período con confianza" | Cerrar → ver conciliación (¿cuadra?) → aprobar y emitir, con la consecuencia clara. Control total sobre el punto irreversible. | "Facturé tranquilo, sabiendo que cuadraba." |
| **Retención** | "Dejar la planilla para siempre" | Cada ciclo refuerza que el dinero cuadra solo. El valor es acumulativo: mientras más opera, más confía. | "Ya no podría volver a las planillas." |

## 3.2 Seller — *"¿dónde está mi envío y cuánto me cobran?"*

| Etapa | Objetivo del usuario | Experiencia ideal | Métrica de éxito (emocional) |
|---|---|---|---|
| **Llegada** | "El courier me invitó, ¿qué hago?" | Invitación → activación → una sola acción clara: conectar Mercado Libre. Sin tour, sin distracción. | "Me tomó dos minutos." |
| **Activación** | "Que mis envíos lleguen al courier solos" | Conexión OAuth con feedback inequívoco de éxito: *"Conexión sana — tus pedidos llegan automáticamente."* La salud de la conexión es siempre visible. | "Sé que está conectado y funcionando." |
| **Uso recurrente** | "Saber dónde están mis envíos sin preguntar" | Tracking propio, claro, en lenguaje de seller (no de courier). Responde la pregunta antes de que llame. | "No tuve que escribirle al courier." |
| **Momento sensible: el cobro** | "Entender cuánto me cobran y por qué" | Estado de cuenta transparente: el monto con su desglose, la factura descargable. Cero sorpresas. La transparencia *es* la retención. | "El cobro fue exactamente lo que esperaba." |
| **Incidencia / conexión caída** | "Algo pasó con mi envío/conexión" | Aviso in-app honesto y accionable: qué pasó y qué hacer (reconectar self-service). Nunca prometer un correo que no llega. | "Me enteré a tiempo y lo resolví solo." |

## 3.3 Conductor — *"mi ruta y mi pago"*

| Etapa | Objetivo del usuario | Experiencia ideal | Métrica de éxito (emocional) |
|---|---|---|---|
| **Llegada** | "El courier me dio acceso" | Abrir la PWA en el celular y ver de inmediato lo único que importa: su día. Sin configuración. | "Lo abrí y entendí al toque." |
| **Inicio de jornada** | "¿Cuál es mi ruta hoy?" | Manifiesto del día, paradas ordenadas, grande y legible a una mano. Un botón: "Listo para salir". | "Sé exactamente a dónde voy." |
| **En ruta** | "Ver el detalle de la próxima parada" | Información esencial por parada, sin ruido. **Convive con la app de Flex** (obligatoria, no integrable) — Rutax no compite con ella, la complementa. No pide POD (no le corresponde). | "No me estorba mientras reparto." |
| **Cierre / pago** | "¿Cuánto me toca y por qué?" | Liquidación clara: cuántas entregas, cuánto suma, descargable. Sin disputas porque todo es trazable. | "Sé cuánto cobro y no tengo que reclamar." |

> **Tensión de diseño asumida (no resoluble):** el conductor usa dos apps. La estrategia no la pelea — la minimiza: Rutax debe ser tan liviano y enfocado que sumar su uso al de Flex no genere carga. Cada elemento que no sea "mi ruta" o "mi pago" es candidato a eliminarse de su vista.

---

# SECCIÓN 4 — USER FLOWS

Optimización de los flujos **ya implementados**. Para cada uno: la fricción a eliminar y el estado ideal. No se inventan flujos nuevos; se afinan los existentes.

## 4.1 Onboarding del courier (DTE → folios → tarifas → cobranza → sellers)

- **Fricción a eliminar:** percepción de "muchos pasos sueltos"; no saber cuánto falta; abandonar a mitad.
- **Estado ideal:** una **secuencia única con progreso persistente** (el `banner-onboarding` como hilo conductor). Cada paso: una decisión, explicada en su *por qué*. Pasos opcionales (cobranza Fintoc) marcados como tales para no bloquear. Se puede salir y retomar exactamente donde se quedó. Al completar: confirmación de "listo para operar".

## 4.2 Conexión OAuth del seller

- **Fricción a eliminar:** ansiedad de "¿quedó conectado?"; no saber qué hacer si falla.
- **Estado ideal:** una sola acción dominante. Feedback de éxito inequívoco con estado de salud visible y permanente. Si falla o cae después: reconexión **self-service** clara, sin depender del courier. El estado de la conexión nunca es ambiguo.

## 4.3 Asignación + manifiestos (el flujo más repetido del interno)

- **Fricción a eliminar:** asignar de a uno; demasiados clics por pedido; perder contexto entre listado y asignación.
- **Estado ideal:** asignación **masiva** y fluida (Linear): seleccionar varios, asignar a un conductor/manifiesto en un gesto. UI optimista (el pedido se mueve al instante). Atajos de teclado para el poder-usuario. El panel multi-seller con filtros que se sienten instantáneos. Confirmar un manifiesto encadena naturalmente a "el conductor ya lo ve".

## 4.4 Estados + incidencias

- **Fricción a eliminar:** cambiar estado o registrar incidencia como tarea pesada; no entender el impacto financiero de una incidencia.
- **Estado ideal:** cambio de estado en un gesto, con feedback inmediato. Al registrar una incidencia, el sistema **muestra su consecuencia** ("reagendado: afecta el cobro al seller, no la liquidación del conductor") — el usuario entiende el efecto en el dinero sin tener que saberse las reglas. Incidencias sin gestión >4h se destacan in-app.

## 4.5 Cierre de período → conciliación → emisión DTE (el flujo crítico)

- **Fricción a eliminar:** miedo a equivocarse en lo irreversible; no saber si el período cuadra antes de facturar; pasos desconectados.
- **Estado ideal:** **corriente continua y deliberada**. Cerrar período → el sistema concilia y *muestra el veredicto* ("cuadra" / "N descuadres, revísalos") → revisar → previsualizar la factura (líneas, monto, seller) → emitir con confirmación que escribe la consecuencia en palabras. La fricción es intencional y proporcional (P5): rápido hasta el punto de no retorno, pausado y explícito en él. La bitácora registra el "quién" sin que el usuario tenga que pensarlo.

## 4.6 Nota de crédito (anulación)

- **Fricción a eliminar:** confusión sobre qué se anula y por qué; acción peligrosa sin contexto.
- **Estado ideal:** flujo explícito de "anular factura": motivo obligatorio, consecuencia clara (anulación total, DTE 61 irreversible), previsualización del impacto. Misma filosofía de fricción-proporcional que la emisión.

## 4.7 Cobranza / conciliación de pagos (Fintoc)

- **Fricción a eliminar:** pagos sin atribuir que quedan en limbo; no saber qué períodos están pagados.
- **Estado ideal:** los pagos se atribuyen solos cuando se puede; los que no, se destacan para resolución manual de un gesto (atribuir/descartar). El estado de cobro de cada período (pendiente/parcial/pagado) es visible y tranquilizador. La cobranza se siente como "el círculo se cierra", no como trabajo extra.

## 4.8 Conductor — manifiesto y liquidación

- **Fricción a eliminar:** cualquier paso que no sea ver la ruta o el pago; lentitud en la calle.
- **Estado ideal:** abrir → ruta del día, sin login friccionado, tolerante a conexión intermitente. "Listo para salir" en un toque. Liquidación de una pantalla, descargable. Nada más. La mejor versión es la que cabe en la pantalla y en la atención de quien va manejando entre paradas.

---

# SECCIÓN 5 — INFORMATION ARCHITECTURE

Estructura ideal de la información, optimizada para **descubrimiento rápido, navegación intuitiva y escalabilidad**. Parte de la IA ya existente (Blueprint §8: 4 grupos de navegación) y la afina.

## 5.1 Principios de arquitectura

- **Por objetivo, no por tabla.** Los grupos de navegación reflejan lo que el usuario quiere lograr (Operación, Dinero, Configuración), no el modelo de datos.
- **Navegación por capacidad** (P3): cada rol ve un árbol completo *de su mundo*. No hay items deshabilitados ni "no tienes permiso" — simplemente no existen para quien no los usa. Simplicidad cognitiva de Notion.
- **Tres niveles máximo.** Grupo → sección → detalle. Más profundidad pierde al usuario. El detalle (un pedido, un período, una factura) es siempre hoja, nunca otro árbol.
- **El estado financiero del período, omnipresente para quien factura.** No enterrado en "Dinero": el dueño/administración debe sentir el pulso del dinero desde el dashboard.
- **Escalabilidad:** la estructura aguanta más sellers, más conductores, más períodos sin reorganizarse. Listados con filtros y búsqueda como ciudadanos de primera clase, no añadidos.

## 5.2 Arquitectura por audiencia

### Courier interno `(tenant)` — denso, jerárquico, por capacidad

```
Dashboard            → el pulso del día (operativo + financiero) en un vistazo
Operación
  ├─ Pedidos         → panel multi-seller (el centro de gravedad operativo)
  │   └─ Detalle     → estado · incidencia · reasignación · etiqueta
  ├─ Incidencias     → lo que requiere atención, destacado
  └─ Manifiestos     → crear · asignar · confirmar
Dinero               → el diferenciador, no escondido
  ├─ Períodos        → cerrar · conciliar · emitir (el flujo crítico, como corriente)
  ├─ Liquidaciones   → a conductores
  ├─ Conciliación    → descuadres (solo dueño/admin)
  └─ Cobranza        → pagos recibidos y su atribución
Configuración        → se visita poco; ordenada y fuera del camino diario
  ├─ Onboarding · DTE · Folios · Tarifas · Cobranza
  ├─ Equipo · Sellers
  └─ Exportar datos
```

> **Decisión de jerarquía:** "Dinero" tiene el mismo peso visual que "Operación" — son los dos pilares. "Configuración" es deliberadamente más callada (se usa al inicio y esporádicamente). El Dashboard es la puerta y el resumen, no un módulo más.

### Portal del seller — plano, tranquilizador, mínimo

```
Inicio / Conexión ML   → ¿está todo bien? (salud visible)
Pedidos                → mi tracking · solicitar same-day
Incidencias            → qué pasó con lo mío
Cobros                 → cuánto y por qué · descargar factura
```

> Estructura casi plana: el seller no debe navegar, debe *encontrar*. Cuatro destinos, todos a un clic desde el inicio.

### PWA del conductor — una mano, dos destinos

```
Inicio          → mi día
Manifiesto      → mi ruta (la pantalla que más se ve)
Liquidaciones   → mi pago
```

> Lo más plano posible. La navegación compite con la app de Flex y con la calle: cada nivel extra es un costo. Idealmente, "mi ruta" es prácticamente la home.

## 5.3 Descubrimiento

- **Búsqueda donde el volumen lo exige** (pedidos, sellers, períodos): encontrar un pedido por destinatario o ID no debe requerir paginar.
- **Filtros persistentes y rápidos** en el panel multi-seller — el supervisor vuelve al mismo recorte cada día.
- **Atajos de navegación** para el interno frecuente (Linear): saltar entre secciones sin volver al menú.

---

# SECCIÓN 6 — FEEDBACK STRATEGY

El sistema de respuesta de Rutax. Inspirado en el **nivel de detalle obsesivo de Duolingo** — adaptado a un producto financiero serio: feedback rico y específico, pero sobrio (sin gamificación). Cada estado tiene una doctrina.

## 6.1 Loading states — *"el sistema está vivo y trabajando"*

- **Regla:** nunca una pantalla en blanco ni un spinner solitario sin contexto.
- **Skeletons que preservan el layout:** la estructura aparece antes que el dato, de modo que la página no "salta" al cargar (reduce la *percepción* de espera — Linear).
- **Optimismo donde se puede** (I1): para acciones del usuario, mostrar el resultado al instante y reconciliar después; el loading real solo para la carga inicial de datos.
- **Trabajo asíncrono explícito** (F5): "Emitiendo factura… puedes seguir trabajando, te avisamos acá cuando esté lista." El usuario no queda secuestrado por un job.
- **Tono:** discreto. El loading no es protagonista.

## 6.2 Success states — *"esto exactamente pasó"*

- **Regla:** específico, no genérico (F2). Nombra el objeto, el resultado y la magnitud.
  - ✅ *"Factura folio 1042 emitida para Comercial XYZ — $1.240.500. El seller ya puede descargarla."*
  - ❌ *"Operación exitosa."*
- **Proporcional al peso del evento:** asignar un pedido → toast discreto que se desvanece. Emitir el primer DTE / cerrar el primer lazo → confirmación más presente y sobria (el "momento aha" del courier merece reconocimiento, sin confeti).
- **Encadena al siguiente paso** (fluidez, P fluidez): el éxito sugiere qué sigue ("Período facturado → revisar cobranza").
- **Microinteracción de cierre:** el objeto que cambió de estado se anima lo justo para que el ojo lo registre (F4).

## 6.3 Error states — *"qué pasó y cómo salgo de esto"*

- **Regla (F3):** todo error responde tres cosas: **qué** pasó, **por qué**, **qué hacer ahora**. Nunca un código crudo de cara al usuario.
  - ✅ *"No se puede emitir la factura: el período aún está abierto. Ciérralo primero para poder facturar."*
  - ❌ *"Error 42501"* / *"Algo salió mal."*
- **Traducir los errores del sistema** (42501 de RLS, validación Zod) al lenguaje y la acción del usuario. El backend ya falla con razón; la UI la explica.
- **Errores recuperables ofrecen la recuperación** en el mismo lugar: reintentar, reconectar, corregir.
- **Errores en lo irreversible son preventivos, no correctivos:** se evitan *antes* con confirmación clara, porque después no hay arreglo (DTE).
- **Tono:** franco y tranquilizador, nunca alarmista ni culpabilizador. El error es del sistema o del contexto, no "del usuario tonto".

## 6.4 Empty states — *"está vacío por una razón, y esto puedes hacer"*

- **Regla:** un empty state nunca es un muro; es una invitación o una explicación.
- **Tres tipos, tres tratamientos:**
  - **Vacío de arranque** (aún no hay datos): explica qué aparecerá aquí y ofrece la acción que lo llena. *"Aún no tienes pedidos. Llegan solos cuando tus sellers conecten Mercado Libre."*
  - **Vacío de buen estado** (no hay nada *porque todo está bien*): se celebra con sobriedad. *"Sin incidencias sin gestionar. Todo al día."* / *"0 descuadres este período."* — esto es **confianza**, no ausencia.
  - **Vacío de filtro** (la búsqueda no arrojó): distingue de "no hay datos" y ofrece limpiar el filtro.
- **Por audiencia:** el empty del conductor ("sin ruta asignada hoy") es distinto en tono al del dueño.

## 6.5 Confirmations — *"fricción proporcional a la consecuencia"*

- **Regla (I4, P5):** se confirma lo irreversible o destructivo; **no** lo reversible o trivial.
- **Sin confirmación:** asignar/reasignar, cambiar estado corregible, filtrar, navegar. (Pedir confirmación de esto erosiona la atención cuando de verdad importa.)
- **Confirmación con consecuencia escrita:** emitir DTE, emitir nota de crédito, anular período. La confirmación no pregunta "¿estás seguro?" (vacío) — **describe la consecuencia**: *"Vas a emitir un documento tributario por $1.240.500. Es irreversible ante el SII; corregirlo después requiere una nota de crédito. ¿Emitir?"*
- **Previsualización antes de confirmar** lo financiero: ver qué se factura antes de firmarlo (control, §2.4).
- **El "quién" se registra automáticamente** (bitácora con `actorUsuarioId`) — el usuario no gestiona la auditoría, el sistema sí.

## 6.6 Notificaciones — *in-app, honestas (decisión cerrada)*

- **Hoy:** todas las alertas (reconexión ML, folios bajos, morosidad, incidencias sin gestión) son **in-app** — badges, banners, un lugar donde "revisar mis avisos". **El copy nunca promete email** (P6, decisión BRIEF §1).
- **Accionables:** cada aviso lleva su acción ("reconectar", "ver incidencia", "cargar folios").
- **Jerarquizadas:** lo urgente (conexión caída, folios casi agotados) se destaca; lo informativo, callado.
- **Futuro (no prometer aún):** cuando se conecte Resend, el email se *suma* como canal sobre esta base in-app, sin rehacerla.

---

# SECCIÓN 7 — UX IMPROVEMENTS

Backlog priorizado por **impacto en la experiencia** (no por esfuerzo). Derivado de los gaps de los tres documentos fuente. La prioridad es de experiencia; la secuencia real la define el equipo según esfuerzo.

## 7.1 Impacto ALTO — definen si el producto se siente confiable y rápido

| # | Mejora | Por qué es alto impacto | Origen |
|---|---|---|---|
| A1 | **Sistema visual de marca Rutax** (primario navy + tipografía) sobre los tokens ya cableados. | Hoy es shadcn gris sin identidad. La confianza (§2.3) en un producto financiero se comunica visualmente. Es 1 variable CSS → ROI enorme. | UX_READINESS F4; BRIEF §2 |
| A2 | **UX de emisión DTE a prueba de errores:** previsualización + confirmación con consecuencia escrita + lenguaje inequívoco de irreversibilidad. | Es el único punto irreversible del producto. Un error aquí es un DTE real ante el SII. Máxima fricción justificada (P5). | Todos los docs; flujo de riesgo Alto |
| A3 | **Catálogo formal de estados empty/loading/error** por las 3 audiencias (Sección 6 hecha sistema, no caso a caso). | Hoy son parciales y sin inventario. Es el primer entregable que hace sentir la app "terminada" y coherente. | UX_READINESS F3/F5 |
| A4 | **Asignación masiva + UI optimista + atajos** en el flujo operativo más repetido. | El supervisor lo hace decenas de veces al día; la velocidad percibida (§2.2) se gana o se pierde aquí. | Flujo 4.3 |
| A5 | **Centro de avisos in-app** coherente y accionable (reconexión, folios, morosidad, incidencias). | Las notificaciones existen pero solo en bitácora; sin un lugar in-app, el usuario no se entera. Decisión cerrada de hacerlo in-app. | BRIEF §1; flujos 4.2/4.4 |
| A6 | **Trazabilidad visible del lazo entrega→dinero** (de una entrega a su cobro/liquidación/factura/pago y viceversa). | Es *la* prueba de confianza del producto (P2/P4). Sin ella, el diferenciador no se *siente*. | PRODUCT_BLUEPRINT §1 |

## 7.2 Impacto MEDIO — pulen y dan consistencia

| # | Mejora | Por qué importa | Origen |
|---|---|---|---|
| M1 | **Onboarding del courier como secuencia guiada** con progreso persistente y "por qué" de cada paso. | Reduce abandono en la activación (§3.1); convierte 5 pasos sueltos en un camino. | Flujo 4.1 |
| M2 | **Desglose del "por qué" de cada monto** (cobro = tarifa + ajuste incidencia) accesible a un clic. | Claridad (§2.1) y confianza del seller (§3.2): cero cobros-sorpresa. | P4 |
| M3 | **Mostrar la consecuencia financiera al registrar incidencias** ("reagendado no penaliza al conductor"). | El usuario entiende el impacto sin saberse las reglas; reduce errores. | Flujo 4.4 |
| M4 | **Consolidar los 5 `boton-descarga-*`** en un patrón único `BotonDescarga`. | Una sola forma de cada cosa (S5); consistencia = menos carga cognitiva. | AUDIT deuda #7 |
| M5 | **PWA del conductor: confirmar instalabilidad** (manifest + service worker) y tolerancia offline. | Si se promete "instala la app", debe instalarse; el conductor opera con datos intermitentes. | AUDIT #10; UX_READINESS |
| M6 | **Vocabulario del usuario en toda la UI** (auditar y reemplazar tecnicismos de esquema). | Simplicidad cognitiva (S2); cada audiencia en su dialecto. | P3; S2 |
| M7 | **Conciliación como mensaje de tranquilidad** ("0 descuadres") y no solo lista de problemas. | Convierte un módulo de control en una señal de confianza. | §2.3; 6.4 |

## 7.3 Impacto BAJO — limpieza y deuda menor

| # | Mejora | Por qué (menor) | Origen |
|---|---|---|---|
| B1 | **Limpiar grupo `(app)/` legado.** | Higiene de código; no lo ve el usuario. | AUDIT deuda #8 |
| B2 | **Enlace "¿Olvidaste tu contraseña?"** en los logins (delegado a Supabase nativo por ahora). | Cubre la necesidad con esfuerzo mínimo; UI propia es post-pulido. | BRIEF §3 |
| B3 | **Consolidar paneles de conexión ML** (`panel-` / `pantalla-conexion-ml`). | Deuda menor de duplicación; ya hay extracción parcial. | AUDIT deuda |
| B4 | **Auditoría formal de accesibilidad** (Radix da base; falta verificación). | Importante a futuro; no bloquea el pulido visual. | UX_READINESS F6 |
| B5 | **Microinteracciones de transición de estado** (animación sobria de cambio). | Detalle Duolingo; suma, no es crítico. | F4 |

## 7.4 Lo que NO se hace (límites de la estrategia)

- **No diseñar captura de POD propia.** La app de Flex es obligatoria y no integrable (restricción dura). Rutax orquesta alrededor, nunca la reemplaza.
- **No prometer notificaciones por email** hasta que Resend esté conectado (P6).
- **No introducir IA, optimizadores de ruteo ni gamificación.** Prohibidos en el MVP; el ruteo está commoditizado y no es el foco.
- **No tocar las reglas de negocio ni el backend.** Esta es una fase de pulido de experiencia sobre cimiento firme; la estrategia viste lo que ya funciona.

---

## Cierre — el contrato de experiencia

Rutax debe sentirse como **Stripe maneja el dinero de un courier chileno: con la claridad de Linear, el detalle de Duolingo y el orden de Notion.** Tres audiencias, un solo sentimiento: *acá los números cuadran y no tengo que revisarlos a mano.*

La estrategia no pide rehacer nada estructural — el backend está firme, poblado y verificado E2E. Pide **vestir con identidad y rigor de experiencia** un producto que ya hace lo difícil. El mayor riesgo no es técnico: es desperdiciar un motor financiero sólido tras una experiencia genérica. Esta estrategia existe para que la experiencia esté a la altura del motor.

---

*Documento de estrategia de experiencia derivado de [PROJECT_AUDIT.md](PROJECT_AUDIT.md), [PRODUCT_BLUEPRINT.md](PRODUCT_BLUEPRINT.md), [UX_READINESS_REPORT.md](UX_READINESS_REPORT.md) y [BRIEF_DECISIONES_UX.md](BRIEF_DECISIONES_UX.md). Define experiencia, no pantallas. Mantener al día tras decisiones de dirección o cambios de roadmap.*

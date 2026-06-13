# BRIEF DE DECISIONES — Arranque de fase UX/UI
## Para dirección de producto · 3 decisiones que desbloquean al equipo de diseño

> **Qué es esto.** Un brief de decisión: para cada punto pendiente identificado en [UX_READINESS_REPORT.md](UX_READINESS_REPORT.md) (Fase 7, bloqueadores IMPORTANTES), aquí tienes el contexto, las opciones reales, el trade-off de cada una y una recomendación. Objetivo: que decidas en minutos, no que vuelvas a investigar.
>
> **Cómo usarlo.** Lee cada decisión y marca tu elección (o ajusta). Con las 3 cerradas, UX/UI, UX Writer y Frontend arrancan sin riesgo de retrabajo.
>
> **Fecha:** 2026-06-13 · **Decisiones:** 3 · **Tiempo estimado de lectura:** 5 min.

---

## Decisión 1 — Política de notificaciones

### Contexto
La lógica de alertas ya existe y funciona (reconexión de ML caída, folios CAF bajos, morosidad de sellers, incidencias sin gestión >4h). **Pero hoy solo se escriben en la bitácora interna: no se envía ningún email ni push.** El proveedor de email (Resend) está como `TODO` en el código.

Esto importa para diseño porque define qué puede **prometer** la interfaz. Si una pantalla dice "te avisaremos por correo cuando tu conexión se caiga" y el correo no se envía, rompemos la confianza del seller y generamos retrabajo de copy y de pantallas.

### Opciones

| | **A. Conectar Resend ahora** | **B. Diseñar "sin email" explícito** |
|---|---|---|
| **Qué implica** | Tarea de devops antes/durante el diseño: cuenta Resend, plantillas, cablear el envío real. | Diseñar las alertas como notificaciones **in-app** (badges, banners, centro de avisos). Email queda para una fase posterior. |
| **Ganas** | La experiencia queda completa de una; el copy puede prometer correo. | Arranque inmediato sin dependencia de devops; el diseño in-app igual aporta valor y no se bota después. |
| **Pierdes / riesgo** | Sumas una dependencia de devops al camino crítico del diseño; retrasa el arranque. | El seller no recibe aviso fuera de la app (si no entra, no se entera) hasta la fase de email. |

### Recomendación → **Opción B**
Diseñar primero las notificaciones **in-app** (que de todas formas se necesitan y no se rehacen) y dejar el email para cuando devops conecte Resend. Así el equipo de diseño arranca ya, sin esperar infraestructura, y el copy se mantiene honesto ("revisa tus avisos aquí" en vez de "te enviaremos un correo"). Cuando Resend esté listo, se **suma** el canal email sobre una base ya diseñada.

**Tu decisión:** ☐ A · ☑ **B — in-app ahora, email cuando llegue Resend** *(cerrada 2026-06-13)*

---

## Decisión 2 — Identidad de marca / sistema visual

### Contexto
La app está técnicamente bien construida (tokens de color cableados en [globals.css](src/app/globals.css), dark mode, componentes shadcn consistentes), **pero usa el tema gris por defecto de shadcn: no hay color de marca, ni tipografía propia, ni identidad visual.** Es un lienzo limpio y correcto, no un diseño equivocado — no hay nada que deshacer.

UX/UI necesita, como mínimo, un **color primario** y una **tipografía** para empezar a maquetar pantallas con identidad.

### Opciones

| | **A. Branding formal primero** | **B. Provisional ahora, refinar después** |
|---|---|---|
| **Qué implica** | Mini-proceso de marca: definir personalidad, paleta completa, logo, tipografía, antes de tocar pantallas. | Elegir un color primario y una tipografía "suficientemente buenos" hoy; refinar la marca en paralelo o más adelante. |
| **Ganas** | Identidad sólida y coherente desde el día 1; sin retoques visuales después. | El diseñador arranca de inmediato; los tokens ya están cableados, así que cambiar el primario después es trivial (es 1 variable). |
| **Pierdes / riesgo** | Frena el arranque de UX/UI semanas hasta cerrar la marca. | Posible retoque visual menor cuando llegue la marca definitiva (bajo, porque todo es tokenizado). |

### Recomendación → **Opción B**
La arquitectura de tokens hace que cambiar el color de marca sea **una sola variable CSS** — el retrabajo de cambiar el primario más adelante es casi nulo. No tiene sentido frenar el arranque por algo tan barato de ajustar. Elige un primario provisional (idealmente alineado a tu intuición de marca) y deja que el diseñador trabaje; la identidad formal puede madurar en paralelo.

> **Mini-decisión asociada (opcional):** ¿tienes ya un color o referencia de marca en mente (logo, web, competidor que te guste)? Si sí, lo usamos de base provisional. Si no, el UI Lead propone 2-3 direcciones.

**Tu decisión:** ☑ **B — primario provisional ya, con brief de marca definido** *(cerrada 2026-06-13)*

### Brief de marca (input de dirección)
- **Nombre del producto:** **Rutax**
- **Personalidad:** serio · versátil · inspira confianza.
- **Dirección visual provisional (propuesta a validar por el UI Lead):** un **azul profundo / navy** como color primario. El azul es el código universal de confianza y seriedad; un tono profundo (no brillante) aporta sobriedad sin perder versatilidad para los 3 contextos (backoffice denso, portal del seller, PWA del conductor). Acentos neutros fríos; verde/ámbar/rojo reservados solo para estados (éxito/advertencia/error), no para la marca.
  - *Sugerencia de token de arranque (ajustable en 1 variable):* `--primary: oklch(0.45 0.13 255)` (azul navy confiable) sobre la base shadcn ya cableada en [globals.css](src/app/globals.css).
- **Pendiente de dirección (no bloquea):** ¿existe logo de Rutax, o lo crea el UI Lead? ¿hay alguna referencia visual que te guste?

---

## Decisión 3 — Recuperación de contraseña

### Contexto
No se detectó en el código una pantalla propia de "olvidé mi contraseña". Supabase Auth (el sistema de login que ya usa el proyecto) **soporta esto de forma nativa**: envía un correo de recuperación con su propio flujo. La pregunta es si quieres una experiencia **propia/marcada** o si delegas en el flujo estándar de Supabase.

Afecta a las 3 audiencias que hacen login: usuarios internos del courier, sellers y conductores.

### Opciones

| | **A. UI propia** | **B. Delegar a Supabase nativo** |
|---|---|---|
| **Qué implica** | Diseñar y construir pantallas propias ("olvidé mi clave" → email → "nueva clave"), con tu marca y copy. | Usar el flujo y correo estándar de Supabase; el diseño solo agrega el enlace "¿Olvidaste tu contraseña?" en el login. |
| **Ganas** | Experiencia coherente con el resto del producto; control total del copy y la marca. | Cero esfuerzo de diseño/desarrollo; funciona ya. |
| **Pierdes / riesgo** | Más trabajo de diseño + frontend + plantilla de email (depende de Resend, ver Decisión 1). | El correo de recuperación es genérico, fuera de marca; experiencia menos pulida. |

### Recomendación → **Opción B por ahora**
Delegar en Supabase nativo para el arranque (solo agregar el enlace en las pantallas de login) y dejar la UI propia como mejora **post-pulido**, junto con las plantillas de email cuando Resend esté conectado (se enlaza con la Decisión 1). Es el camino de menor esfuerzo que no bloquea nada y cubre la necesidad funcional desde ya.

**Tu decisión:** ☑ **B — Supabase nativo ahora, UI propia post-pulido** *(cerrada 2026-06-13)*

---

## Resumen — decisiones cerradas (2026-06-13)

| # | Decisión | Elección | Implicancia para el arranque |
|---|---|---|---|
| 1 | Notificaciones | **B** — in-app ahora, email cuando llegue Resend | Diseñar avisos in-app; copy NO promete correo. |
| 2 | Identidad de marca | **B** — primario provisional · producto = **Rutax** (serio, versátil, confianza) → azul navy provisional | UI Lead arranca con primario azul a validar. |
| 3 | Recuperación de contraseña | **B** — Supabase nativo ahora, UI propia post-pulido | Diseño solo agrega enlace "¿Olvidaste tu contraseña?" en login. |

> **GO formal:** con las 3 decisiones cerradas, se da luz verde a UX/UI, UX Writer y Frontend para iniciar la fase de diseño sobre las pantallas existentes (dashboard, portal del seller, PWA del conductor).

> **Patrón de las 3 recomendaciones:** *no frenar el arranque de UX/UI por dependencias que se resuelven barato más tarde.* Las tres apuntan a desbloquear al equipo de diseño esta semana, dejando lo costoso (email, branding formal, UI de recuperación) para correr en paralelo o en la fase de pulido — sin generar retrabajo, porque la base técnica (tokens, componentes, auth) ya lo permite.

---

*Brief derivado de [UX_READINESS_REPORT.md](UX_READINESS_REPORT.md) (Fase 7) y [PROJECT_AUDIT.md](PROJECT_AUDIT.md). Una vez resueltas las 3 decisiones, actualizar el reporte de readiness y dar el "go" a UX/UI, UX Writer y Frontend.*

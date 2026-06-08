# 11. Plan de construcción con agentes de IA (vibecoding)

Para construir con asistencia de IA, conviene combinar tres mecanismos de Claude Code. No es “skill vs agente”: los roles van como subagentes, el conocimiento compartido como skills, y el contexto del proyecto en CLAUDE.md.

## 11.1 Los tres mecanismos

- **Subagente = trabajador especializado con su propio contexto. **Archivo Markdown con frontmatter YAML (name, description, tools opcionales) más un system prompt, en .claude/agents/ (proyecto) o ~/.claude/agents/ (usuario). Corre en su propia ventana de contexto, con sus propias herramientas y permisos. Es tu “mini-agente con un rol”.

- **Skill = manual reutilizable que cualquier agente carga cuando lo necesita. **Carpeta con un SKILL.md (frontmatter name + description) y, opcional, scripts/recursos, en .claude/skills/ (proyecto) o ~/.claude/skills/ (personal). Es conocimiento que se inyecta, no un trabajador.

- **CLAUDE.md = memoria del proyecto **que todos leen primero (decisiones de arquitectura, convenciones, reglas no-negociables). Corto (~20–30 líneas); no autogenerar con /init.

**Por qué un rol va como subagente y no como skill: **un rol necesita contexto aislado, un set acotado de herramientas y una persona persistente — justo lo que da el subagente.

## 11.2 Cómo crearlos

- Trabajar en Claude Code (CLI o app de escritorio): es la superficie donde existen los subagentes.

- Crear un CLAUDE.md raíz con el contexto (resumen de este levantamiento + stack + reglas duras: RLS obligatoria, nada de secretos en logs, etc.). Corto.

- Subagentes: usar el comando /agents (recomendado por Anthropic) en ámbito de proyecto y dejar que lo genere, o crearlos a mano en .claude/agents/<nombre>.md. Commitearlos al repo.

- Skills: crear .claude/skills/<nombre>/SKILL.md con su frontmatter e instrucciones (+ scripts opcionales). Commitearlas.

- Reiniciar la sesión para cargar subagentes o carpetas nuevas.

**Tip clave: **el único canal del agente principal al subagente es el texto del prompt; el subagente arranca con contexto fresco, así que pásale explícitamente rutas, decisiones y criterios de aceptación.

## 11.3 Redactar el prompt de cada agente (apoyado en skills)

Cada subagente debe crearse en pro de la elaboración del proyecto, no genérico. Al redactar su system prompt, apóyate de buenas prácticas de prompting (por ejemplo, la skill de optimización de prompts) para convertir las responsabilidades del rol —tomadas de este documento— en una instrucción tuneada. Cada prompt de agente debería incluir:

- Rol y objetivo claros (qué hace y qué NO hace).

- Contexto del proyecto (referencia a CLAUDE.md: stack, modelo de datos, reglas duras).

- Las skills que debe aplicar (p. ej. flex-ml, chile-dte, multitenant-rls).

- Herramientas permitidas acotadas a su tarea.

- Definición de hecho (qué entrega y qué pruebas debe pasar).

**Advertencia: **no enchufes skills genéricas de internet sin leerlas; una skill genérica puede contradecir tus convenciones y bajar la calidad. Toma inspiración de las públicas y reescríbelas para tu repo.

## 11.4 Mapa de roles (subagentes) y conocimiento (skills)

**Subagentes (roles): **Arquitecto · BD/RLS · Backend · Integraciones · Frontend · QA · UX/UI · Seguridad/Cumplimiento · Copywriter · DevOps.

**Skills (conocimiento compartido — escríbelo una vez):**

- **flex-ml **— OAuth por seller, refresco de tokens, estados de envío, salud de conexiones, restricción de la app no integrable.

- **chile-dte **— emitir DTE vía proveedor bajo el RUT del courier, certificado/folios, notas de crédito, boleta de terceros.

- **multitenant-rls **— patrones de RLS en Postgres para aislar tenant + seller.

- **motor-entrega-dinero **— reglas de cobro/liquidación/conciliación e incidencias (lógica crítica, consistente entre agentes).

- **pagos-chile **— Fintoc/Khipu (conciliación) y Flow/Webpay (suscripción).

## 11.5 Ejemplo de subagente

Archivo .claude/agents/integraciones.md:

---

name: integraciones

description: Úsalo para toda integración externa — Mercado Libre

  (OAuth por seller, estados, etiquetas, refresco de tokens, salud

  de conexiones), proveedor DTE y pasarelas de pago.

tools: Read, Edit, Bash, WebFetch

---

Eres el especialista en integraciones del proyecto. Reglas:

- Cada servicio externo es un adaptador detrás de un "puerto";

  el núcleo no depende del proveedor.

- ML: OAuth con la cuenta principal del seller; refresco de tokens

  en jobs; webhooks + sondeo de respaldo; respeta límites de tasa.

- Aplica las skills flex-ml, chile-dte y pagos-chile.

- Nunca registres tokens ni certificados en logs.

Entrega: código + pruebas de resiliencia (reintentos, idempotencia)

+ notas.

**Nota de superficie: **todo esto vive en Claude Code; los subagentes son una función de Claude Code. Las skills también funcionan en claude.ai (se suben como zip en Configuración › Funciones, en planes con ejecución de código). Los “agent teams” (sesiones separadas que colaboran) consumen muchos más tokens; para un fundador solo, subagentes en una sola sesión es lo correcto.

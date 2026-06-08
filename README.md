# Setup de desarrollo con IA — SaaS última milla (couriers Flex)

Base para construir el proyecto con Claude Code.

- `CLAUDE.md` (raíz) — memoria del proyecto: contexto, stack y reglas no-negociables.
- `.claude/agents/` — 10 subagentes (roles). Cada uno es un especialista con su propio contexto y herramientas.
- `.claude/skills/` — 5 skills (conocimiento del dominio reutilizable por cualquier agente).

## Cómo usarlo
1. Copia `CLAUDE.md` y la carpeta `.claude/` a la RAÍZ de tu repositorio.
2. Abre el repo en Claude Code y reinicia la sesión (subagentes y skills se cargan al inicio).
3. Verifica con `/agents` que aparezcan los subagentes.
4. Empieza por el núcleo: arquitecto, base-datos-rls, backend, integraciones, frontend, qa. Suma ux-ui, seguridad-cumplimiento, copywriter y devops cuando el proyecto lo pida.
5. Construye en el orden del MVP (Fase A → B → C de CLAUDE.md).

## Ajusta antes de usar
- Lee cada archivo y adáptalo a tus convenciones. No uses skills genéricas de terceros sin revisarlas.
- Al crear o afinar el prompt de un agente, apóyate en buenas prácticas de prompting (p. ej. la skill optimizador-prompts) para tunearlo a tu proyecto.
- Las skills te piden verificar contra documentación oficial los detalles que cambian (endpoints, precios, TTL de tokens). Mantenlo así.

## Commitea todo al repo
Así cada sesión (y cada colaborador futuro) trabaja con los mismos agentes y skills.

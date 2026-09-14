# Kickoff — sesión de implementación del rediseño del onboarding

Prompt de arranque para una sesión nueva de Claude Code que continúa el
rediseño del onboarding. La sesión arranca en frío (no ve la conversación
previa), por eso este prompt es autocontenido.

## Cómo usarlo

1. Inicia la sesión sobre la branch `claude/courier-onboarding-analysis-7crzwx`
   (es la que tiene el documento de diseño). En local:
   ```
   git fetch origin
   git checkout claude/courier-onboarding-analysis-7crzwx
   ```
2. Copia el bloque de abajo y pégalo como primer mensaje.

> El arreglo del build va aparte en el PR #5 (`claude/fix-build-puesta-en-marcha`
> → `master`). Conviene mergearlo primero para tener la base verde, pero no
> bloquea diseñar/planificar la Fase 1.

## Prompt

```
Contexto: Soy el fundador de Rutax. Vengo de una sesión previa donde
rediseñamos el onboarding de courier, seller y conductor para reducir la
fricción. Las decisiones y el diseño completo están en el documento
docs/arquitectura/onboarding-rediseno.md de esta branch.

Antes de proponer nada:
1. Lee CLAUDE.md (raíz) completo.
2. Lee docs/arquitectura/onboarding-rediseno.md completo.

Decisiones YA cerradas (no las re-abras, están en el doc):
- Login SIN passwords: Google como principal + magic-link por email como
  fallback.
- Conductor: identidad por teléfono vía WhatsApp OTP (se reusa la Cloud API
  de Meta ya desplegada). Sin QR presencial.
- Sin migración: todos los usuarios actuales son de prueba; se parte limpio.
- Onboarding del courier progresivo (just-in-time), no el muro de 8 pasos.

Lo que quiero en esta sesión: aterrizar la FASE 1 (login sin password del
courier: Google + magic-link en /registro y /login, retirar /activar-cuenta,
config de Supabase Auth) en un plan de implementación fino, archivo por
archivo, antes de escribir código. Usa el subagente `arquitecto` para las
decisiones estructurales y `base-datos-rls`/`backend` según corresponda, en
ese orden. No toques RLS, el custom_access_token_hook ni el motor de dinero:
el doc explica por qué el cambio de login no los afecta.

Empieza confirmándome que leíste ambos documentos y dame el plan de F1 para
aprobar antes de tocar nada.
```

# identidad

Auth, tenants, RBAC, onboarding del courier y del seller.

## Estructura

- `roles.ts` — enum `Rol` (espejo TS de `identidad.rol_usuario` en Postgres) y helpers de validación de rol.
- `usuario-actual.ts` — forma `UsuarioActual` (espejo de los claims que el `custom_access_token_hook` inyecta al JWT: `tenant_id`/`tipo_usuario`/`seller_id`/`driver_id`/`rol`/`estado_usuario`).
- `capacidades.ts` — **RBAC en código**: catálogo cerrado de capacidades + mapa rol→capacidades + utilidades `puede*` (`puedeAprobarFacturacion`, `puedeGestionarTarifas`, `puedeInvitarUsuarios`, etc.). Es el contrato que `dinero`/`operacion`/`frontend` consumen — nunca deben replicar la matriz.
- `rut.ts` — validación de RUT chileno (módulo 11; complementa el chequeo de formato que ya hace la BD).
- `auditoria.ts` — única puerta de escritura a `bitacora_auditoria` (vía `service_role`); sanea `detalle` para nunca persistir secretos/tokens.
- `errores.ts` — errores de dominio (`ErrorValidacion`, `ErrorConflicto`, `ErrorNoEncontrado`) para que los llamadores distingan fallas esperables de fallas de infraestructura.
- `onboarding.ts` — alta de tenant + primer usuario `dueno` (RF-006), vía `service_role`, auditada.
- `invitaciones.ts` — crear / aceptar / revocar invitaciones (RF-005 interno, RF-010 seller), vía `service_role`, auditadas.

## Cómo se obtiene el cliente `service_role`

Las funciones de este módulo reciben el cliente Supabase por parámetro
(inyección de dependencias — facilita probarlas con dobles, ver los
`*.test.ts`). En producción, el llamador (Server Action / Route Handler)
construye ese cliente con `crearClienteServiceRole()` de
`@/lib/supabase/service-role` — **nunca lo expone al navegador**.

## Pruebas

`npm test` (Vitest). Cubren la matriz rol→capacidades completa contra
`docs/levantamiento.md` §4, validación de RUT, y los caminos felices/bordes de
onboarding e invitaciones (coherencia tipo_usuario↔seller_id/driver_id↔rol,
expiración, un solo uso, aislamiento por tenant, ausencia de secretos en la
bitácora, compensación ante fallos a medio camino).

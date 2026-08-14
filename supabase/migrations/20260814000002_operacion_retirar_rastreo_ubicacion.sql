-- =============================================================================
-- Operación · retiro del rastreo de ubicación en vivo del conductor
-- =============================================================================
-- CONTEXTO: docs/seguridad/punto-de-termino-conductor.md §1 (revisión de
-- seguridad-cumplimiento, 2026-08-14). Decisión del usuario, mismo día: cortar
-- la recolección entera, no mitigarla.
--
-- QUÉ SE ENCONTRÓ: `operacion.ubicacion_conductor` se alimentaba cada 90 s
-- desde la PWA del conductor mientras su manifiesto estaba 'en_ruta'
-- (`src/app/conductor/manifiesto/ping-ubicacion.tsx`, ya retirado). Verificado
-- en código: NINGUNA pantalla la leía — ni (tenant), ni la Torre, ni el
-- portal. Los tres caminos de borrado (completar manifiesto, desmontar el
-- componente, revocar consentimiento) fallaban juntos en el escenario normal,
-- y ningún job la purgaba. Consecuencia: la última posición del día sobrevivía
-- sin límite de tiempo, y con frecuencia esa última posición es el domicilio
-- del conductor — un dato personal del trabajador (Ley 21.431) recogido sin
-- finalidad efectiva, sin plazo y sin salida.
--
-- QUÉ SE RETIRÓ EN CÓDIGO (mismo cambio, no en esta migración): el componente
-- `ping-ubicacion.tsx`, las Server Actions que escribían/borraban la posición
-- y las que pedían/revocaban el consentimiento de ESTA finalidad
-- (`actionPingUbicacion`, `actionBorrarUbicacion`,
-- `actionRegistrarConsentimientoUbicacion`, `actionRevocarConsentimientoUbicacion`),
-- y el módulo `ubicacion-conductor.ts` entero
-- (`actualizarUbicacionConductor`/`borrarUbicacionAlCerrarRuta`). Ya no queda
-- ningún camino de la aplicación que lea ni escriba esta tabla — fijado por
-- `src/modules/operacion/ubicacion-conductor-retirado.test.ts`.
--
-- QUÉ HACE ESTA MIGRACIÓN, y nada más:
--   1. Vacía `operacion.ubicacion_conductor` (los datos ya recolectados).
--   2. Repone el `comment on table` con la razón del retiro, para que quien
--      llegue después no la reconecte por accidente.
--
-- QUÉ NO HACE (a propósito, ver docs/seguridad/punto-de-termino-conductor.md):
--   - NO borra la tabla, ni sus columnas, ni sus índices.
--   - NO toca la RLS (`ubicacion_conductor_select`, force RLS, sin política de
--     escritura para `authenticated`) ni los GRANT existentes: se conservan
--     como terreno preparado. (El SELECT de `authenticated` sobre una tabla
--     que ya nunca se alimenta queda como hallazgo H-5 del documento — no se
--     cierra aquí porque el usuario no lo pidió en este cambio; queda
--     disponible como endurecimiento posterior si se decide.)
--   - NO toca `operacion.consentimientos_ubicacion`: esos registros son
--     histórico legal de consentimiento otorgado/revocado (Ley 21.431) y el
--     módulo que los gestiona (`consentimiento-ubicacion.ts`) se conserva
--     como mecanismo — lo reusa la etapa 7 (punto de término del conductor)
--     con una columna `finalidad` nueva. No es parte de este retiro.
--   - NO construye el punto de término de la etapa 7. Eso tiene su propio
--     documento y su propia migración, después.
--
-- Idempotente: el DELETE sobre una tabla ya vacía es un no-op, y
-- `comment on table` siempre reemplaza el comentario anterior.
-- =============================================================================

-- 1. Vacía los datos ya recolectados por el ping retirado.
delete from operacion.ubicacion_conductor;

-- 2. Deja la razón escrita en la propia tabla — reemplaza el comentario de la
--    migración 20260613000008, que describía el rastreo como una feature viva.
comment on table operacion.ubicacion_conductor is
  'RASTREO EN VIVO RETIRADO el 2026-08-14 (decisión del usuario, a partir de
   docs/seguridad/punto-de-termino-conductor.md §1). Se pingueaba la posición
   del conductor cada 90 s mientras su manifiesto estaba en_ruta, pero NINGUNA
   pantalla la leía, los tres caminos de borrado fallaban juntos en el
   escenario normal y ningún job la purgaba: la última posición del día
   sobrevivía indefinidamente y con frecuencia era el domicilio del conductor.
   Se cortó la escritura (el módulo ubicacion-conductor.ts ya no existe) y se
   vació la tabla en esta migración. La tabla, sus columnas, su RLS y sus
   GRANT se CONSERVAN sin cambios — terreno preparado, no una feature en
   pausa. Cualquier reconstrucción futura de rastreo de ubicación del
   conductor (aquí o en la etapa 7, punto de término del conductor, que usa
   una tabla DISTINTA: operacion.punto_termino_conductor) debe partir desde el
   día uno con: consentimiento por finalidad propia (no reusar un
   consentimiento genérico), purga automática con cadencia horaria o menor
   (un job diario deja el domicilio del conductor en la base toda la noche), y
   una forma real de revocar cableada a una interfaz visible — no solo una
   función que exista en el código. No reconectar el ping sin releer
   docs/seguridad/punto-de-termino-conductor.md primero.';

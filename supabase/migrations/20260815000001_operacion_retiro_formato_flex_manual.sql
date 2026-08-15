-- =============================================================================
-- Operación · retiro — EL CÓDIGO TECLEADO A MANO ES SU PROPIO FORMATO
-- =============================================================================
-- CONTEXTO: `docs/arquitectura/retiro-y-ruteo.md` §3 y §8. Predecesora:
-- 20260813000004 (sesiones_retiro / bultos_retiro / bultos_retiro_qr y el enum
-- `operacion.formato_codigo_bulto`).
--
-- =============================================================================
-- QUÉ PROBLEMA CIERRA
-- =============================================================================
-- La app del conductor gana ingreso manual de código (pedido del usuario, para
-- los casos excepcionales: etiqueta rota, QR borroso, bulto sin etiqueta
-- legible). Sin esta migración esa función nace inútil justo donde más se
-- necesita: el parser solo reconoce el JSON completo del QR de Flex o un
-- `RX-XXXX-XXXX` de same-day, así que un número de envío TECLEADO caía a
-- `desconocido`, se guardaba con `codigo_normalizado = sha256:…`, no casaba
-- contra ningún pedido y aterrizaba en la bandeja de excepciones como ilegible.
-- Con ~98% de la operación en Flex, eso es no tener la función.
--
-- =============================================================================
-- POR QUÉ UN VALOR PROPIO Y NO REUSAR `flex_qr`
-- =============================================================================
-- Reusar `flex_qr` no exigía migración y era tentador. Se descarta porque
-- **haría mentir al dato sobre lo único irrecuperable del retiro**.
--
-- El `hash_code` de la etiqueta es una firma de ML que no se puede calcular, y
-- `GET /shipment_labels` exige `ready_to_ship`: una vez retirado el bulto, ML no
-- reimprime la etiqueta. Si el string no se capturó al escanear, ESE QR SE
-- PIERDE PARA SIEMPRE (§3 del alcance). Un bulto tecleado nunca tuvo QR que
-- guardar — y marcarlo `flex_qr` lo dejaría indistinguible de uno escaneado, que
-- sí lo tuvo.
--
-- «Pero eso ya se sabe: basta mirar si hay fila en `bultos_retiro_qr`». Se
-- puede, y es peor: esa tabla está deliberadamente cerrada (credencial-símil,
-- RBAC y GRANT por columna), así que responder "¿este se tecleó?" obligaría a
-- consultar la tabla más restringida del módulo para una pregunta que no es
-- sensible. Y "sin credencial" tampoco es equivalente: el propio parser ya
-- admite un `flex_qr` sin `hash_code` (payload incompleto), así que ausencia de
-- credencial NO implica ingreso manual. Dos hechos distintos con la misma
-- etiqueta es exactamente la familia de bug que este proyecto ya pagó caro con
-- el CHECK de `tipo_diferencia` (CLAUDE.md §Invariantes).
--
-- =============================================================================
-- LO QUE ESTA MIGRACIÓN NO HACE
-- =============================================================================
-- No toca una sola fila existente, no cambia ninguna política de RLS y no
-- modifica `bultos_retiro` ni `bultos_retiro_qr`. Agregar un valor a un enum no
-- invalida los que ya están escritos.
--
-- ⚠️ `alter type … add value` NO se puede USAR en la misma transacción en que se
-- agrega (Postgres). Aquí solo se agrega: ninguna sentencia de esta migración
-- escribe el valor nuevo. El primero que lo escriba será el escritor de lotes,
-- en otra transacción, después del despliegue.
--
-- Idempotente: `add value if not exists`.
--
-- LAS OTRAS MITADES, que hay que mover juntas o el sistema queda a medias:
--   · `src/modules/operacion/retiro/parser-codigo.ts` — `FORMATOS_CODIGO_BULTO`
--     (espejo exacto de este enum) y el detector `intentarFlexManual`.
--   · `src/modules/operacion/retiro/dto-pedido.ts` — `COLUMNA_BUSQUEDA_POR_FORMATO`,
--     donde `flex_manual` busca por `ml_shipment_id` igual que `flex_qr`. Sin esa
--     entrada el código tecleado se guarda pero NUNCA encuentra su pedido, que es
--     el fallo silencioso que esta migración vino a evitar.
--   · `supabase/tests/database/rls_aislamiento_retiro.test.sql` — el `results_eq`
--     sobre `enum_range` que fija la lista COMPLETA. Es el guardián de que las
--     dos mitades no se desfasen; se repone entera, nunca se le suma un valor a
--     ojo desde una versión vieja.
-- =============================================================================

alter type operacion.formato_codigo_bulto add value if not exists 'flex_manual';

comment on type operacion.formato_codigo_bulto is
  'Qué clase de código identificó al bulto. flex_qr = el JSON de la etiqueta de
   Mercado Envíos ({id, sender_id, hash_code, security_digit}), leído por la
   cámara · flex_manual = el MISMO número de envío pero TECLEADO por el conductor
   cuando la etiqueta no se puede escanear (rota, borrosa, ausente): identifica
   el bulto igual de bien, pero NO trae el hash_code, y ese string no se puede
   recuperar después porque ML no reimprime la etiqueta de un envío ya retirado ·
   rutax_interno = la etiqueta que genera Rutax para same-day (codigo_interno
   RX-XXXX-XXXX) · desconocido = ilegible o de otro sistema.

   `desconocido` NO es un error: el escaneo SE GUARDA IGUAL. Perder un escaneo es
   el único fallo verdaderamente irreversible del retiro — el bulto ya se subió a
   la van y el QR de Flex no se puede reimprimir (GET /shipment_labels exige
   ready_to_ship).

   flex_qr y flex_manual comparten `codigo_normalizado` (el shipment id), así que
   el MISMO bulto tecleado y escaneado se fusiona por la unique
   (sesion_retiro_id, codigo_normalizado) — como debe ser: es un bulto, no dos.';

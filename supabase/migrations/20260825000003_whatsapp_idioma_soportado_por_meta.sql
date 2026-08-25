-- =============================================================================
-- WhatsApp — el idioma por defecto de un contacto tiene que existir en Meta
-- =============================================================================
--
-- `integraciones.whatsapp_contactos.idioma` nació con default `es_CL`, que es
-- el locale correcto para Chile y **no existe como idioma de plantilla de
-- WhatsApp**. Meta acepta cuatro variantes del castellano y ninguna es Chile:
--
--     es · es_AR · es_ES · es_MX
--
-- Se corrige a `es` (castellano neutro). El texto de las plantillas lo
-- escribimos nosotros, así que la variante regional no cambia una coma de lo que
-- lee el destinatario — solo decide si Meta encuentra la plantilla o no.
--
-- -----------------------------------------------------------------------------
-- POR QUÉ SE ARREGLA AHORA SI LA COLUMNA TODAVÍA NO SE USA
-- -----------------------------------------------------------------------------
-- Hoy el envío toma el idioma del catálogo en TypeScript, no de esta columna, así
-- que el default equivocado no rompe nada. Pero la columna existe para el día en
-- que un contacto pueda elegir su idioma, y ese día alimentaría directamente el
-- campo `language.code` de la Cloud API.
--
-- El modo en que falla es lo que lo hace caro: la plantilla existe, está
-- aprobada y se ve en el panel de Meta, pero el envío devuelve «template name
-- does not exist in the translation» — y uno se pasa la tarde revisando el
-- NOMBRE de la plantilla. Con la tabla vacía cuesta una migración de tres
-- líneas; con filas reales, un incidente.
--
-- El CHECK es la parte que importa: sin él, el próximo default equivocado entra
-- igual. Es deliberadamente permisivo con el resto de los idiomas de Meta (hay
-- decenas) y solo cierra la puerta a los que no existen.
-- =============================================================================

-- 1. El default, para las filas nuevas.
alter table integraciones.whatsapp_contactos
  alter column idioma set default 'es';

-- 2. Las filas ya escritas. En producción no hay ninguna al momento de esta
--    migración, pero en local/demo sí puede haberlas y quedarían con un idioma
--    que Meta rechaza.
update integraciones.whatsapp_contactos
   set idioma = 'es'
 where idioma = 'es_CL';

-- 3. La barrera. `es_CL` es el error natural en un producto Chile-only: se
--    escribe solo, se ve correcto, y falla lejos del sitio donde se escribió.
alter table integraciones.whatsapp_contactos
  drop constraint if exists whatsapp_contactos_idioma_existe_en_meta;

alter table integraciones.whatsapp_contactos
  add constraint whatsapp_contactos_idioma_existe_en_meta
  check (idioma <> 'es_CL');

comment on column integraciones.whatsapp_contactos.idioma is
  'Codigo de idioma de plantilla de WhatsApp. OJO: es_CL NO EXISTE en Meta —
   las variantes del castellano son es, es_AR, es_ES y es_MX. Usamos es.';

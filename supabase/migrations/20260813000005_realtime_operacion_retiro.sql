-- =============================================================================
-- Realtime — señal de cambios del retiro en bodega (etapa 5, Preparación del día)
-- =============================================================================
-- CONTEXTO: docs/arquitectura/retiro-y-ruteo.md §7 ("Preparación del día":
-- retiros en curso y acumulado por comuna creciendo solo) y
-- docs/arquitectura/retiro-y-ruteo-plan.md, etapa 5 — donde esta migración está
-- listada como uno de los tres arreglos obligatorios.
-- Predecesora directa: 20260813000004 (crea las dos tablas y sus grants).
--
-- Agrega `operacion.sesiones_retiro` y `operacion.bultos_retiro` a la publicación
-- `supabase_realtime`. Molde exacto: 20260709000003/4/5 (pedidos, incidencias,
-- manifiestos) — DO-block sobre pg_publication_tables, sin REPLICA IDENTITY FULL.
--
-- =============================================================================
-- POR QUÉ ESTO EXISTE: SIN LA PUBLICACIÓN, EL "EN VIVO" FALLA EN SILENCIO
-- =============================================================================
-- Una tabla que no está en la publicación NO produce ningún error cuando alguien
-- se suscribe a ella. El cliente llama
--   supabase.channel(...).on('postgres_changes',
--     { schema: 'operacion', table: 'sesiones_retiro' }, ...).subscribe()
-- y recibe `SUBSCRIBED`. El canal queda abierto, sano y mudo: el WAL nunca lleva
-- esas filas, así que Realtime no tiene qué reenviar. No hay excepción en el
-- navegador, no hay 4xx en la red, no hay línea en los logs del servidor ni en
-- los de Postgres. La pantalla simplemente se ve TRANQUILA.
--
-- Y ahí está el problema, que es de producto y no de infraestructura: en la
-- Preparación del día "tranquilo" es indistinguible de "no está pasando nada".
-- El coordinador mira la pantalla a las 11 de la mañana mientras un conductor
-- escanea 130 bultos en la bodega del seller, ve los mismos contadores de hace
-- una hora, y concluye lo razonable — que el conductor todavía no llega. Toma
-- decisiones de flota con eso. Es exactamente el modo de falla que la etapa 5
-- existe para eliminar: reemplazar el WhatsApp por una pantalla que se puede
-- creer. Una pantalla que miente sin avisar es peor que no tener pantalla.
--
-- Por eso la publicación es parte de la migración y no un detalle de despliegue:
-- es el único punto donde la ausencia se puede verificar mecánicamente.
--
-- =============================================================================
-- MODELO — señal, no payload (idéntico a pedidos/incidencias/manifiestos)
-- =============================================================================
--   · Realtime se usa SOLO COMO SEÑAL: ante un cambio, el cliente re-ejecuta el
--     Server Component (`router.refresh`), que lee en el servidor. El cliente NO
--     lee el payload del evento. Ya verificado en vivo en este repo, sin fugas.
--   · La RLS de las dos tablas (interno del tenant, o el conductor con SUS filas;
--     el seller ve CERO — 20260813000004 §7.1) filtra los eventos por suscriptor:
--     ningún courier recibe eventos de otro, y ningún conductor los de un colega.
--   · Requisito no obvio: para que Realtime pueda evaluar esa RLS por suscriptor,
--     el rol `authenticated` necesita SELECT sobre la tabla. Ese grant ya existe
--     (20260813000004:1184-1187). La aserción de más abajo lo comprueba: sin él,
--     el canal se suscribe igual y tampoco entrega nada — el MISMO silencio, por
--     otra causa.
--   · Solo se consumen INSERT/UPDATE. NO se toca REPLICA IDENTITY: el registro
--     `new` viaja sin `full`; `full` solo agregaría el `old`, que no se usa, y
--     `bultos_retiro` recibe ~400 INSERT diarios en ráfagas — el costo de WAL
--     extra sería puro desperdicio.
--
-- Idempotente: no falla si la publicación no existe (entorno sin Realtime) ni si
-- las tablas ya están publicadas. No destructivo: solo agrega.
-- =============================================================================


-- =============================================================================
-- 1. Publicación de las dos tablas del retiro
-- =============================================================================
do $$
declare
  tabla text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach tabla in array array['sesiones_retiro', 'bultos_retiro']
    loop
      if not exists (
        select 1
        from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'operacion'
          and tablename = tabla
      ) then
        execute format('alter publication supabase_realtime add table operacion.%I', tabla);
      end if;
    end loop;
  end if;
end $$;


-- =============================================================================
-- 2. Aserción defensiva — ABORTA si la tabla del QR quedara publicada
-- =============================================================================
-- ⚠️ ESTO NO ES UN COMENTARIO DE ADVERTENCIA: ES LA RED PERMANENTE.
--
-- `operacion.bultos_retiro_qr` guarda el string del QR de la etiqueta CIFRADO.
-- Es credencial-símil e IRRECUPERABLE (hash_code es una firma de ML que no se
-- puede recalcular, y GET /shipment_labels ya no reimprime la etiqueta una vez
-- retirado el bulto). Por eso es DENY-ALL: RLS enable+force sin ninguna política,
-- `revoke all` a authenticated/anon/public y sin vista espejo en `public`.
--
-- Publicarla la sacaría por un camino que NINGUNA de esas barreras cubre: la
-- réplica lógica no pregunta por GRANTs. El proceso de Realtime lee el WAL con un
-- rol de replicación, DECODIFICA LA FILA ENTERA en su propia memoria —criptograma,
-- kid y aad_esquema incluidos— y recién después decide, por suscriptor, si se la
-- entrega a alguien. O sea: el dato sale del perímetro de la tabla ANTES de que
-- se aplique cualquier política, y queda expuesto a los logs, a los volcados de
-- error y a la retención de un servicio que no es la base de datos.
--
-- Que hoy ningún cliente pueda leerla depende de que los privilegios sigan
-- revocados para siempre. Una migración futura que agregue un GRANT "para
-- depurar" convertiría una publicación inocente en una fuga, sin tocar una sola
-- línea de código de aplicación. La regla más barata de sostener es la más dura:
-- esa tabla NO se publica nunca, y esto aborta la migración si alguien lo hizo.
--
-- Se comprueba también el grant de SELECT que Realtime necesita para entregar los
-- eventos de las OTRAS dos: sin él, el canal se suscribe y no emite — el mismo
-- fallo mudo que esta migración viene a cerrar, por otra causa.
do $$
declare
  tabla text;
begin
  -- 2.1 La tabla del QR, fuera de la publicación. Siempre.
  if exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'operacion'
      and tablename = 'bultos_retiro_qr'
  ) then
    raise exception
      'operacion.bultos_retiro_qr está publicada en supabase_realtime. Esa tabla es DENY-ALL y guarda el string del QR cifrado (credencial-símil e irrecuperable): la réplica lógica no pregunta por GRANTs, así que el criptograma saldría por el WAL y sería decodificado por el proceso de Realtime fuera de toda política. Quitarla con: alter publication supabase_realtime drop table operacion.bultos_retiro_qr;';
  end if;

  -- 2.2 Sin SELECT para `authenticated`, Realtime no puede evaluar la RLS por
  --     suscriptor y no entrega NADA aunque la tabla esté publicada. Se verifica
  --     con has_table_privilege y no contando GRANTs: lo que importa es el
  --     privilegio efectivo.
  foreach tabla in array array['sesiones_retiro', 'bultos_retiro']
  loop
    if not has_table_privilege('authenticated', 'operacion.' || tabla, 'SELECT') then
      raise exception
        'authenticated NO tiene SELECT sobre operacion.%. Realtime evalúa la RLS por suscriptor y sin ese privilegio el canal se suscribe pero no entrega un solo evento — el mismo silencio que esta migración viene a cerrar. El grant vive en 20260813000004.', tabla;
    end if;
  end loop;

  -- 2.3 Control positivo: si la publicación existe, las dos tablas quedaron
  --     dentro. Sin esto, un fallo del §1 (p. ej. la publicación pertenece a otro
  --     rol y el ALTER no tomó) pasaría inadvertido — y el resultado sería, otra
  --     vez, una pantalla muda sin ningún error.
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach tabla in array array['sesiones_retiro', 'bultos_retiro']
    loop
      if not exists (
        select 1
        from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'operacion'
          and tablename = tabla
      ) then
        raise exception
          'operacion.% no quedó en la publicación supabase_realtime pese a que la publicación existe. La Preparación del día se vería tranquila mientras un conductor escanea 130 bultos, sin ningún error en ninguna parte.', tabla;
      end if;
    end loop;
  end if;
end $$;

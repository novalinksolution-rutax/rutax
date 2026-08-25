# Migraciones en pausa

**Nada de esta carpeta se aplica.** El CLI de Supabase solo lee
`supabase/migrations/`, así que un archivo acá no lo toma ni `db push` ni
`db reset`. Es a propósito: es el único lugar donde una migración puede quedar
guardada **sin** que el próximo despliegue se la lleve puesta.

Un archivo entra acá cuando se decidió **no** aplicarlo, no cuando está a medio
escribir. Si está a medio escribir, no se commitea.

## Cómo sacar una de pausa

Moverla de vuelta a `supabase/migrations/` y correr `npx supabase db push`. Ojo
con el número: si ya se aplicaron migraciones posteriores, el CLI la aplica
igual (fuera de orden), y eso solo es seguro si la migración no depende de lo
que vino después.

## Lo que hay acá

### `20260824000001_identidad_claims_uuid_toleran_null_de_realtime.sql`

En pausa por **decisión del usuario (25-ago-2026)**: el diagnóstico que la
originó se hizo contra la base local y no se ha reproducido en producción.

Qué haría: que `claim_tenant_id()`, `claim_seller_id()` y `claim_driver_id()`
traten el **texto** `'null'` como ausencia, igual que ya tratan la cadena vacía.
El porqué está entero en la cabecera del archivo.

⚠️ **Consecuencia mientras siga en pausa, para que nadie la redescubra desde
cero:** en local, un `supabase db reset` deja de aplicarla y Realtime vuelve a
quedarse sin entregar eventos —a todos los suscriptores a la vez, con el
indicador de las pantallas en verde—. Para volver a taparlo en local, sin
moverla de acá:

```bash
docker exec -i supabase_db_SaaS_Courier_Again psql -U postgres -d postgres \
  < supabase/migraciones-en-pausa/20260824000001_identidad_claims_uuid_toleran_null_de_realtime.sql
```

En producción no se ha comprobado si el fallo ocurre. El primer sitio donde
mirarlo es el log del contenedor de Realtime, buscando
`invalid input syntax for type uuid: "null"`.

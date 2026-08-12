# UX — Seller con múltiples cuentas de Mercado Libre (hasta 10)

**Estado:** implementado. Flujo aprobado por el founder (2026-06-30), sobre las pantallas existentes.
Complementa `docs/arquitectura/seller-multicuenta-ml.md` (el "qué" técnico). Aquí va el "cómo se ve/usa".

Premisa: **el seller, desde su propio usuario, conecta y gestiona hasta 10 cuentas de Mercado Libre.** El courier solo monitorea salud; no hace el OAuth del seller.

> ⚠️ **Actualización 2026-08-12.** Dos cambios que este documento no anticipaba:
> 1. **El tope subió de 3 a 10** (un courier real tiene un seller con 4 cuentas). Donde abajo diga "3", léase 10.
> 2. **"Agregar otra cuenta" tiene un paso previo obligatorio.** Mercado Libre no permite forzar el selector de cuenta (ni `prompt`, ni `select_account`, ni logout documentado): si el seller tiene sesión abierta en ML, vuelve con la MISMA cuenta y el sistema —antes de este arreglo— le decía "Agregaste la cuenta correctamente" sin haber agregado nada. Ahora se avisa antes de salir a ML (cerrar sesión en ML o ventana privada) y el callback detecta el duplicado tras el canje, devolviendo `cuenta_ya_conectada` en vez de `exito`.

## 1. Flujo (portal del seller)
- **Ver cuentas**: sección "Mis cuentas de Mercado Libre" en el home del portal. Lista de tarjetas (0–3), una por conexión. Orden: `desvinculada` → `atencion` → `pendiente` → `sana`.
- **Agregar cuenta**: botón "Agregar otra cuenta" bajo la lista → OAuth con nuevo modo `agregar_cuenta`. Al llegar a 3, el botón **desaparece** (no gris) + línea "Ya tienes 3 cuentas conectadas (límite máximo)".
- **Reconectar**: botón por tarjeta (solo si `atencion`/`desvinculada`). Lleva el `conexion_id` en el `state` del OAuth → el callback hace UPDATE de ESA fila, no inserta.
- **Renombrar (alias)**: edición **inline** en la tarjeta (sin modal/navegación). Fallback a `ml_nickname` si vacío. Máx. 40 caracteres.

## 2. Jerarquía por tarjeta
1. Identidad: `alias` editable / `ml_nickname` fallback.
2. Estado: salud en lenguaje humano + color (`sana` verde "Conectada y sincronizando" · `atencion` amarillo "Necesita atención" · `desvinculada` rojo "Desconectada — reconéctala…" · `pendiente` gris "Configurando…").
3. Contexto: "Última sincronización: hace X" (si sana) / "Desconectada desde DD/MM/AAAA" (si desvinculada).
4. Acción: "Reconectar" (si atención/desvinculada) + "Editar nombre" (siempre, discreto).

Estados: **carga** = skeleton por tarjeta · **vacío (0)** = CTA "Conectar mi cuenta" · **error** = mensaje inline + "Reintentar" (no bloquea el resto del portal).

## 3. Badge de origen del pedido
**Regla dura: mostrar el origen SOLO si el seller tiene >1 conexión.** Con 1 cuenta, nada (cero ruido). `same_day` nunca muestra badge.
- Presentación: chip **gris neutro** (no semántico), `text-xs`. Texto: `alias` → `ml_nickname` → `···últimos4` del `ml_user_id`.
- Resolución en el **server component**: si `conexiones.length <= 1`, el DTO del pedido NO trae `origenAlias`; si `>1`, lo trae resuelto por `(seller_id, ml_user_id)`. El cliente no calcula esto.
- Ubicación: lista de pedidos del seller (inline bajo el destinatario, junto a la comuna) · detalle del seller (fila "Cuenta de origen") · operaciones del courier (inline, secundario).
- **Manifiesto/detalle del conductor: DIFERIDO** (no lo necesita para operar; todos los Flex van a la misma app de ML).

## 4. Microcopy (a pulir por `copywriter`)
- `tope_alcanzado`: "Ya llegaste al límite de cuentas conectadas / Tu cuenta tiene hasta 3 conexiones… primero desconecta una desde tu portal." Acción: "Ir a mis conexiones". Sin "Intentar de nuevo".
- `cuenta_ya_conectada`: "Esta cuenta ya está conectada / …si quieres reconectarla porque tuvo problemas, hazlo desde su tarjeta." Acción: "Ir a mis conexiones".

## 5. Lado courier (decisión del founder)
- El courier NO tiene botón "Conectar/Agregar" (lo hace el seller).
- Dashboard: el bloque "Conexiones ML caídas" se agrupa **por conexión** (ej. "Tienda ABC · Cuenta Outlet"). Se **quita el botón "Reconectar" engañoso** (el courier no puede hacer el OAuth del seller) → dejar estado + enlace al seller. **No** construir sistema de notificación nuevo en esta iteración.

## 6. Wireframes
```
┌─ Mis cuentas de Mercado Libre (1 cuenta) ───────────┐   ┌─ (3 cuentas, tope) ─────────────────┐
│  ✓ Tienda Principal            [Editar nombre]      │   │  ⚠ Cuenta secundaria  [Reconectar]  │
│    Conectada y sincronizando                        │   │    Desconectada desde 28/06/2026    │
│    Última sincronización: hace 3 min                │   │  ✓ Tienda Principal                 │
│                                                     │   │  ✓ Outlet Verano                    │
│  + Agregar otra cuenta de Mercado Libre             │   │  Ya tienes 3 cuentas (límite máx.)  │
└─────────────────────────────────────────────────────┘   └─────────────────────────────────────┘

Lista de pedidos (seller con 2 cuentas)         Lista de pedidos (seller con 1 cuenta)
  María González                                  María González
  Las Condes · Outlet Verano                      Las Condes
  ^ chip de origen solo porque hay >1 cuenta      ^ sin chip
```

## 7. Criterios para `frontend`
1. `PanelConexionesMl` (reemplaza el singular): recibe `conexiones: ConexionMlSeller[]` (0–3) + `puedeAgregar = conexiones.length < 3`.
2. Badge: resuelto en server; el cliente lo recibe o no. Nunca calcula el conteo en cliente.
3. `iniciarConexionMl` acepta `modo: agregar_cuenta` y, en reconexión, `conexionId` (transportado en el `state`/cookie del OAuth y usado por el callback para UPDATE de esa fila).
4. **Seguridad (no negociable)**: el seller NO puede escribir en `conexiones_seller_ml` (RLS + trigger `solo_interno_edita` → 42501). **Renombrar alias** y **reconectar por conexión** van por **server action con service_role que verifica la propiedad del seller** (mismo patrón que la reconexión actual). Prohibido el write directo del seller.
5. Alias inline: transición ver/editar es estado local React; la action retorna `{ ok, mensaje? }`; en error revierte el valor.
6. Nota de tope: con 3 conexiones, texto informativo `text-sm text-muted-foreground` en vez del botón (sin estado "disabled").
7. Accesibilidad: lista con `role=list/listitem`, `aria-label` por tarjeta y por botón; autofocus al editar alias.

## 8. Archivos a extender (no reescribir)
- `src/app/portal/panel-conexion-ml.tsx` → `panel-conexiones-ml.tsx` (plural).
- `src/app/portal/conectar-ml/pantalla-conexion-ml.tsx` (casos `agregar_cuenta`, `tope_alcanzado`, `cuenta_ya_conectada`).
- `src/app/portal/conectar-ml/compartido.ts` (agregar `agregar_cuenta` a `ModoConexionMl`).
- `src/app/portal/conectar-ml/actions.ts` (modo `agregar_cuenta` + `conexionId` en reconexión).
- `src/app/portal/page.tsx` y `src/app/portal/actions.ts` (usar `obtenerConexionesPorSeller`, plural).
- `src/app/portal/pedidos/page.tsx` (+ detalle) (badge condicional).
- `src/app/(tenant)/operaciones/*` (badge secundario) y `src/app/(tenant)/dashboard/page.tsx` (caídas por conexión, sin "Reconectar").

# El denominador · las rutas que existen hoy

**75 rutas** con `page.tsx` en `src/app/`, al 23-08-2026. Es contra esto que se cuenta el
libro de pantallas: una ruta que ningún tablero cubre **es en sí misma un hallazgo**, igual que
un tablero que dibuja una pantalla que no existe.

Se regenera con:

```
find src/app -name "page.tsx" | sed 's|^src/app/||; s|/page.tsx$||' | sort
```

| Superficie | Rutas | Tableros que la cubren |
|---|---|---|
| `(tenant)` · courier | 33 | B1a · B1b · B1c · B2a · B2b · B3a · B3b · P1–P4 · P6 |
| `portal` · seller | 11 | B4 · P7 |
| `conductor` · PWA | 5 | **ninguno** — el bloque 6 vive en el repo `rutax-conductor`; esta PWA está marcada para retiro |
| `admin` · backstage | 13 | B6 |
| sin sesión y público | 13 | B7 · B7b · Sitio comercial |

## Las rutas, una por una


### sin sesión y público

- `/(legal)/privacidad`
- `/(legal)/terminos`

### `(tenant)` · courier

- `/(tenant)/conductores`
- `/(tenant)/conductores/[id]`
- `/(tenant)/configuracion`
- `/(tenant)/configuracion/api`
- `/(tenant)/configuracion/bodegas`
- `/(tenant)/configuracion/exportar-datos`
- `/(tenant)/configuracion/plan`
- `/(tenant)/configuracion/retiro`
- `/(tenant)/configuracion/tarifas`
- `/(tenant)/configuracion/zonas`
- `/(tenant)/dashboard`
- `/(tenant)/dinero/cobranza`
- `/(tenant)/dinero/conciliacion`
- `/(tenant)/dinero/liquidaciones`
- `/(tenant)/dinero/liquidaciones/[liquidacionId]`
- `/(tenant)/dinero/periodos`
- `/(tenant)/dinero/periodos/[periodoId]`
- `/(tenant)/equipo`
- `/(tenant)/manifiestos`
- `/(tenant)/manifiestos/[manifiestoId]`
- `/(tenant)/onboarding`
- `/(tenant)/onboarding/cobranza`
- `/(tenant)/onboarding/dte`
- `/(tenant)/onboarding/folios`
- `/(tenant)/onboarding/tarifas`
- `/(tenant)/operaciones`
- `/(tenant)/operaciones/[pedidoId]`
- `/(tenant)/operaciones/incidencias`
- `/(tenant)/preparacion`
- `/(tenant)/preparacion/asignar`
- `/(tenant)/sellers`
- `/(tenant)/sellers/invitar`
- `/(tenant)/torre-de-control`

### sin sesión y público

- `/activar-cuenta`

### `admin` · backstage

- `/admin`
- `/admin/bitacora`
- `/admin/comunicaciones`
- `/admin/couriers`
- `/admin/couriers/[tenantId]`
- `/admin/couriers/[tenantId]/soporte`
- `/admin/login`
- `/admin/metricas`
- `/admin/planes`
- `/admin/salud`
- `/admin/seguridad`
- `/admin/suscripciones`
- `/admin/suscripciones/[suscripcionId]`

### `conductor` · PWA en retiro

- `/conductor`
- `/conductor/liquidaciones`
- `/conductor/manifiesto`
- `/conductor/manifiesto/[pedidoId]`
- `/conductor/punto-termino`

### sin sesión y público

- `/invitacion/[token]`
- `/kitchen-sink`
- `/login`
- `/offline`
- `/page.tsx`

### `portal` · seller

- `/portal`
- `/portal/bienvenida`
- `/portal/bodegas`
- `/portal/cobros`
- `/portal/cobros/[periodoId]`
- `/portal/conectar-ml`
- `/portal/incidencias`
- `/portal/login`
- `/portal/pedidos`
- `/portal/pedidos/[pedidoId]`
- `/portal/pedidos/nuevo`

### sin sesión y público

- `/recuperar-contrasena`
- `/registro`
- `/registro/revisa-tu-correo`
- `/restablecer-contrasena`
- `/tracking/[token]`

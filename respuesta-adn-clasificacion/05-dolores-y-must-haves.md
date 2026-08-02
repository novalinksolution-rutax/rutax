# 5. Dolores que el motor debe resolver primero

> El producto ya está construido **alrededor de una tesis de dolor explícita** (CLAUDE.md +
> `Contexto/`). Abajo, lo que el repo asume como dolor prioritario **[REPO]** y los huecos a
> confirmar contigo **[CONFIRMAR]**.

## Dolor central que el motor ataca [REPO]
La **trastienda de dinero del courier**: hoy se hace a mano (planillas), es lenta y propensa a
error. El diferenciador es el **motor entrega→dinero**: que cada entrega genere **sola** su
línea de cobro al seller y su línea de liquidación al conductor, **conciliadas**.

## Must-haves ya implementados (ordenados por el dolor que resuelven) [REPO]
1. **Facturar al seller sin rehacer planillas** → líneas de cobro automáticas + períodos + DTE
   (sandbox) con compuerta humana de emisión.
2. **Liquidarle al conductor lo justo y a tiempo** → líneas de liquidación automáticas +
   liquidación consolidada con PDF.
3. **Cuadrar entregado-vs-facturado** → conciliación (detective, solo lectura) que detecta
   diferencias antes de cobrar.
4. **No perder plata por incidencias** → reglas de incidencia que ajustan cobro/liquidación.
5. **Cobrar y conciliar el pago del seller** → cobranza Fintoc + matching de pagos recibidos.
6. **No exponer datos entre couriers/sellers** → RLS en la base (dolor de confianza/cumplimiento).

## Para ordenar los must-haves a tu realidad [CONFIRMAR]
Confirma cuál de estos es **el dolor #1 que te abre la venta** (el "para esto te pagan ya"):
- [ ] Le facturo al seller en minutos, no en días.
- [ ] Le pago al conductor sin pelear cada entrega.
- [ ] Dejo de perder plata en incidencias/diferencias.
- [ ] Cobro y concilio la plata del seller sin perseguir transferencias.
- [ ] Otro: ____________________

Y qué dolor, hoy, **te hace perder clientes o plata** si no se resuelve primero.

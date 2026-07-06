# 6. Conductores (contratistas / empleados / mixto)

## Lo que el repo ya soporta [REPO]
El modelo de datos **ya contempla ambos casos y, por tanto, el mixto**:

- Tabla `identidad.conductores` con enum
  `identidad.tipo_relacion_conductor as enum ('dependiente', 'independiente')`.
  - `dependiente` → empleado (contrato).
  - `independiente` → contratista (boleta de honorarios / boleta de terceros).
- La skill **chile-dte** contempla **"boleta de terceros para conductores formales"**, lo que
  indica que el flujo de liquidación con documento para el conductor independiente está previsto.
- La liquidación (`dinero.liquidaciones`) es la misma estructura para ambos; cambia el
  tratamiento tributario/documental.

> Es decir: **arquitectónicamente el sistema es mixto-ready.** No fuerza un solo tipo.

## Lo que falta confirmar [CONFIRMAR]
1. ¿Tu cliente típico opera **mayormente independientes (boleta de honorarios)**, empleados, o
   genuinamente mixto? (define qué flujo de liquidación pulir primero).
2. Para independientes: ¿el courier **emite boleta de terceros** por el conductor, o el conductor
   emite su propia boleta? (afecta si Rutax debe generar ese documento o solo el detalle de pago).
3. ¿Hay retención/impuesto que el motor deba calcular en la liquidación del independiente?
4. Ley 21.431 (repartidores de plataformas): ¿aplica a tu caso de uso y cómo afecta el dato
   personal del conductor que guardas?

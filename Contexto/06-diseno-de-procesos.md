# 5. Diseño de procesos (AS-IS → TO-BE)

## 5.1 Los seis procesos clave

### 1. Ingesta / creación de pedidos

**AS-IS: **El seller avisa por WhatsApp; fotos de etiquetas; carga manual en Excel; el same-day se coordina por llamada.

**TO-BE: **Los Flex entran solos vía API (OAuth del seller); el same-day se crea en la plataforma (por seller o courier) con su destino de facturación definido.

### 2. Asignación a conductores

**AS-IS: **Mapa mental del coordinador + Excel + grupos de WhatsApp; conocimiento tácito, no transferible.

**TO-BE: **Asignación por zona/conductor en el sistema con manifiesto generado; las reglas quedan en la plataforma, no en una persona.

### 3. Ejecución, estados e incidencias

**AS-IS: **El conductor escanea/entrega en la app de Flex; las incidencias se reportan por WhatsApp/llamada/notas.

**TO-BE: **El escaneo/POD sigue en la app de Flex (obligatorio); la plataforma sincroniza el estado y captura/clasifica la incidencia con trazabilidad.

### 4. Facturación al seller

**AS-IS: **A fin de mes, Excel + sistema de boletas aparte; 6–16 h/mes; entregas que se escapan sin cobrar.

**TO-BE: **El motor arma las líneas según lo realmente entregado; el courier emite el DTE al seller desde la plataforma (vía proveedor, bajo su RUT).

### 5. Liquidación de conductores

**AS-IS: **Excel + WhatsApp; semanal/quincenal; disputas y errores; rotación si se paga mal.

**TO-BE: **Liquidación calculada por entrega (formal con boleta de terceros; informal con registro interno); el conductor la ve; el pago lo hace el courier por fuera.

### 6. Cobranza y conciliación

**AS-IS: **Excel, banco, correo; descuadres; morosidad que se descubre tarde.

**TO-BE: **MVP: conciliación entregado-vs-facturado. Crecimiento: cobranza por transferencia con conciliación automática del pagado (Fintoc/Khipu) y alertas de morosidad.

## 5.2 Cuellos de botella, riesgos y automatizaciones

- **Cuellos de botella: **dependencia de personas clave; cierre de mes manual; incidencias dispersas en WhatsApp; doble digitación de pedidos.

- **Riesgo de diseño principal: **la dependencia de la API de Flex (estados incompletos/tardíos y desvinculaciones). Mitigación: tratar el estado como dato que puede faltar, permitir corrección manual, no bloquear el cierre, y el monitor de salud de conexiones con reconexión y backfill.

- **Automatizaciones futuras: **normalización de direcciones, predicción de ausencias, sugerencia de asignación por carga/zona, alertas tempranas de seller en riesgo de reputación.

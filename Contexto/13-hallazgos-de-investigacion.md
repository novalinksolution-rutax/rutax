# 12. Hallazgos de investigación clave

Estos hallazgos —verificados contra fuentes públicas (Anexo C)— sustentan decisiones del documento.

- **Ley 21.431 (plataformas digitales). **Define “empresa de plataforma digital de servicios” como la que gestiona un sistema que permite a un trabajador ejecutar reparto de bienes para usuarios en un territorio. Como el fundador NO opera entregas, el sujeto de esta ley sería el courier, no el fundador. El conductor es dependiente o independiente según el Art. 7; la ley protege sus datos y prohíbe discriminación por mecanismos automatizados. El software debe registrar el tipo de relación y proteger esos datos, sin empujar informalidad.

- **Facturación electrónica (DTE/SII). **La factura es un DTE tipo 33 (XML firmado), obligatorio en B2B. Construir el motor de emisión propio exige certificarse ante el SII (set de pruebas, gestión de folios/CAF, cuadratura, contingencias, recepción). Recomendación: integrar un proveedor certificado (cada courier emite bajo su propio RUT) y reservar el desarrollo propio para cuando el volumen lo justifique.

- **Pagos. **Para la cobranza courier→seller, la transferencia con conciliación automática (Fintoc/Khipu) ataca directo el dolor de cuadre. Para la suscripción del SaaS, Flow (suscripciones nativas) o Webpay PatPass. El same-day no es un cobro separado: se factura junto con los Flex del período.

- **OAuth de Mercado Libre. **El seller autoriza con su cuenta principal (no colaborador) y la app obtiene un access token con refresco. Los tokens caducan y hay eventos que obligan a re-vincular manualmente — de ahí la criticidad del monitor de salud de conexiones. La app de escaneo/POD no es integrable.

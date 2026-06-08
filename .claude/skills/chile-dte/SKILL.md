---
name: chile-dte
description: Conocimiento para emitir Documentos Tributarios Electrónicos en Chile — factura (DTE tipo 33) del courier al seller, vía un proveedor certificado, bajo el RUT del courier; manejo de certificado digital y folios (CAF); notas de crédito; y boleta de terceros para conductores formales. Úsala al construir facturación o liquidación con documento.
---
# Facturación electrónica (DTE) en Chile

## Principio clave
NO emitimos "como" la plataforma. Cada courier es el emisor legal y emite bajo SU propio RUT. Nuestra plataforma orquesta la emisión a través de un proveedor de API certificado por el SII.

## Build vs. integrar
Construir el motor de emisión propio exige certificarse ante el SII (set de pruebas, gestión de folios/CAF, cuadratura, contingencias, recepción de DTE de terceros) y mantenerlo. Para el MVP, INTEGRA un proveedor certificado. Reserva el desarrollo propio para cuando el volumen lo justifique. Verifica condiciones vigentes en sii.cl.

## Proveedores candidatos (verifica precios y multiempresa actuales)
- SimpleFactura / SimpleAPI (Chilesystems): API REST con SDKs, orientada a multiempresa (varias razones sociales); puede gestionar la certificación.
- Openfactura (Haulmer): certificado por el SII, con sandbox gratuito.
- Otros: BaseAPI, Bsale.
Criterios: soporte multiempresa real, costo por documento, delegación de certificación/folios, límites de tasa, calidad del sandbox.

## Multiempresa (cómo encaja con nuestro multi-tenant)
- En el onboarding del courier, recoge su certificado digital (guárdalo cifrado) y gestiona/solicita sus folios (CAF), delegando al proveedor donde sea posible.
- Solo el courier necesita ser emisor. El seller es el RECEPTOR de la factura; no emite. (El portal del seller puede mostrar/descargar el DTE recibido.)

## Documentos
- Factura: DTE tipo 33 (XML firmado), del período, consolidando entregas Flex + same-day por seller.
- Notas de crédito para ajustes.
- Conductores formales que entregan documento: usa boleta de prestación de servicios de terceros (la empresa emite por el prestador) o la BHE del conductor. Conductores informales: solo registro interno de liquidación, sin documento.

## Cuidado
Certificados y folios son datos sensibles: cifrados, acceso auditado, nunca en logs.

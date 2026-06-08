---
name: flex-ml
description: Conocimiento para integrar Mercado Libre Flex — OAuth por seller, ciclo de vida y refresco de tokens, lectura de pedidos y estados/subestados de envío, etiquetas, código de colecta diario, salud de conexiones (reconexión y backfill) y la restricción de la app de escaneo no integrable. Úsala al construir o tocar cualquier integración con Mercado Libre.
---
# Integración con Mercado Libre Flex

## Verifica siempre lo volátil
Endpoints, TTL de tokens, límites de tasa y campos cambian. Antes de implementar, confirma contra la documentación oficial: developers.mercadolibre.cl (y .com.ar). No hardcodees supuestos sobre tiempos de vida de token.

## Modelo de autorización
- OAuth 2.0 por seller. El seller autoriza tu aplicación y obtienes un authorization code que cambias por access_token + refresh_token.
- CRÍTICO: el seller debe autorizar con su cuenta PRINCIPAL/manager. Si entra como colaborador/operador, el permiso es inválido. El flujo de (re)conexión debe guiar esto explícitamente.
- Los access_token caducan; implementa refresco automático con el refresh_token en un job en segundo plano, antes de expirar.
- Esta autorización es solo para extraer datos del seller desde ML; NO es el login del usuario a nuestra herramienta.

## Qué se puede leer (lo aprovechable)
- Estados y subestados del envío (delivered, not_delivered, receiver_absent, cancelled, etc.): alimentan ingesta, incidencias y conciliación.
- Asignación de transportista; notificaciones de transferencias entre conductores (handshakes); etiquetas para no depender de fotos por WhatsApp.
- Código de autorización de colecta (diario), que el conductor necesita cuando la colecta es fuera de la dirección del seller.

## La restricción dura
La app de Mercado Envíos Flex es obligatoria para escanear y completar entregas y NO es integrable. El POD vive ahí. Nunca intentes reemplazar el escaneo; orquesta alrededor.

## Resiliencia (obligatoria)
- Combina webhooks/notificaciones con un sondeo periódico de respaldo: los eventos se pueden perder.
- Idempotencia: no crear pedidos/registros duplicados ante reintentos o eventos repetidos.
- Respeta límites de tasa con backoff.
- Trata el estado como dato que puede faltar o llegar tarde: permite corrección manual y no bloquees el cierre financiero por un estado ausente.

## Salud de conexiones
- Estados por seller: conectada / requiere atención / desvinculada / pendiente, con marca de última sincronización exitosa.
- Distingue "lo resolví con refresco automático" de "requiere re-vinculación del seller" para no alarmar de más.
- Reconexión self-service de un clic + empujón iniciado por el courier (enviar link).
- Backfill: al reconectar, recupera los pedidos generados durante la caída (hasta donde la API lo permita).

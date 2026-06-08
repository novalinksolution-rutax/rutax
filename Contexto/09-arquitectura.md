# 8. Arquitectura recomendada

La restricción que manda es que lo construye una persona con asistencia de IA (vibecoding). Cada decisión prioriza poco que operar, mucho respaldo en datos de entrenamiento de IA, y garantías fuertes donde el riesgo es alto (aislamiento y dinero).

- **Monolito modular, no microservicios. **Más rápido de construir y depurar para un solo dev; se parte más adelante si hace falta.

- **TypeScript end-to-end. **Un solo lenguaje; de lo mejor cubierto por la IA.

- **Frontend: Next.js (React) + Tailwind + shadcn/ui. **Stack mainstream; componentes listos aceleran dashboards y portales.

- **Base de datos: PostgreSQL con Row-Level Security (RLS). **Hace cumplir el aislamiento entre couriers y del seller a nivel de base de datos: la decisión arquitectónica más importante del proyecto.

- **Plataforma backend: Supabase **(Postgres gestionado + Auth + Storage + RLS + funciones), o alternativa Next.js + Postgres gestionado (Neon/Railway) + Auth.js. “Baterías incluidas” reduce lo que se construye y opera en solitario.

- **Jobs en segundo plano: orquestador gestionado **(Inngest o Trigger.dev, o cron de Supabase). El refresco de tokens, la ingesta, el sondeo de salud de conexiones y la generación de liquidaciones/facturas necesitan reintentos e idempotencia confiables (corazón de RNF-05).

- **Secretos/certificados: cifrado dedicado **(secrets manager o columna cifrada con clave gestionada), separado de los datos de negocio.

- **App de conductor: PWA/web responsive en MVP, **React Native/Expo (nativa) en V2.

- **Hosting: Vercel + Supabase. **Gestionados y vibecoding-friendly; cero servidores que administrar.

- **Integraciones como adaptadores aislados: **un “puerto” por servicio externo (ML, DTE, pagos), para cambiar proveedor —o construir el propio a futuro— sin reescribir el núcleo.

## 8.1 Servicios externos

| **Servicio** | **Recomendación / nota** |
| --- | --- |
| Mercado Libre API | OAuth por seller, /shipments (estados/subestados), asignación de transportista, etiquetas. La app de escaneo/POD NO es integrable. |
| Proveedor DTE (recomendado: integrar, no construir) | Candidato líder: SimpleFactura / SimpleAPI (Chilesystems) — API REST con SDKs, pensada para multiempresa (concentra varias razones sociales; puede gestionar la certificación). Alternativa fuerte: Openfactura (Haulmer), certificado por el SII con sandbox gratuito. Criterios: multiempresa real, costo por documento, delegación de certificación/folios, límites de tasa, sandbox. |
| Cobranza con conciliación | Fintoc o Khipu (transferencia + conciliación automática) — ataca directo el dolor de cuadre. (V2) |
| Suscripción del SaaS | Flow (suscripciones nativas) o Webpay PatPass. |
| Notificaciones / email | Servicio tipo Resend. |
| Observabilidad | Sentry + logs. |

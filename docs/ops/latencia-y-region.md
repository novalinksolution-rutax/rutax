# Región de despliegue y latencia — análisis y decisión

**Fecha:** 2026-08-05 · **Estado:** decidido, revisable con datos de operación real.

## Decisión

Producción corre en **São Paulo**: Supabase en `sa-east-1` y las funciones de Vercel
fijadas en `gru1`. **PITR queda diferido** hasta que haya couriers pagando; el piloto
arranca con los respaldos diarios que trae el plan Pro (RPO ≤24 h, ya justificado en
`docs/ops/restauracion.md`).

No se migra a Chile. El análisis de abajo es el porqué, y sirve para reabrir la
discusión sin volver a levantarlo todo.

---

## 1. Por qué São Paulo y no Santiago

**Supabase no tiene región en Chile.** Su única región sudamericana es `sa-east-1`
(São Paulo). El resto son EE.UU., Europa y Asia.

**Vercel tampoco.** Sus regiones de cómputo son `gru1` (São Paulo), `iad1`, `sfo1`,
`pdx1`, `cle1`, `yul1` y las de Europa/Asia. No existe `scl1`.

De ahí sale la trampa principal de todo este análisis:

> Mover **solo la base de datos** a Santiago y dejar la app en Vercel **empeora las
> cosas**: el salto app→BD pasa a ser São Paulo→Santiago, o sea los mismos 35-50 ms
> que se querían evitar, pero pagando infraestructura propia. Para llegar de verdad a
> 5-10 ms hay que sacar **también** la app de Vercel.

## 2. Cuánto vale realmente la latencia

Latencia Santiago↔São Paulo: **~35-50 ms** de ida y vuelta. Una base local daría
~5-10 ms. El delta es de **~33 ms por salto secuencial** — y solo se multiplica por la
cantidad de idas y vueltas que encadene la página:

| Escenario | Ahorro con base en Chile |
|---|---|
| Página bien paralelizada (2 saltos) | ~66 ms |
| Página con 4 consultas en fila | ~130 ms |
| Sobre una página que ya tarda 700-900 ms con cold start | **7-15%** |

**El punto que decide:** paralelizar las consultas independientes de una pantalla
rinde lo mismo o más, gratis y en una sesión. Y los dos arreglos no se suman: una vez
paralelizada la página, el delta de región cae por debajo del umbral de percepción.

**Dónde sí ganaría una base local:** jobs conversadores (un `for` con una consulta por
fila). 500 consultas secuenciales son ~20 s en SP contra ~3,5 s en Santiago. Pero son
jobs de Inngest —nadie espera— y el arreglo correcto es agrupar en SQL de conjunto,
que lo deja en un salto y le gana a las dos regiones.

**Para el conductor en terreno la región es ruido:** en 4G la red móvil ya pone
50-150 ms.

## 3. Costo comparado

| | **São Paulo** (Supabase Pro + Vercel + `gru1`) | **Chile completo** (app + BD en Santiago, self-host) |
|---|---|---|
| Base de datos | Supabase Pro $25 | VM 8-16 GB en `southamerica-west1` ~$60-140 |
| Compute add-on (requisito de PITR) | +$5 | — |
| PITR / respaldos | $100 (7 días de retención) | pgBackRest a GCS ~$5-15 |
| Disco | incluido | SSD 100-200 GB ~$20-40 |
| Hosting app | Vercel Pro $20 | Cloud Run / VM ~$30-60 |
| Egress | dentro de cuota del plan | ~$0.12-0.19/GB (basemap PMTiles, fotos de POD) |
| CDN, ISR, preview deploys, WAF | incluido | Cloudflare + armarlo a mano |
| **Mensual** | **~$46 sin PITR · ~$151 con PITR** | **~$120-260 + egress** |
| Trabajo inicial | 1 sesión | 2-4 sesiones + 2-4 semanas hasta que sea seguro |
| Trabajo permanente | ninguno | propio, indefinido |

*Precios de lista a agosto 2026. Las regiones sudamericanas de GCP corren 20-40% sobre
las de EE.UU.*

**Lectura honesta:** sin PITR, São Paulo gana 3 a 5 veces. **Con PITR empatan**, porque
pgBackRest es gratis y Supabase cobra $100 por el mismo servicio. Si la conversación
fuera solo de plata, la opción chilena sería defendible.

Lo que compran esos $100 no es software: son respaldos que otro verifica,
restauraciones probadas y alguien de turno que no eres tú. Y aun pagándolo, seguiría
faltando reconstruir lo que da Vercel (CDN, ISR, previews, borde).

## 4. Costo de migrar, medido contra este repo

Acoplamiento real (agosto 2026): **252 archivos** usan `supabase-js` · **749 call
sites** de `.from()` · **99 políticas RLS** (17 dependen de `auth.uid()`/JWT) ·
**54 migraciones** · **25 archivos pgTAP** · **44.779 líneas** de TS/TSX.

| Opción | Trabajo de código | Calendario con agente |
|---|---|---|
| **Self-host Supabase** en Santiago | ~cero: cambia `NEXT_PUBLIC_SUPABASE_URL`, misma API | 2-4 sesiones para levantarlo; 2-4 semanas para dejarlo seguro |
| **GCP Cloud SQL** (salir de Supabase) | 749 call sites a SQL/Drizzle, contexto RLS por request, 99 políticas re-ancladas, Auth propio (MFA TOTP, invitaciones, hook de claims), Storage a GCS, 25 pgTAP revalidados | 3-6 semanas de sesiones |

El riesgo de la segunda no es el plazo: **lo que se reescribe es el aislamiento
multi-tenant**. Un error ahí no cuesta milisegundos, filtra datos de un courier a otro.

## 5. Diferir es casi gratis (y por eso se difiere)

El self-host no exige cambios de código. Si en seis meses hay couriers pagando y la
latencia aparece como queja **medida**, la migración cuesta lo mismo que hoy — el
traspaso de datos es un dump/restore de horas. El costo de postergar no se acumula.

## 6. Cuándo reabrir esto

- Un courier reporta lentitud y la telemetría la atribuye a la base, no al cold start
  ni al número de consultas.
- AWS abre su región de Chile (anunciada para fines de 2026) **y** Supabase la ofrece.
- El gasto de Supabase supera con holgura el costo de operar infraestructura propia
  (varios couriers, volumen alto de Storage/egress).

Mientras tanto: `gru1` fijado y las pantallas paralelizadas.

# Levantamiento — poner la app del conductor productiva en Android

> Estado: **levantamiento**, no runbook todavía. Documenta qué hay hoy, qué falta
> para que exista un APK instalado en el teléfono de un conductor, y qué decisiones
> ya se tomaron. El runbook paso a paso se escribe cuando cierren las preguntas
> abiertas de §6.
>
> Repo de la app: `novalinksolution-rutax/rutax-conductor` (privado, separado a
> propósito — ver CLAUDE.md/Stack). Este documento vive en el repo web porque es
> el hermano de [`despliegue.md`](./despliegue.md), el runbook de producción.
>
> Fecha del levantamiento: 2026-08-29. Commit inspeccionado: `5528d9a`.

---

## 1. Lo que ya está sano (y no hay que tocar)

Verificado ejecutando, no leyendo:

| Chequeo | Resultado |
|---|---|
| `npx tsc --noEmit` | **limpio**, 0 errores |
| `npx jest` | **21 suites, 263 pruebas, todas verdes** en 3,5 s |
| `npm install` | limpio con `legacy-peer-deps=true` (ya está en `.npmrc`) |

La app está completa como producto: 26 rutas de `expo-router` cubriendo login con
PIN, manifiesto del día, ruta con mapa y reordenamiento, evidencia/POD, retiro en
bodega con escaneo, traspaso entre conductores, liquidaciones, perfil, punto de
término y la Torre móvil. Colas offline propias para retiro y traspaso.

**El problema no es el código. Es que nunca se compiló.**

---

## 2. El hueco central

`app.json` **no tiene `extra.eas.projectId`**. Eso significa que `eas init` nunca
se corrió: el proyecto no está enlazado a ninguna cuenta de Expo, no existe
keystore de firma, y por lo tanto **nunca se ha generado un solo artefacto
instalable**. Todo lo que sigue cuelga de ahí.

---

## 3. Los diez huecos, ordenados por qué tan caro es descubrirlos tarde

### 🔴 Bloqueantes — sin esto no hay APK, o el APK no sirve

**3.1 · El perfil `production` de `eas.json` produce un AAB, no un APK.**
Un AAB es el formato de Play Store: **no se puede instalar en un teléfono**. El
default de `android.buildType` es `app-bundle`, y el perfil `production` no lo
sobrescribe ni declara `distribution: "internal"`. El perfil `preview` sí es
`internal`, así que ése sí da APK. Como el plan es sideload, hay que declarar
`"android": { "buildType": "apk" }` explícitamente y no confiar en el default.

**3.2 · Falta `EXPO_PUBLIC_SUPABASE_ANON_KEY` en el build.**
Está en `.env.example` y `ENTORNOS.md` explica que hay que registrarla como
variable de EAS — pero no está en `eas.json` ni registrada. Sin ella el cliente
Supabase se crea con string vacío y **el conductor no puede ni iniciar sesión**.
Es el fallo más caro de descubrir tarde: se descubre con el APK ya instalado.

**3.3 · Falta `expo-asset`, y solo rompe fuera de Expo Go.**
`expo-doctor` lo reporta textual: *"Missing peer dependency: expo-asset, required
by expo-audio. Your app may crash outside of Expo Go without this dependency."*
La app usa `expo-audio` en `src/senales.ts` para el pitido de confirmación al
escanear un bulto. En desarrollo nunca se nota; en el APK sí. Arreglo:
`npx expo install expo-asset`.

**3.4 · La URL del backend está equivocada.**
`eas.json` apunta a `https://rutax-cl.vercel.app`. El runbook de producción
([`despliegue.md`](./despliegue.md) §0) dice que producción es **`rutax.io`**,
sirviendo desde el apex. **Decidido: va `rutax.io`.** Importa fijarlo bien de
entrada porque corregirlo después es recompilar y reinstalar en cada teléfono.

**3.5 · Sin credenciales FCM, las notificaciones push no llegan en Android.**
El servidor ya está construido y vivo: `src/modules/integraciones/push/puerto.ts`
manda tres avisos — *ruta lista*, *traspaso recibido*, *retiro nuevo* — y la ruta
`PUT /api/conductor/dispositivo` ya registra tokens. Pero en un build standalone
de Android, Expo despacha vía FCM V1, que exige un proyecto Firebase con su
`google-services.json` y una *service account key* subida a EAS.

⚠️ **Esto importa más de lo que parece.** El propio puerto documenta que el aviso
de traspaso **es el único del producto que no se puede apagar**, y explica por
qué: sin él, el traspaso queda esperando la aceptación del receptor y alguien
termina cargando bultos que no son suyos. **Decidido: FCM entra en este
despliegue.**

### 🟡 Importantes — el APK sale, pero degradado

**3.6 · El APK saldría con el ícono por defecto de Expo.**
No hay **ningún** asset en el repo: sin `icon`, sin `android.adaptiveIcon.foregroundImage`
(solo está el `backgroundColor` `#1E3A5F`), sin splash. El build no falla; usa el
ícono genérico de Expo. En el teléfono del conductor la app se ve como una app de
demo. **Decidido: el logo lo pasas tú** — hace falta un PNG cuadrado de 1024×1024
para el ícono, y otro para la capa de frente del adaptive icon, con margen de
seguridad porque Android la recorta en círculo o squircle según el lanzador.

**3.7 · El mapa sale gris en Android.**
`GOOGLE_MAPS_ANDROID_KEY` no está en `eas.json`. `app.config.js` ya está escrito
para inyectarla y documenta el fallo con precisión: *"en iOS usa Apple Maps —que
no pide clave— y Google Maps en Android, que sí. Por eso el mapa se veía bien en
el iPhone y nadie notó que faltaba."* La app **no se cae** sin la clave, es a
propósito. **Decidido: hay que crearla** — proyecto en Google Cloud con
facturación activa, aunque el consumo caiga en el tier gratis.

⚠️ **Hay un huevo-y-gallina que hay que ordenar:** la clave debe restringirse al
paquete `com.rutax.conductor` **+ la huella SHA-1 del certificado de firma**, y
esa huella solo existe *después* del primer build de EAS. Orden correcto: primer
build → sacar la SHA-1 con `eas credentials` → recién ahí poner las restricciones.

**3.8 · Sin `expo-updates`, cada arreglo es un APK nuevo.**
Un texto mal escrito, un bug de pantalla: hoy eso obliga a recompilar y a
perseguir teléfono por teléfono. **Decidido: se agrega EAS Update.** Con una flota
de 10-20 conductores, el tier gratuito (1.000 usuarios activos al mes) sobra por
un orden de magnitud.

**3.9 · No hay versionado.**
`app.json` declara `version: "1.0.0"` pero **ningún `android.versionCode`**, y
`eas.json` no fija `cli.appVersionSource` ni `autoIncrement`. Android usa el
`versionCode` para decidir si un APK es una actualización o un downgrade: sin
manejarlo explícitamente, instalar la versión siguiente encima puede fallar.
Con flota real esto deja de ser cosmético — hay que poder revertir a la versión
anterior cuando una salga mala.

### 🟢 Menores — anotados para no re-descubrirlos

**3.10 ·** `android.permissions` declara `READ_EXTERNAL_STORAGE`, que en Android 13+
ya no hace nada (`expo-image-picker` moderno no lo necesita).
**Se decidió NO quitarlo.** Estaba en el plan de limpieza y se revirtió al
mirarlo de cerca: en Android 12 y anteriores ese permiso **sí** gobierna el
acceso a la galería, y ése es justo el teléfono que puede tener un repartidor.
La ganancia de sacarlo era cosmética —un permiso de más en la ficha— y el riesgo
era romper «adjuntar evidencia desde galería» en el hardware más viejo de la
flota. No compensa.

**3.11 ·** El proyecto está en **Expo SDK 54**; hoy ya existen SDK 55 y 56.
**Recomiendo NO subir ahora**: SDK 54 está soportado, el código está verde, y una
migración de SDK en el mismo movimiento que el primer despliegue mezcla dos
fuentes de fallo. Se agenda aparte.

---

## 4. El hallazgo que cambia la estrategia: Android está cerrando el sideload

Esto no salió del repo, salió de investigar, y es lo más importante de este
levantamiento porque le pone **fecha de vencimiento al plan "APK descargable"**.

Google está imponiendo **verificación de desarrollador para instalar apps en
dispositivos Android certificados**, y cubre explícitamente el sideload — no solo
Play Store. Los hechos relevantes:

| Hecho | Consecuencia para Rutax |
|---|---|
| Cuenta de **distribución limitada**: gratis, sin ID de gobierno, **hasta 20 dispositivos en total** (todos los apps de esa cuenta juntos), cada uno enrolado explícitamente. Lanzamiento global **agosto 2026**. | La flota objetivo es **10-20 conductores**. Cabe — **pero justo en el borde**, y el borde es duro: el dispositivo 21 exige subir a distribución completa. |
| **Distribución completa**: US$25 una vez + ID de gobierno + registrar la llave de firma. | Es el camino si la flota crece o si entra un segundo courier. |
| Aplicación arranca el **30-sep-2026** en Brasil, Indonesia, Singapur y Tailandia; **global durante 2027**. | Chile **no** está en la primera ola. Hay pista para el piloto, pero el modelo "cada courier instala un APK que le pasamos" **no sobrevive a 2027** sin verificación. |

**Lectura honesta:** para el piloto de un courier con 10-20 conductores, el APK
sideload sirve y sirve ya. Como estrategia de distribución del SaaS a varios
couriers, tiene fecha de término. Conviene saberlo hoy, cuando la decisión de
publicar en Play Store todavía se puede planificar, y no en 2027 cuando sea una
urgencia.

**Segundo hallazgo, más inmediato:** los artefactos de distribución interna de EAS
**expiran a los ~30 días**. La página con QR que genera EAS es perfecta para
instalar *ahora*, pero **no es un lugar de descarga permanente**. Con la opción
elegida (página de EAS + QR), hay que asumir que el enlace cambia en cada build y
caduca — y que si se quiere un `rutax.io/conductor/descargar` estable, es trabajo
aparte.

---

## 5. Decisiones ya tomadas

| Tema | Decisión |
|---|---|
| Cuenta Expo | **Ya existe.** Faltan los datos (nombre de cuenta/organización y `projectId` si lo hay). |
| Backend del APK | **`rutax.io`** (producción real). |
| Push / FCM | **Entra** en este despliegue. |
| Ícono y marca | **El logo lo pasa el usuario** (PNG 1024×1024 + capa de frente del adaptive icon). |
| Distribución | **Página de EAS + QR** para partir. |
| Actualizaciones | **Se agrega EAS Update** (OTA). |
| Google Maps | **Hay que crear la clave**; Google Cloud con facturación. |
| Alcance | **Flota completa de un courier real (≈10-20 conductores).** |
| Verificación de desarrollador | **Cuenta de distribución limitada gratuita** (tope 20 dispositivos). Ver la alerta en §8. |
| Repo conductor | Los cambios van **directo a `master`** de `rutax-conductor`. |

---

## 6. Preguntas abiertas

1. **Datos de la cuenta Expo** — nombre de cuenta u organización (es el `owner`
   que va en `app.json`) y, si ya se corrió `eas init` alguna vez, el `projectId`.
   Recomendación: que sea una **organización**, no una cuenta personal. El
   keystore de firma vive ahí, y perderlo significa que ningún APK futuro puede
   actualizar al que ya está instalado — hay que desinstalar y reinstalar en cada
   teléfono, perdiendo la sesión del conductor.
2. **Los archivos del logo.**
3. **Plan de Expo**: el tier gratuito da 15 builds Android al mes. Para un primer
   despliegue alcanza de sobra; conviene confirmar que no hay apuro por el plan
   pagado.

---

## 7. Plan propuesto, por etapas

Cada etapa termina en algo verificable. La 1 y la 2 no dependen de ninguna
respuesta pendiente.

**Etapa 1 — Sanear el proyecto para que compile bien** ✅ **HECHA** (2026-08-29,
`rutax-conductor@59761f7`)
`expo-asset` fijado en `~12.0.13` · los tres perfiles de `eas.json` declaran
`buildType: "apk"` · `production` pasa a `distribution: "internal"` ·
`EXPO_PUBLIC_API_URL` apunta a `rutax.io` · versionado remoto con `autoIncrement`
en `production`. `READ_EXTERNAL_STORAGE` se mantiene, por §3.10.
Verificado: `expo-doctor` 16/18 —los dos que fallan son *fetches* de red
bloqueados por el proxy del entorno, no problemas del proyecto—, typecheck limpio
y 263 pruebas verdes. El *porqué* de cada decisión quedó en `ENTORNOS.md`.

**Etapa 2 — Assets de marca** *(depende del logo)*
Ícono, adaptive icon y splash con el `#1E3A5F` que ya usa la app.

**Etapa 3 — Enlazar EAS y primer build de humo** *(depende de la cuenta Expo)*
`eas init` · registrar `EXPO_PUBLIC_SUPABASE_ANON_KEY` como variable de proyecto ·
primer `eas build --profile preview --platform android`. **Salida: el primer APK
instalable y su página con QR.** Se instala en un teléfono y se comprueba lo único
que importa en esta etapa: que el conductor pueda iniciar sesión.

**Etapa 4 — Google Maps** *(depende de la clave; requiere la SHA-1 de la etapa 3)*
Crear la clave, inyectarla por EAS, sacar la SHA-1 con `eas credentials`, aplicar
las dos restricciones, rebuild, y confirmar que el mapa dejó de estar gris.

**Etapa 5 — Push / FCM**
Proyecto Firebase, `google-services.json` versionado (no lleva secretos),
*service account key* subida a EAS y **fuera de git**. Prueba de punta a punta:
confirmar un manifiesto desde la web y ver llegar el aviso al teléfono.

**Etapa 6 — EAS Update (OTA)**
Instalar `expo-updates`, configurar canales por perfil, y **probar el circuito
completo**: publicar un cambio de texto y verlo llegar a un APK ya instalado sin
reinstalar. Una configuración de OTA sin ese ensayo no está probada.

**Etapa 7 — Verificación de desarrollador y proceso de release**
Registrar la cuenta según §6.3, enrolar los dispositivos de la flota, y dejar
escrito el runbook: cómo se corta una versión, cómo se avisa, cómo se revierte.

**Etapa 8 — Prueba en terreno**
Lo que `ENTORNOS.md` advierte que **solo se puede probar en un teléfono físico**:
velocidad real de la cámara leyendo QR en ráfaga en una bodega mal iluminada, la
detección de red que decide cuándo drena la cola de escaneos, y el consumo de
batería con la cámara abierta durante una visita larga —el conductor sale a
repartir después.

⚠️ Y la advertencia de `ENTORNOS.md` que aplica a todo desde la etapa 3: apuntando
a producción, **un retiro registrado es un retiro de verdad**, con sus bultos, y
el retiro se le paga al conductor por visita a bodega. Para pruebas de humo, un
conductor de prueba — no uno que cobre.

---

## 8. ⚠️ La deuda con fecha: el tope de 20 dispositivos

Se eligió la **cuenta de distribución limitada gratuita** de Google. Es la
decisión correcta para este piloto —gratis, sin ID de gobierno, solo un email—
pero deja dos cabos que hay que vigilar, porque ninguno avisa antes de morder:

1. **El tope es de 20 dispositivos en total**, sumando todas las apps de esa
   cuenta, y **cada teléfono se enrola a mano**. Con 10-20 conductores el margen
   es de cero a diez. El día que el courier contrate al conductor 21 —o entre un
   segundo courier— la instalación simplemente no procede, y el arreglo es migrar
   a distribución completa (US$25 + ID de gobierno + registrar la llave de firma).
   **No es un trámite de un rato**, así que conviene empezarlo antes de
   necesitarlo, no el día que un conductor nuevo no puede instalar.
2. **La aplicación es global durante 2027.** Chile no está en la primera ola
   (30-sep-2026: Brasil, Indonesia, Singapur y Tailandia), así que el piloto corre
   sin fricción. Pero el modelo «cada courier instala un APK que le pasamos» no
   sobrevive a 2027 sin verificación, y a esa altura publicar en Play Store deja
   de ser opcional.

**Lo que esto significa para el producto:** la publicación en Play Store pasa de
«algún día» a un ítem con ventana. Vale la pena planificarla mientras es una
decisión y no una urgencia — sobre todo porque Play tiene sus propios plazos
(ficha, política de privacidad, y para cuentas nuevas un período de prueba
cerrada con testers antes de poder publicar).

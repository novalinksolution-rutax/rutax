# Guía de voz y estilo — Rutax

Guía de referencia para el copy (UX writing) de todo el producto. Objetivo: una comunicación clara, cálida-profesional y consistente, al nivel de los mejores productos digitales de LATAM.

## Referentes de tono
Nos inspiramos en SaaS/fintech de LATAM que comunican bien: **Mercado Pago, Fintual, Xepelin, Cornershop, Buk, NotCo**. Lo que tomamos de ellos:
- Cercanía sin perder seriedad: hablan como una persona competente, no como un manual corporativo.
- Claridad brutal: una idea por frase, sin relleno ni jerga técnica de cara al usuario.
- El usuario primero: dicen qué gana o qué tiene que hacer, no cómo funciona el sistema por dentro.

## Principios
1. **Español de Chile, profesional-cercano.** Ni acartonado ni chistoso. Como un colega experto que te explica algo importante y quiere que lo entiendas.
2. **Tratamiento: "tú"**, consistente en todo el producto. Nunca "usted", nunca mezclar.
3. **Claridad sobre completitud.** Frases cortas. Una acción por frase. Si algo se puede decir en menos palabras, se dice en menos palabras.
4. **Sin jerga técnica de cara al usuario.** Nada de "tenant", "endpoint", "webhook", "payload", "RLS", "token" en pantallas de usuario. (En el backstage /admin, un vocabulario un poco más técnico es aceptable porque el lector es del equipo Rutax.)
5. **Nunca culpar al usuario.** Los errores explican qué pasó y qué hacer, en tono neutro y útil.

## Convenciones de forma
- **Sentence case** en títulos, botones y etiquetas: "Crear pedido", "Mi plan", no "Crear Pedido" ni "MI PLAN". Excepción: nombres propios (Rutax, Mercado Libre, Flex).
- **Botones = verbo + objeto concreto**: "Guardar cambios", "Asignar conductor", "Descargar factura". Evitar "Enviar", "Aceptar", "OK" sueltos cuando se puede ser específico.
- **Sin signos de más:** un solo signo de exclamación como máximo, y con moderación. Nada de "!!!" ni mayúsculas para gritar.
- **Tildes y ortografía impecables.** Revisar: más/mas, sólo→solo (adverbio sin tilde), qué/que, cómo/como, tú/tu, él/el, sí/si, aún/aun.
- **Números y dinero:** montos en CLP con formato chileno ($1.234.567). Fechas legibles (14 de julio de 2026 o 14-07-2026 según contexto). Horas en zona de Santiago.
- **Comillas y guiones:** usar comillas y rayas correctas cuando el medio lo permite; no abusar de MAYÚSCULAS para enfatizar (usar negrita si el componente lo soporta).

## Terminología (unificar en todo el producto)
- **Pedido** (no "orden", no "envío" salvo en contexto Flex/etiqueta).
- **Conductor** (la persona que reparte). No "repartidor" ni "chofer" de forma inconsistente.
- **Seller** — se mantiene "seller" por ser el término de Mercado Libre que el rubro usa; alternativa aceptable "vendedor" SOLO si ya domina en esa pantalla. Elegir uno por superficie y no mezclar.
- **Manifiesto** (la hoja de ruta del día del conductor).
- **Liquidación** (lo que se le paga al conductor).
- **Cobro / factura** (lo que el courier cobra al seller).
- **Suscripción / plan** (lo que el courier le paga a Rutax).
- **Courier** (la empresa de última milla, el cliente de Rutax). En pantallas del propio courier, hablarle en primera persona ("tu operación", "tus pedidos"), no llamarlo "courier".
- **Rutax** siempre con R mayúscula.

## Tipos de mensaje
- **Títulos de pantalla:** dicen qué es la pantalla en pocas palabras. "Pedidos de hoy", no "Listado de pedidos del día actual".
- **Estados vacíos:** explican qué es la sección + el primer paso concreto. Cálidos, nunca un frío "Sin datos". Ej.: "Aún no tienes pedidos. Cuando ingreses uno, aparecerá acá."
- **Errores:** qué pasó + qué hacer. Sin tecnicismos ni códigos crudos. Ej.: "No pudimos guardar el cambio. Revisa tu conexión e inténtalo de nuevo."
- **Confirmaciones de acciones sensibles** (borrar, desactivar, cobrar, emitir): dejar clarísima la consecuencia antes de confirmar.
- **Éxito:** breve y concreto. "Listo, el conductor quedó asignado."
- **Correos:** asunto corto y claro (qué pasó). Cuerpo: saludo → qué pasó → qué hacer (con enlace) → cierre sobrio firmado "Rutax". Tonos: bienvenida cálida; recibo/confirmación breve; cobro fallido / vencimiento firmes pero nunca alarmistas ni amenazantes.

## Qué NO tocar
- Lógica, props, nombres de variables, claves de traducción, ni valores que el código interpola (montos, fechas, nombres que vienen por variable).
- El vocabulario técnico interno del código y los comentarios (esto es solo para texto de cara al usuario).

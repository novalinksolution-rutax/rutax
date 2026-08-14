# Texto de consentimiento: Punto de término de ruta del conductor

**Versión:** v1  
**Responsable:** UX Writer  
**Aprobado por:** Seguridad-Cumplimiento (2026-08-14)  
**Referencia normativa:** `docs/seguridad/punto-de-termino-conductor.md` §5.2 y §4.4

---

## 1. Pantalla de consentimiento (flujo inicial)

### Título
**Termina tu ruta más cerca de tu casa**

### Cuerpo principal

Cuando acabas la jornada, ¿siempre quedas lejos de tu casa? Si nos dices dónde vives aproximadamente, ordenamos tus entregas para que termines por tu sector.

**Qué guardamos**
Un punto aproximado en el mapa, sin dirección exacta. Nada de historial de dónde anduviste.

**Quién lo ve**
Solo tú. Tu jefe no lo ve, el dueño del courier tampoco, nadie.

**Es opcional, y nadie sabe si dijiste que no**
Si no lo defines, tu ruta simplemente termina en la última parada. **Tu jefe no puede ver quiénes lo marcaron y quiénes no**: para él, las dos rutas se ven igual. Y lo puedes quitar cuando quieras, en un toque, sin que pase nada.

**Lo que va a pasar con el tiempo**
Tu jefe puede notar, después de varias rutas, que tiendes a terminar por tu sector. No la dirección exacta, la comuna o la zona. Es el costo de esta funcionalidad y no hay forma de evitarlo. Pero solo si alguien mira muchas rutas tuyas a lo largo de semanas.

**Cuánto dura**
Se borra automáticamente después de 90 días sin trabajar. Tú lo puedes borrar cuando quieras, y borra de verdad.

### Botones

| Botón | Acción |
|-------|--------|
| **Marcar mi punto** | Acepta el consentimiento y lleva a la pantalla del mapa para que defina su ubicación. |
| **Mejor no** | Rechaza sin hacer nada; cierra el diálogo y se vuelve a la pantalla anterior. |

**Nota sobre el botón de rechazo:** "Mejor no" en lugar de "Cancelar" porque sugiere una elección deliberada, no una salida de un flujo. El conductor que rechaza está tomando una decisión válida, no interrumpiendo algo.

---

## 2. Pantalla posterior: "Tu punto de término está guardado"

Aparece después de que el conductor marcó su punto en el mapa.

### Título
**Tu punto de término está guardado**

### Cuerpo

**Dónde termina tu ruta**  
[Pin en mapa con zoom a la zona] · [Nombre de la comuna]

Se usará para ordenar tus entregas de modo que termines por acá.

### Acciones disponibles

| Acción | Texto | Resultado |
|--------|-------|-----------|
| Cambiar | **Marcar otro punto** | Lleva al mapa nuevamente; al guardar un nuevo punto, sobrescribe el anterior. |
| Revocar | **Quitar mi punto de término** | Abre un diálogo de confirmación (ver §3). |

### Avisos adicionales

- Después de 90 días sin trabajar, este punto se borra automáticamente.
- Si cambias de domicilio, vuelve a marcar tu nuevo punto.

---

## 3. Confirmación de borrado

Aparece al tocar "Quitar mi punto de término".

### Título
**¿Quitar tu punto de término?**

### Cuerpo

Una vez lo borres, se olvida todo. Tu ruta volverá a terminar en la última parada normal, sin ajuste hacia tu sector.

### Botones

| Botón | Acción |
|-------|--------|
| **Sí, borrar** | Borra la fila inmediatamente; cierra el diálogo. Vuelve a §2 sin el punto (ve "Marcar mi punto" en lugar de "Cambiar"). |
| **Mejor no** | Cierra sin hacer nada. |

**Nota:** Sin confirmación en cadena (no pedir "¿estás seguro?"). Un toque es suficiente si el botón es claro.

---

## 4. Versión corta: Para ofrecerlo por primera vez

Aparece probablemente en una tarjeta de su perfil, o una fila en el menú de ajustes.

### Formato: Tarjeta o Fila

**Título**  
Punto de término

**Descripción**  
Marca dónde vives para terminar tu ruta más cerca de tu casa.

**Estado (si no lo definió todavía)**  
No configurado · [Botón] Configurar

**Estado (si ya lo definió)**  
Guardado en [Comuna] · [Botón] Cambiar

**Nota:** Esta versión corta no hace la promesa completa; da ganas de tocar para saber más. La promesa completa está en §1.

---

## 5. Flujo de rechazo (cuando dice "Mejor no" en §1)

Si el conductor rechaza en la pantalla inicial:

### Cuerpo (opcional, si se muestra un aviso)
Tu ruta simplemente terminará en la última parada. Puedes cambiar de idea cuando quieras desde tu perfil.

**Nota:** No insistir ni mostrar un recordatorio. El consentimiento es libre; si dice no, se respeta. La opción de cambiar de idea está siempre disponible en su perfil.

---

## 6. Notas sobre la redacción y decisiones de UX

### Dos correcciones aplicadas en revisión (2026-08-14)

**1. Faltaba la frase que hace libre el consentimiento.** El texto decía quién ve el punto y
declaraba el residuo, pero no decía **que el jefe no puede saber quién lo definió y quién no**. Sin
esa frase, el conductor supone lo contrario —que su jefe verá quién "no cooperó"— y entonces su
negativa no es libre: bajo subordinación laboral el consentimiento solo vale si negarse no queda a
la vista de quien manda. El sistema está construido para que las dos rutas se vean idénticas
(`docs/seguridad/punto-de-termino-conductor.md` §4), pero eso **hay que decírselo**: nadie lo va a
suponer. Es la frase más importante de toda la pantalla.

**2. Voseo argentino mezclado con tuteo.** Había "dónde vivís" junto a "dices"/"puedes" en la misma
frase, y "volvé a marcar". En Chile la forma escrita natural es el tuteo; el voseo suena de otro
país y rompe la confianza justo donde se está pidiendo algo delicado. Corregido a "vives" y
"vuelve".

### Puntos obligatorios del §5.2 cubiertos

- ✅ **Qué se guarda**: "un punto aproximado en el mapa, sin dirección exacta"
- ✅ **Para qué**: "ordenar tus entregas para que termines por tu sector"
- ✅ **Quién lo ve**: "Solo tú. Tu jefe no lo ve"
- ✅ **Opcional y revocable**: "Es opcional y revocable" + "se puede quitar cuando quieras, en un toque"
- ✅ **Residuo (§4.4)**: "Tu jefe puede notar que tiendes a terminar por tu sector" + "No la dirección exacta, la comuna o la zona" + "Es el costo de esta funcionalidad"
- ✅ **Retención y purga**: "Se borra automáticamente después de 90 días sin trabajar"

### Decisiones de lenguaje

1. **"Aproximado" vs "impreciso"**: "Aproximado" suena mejor a un conductor chileno que "impreciso", que suena técnico.

2. **"Tu jefe no lo ve"**: Dicho directamente porque es exactamente lo que hace válido el consentimiento bajo subordinación laboral (§4.2 del documento de privacidad). Sin esto el conductor asume lo peor.

3. **"Mejor no" como botón de rechazo**: En lugar de "Cancelar" o "No", porque sugiere una elección deliberada, no una interrupción. El conductor que dice "Mejor no" está siendo sensato, no incumpliendo un flujo.

4. **"Borra de verdad"**: La Ley 21.431 pide que el conductor entienda que el borrado es definitivo. "De verdad" es informal pero efectivo en español de Chile.

5. **El residuo sin suavizar**: "Tu jefe puede notar que tiendes a terminar por tu sector" es directo y honesto. No dice "quizá" ni "tal vez"; dice qué puede pasar. Eso es lo que hace informado el consentimiento.

6. **"Sector" además de "comuna"**: La mayoría de los conductores chilenos no piensa en "comunas" en el día a día; "sector" es más natural.

### Por qué NO se dice

- **No se menciona "Ley 21.431"**: La ley existe, pero nombrarla confunde. El conductor necesita entender qué gana, no qué lo protege legalmente.
- **No se dice "datos personales"**: Jerga legal. "Dónde vives" es más claro.
- **No se dice "consentimiento"**: El conductor no necesita saber que se llama "consentimiento"; necesita entender que está eligiendo.
- **No se oculta el residuo**: No dice "nadie lo va a ver" (sería falso) ni "solo tu jefe lo verá" (contradicho al inicio). Dice la verdad: se puede deducir la comuna con el tiempo.

---

## 7. Consideraciones de UX/UI

### Dónde mostrar cada pantalla

| Pantalla | Contexto | Trigger |
|----------|----------|---------|
| §1 (Consentimiento) | Primera vez que el conductor entra a su perfil, si no lo definió todavía | Botón "Configurar" en la tarjeta (§4), o automático al primera entrada |
| §2 (Guardado) | Después de marcar el punto en el mapa | Retorno de la Server Action que guarda |
| §3 (Confirmación) | Al tocar "Quitar mi punto de término" en §2 | Botón en la pantalla de §2 |
| §4 (Versión corta) | Perfil del conductor, en un lugar prominente | Siempre visible en la sección de ajustes operativos |

### Espacios donde NO aparece

Per §4.3 (15 canales de fuga):

- ❌ Manifiesto impreso, PDF, CSV
- ❌ Portal del seller o panel del coordinador
- ❌ Exportación de datos del courier
- ❌ Bitácora de auditoría (se registra el hecho, no la coordenada)
- ❌ Supabase Realtime
- ❌ Torre de control
- ❌ Sentry (nunca como contexto de un error)

---

## 8. Registro de consentimiento

Al aceptar (§1) o cambiar de idea (§2→§3), se registra en `operacion.consentimientos_ubicacion`:

```
{
  conductor_id: <uuid>,
  tenant_id: <uuid>,
  otorgado_en: <now()>,
  revocado_en: null (si acepta) o now() (si revoca),
  finalidad: 'punto_termino_ruta'
}
```

**Versión del texto:** `VERSION_TEXTO_CONSENTIMIENTO_PUNTO_TERMINO = "v1"`

El campo `finalidad` distingue este consentimiento del rastreo en vivo (`rastreo_en_ruta`). Si el conductor revoca punto de término, el rastreo sigue vigente (o no) según su propio consentimiento.

---

## 9. Bitácora de auditoría

Al registrar o revocar, se anota en `bitacora_auditoria` solo el hecho, **sin la coordenada**:

- **Hecho registrado**: `conductor.punto_termino.definido` o `conductor.punto_termino.revocado`
- **Campos capturados**: `conductor_id`, `tenant_id`, `actorUsuarioId`, `timestamp`
- **Campos prohibidos**: `lat`, `long`, `latitud`, `longitud`, `punto_termino` (ver `CLAVES_PROHIBIDAS` en `src/modules/identidad/auditoria.ts`)

---

## 10. Próximos pasos para la implementación

1. **Server Action `definirPuntoTermino`**: guarda en `punto_termino_conductor` + registra consentimiento + audita.
2. **Server Action `borrarPuntoTermino`**: revoca consentimiento + audita + **DELETE** inmediato (no `activa = false`).
3. **Componente `<MapaDefinirPunto />`**: permitir al conductor marcar un pin; al guardar, redondea a 3 decimales y extrae la comuna.
4. **Validación**: rechazar intentos de guardar una dirección en texto; solo aceptar coordenadas.
5. **Tests** (Vitest): dos conductores, mismas paradas, uno con punto y otro sin → DTO idéntico.
6. **Tests** (pgTAP): aislamiento por conductor, redondeo, borrado inmediato.

---

## Anexo: Checklist de conformidad

Antes de desplegar a producción:

- [ ] §1: Pantalla de consentimiento muestra los 6 puntos del §5.2
- [ ] §2: Pantalla de guardado muestra el punto con la comuna, opciones de cambiar y borrar
- [ ] §3: Confirmación de borrado es clara y revocable
- [ ] §4: Tarjeta corta está en el perfil del conductor
- [ ] Residuo (§4.4) se declara sin suavizar: "Tu jefe puede notar que tiendes a terminar por tu sector"
- [ ] Botón de rechazo dice "Mejor no", no "Cancelar"
- [ ] Borrado es inmediato (DELETE), no `activa = false`
- [ ] Versión `"v1"` está registrada en código
- [ ] El punto no aparece en manifiesto, PDF, exportación, ni panel del coordinador
- [ ] Auditoría registra el hecho sin la coordenada
- [ ] Pruebas de aislamiento (pgTAP) + DTO idéntico (Vitest) pasan al verde

# Cómo se hace esta reconciliación

## Por qué existe

El rediseño se estaba bajando a código **contra los `.md` de reglas**, y el checklist enumeraba
*componentes* — las tablas de `RUTAX-COSTO-DE-IMPLEMENTACION.md` §10. Eso dejó un punto ciego
entero: **las pantallas cuyo layout cambió completo**. El caso que lo destapó es el dashboard
operativo, que en el tablero `B1c` es un mosaico de ocho magnitudes y en el código sigue siendo
la pantalla vieja. Su componente —`mosaico de magnitudes`— está en `RUTAX-SISTEMA-DE-DISENO.md`
§8 y **no aparece ni una vez en el checklist**.

Así que esto no enumera componentes: enumera **pantallas**, y para cada una compara el tablero
con el código real.

## Regla de oro

**Lo que manda es el tablero.** Si el tablero y un `.md` se contradicen, se anota la
contradicción y no se resuelve acá.

## Cómo se clasifica cada pantalla

Un veredicto por pantalla, y solo uno:

| Veredicto | Qué significa |
|---|---|
| `IGUAL` | El código ya tiene la estructura del tablero. Puede faltar pulido; no falta trabajo de bloque. |
| `FALTA PIEZA` | La estructura está, faltan piezas concretas y enumerables (una columna, un estado, un bloque). |
| `PANTALLA DISTINTA` | El tablero propone otra organización de la información. **Hay que rehacerla**, no parchearla. Es el veredicto caro. |
| `NO EXISTE` | La ruta no está en el repo. |

## Qué se escribe por pantalla

- **Ruta real** en `src/app/…` (o `NO EXISTE`).
- **Qué muestra el tablero**: la estructura, en 3–6 líneas. Regiones, orden, qué manda arriba.
- **Qué tiene el código hoy**: con `archivo:línea`, verificado leyendo, no supuesto.
- **Delta**: la lista de diferencias, cada una accionable.
- **Veredicto** de la tabla de arriba.

## Cómo se trabaja (esto no es opcional)

**Se escribe al disco sección por sección, a medida que se avanza.** No se acumula el documento
para volcarlo al final: un barrido de 508k tokens ya terminó una vez sin dejar nada escrito.
Cada pantalla que se termina de analizar se agrega al archivo antes de pasar a la siguiente.

**No se toca nada fuera de `docs/diseno/_reconciliacion/`.** Nada de `src/`, nada de migraciones.
Esto es un levantamiento, no una implementación.

## Los tableros

Están todos en `docs/diseno/pantallas/`, y `INDICE.md` dice qué hay en cada uno. Son HTML con
estilos en línea y sin una sola clase: para leerlos conviene `grep`/`sed` por texto visible en
vez de cargar el archivo entero.

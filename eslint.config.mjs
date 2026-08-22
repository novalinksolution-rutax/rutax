import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Material archivado (hoy: el handoff de diseño de Torre de control v1,
    // con sus prototipos HTML y su runtime `support.js` / `_ds/`). Es
    // REFERENCIA HISTÓRICA, no código de producción: no se compila ni se
    // importa. Lintearlo deja el proyecto en rojo por código que nadie va a
    // mantener.
    "docs/_historico/**",
    // Tableros visuales del rediseño (`docs/diseno/pantallas/`): HTML autónomo
    // exportado desde Claude Design, con el mismo runtime vendorizado
    // `support.js` que el handoff archivado de arriba. Es la ESPECIFICACIÓN
    // VISUAL, no código de producción: se abre en el navegador con doble clic,
    // no se compila ni se importa. Sus 2 errores —`ReactDOM.render` de React 17
    // y una asignación a `module`— son del exportador, no nuestros, y dejaban
    // `npm run lint` en rojo permanente, que es como no tener compuerta.
    "docs/diseno/pantallas/**",
    // Artefactos generados y fuera del repo (`.gitignore`): el basemap PMTiles
    // recortado y el prototipo navegable de la Torre v2, con su copia compilada
    // del estilo y sus vendorizados de MapLibre/PMTiles. Es andamiaje de
    // diseño, no código de producción — no se compila ni se importa desde
    // `src/`. Sin esto, el `require()` del bundle compilado deja el lint en
    // rojo por código que nadie escribió a mano.
    ".artefactos/**",
    // Worktrees de git. Claude Code los crea DENTRO del repo (`.claude/worktrees/`),
    // así que un `npm run lint` desde la raíz entra a lintear la copia de trabajo
    // de cada worktree: son los mismos archivos otra vez, más su `coverage/` y su
    // `.next/`. Medido: 836 archivos de ruido y 2.266 "errores" que no existen en
    // el código — suficiente para que la salida del lint deje de servir mientras
    // haya un worktree abierto.
    ".claude/**",
    // Reportes de `npm run coverage`: HTML y JS generados, no fuente.
    "coverage/**",
  ]),
]);

export default eslintConfig;

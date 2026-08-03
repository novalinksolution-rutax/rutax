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
    // Artefactos generados y fuera del repo (`.gitignore`): el basemap PMTiles
    // recortado y el prototipo navegable de la Torre v2, con su copia compilada
    // del estilo y sus vendorizados de MapLibre/PMTiles. Es andamiaje de
    // diseño, no código de producción — no se compila ni se importa desde
    // `src/`. Sin esto, el `require()` del bundle compilado deja el lint en
    // rojo por código que nadie escribió a mano.
    ".artefactos/**",
  ]),
]);

export default eslintConfig;

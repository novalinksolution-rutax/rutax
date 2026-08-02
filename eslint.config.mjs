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
    // Paquete de handoff de diseño de Torre de control: prototipos HTML con su
    // runtime (`support.js`, `_ds/`) para abrirse offline. Son REFERENCIA
    // VISUAL, no código de producción — se recrean en Next/Tailwind, no se
    // compilan ni se importan. Lintearlos deja el proyecto en rojo por código
    // que nadie va a mantener.
    "design_handoff_torre_de_control/**",
  ]),
]);

export default eslintConfig;

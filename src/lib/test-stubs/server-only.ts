// Stub de `server-only` para Vitest.
//
// El paquete real (`server-only`) es un side-effect-only import que Next.js
// usa para hacer fallar el BUILD si un módulo de servidor se cuela al bundle
// del cliente. No está instalado como dependencia de este repo (no hace falta
// para Next.js: basta con que el paquete exista) y Vitest, que no pasa por el
// bundler de Next, no lo resuelve — así que cualquier módulo importado
// transitivamente por un test que empiece con `import "server-only"` tumbaba
// la suite con "Cannot find package 'server-only'", aunque el módulo en
// cuestión no tuviera nada de específico del navegador.
//
// Este alias (`vitest.config.ts` → `resolve.alias`) reemplaza esa importación
// por un módulo vacío SOLO en pruebas. No afecta el build de Next.js — Vitest
// no participa de él — así que la protección real (evitar que ese código
// llegue al navegador) sigue intacta donde importa.
export {};

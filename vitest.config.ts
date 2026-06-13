import { defineConfig } from "vitest/config";
import path from "node:path";

// Configuración mínima de Vitest para pruebas unitarias del lado servidor
// (TypeScript end-to-end). No se usa entorno de browser: estas pruebas cubren
// lógica de dominio pura (RBAC, reglas de dinero, onboarding/invitaciones con
// dependencias inyectadas, cifrado, resiliencia de adaptadores) — nunca
// golpean Supabase real ni necesitan DOM.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    exclude: ["**/node_modules/**"],
    globals: false,
    // Cobertura con piso (trinquete): el CI corre `npm run coverage` y falla si
    // un cambio baja la cobertura bajo estos umbrales. Fijados unos puntos bajo
    // la base medida (junio 2026: ~67% stmts / 60% branch / 75% fn / 70% lines)
    // para no fallar por ruido, pero sí bloquear erosión real. Solo deben SUBIR.
    // Sin `all`/`include`: medimos los archivos que los tests realmente ejercen
    // (lógica de servidor) — no las páginas .tsx de UI, que no tienen tests unit.
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      thresholds: {
        statements: 65,
        branches: 58,
        functions: 72,
        lines: 67,
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});

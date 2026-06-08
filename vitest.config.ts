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
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});

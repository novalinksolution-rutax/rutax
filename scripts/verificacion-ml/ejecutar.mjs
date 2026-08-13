#!/usr/bin/env node
// =============================================================================
// Arrancador de la verificación en vivo contra la API de Mercado Libre.
//
// Qué hace: cargar `verificar-contrato-ml.ts` con TypeScript y los alias `@/`
// del proyecto resueltos, y ejecutar su `main()`. Nada más — toda la lógica de
// verificación vive en el `.ts`, que sí pasa por `npm run typecheck` y
// `npm run lint`.
//
// POR QUÉ EXISTE ESTE ARCHIVO (y no se corre el .ts directamente)
// ---------------------------------------------------------------------------
// El script importa a propósito el código real del proyecto (`peticionMl`,
// `descifrarSecreto`, `extraerShipmentId`, `interpretarShipment`) en vez de
// reimplementarlo. Ese código usa imports sin extensión (`../resiliencia`) y el
// alias `@/`, y además `resiliencia.ts` tiene una propiedad de parámetro en un
// constructor — sintaxis que el borrado de tipos nativo de Node NO acepta. Es
// decir: `node verificar-contrato-ml.ts` falla, y no por culpa del script.
//
// Se usa Vite (que ya está en `node_modules` porque Vitest depende de él) como
// cargador: `ssrLoadModule` compila TypeScript, resuelve el alias y las
// extensiones, y deja `node_modules` como externo. Cero dependencias nuevas y
// cero descargas.
//
// Alternativa equivalente si algún día prefieres no depender de Vite:
//   npx tsx --env-file=.env.local scripts/verificacion-ml/verificar-contrato-ml.ts
// (habría que agregarle al .ts una llamada final a `main(process.argv.slice(2))`).
//
// CÓMO SE CORRE
// ---------------------------------------------------------------------------
//   node scripts/verificacion-ml/ejecutar.mjs --listar
//   node scripts/verificacion-ml/ejecutar.mjs
//   node scripts/verificacion-ml/ejecutar.mjs --conexion <uuid> --dias 7 --envios 3
//
// Requiere en el entorno (nunca se imprime el valor de ninguna):
//   NEXT_PUBLIC_SUPABASE_URL · SUPABASE_SERVICE_ROLE_KEY · SECRETOS_CLAVE_CIFRADO_B64
// Node no carga `.env.local` solo: o se pasa `--env-file=.env.local`, o se
// exportan las variables antes (lo recomendado para apuntar a producción, para
// no dejar credenciales de producción escritas en un archivo del repo).
//
// Códigos de salida: 0 = corrió completo (los veredictos van en la salida) ·
// 1 = no se pudo completar (falta entorno, no hay conexiones, token vencido) ·
// 2 = mal uso de las opciones.
// =============================================================================
import path from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, "..", "..");

async function main() {
  let createServer;
  try {
    ({ createServer } = await import("vite"));
  } catch {
    console.error(
      "No se pudo cargar Vite desde node_modules, que es lo que compila el script.\n" +
        "  Corre `npm install` en la raíz del repo y vuelve a intentar.\n" +
        "  Alternativa sin Vite: npx tsx scripts/verificacion-ml/verificar-contrato-ml.ts",
    );
    return 1;
  }

  const servidor = await createServer({
    configFile: false,
    root: RAIZ,
    appType: "custom",
    logLevel: "warn",
    server: { middlewareMode: true },
    optimizeDeps: { noDiscovery: true },
    resolve: { alias: { "@": path.resolve(RAIZ, "src") } },
  });

  try {
    const modulo = await servidor.ssrLoadModule(
      "/scripts/verificacion-ml/verificar-contrato-ml.ts",
    );
    return await modulo.main(process.argv.slice(2));
  } finally {
    await servidor.close();
  }
}

main()
  .then((codigo) => process.exit(typeof codigo === "number" ? codigo : 0))
  .catch((error) => {
    console.error("Error inesperado del arrancador:", error?.message ?? error);
    process.exit(1);
  });

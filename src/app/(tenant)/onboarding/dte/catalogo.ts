/**
 * Catálogo de proveedores DTE (Pantalla E, §1.2) — datos y helpers estáticos,
 * sin acceso a datos ni efectos.
 *
 * Vive en un módulo aparte de `actions.ts` porque ese archivo lleva
 * `"use server"`, y Next.js exige que TODO export de un módulo con esa
 * directiva sea una Server Action async — no admite constantes, tipos
 * (en tiempo de ejecución) ni funciones síncronas exportadas junto a ellas
 * ("Server Actions must be async functions"). Compartido entre el servidor
 * (`actions.ts`) y el cliente (`formulario-configuracion-dte.tsx`).
 */

export interface ProveedorDte {
  id: string;
  nombre: string;
  descripcion: string;
  /** Campos de credenciales que este proveedor exige — el formulario se adapta (§1.2). */
  camposCredenciales: Array<{ clave: string; etiqueta: string; tipo: "text" | "password" }>;
  /** `true` si gestiona folios CAF directo con el SII (decisión documentada en NOTAS-FOLIOS.md). */
  gestionaFolios: boolean;
}

export const PROVEEDORES_DTE: ProveedorDte[] = [
  {
    id: "simplefactura",
    nombre: "SimpleFactura (Chilesystems)",
    descripcion: "Gestiona también tus folios CAF directo con el SII — no necesitas cargarlos tú.",
    camposCredenciales: [
      { clave: "usuario", etiqueta: "Usuario o RUT de acceso", tipo: "text" },
      { clave: "api_key", etiqueta: "API key", tipo: "password" },
    ],
    gestionaFolios: true,
  },
  {
    id: "openfactura",
    nombre: "Openfactura (Haulmer)",
    descripcion: "Tú gestionas tus folios CAF: deberás descargarlos del SII y cargarlos aquí.",
    camposCredenciales: [{ clave: "api_key", etiqueta: "API key", tipo: "password" }],
    gestionaFolios: false,
  },
];

export function obtenerProveedorDte(id: string): ProveedorDte | null {
  return PROVEEDORES_DTE.find((p) => p.id === id) ?? null;
}

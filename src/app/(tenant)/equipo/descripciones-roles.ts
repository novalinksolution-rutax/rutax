/**
 * Descripciones de una línea por rol interno invitable — Pantalla I (§2.2):
 * "cada opción del selector lleva una descripción de qué puede hacer ese rol
 * — esto evita la pregunta '¿y un coordinador qué puede hacer?' que hoy
 * termina en WhatsApp al fundador."
 *
 * Resumen fiel del mapa rol→capacidades de `capacidades.ts` (única fuente de
 * verdad de RBAC) — si ese mapa cambia, esta descripción debe revisarse para
 * no prometer algo que el rol ya no puede hacer.
 */

import type { RolInterno } from "@/modules/identidad/roles";

export const DESCRIPCIONES_ROLES_INTERNOS: Record<RolInterno, { etiqueta: string; descripcion: string }> = {
  dueno: {
    etiqueta: "Dueño",
    descripcion: "Control total: usuarios, facturación, tarifas, liquidaciones y operación diaria.",
  },
  administracion: {
    etiqueta: "Administración",
    descripcion: "La capa de dinero: factura, liquida a conductores, cobra y concilia. Sin reasignar pedidos.",
  },
  supervisor: {
    etiqueta: "Supervisor",
    descripcion: "Operación diaria: asigna pedidos, genera manifiestos y gestiona incidencias. Sin acceso a dinero ni usuarios.",
  },
  coordinador: {
    etiqueta: "Coordinador",
    descripcion: "El más acotado: solo asigna pedidos y genera manifiestos.",
  },
};

/**
 * Constantes de las marcas operativas.
 *
 * Viven aquí y no en `acciones.ts` porque **un archivo `"use server"` solo puede
 * exportar funciones async**. Exportar una constante desde ahí no es un aviso ni
 * un warning: Turbopack rompe el módulo entero («The module has no exports at
 * all») y la Torre completa deja de cargar con un 500.
 *
 * Ni el typecheck ni ESLint ni los 2367 tests lo vieron — lo cazó abrir la
 * página.
 */

/** Radio por defecto de una marca nueva, en metros. */
export const RADIO_MARCA_DEFECTO_M = 500;

/** Tope de caracteres de la nota. Es una anotación, no un parte. */
export const MAX_CARACTERES_NOTA = 280;

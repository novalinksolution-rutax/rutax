/**
 * Bancos y tipos de cuenta de Chile — catálogo compartido de presentación.
 * =============================================================================
 *
 * Vive acá por la regla del proyecto: el formato de moneda, la traducción de
 * estados, el catálogo de comunas y el nombre visible de la fuente ya están en
 * `src/lib/ui/`, para no duplicar lógica de presentación entre `(tenant)`,
 * `portal` y `conductor`.
 *
 * Nació dentro de `panel-conductores.tsx` como una constante local. Se extrajo
 * al aparecer el SEGUNDO consumidor —la cuenta a la que el seller le transfiere
 * al courier— porque dos listas de bancos son dos listas que se separan: se le
 * agrega un banco a una pantalla, la otra sigue sin él, y nadie lo nota hasta
 * que alguien no encuentra el suyo.
 *
 * ⚠️ El valor guardado es el NOMBRE, no un código. Es lo que ya hay en
 * `identidad.conductores.banco` y lo que se imprime tal cual; cambiar a códigos
 * exigiría migrar esas filas y no compra nada mientras la lista la elija una
 * persona de un desplegable.
 */

export const BANCOS_CHILE = [
  "Banco de Chile",
  "BCI",
  "Banco Estado",
  "Santander Chile",
  "Scotiabank Chile",
  "Itaú Chile",
  "BICE",
] as const;

export type TipoCuentaBancaria = "corriente" | "vista" | "ahorro";

/** Las tres del CHECK `courier_datos_cobro_tipo_cuenta_valido`, con su nombre. */
export const ETIQUETAS_TIPO_CUENTA: Record<TipoCuentaBancaria, string> = {
  corriente: "Cuenta corriente",
  vista: "Cuenta vista",
  ahorro: "Cuenta de ahorro",
};

export const TIPOS_CUENTA_BANCARIA = ["corriente", "vista", "ahorro"] as const;

/**
 * Escala de riesgo — Torre de control (README §7, "Escala de riesgo — 5 pasos
 * de trama a 45°"). El riesgo se dibuja en grafito, no en color: la densidad
 * de la trama es el canal primario, la cifra y la palabra viajan siempre con
 * ella (regla de producto 4 — el color nunca es el único canal).
 */

export type PasoRiesgo = 1 | 2 | 3 | 4 | 5;

export interface EscalonRiesgo {
  paso: PasoRiesgo;
  rango: [number, number];
  palabra: string;
  /** Separación de la trama, en px. */
  pitch: number;
  /** Grosor de la línea, en px. */
  grosor: number;
  opacidad: number;
  fondo: string;
  tintaLinea: string;
}

export const ESCALA_RIESGO: EscalonRiesgo[] = [
  { paso: 1, rango: [0, 20], palabra: "calmo", pitch: 13, grosor: 1, opacidad: 0.34, fondo: "#f3f2f2", tintaLinea: "#201e1d" },
  { paso: 2, rango: [21, 40], palabra: "bajo", pitch: 9, grosor: 1, opacidad: 0.4, fondo: "#f3f2f2", tintaLinea: "#201e1d" },
  { paso: 3, rango: [41, 60], palabra: "medio", pitch: 6, grosor: 1, opacidad: 0.52, fondo: "#f3f2f2", tintaLinea: "#201e1d" },
  { paso: 4, rango: [61, 75], palabra: "alto", pitch: 4, grosor: 1.1, opacidad: 0.66, fondo: "#eae7e7", tintaLinea: "#201e1d" },
  { paso: 5, rango: [76, 100], palabra: "crítico", pitch: 3, grosor: 1.4, opacidad: 0.9, fondo: "#fff2ef", tintaLinea: "#ec3013" },
];

/** 0–100 → el escalón de la escala de riesgo que le corresponde. */
export function escalonDeRiesgo(valor: number): EscalonRiesgo {
  const encontrado = ESCALA_RIESGO.find((e) => valor >= e.rango[0] && valor <= e.rango[1]);
  return encontrado ?? (valor > 100 ? ESCALA_RIESGO[4] : ESCALA_RIESGO[0]);
}

/** La palabra del nivel (regla 4: el color nunca es el único canal). */
export function palabraDeRiesgo(valor: number): string {
  return escalonDeRiesgo(valor).palabra;
}

/** true solo para el escalón crítico — es la única condición que usa Señal. */
export function esRiesgoCritico(valor: number): boolean {
  return valor >= 76;
}

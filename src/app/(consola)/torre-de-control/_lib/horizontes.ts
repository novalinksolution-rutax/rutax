import type { Horizonte } from "../_fixture/estado-torre";

/** Los 4 horizontes, en el orden del segmentado (README §4: teclas 1–4). */
export const HORIZONTES: { valor: Horizonte; etiqueta: string; tecla: string }[] = [
  { valor: "hoy", etiqueta: "Hoy", tecla: "1" },
  { valor: "manana", etiqueta: "Mañana", tecla: "2" },
  { valor: "72h", etiqueta: "72 h", tecla: "3" },
  { valor: "olas", etiqueta: "Olas", tecla: "4" },
];

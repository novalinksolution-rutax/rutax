import type { Horizonte } from "../_fixture/estado-torre";

/** Los horizontes, en el orden del segmentado (teclas 1–3). Eran 4: «Olas» se
 * fusionó con «72 h», que es donde la ola entrante tiene contenido real. */
export const HORIZONTES: { valor: Horizonte; etiqueta: string; tecla: string }[] = [
  { valor: "hoy", etiqueta: "Hoy", tecla: "1" },
  { valor: "manana", etiqueta: "Mañana", tecla: "2" },
  { valor: "72h", etiqueta: "72 h", tecla: "3" },
];

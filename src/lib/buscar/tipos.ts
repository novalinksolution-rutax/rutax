/**
 * Contratos compartidos del buscador global (⌘K).
 * Los usa el endpoint `/api/buscar` (servidor) y la paleta de comando (cliente).
 */

export type TipoResultado = "pedido" | "seller" | "conductor" | "liquidacion";

export interface ItemResultado {
  id: string;
  titulo: string;
  subtitulo: string;
  href: string;
}

export interface GrupoResultado {
  tipo: TipoResultado;
  titulo: string;
  items: ItemResultado[];
}

export interface RespuestaBusqueda {
  grupos: GrupoResultado[];
}

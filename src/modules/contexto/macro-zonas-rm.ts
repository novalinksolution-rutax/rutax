/**
 * Macro-zonas de la Región Metropolitana — el fallback de `sin_zonas`.
 * =====================================================================
 *
 * Un courier que todavía no agrupó sus comunas no puede quedarse sin tablero:
 * el handoff define `sin_zonas` como un estado de primera clase donde la Torre
 * muestra **las cinco macro-zonas de la RM** e invita a configurar las propias.
 *
 * Estas cinco son exactamente las del contrato congelado, y no son un invento
 * de relleno: **particionan las 52 comunas de la Región Metropolitana**
 * (8+7+14+9+14), sin repetir ninguna ni dejar ninguna fuera. Hay un test que lo
 * verifica contra `COMUNAS_RM`, porque una comuna que se cayera de la partición
 * desaparecería del tablero EN SILENCIO — sus pedidos no sumarían a ninguna
 * zona y nadie lo notaría.
 *
 * Los `id` son literales, no UUID: estas zonas no existen en `identidad.zonas`.
 * La consola es de solo lectura y no escribe nada contra ellos; en cuanto el
 * courier configure sus zonas de verdad, este catálogo deja de usarse.
 */

export interface MacroZonaRM {
  id: string;
  nombre: string;
  comunas: string[];
}

export const MACRO_ZONAS_RM: readonly MacroZonaRM[] = [
  {
    id: 'zona-oriente',
    nombre: 'Oriente',
    comunas: [
      'Las Condes', 'Vitacura', 'Lo Barnechea', 'Providencia',
      'Ñuñoa', 'La Reina', 'Peñalolén', 'Macul',
    ],
  },
  {
    id: 'zona-centro',
    nombre: 'Centro',
    comunas: [
      'Santiago', 'Estación Central', 'Quinta Normal', 'San Miguel',
      'San Joaquín', 'Pedro Aguirre Cerda', 'Cerrillos',
    ],
  },
  {
    id: 'zona-sur',
    nombre: 'Sur',
    comunas: [
      'Puente Alto', 'La Florida', 'La Granja', 'La Pintana', 'El Bosque',
      'La Cisterna', 'San Ramón', 'Lo Espejo', 'San Bernardo', 'Buin',
      'Paine', 'Calera de Tango', 'Pirque', 'San José de Maipo',
    ],
  },
  {
    id: 'zona-norte',
    nombre: 'Norte',
    comunas: [
      'Conchalí', 'Huechuraba', 'Independencia', 'Quilicura',
      'Recoleta', 'Renca', 'Colina', 'Lampa', 'Tiltil',
    ],
  },
  {
    id: 'zona-poniente',
    nombre: 'Poniente',
    comunas: [
      'Maipú', 'Pudahuel', 'Cerro Navia', 'Lo Prado', 'Curacaví',
      'María Pinto', 'Melipilla', 'Alhué', 'San Pedro', 'Talagante',
      'El Monte', 'Isla de Maipo', 'Padre Hurtado', 'Peñaflor',
    ],
  },
];

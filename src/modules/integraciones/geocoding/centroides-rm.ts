/**
 * Centroides aproximados de las comunas de la Región Metropolitana.
 * =====================================================================
 *
 * SOLO para el adaptador STUB (dev/CI): da un lat/long determinista por comuna
 * sin tocar la red ni costar dinero. NO es una fuente geográfica de precisión —
 * son centroides aproximados a 3–4 decimales, suficientes para que el stub
 * devuelva coordenadas plausibles dentro de la comuna.
 *
 * En producción el adaptador real (google) geocodifica a nivel de calle; estos
 * valores no se usan.
 *
 * Las claves son los nombres EXACTOS del catálogo `COMUNAS_RM`.
 */

import type { ComunaRM } from '@/lib/ui/comunas-rm';

export const CENTROIDES_RM: Record<ComunaRM, { lat: number; long: number }> = {
  'Alhué': { lat: -34.0289, long: -71.1019 },
  'Buin': { lat: -33.7333, long: -70.7417 },
  'Calera de Tango': { lat: -33.6394, long: -70.7686 },
  'Cerrillos': { lat: -33.4969, long: -70.7186 },
  'Cerro Navia': { lat: -33.4233, long: -70.7406 },
  'Colina': { lat: -33.2019, long: -70.6747 },
  'Conchalí': { lat: -33.3833, long: -70.6750 },
  'Curacaví': { lat: -33.4083, long: -71.1417 },
  'El Bosque': { lat: -33.5625, long: -70.6750 },
  'El Monte': { lat: -33.6792, long: -70.9833 },
  'Estación Central': { lat: -33.4597, long: -70.6981 },
  'Huechuraba': { lat: -33.3667, long: -70.6417 },
  'Independencia': { lat: -33.4167, long: -70.6667 },
  'Isla de Maipo': { lat: -33.7500, long: -70.8972 },
  'La Cisterna': { lat: -33.5333, long: -70.6625 },
  'La Florida': { lat: -33.5500, long: -70.5833 },
  'La Granja': { lat: -33.5417, long: -70.6250 },
  'La Pintana': { lat: -33.5833, long: -70.6333 },
  'La Reina': { lat: -33.4444, long: -70.5375 },
  'Lampa': { lat: -33.2833, long: -70.8833 },
  'Las Condes': { lat: -33.4089, long: -70.5683 },
  'Lo Barnechea': { lat: -33.3500, long: -70.5167 },
  'Lo Espejo': { lat: -33.5236, long: -70.6889 },
  'Lo Prado': { lat: -33.4444, long: -70.7250 },
  'Macul': { lat: -33.4894, long: -70.5986 },
  'Maipú': { lat: -33.5167, long: -70.7667 },
  'María Pinto': { lat: -33.5167, long: -71.1333 },
  'Melipilla': { lat: -33.6889, long: -71.2153 },
  'Ñuñoa': { lat: -33.4564, long: -70.5969 },
  'Padre Hurtado': { lat: -33.5667, long: -70.8000 },
  'Paine': { lat: -33.8083, long: -70.7417 },
  'Peñaflor': { lat: -33.6097, long: -70.8769 },
  'Peñalolén': { lat: -33.4889, long: -70.5417 },
  'Pirque': { lat: -33.6389, long: -70.5917 },
  'Providencia': { lat: -33.4314, long: -70.6111 },
  'Pudahuel': { lat: -33.4417, long: -70.7583 },
  'Puente Alto': { lat: -33.6111, long: -70.5756 },
  'Quilicura': { lat: -33.3667, long: -70.7333 },
  'Quinta Normal': { lat: -33.4278, long: -70.7000 },
  'Recoleta': { lat: -33.4000, long: -70.6417 },
  'Renca': { lat: -33.4042, long: -70.7250 },
  'San Bernardo': { lat: -33.5933, long: -70.7000 },
  'San Joaquín': { lat: -33.4944, long: -70.6278 },
  'San José de Maipo': { lat: -33.6417, long: -70.3528 },
  'San Miguel': { lat: -33.4972, long: -70.6500 },
  'San Pedro': { lat: -33.8917, long: -71.4583 },
  'San Ramón': { lat: -33.5389, long: -70.6444 },
  'Santiago': { lat: -33.4489, long: -70.6693 },
  'Talagante': { lat: -33.6639, long: -70.9278 },
  'Tiltil': { lat: -33.0833, long: -70.9333 },
  'Vitacura': { lat: -33.3833, long: -70.6000 },
};

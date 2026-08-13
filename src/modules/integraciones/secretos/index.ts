export { cifrarSecreto, descifrarSecreto } from "./cifrado";
export {
  comoReferenciaSecreto,
  CLAVES_PROHIBIDAS_EN_METADATA,
  type CifrarEntrada,
  type CifrarResultado,
  type DescifrarResultado,
  type MetadataSecreto,
  type ReferenciaSecreto,
  type TipoSecreto,
} from "./tipos";

// Primitivas de cifrado (AES-256-GCM, con AAD opcional) y resolución de la
// clave maestra — de uso EXCLUSIVO para consumidores de `service_role` que
// necesitan cifrar/descifrar por fuera de `identidad.secretos_cifrados` (hoy:
// el retiro en bodega, que cifra `hash_code` del QR de Flex fuera de esa
// tabla porque es volumen O(bultos/día), no O(tenants) — ver
// `docs/arquitectura/retiro-y-ruteo.md` §3 y `retiro-y-ruteo-plan.md`
// etapa 3). `cifrarSecreto`/`descifrarSecreto` arriba siguen siendo el camino
// para todo lo que SÍ vive en `secretos_cifrados`; no dupliques la lectura de
// `SECRETOS_CLAVE_CIFRADO_B64*` en un nuevo módulo — usa `resolverClave`.
export {
  ALGORITMO_AEAD,
  ErrorDescifradoFallido,
  cifrarPaquete,
  descifrarPaquete,
} from "./cifrado-primitivas";
export { KID_ACTIVO, resolverClave } from "./clave-maestra";

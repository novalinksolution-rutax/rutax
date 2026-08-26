/**
 * Mecanismo central de cifrado/descifrado de secretos.
 * =====================================================================
 *
 * Persiste en `identidad.secretos_cifrados` (migración 0003) y devuelve
 * exclusivamente la `referencia_externa_id` opaca — nunca el valor.
 *
 * DECISIÓN DE MECANISMO DE CLAVE (investigado — ver notas abajo):
 * ---------------------------------------------------------------
 * El documento de arquitectura (§5.1) ya fija "no construir un secrets
 * manager propio; integrar con clave gestionada (Supabase Vault o
 * equivalente)". Lo que investigué para decidir CÓMO integrar:
 *
 * 1. Supabase Vault (`supabase_vault`/`pgsodium`) cifra/descifra DENTRO de
 *    Postgres: `vault.create_secret(valor, nombre, descripcion)` guarda el
 *    valor cifrado con AEAD (cifrado + autenticado) y Supabase administra la
 *    clave raíz fuera de la base de datos — nunca convive con los datos
 *    cifrados. Es exactamente "integrar, no construir": cero gestión de
 *    claves de nuestra parte.
 *    Fuente: https://supabase.com/docs/guides/database/vault
 *
 * 2. PERO: la tabla del cimiento (`identidad.secretos_cifrados`, ya migrada)
 *    fue diseñada para guardar el valor cifrado en una columna `bytea`
 *    propia (`valor_cifrado`), NO como filas de `vault.secrets`. Forzar
 *    Vault habría significado una segunda tabla paralela (`vault.secrets`)
 *    con su propio modelo de acceso, divergiendo del esquema ya migrado y
 *    probado (57 pruebas pgTAP) — más infraestructura que operar, lo
 *    opuesto al espíritu de "no sobre-construir" de §5.1.
 *
 * 3. DECISIÓN: cifrado simétrico autenticado (AES-256-GCM, vía el módulo
 *    `node:crypto` nativo — sin dependencias nuevas, ver `cifrado-
 *    primitivas.ts`) ANTES de que el valor llegue a Postgres, con una clave
 *    maestra gestionada como secreto de plataforma (variable de entorno
 *    `SECRETOS_CLAVE_CIFRADO_B64`, inyectada por el orquestador de
 *    despliegue — Vercel/Supabase — nunca en el repo). Esto es "clave
 *    gestionada" en el sentido que pide §5.1 (la clave vive fuera del código
 *    y de la fila; la rota `devops`), sin forzar un cambio de forma de tabla
 *    ya migrada. `valor_cifrado` guarda `version || nonce || ciphertext ||
 *    tag` serializado; `metadata.kid` registra qué versión de clave se usó
 *    — habilita rotación futura sin re-migrar. Si más adelante el
 *    volumen/cumplimiento lo justifica, migrar este mecanismo a Vault es un
 *    cambio interno de esta utilidad — el contrato (`referencia_externa_id`
 *    opaca) no cambia para el resto del sistema.
 *
 * 4. AES-256-GCM es AEAD: cifra Y autentica en una sola operación (igual
 *    garantía que ofrece Vault/pgsodium) — no es un cifrado "casero", es el
 *    estándar de la industria expuesto por la librería nativa de Node/Edge.
 *    Las primitivas puras viven en `cifrado-primitivas.ts` (sin dependencia
 *    de Supabase/entorno) para poder probar el round-trip y la detección de
 *    manipulación de forma aislada — ver `__tests__/cifrado.test.ts`. La
 *    resolución de la clave maestra (`resolverClave`/`KID_ACTIVO`) vive en
 *    `clave-maestra.ts`, extraída para que otros consumidores de las mismas
 *    primitivas (p. ej. el retiro en bodega, que cifra el `hash_code` del QR
 *    de Flex con AAD) usen la misma clave y el mismo esquema de `kid` sin
 *    duplicarlo.
 *
 * GARANTÍAS DE ESTE MÓDULO (no negociables, CLAUDE.md):
 * - `cifrarSecreto` jamás registra el valor en claro — ni en logs, ni en el
 *   error que arroja, ni en `metadata`.
 * - `descifrarSecreto` solo se ejecuta con cliente `service_role`
 *   (`crearClienteServiceRole`), nunca con sesión de usuario — `secretos_
 *   cifrados` ni siquiera tiene políticas RLS para `authenticated`/`anon`.
 * - `metadata` se valida contra `CLAVES_PROHIBIDAS_EN_METADATA` ANTES de
 *   construir el insert — primera línea de defensa, el CHECK de BD es la
 *   segunda (defensa en profundidad, igual lógica que el propio comentario
 *   de la migración 0003).
 */

import { crearClienteServiceRole } from "@/lib/supabase/service-role";

import { ALGORITMO_AEAD, cifrarPaquete, descifrarPaquete } from "./cifrado-primitivas";
import { KID_ACTIVO, resolverClave } from "./clave-maestra";
import {
  CLAVES_PROHIBIDAS_EN_METADATA,
  comoReferenciaSecreto,
  type CifrarEntrada,
  type CifrarResultado,
  type DescifrarResultado,
  type MetadataSecreto,
  type ReferenciaSecreto,
  type TipoSecreto,
} from "./tipos";

/**
 * Valida que `metadata` no contenga ninguna de las claves prohibidas.
 * Espejo en aplicación del CHECK `secretos_cifrados_metadata_sin_secretos`
 * (migración 0003) — defensa en profundidad: preferimos fallar aquí, con un
 * mensaje claro, antes de que el INSERT dependa solo del constraint de BD.
 */
function validarMetadataNoSensible(metadata: MetadataSecreto | undefined): void {
  if (!metadata) return;

  for (const claveProhibida of CLAVES_PROHIBIDAS_EN_METADATA) {
    if (Object.prototype.hasOwnProperty.call(metadata, claveProhibida)) {
      throw new Error(
        `metadata no puede contener la clave "${claveProhibida}" — ` +
          "los secretos solo viven cifrados en `valor_cifrado`, jamás en metadata " +
          "(regla dura del proyecto + constraint SQL de defensa en profundidad).",
      );
    }
  }
}

/**
 * Cifra un valor (texto o binario) y lo persiste en `identidad.secretos_cifrados`.
 * Devuelve SOLO la referencia opaca — el valor en claro nunca sale de esta función
 * hacia el llamador ni hacia ningún log.
 *
 * Llamado por: adaptadores de `integraciones` durante onboarding (certificado
 * digital, credenciales DTE) y durante el intercambio OAuth de ML (tokens).
 */
export async function cifrarSecreto(entrada: CifrarEntrada): Promise<CifrarResultado> {
  validarMetadataNoSensible(entrada.metadata);

  const clave = resolverClave(KID_ACTIVO);
  const paquete = cifrarPaquete(entrada.valor, clave);

  // Importante: no se asigna el valor en claro a ninguna variable de mayor
  // vida ni se incluye en el objeto que se persiste/loguea — solo `paquete`
  // (ya cifrado) sigue vivo de aquí en adelante.

  const metadataPersistida: MetadataSecreto = {
    ...(entrada.metadata ?? {}),
    alg: ALGORITMO_AEAD,
    kid: KID_ACTIVO,
  };

  const supabase = crearClienteServiceRole();
  const { data, error } = await supabase
    .schema("identidad")
    .from("secretos_cifrados")
    .insert({
      tenant_id: entrada.tenantId,
      tipo_secreto: entrada.tipoSecreto,
      // BUG FIX (crítico): NO pasar el Buffer crudo. supabase-js (PostgREST)
      // serializa un Buffer a JSON como {"type":"Buffer","data":[...]}, y eso
      // (texto) es lo que terminaba guardado en la columna `bytea` — el secreto
      // quedaba IRRECUPERABLE (al leerlo, el primer byte era `{` 0x7b, no el
      // byte de versión, y el descifrado fallaba → conexiones marcadas como
      // desvinculadas). Se envía como hex `\x...`, el formato de entrada bytea
      // de Postgres, simétrico con la lectura (`bufferDesdeColumnaBytea`).
      valor_cifrado: `\\x${paquete.toString("hex")}`,
      metadata: metadataPersistida,
      vence_en: entrada.venceEn ? entrada.venceEn.toISOString() : null,
    })
    .select("referencia_externa_id")
    .single();

  if (error) {
    // Mensaje de error deliberadamente sin datos del secreto — solo el
    // código/mensaje que Postgres devuelve sobre la operación de persistencia.
    throw new Error(`No se pudo persistir el secreto cifrado: ${error.message}`);
  }

  return { referenciaExternaId: comoReferenciaSecreto(data.referencia_externa_id as string) };
}

/**
 * Descifra un secreto a partir de su `referencia_externa_id` opaca.
 *
 * EXCLUSIVO para jobs/funciones de servidor autorizadas (este módulo siempre
 * usa `service_role`; nunca debe invocarse en un contexto con sesión de
 * usuario). El valor descifrado es responsabilidad del llamador inmediato:
 * usarlo (p. ej. construir el header `Authorization` de una llamada a ML o
 * firmar un XML DTE) y descartarlo — nunca asignarlo a estructuras de mayor
 * vida, nunca serializarlo a logs/bitácora/respuestas HTTP.
 */
export async function descifrarSecreto(
  referenciaExternaId: ReferenciaSecreto | string,
): Promise<DescifrarResultado> {
  const supabase = crearClienteServiceRole();
  const { data, error } = await supabase
    .schema("identidad")
    .from("secretos_cifrados")
    .select("tipo_secreto, valor_cifrado, metadata, vence_en")
    .eq("referencia_externa_id", referenciaExternaId)
    .maybeSingle();

  if (error) {
    throw new Error(`No se pudo leer el secreto cifrado: ${error.message}`);
  }
  if (!data) {
    // No revelar si "no existe" vs. "no autorizado" más allá de esto — ya
    // estamos en service_role, así que "no existe" es la única posibilidad.
    throw new Error(`No existe un secreto con la referencia provista.`);
  }

  const metadata = (data.metadata ?? {}) as MetadataSecreto;
  const kid = typeof metadata.kid === "string" ? metadata.kid : KID_ACTIVO;
  const clave = resolverClave(kid);

  const paquete = bufferDesdeColumnaBytea(data.valor_cifrado);

  let textoPlano: Buffer;
  try {
    textoPlano = descifrarPaquete(paquete, clave);
  } catch (errorDescifrado) {
    // No envolver la causa original (podría incluir fragmentos del buffer) —
    // se relanza un mensaje propio, ya saneado.
    throw new Error(
      `No se pudo descifrar el secreto: ${(errorDescifrado as Error).message}`,
    );
  }

  const tipoSecreto = data.tipo_secreto as TipoSecreto;
  const esTexto =
    tipoSecreto === "token_oauth_ml_access" ||
    tipoSecreto === "token_oauth_ml_refresh" ||
    tipoSecreto === "credenciales_proveedor_dte" ||
    // Mandato de auto-cobro de suscripción (Fintoc): el id/token del mandato
    // (payment_method / subscription id, o un JSON compacto con ambos) es texto.
    // Sin esto se descifraría como binario (Uint8Array) y el adaptador no podría
    // usarlo como string en el header/cuerpo de la petición a Fintoc.
    tipoSecreto === "mandato_suscripcion_fintoc" ||
    // Admin API access token de Shopify: viaja como string en el header
    // `x-shopify-access-token`. Sin esta línea se descifraría como Uint8Array y
    // el header saldría con "[object Uint8Array]" — la petición fallaría con un
    // 401 que no explica nada.
    tipoSecreto === "token_admin_shopify";

  return {
    valor: esTexto ? textoPlano.toString("utf8") : new Uint8Array(textoPlano),
    tipoSecreto,
    venceEn: data.vence_en ? new Date(data.vence_en as string) : null,
    metadata,
  };
}

/**
 * El cliente supabase-js puede devolver `bytea` como string `\x...` (formato
 * hex de Postgres) o como `Uint8Array`/`Buffer` según el transporte (PostgREST
 * vs. conexión directa). Normalizamos ambos casos sin asumir uno solo —
 * más robusto ante cambios de configuración de PostgREST.
 */
function bufferDesdeColumnaBytea(valor: unknown): Buffer {
  if (Buffer.isBuffer(valor)) return valor;
  if (valor instanceof Uint8Array) return Buffer.from(valor);

  if (typeof valor === "string") {
    if (valor.startsWith("\\x")) {
      return Buffer.from(valor.slice(2), "hex");
    }
    // Fallback: algunos transportes serializan bytea como base64.
    return Buffer.from(valor, "base64");
  }

  throw new Error("Formato de columna `valor_cifrado` no reconocido al descifrar.");
}


/**
 * Borra un secreto de la bóveda, por su referencia opaca.
 * =============================================================================
 *
 * 🔴 **Es la mitad que faltaba.** El módulo sabía cifrar y descifrar, y no
 * olvidar: `grep` de `secretos_cifrados` no devolvía un solo `delete` en todo
 * `src/`. Mientras no se pudiera desconectar una cuenta eso no se notaba —
 * ahora sí, porque una conexión apagada que conserva su refresh token vivo es
 * exactamente lo que no puede pasar.
 *
 * El precedente ya estaba escrito para otra tabla:
 * *«Purga: al revocar, al desvincular y por inactividad. **No basta
 * `activa = false`**»* (`docs/seguridad/punto-de-termino-conductor.md` C5).
 *
 * -----------------------------------------------------------------------------
 * ⚠️ EL ORDEN IMPORTA, Y ES AL REVÉS DE LO QUE PARECE
 * -----------------------------------------------------------------------------
 * Quien llama tiene que **soltar primero la referencia en su tabla** y borrar el
 * secreto después. Al revés queda una ventana en la que la conexión apunta a un
 * secreto que ya no existe, y cualquier job que la lea en ese instante falla al
 * descifrar y la marca `desvinculada` con un error que no significa nada.
 *
 * -----------------------------------------------------------------------------
 * NO FALLA SI YA NO ESTÁ
 * -----------------------------------------------------------------------------
 * Borrar dos veces es correcto: los jobs reintentan y una desconexión que se
 * repite tiene que terminar en el mismo sitio. Lo que sí devuelve es **cuántas
 * filas borró**, para que el llamador pueda distinguir «lo borré» de «ya no
 * estaba» si le importa.
 *
 * ⚠️ El `tenantId` NO es decorativo: esto corre con `service_role`, así que RLS
 * no protege nada. Sin él, una referencia de otro courier borraría su secreto.
 */
export async function olvidarSecreto(
  referenciaExternaId: ReferenciaSecreto | string | null | undefined,
  tenantId: string,
): Promise<{ borrados: number }> {
  if (!referenciaExternaId) return { borrados: 0 };

  const supabase = crearClienteServiceRole();
  const { data, error } = await supabase
    .schema("identidad")
    .from("secretos_cifrados")
    .delete()
    .eq("referencia_externa_id", referenciaExternaId)
    .eq("tenant_id", tenantId)
    .select("id");

  if (error) {
    // Sin datos del secreto en el mensaje, igual que el resto del módulo.
    throw new Error(`No se pudo borrar el secreto: ${error.message}`);
  }

  return { borrados: (data ?? []).length };
}

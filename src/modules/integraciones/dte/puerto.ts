/**
 * Puerto DTE — única puerta por la que el resto del sistema emite y consulta
 * documentos tributarios electrónicos.
 * =====================================================================
 *
 * Aplica la skill `chile-dte`:
 * - El courier es el EMISOR legal bajo su propio RUT; la plataforma orquesta.
 * - Credenciales descifradas NUNCA en logs, errores ni en el resultado.
 * - Cada tenant tiene su propio proveedor DTE configurado en `courier_config_dte`.
 *
 * Patrón idéntico al puerto ML (`integraciones/ml/puerto.ts`):
 * - La función fábrica `obtenerPuertoDte` lee la config del tenant, descifra
 *   credenciales y devuelve el adaptador concreto — el llamador (job C3)
 *   no sabe qué proveedor hay detrás.
 * - El núcleo de `dinero` NUNCA importa de aquí directamente; usa el contrato
 *   `PuertoDte` para inyección de dependencias en tests y el resultado de
 *   `obtenerPuertoDte` en producción.
 *
 * VERIFICACIÓN CONTRA DOC OFICIAL (detalles volátiles a reconfirmar):
 * - `courier_config_dte.proveedor_dte` es text libre en la BD (migración 0003);
 *   los valores válidos los fija el enum `ProveedorDte` de este módulo.
 * - `proveedor_credenciales_ref` es uuid que apunta a `secretos_cifrados.
 *   referencia_externa_id` — la columna `tipo_secreto = 'credenciales_proveedor_dte'`
 *   guarda las credenciales cifradas con AES-256-GCM.
 * - La fábrica usa `service_role` para leer `courier_config_dte` (tabla con RLS
 *   P1 estricta, solo roles internos).
 */

import { crearClienteServiceRole } from '@/lib/supabase/service-role';
import { descifrarSecreto } from '../secretos';
import { ErrorConfigDteInvalida } from './errores';
import { SimplefacturaAdapter } from './adaptadores/simplefactura';
import type {
  ConsultarEstadoDteResultado,
  EmitirFacturaEntrada,
  EmitirFacturaResultado,
  ProveedorDte,
} from './tipos';

// ---------------------------------------------------------------------------
// Interfaz pública del puerto
// ---------------------------------------------------------------------------

/**
 * Contrato que todo adaptador DTE concreto debe cumplir.
 * El núcleo de `dinero` y los jobs Inngest dependen de esta interfaz,
 * nunca del adaptador concreto.
 */
export interface PuertoDte {
  /**
   * Emite un DTE (factura tipo 33 o nota de crédito tipo 61).
   * El folio debe estar RESERVADO transaccionalmente antes de llamar
   * (protocolo §5.4 del documento de arquitectura, job C3).
   */
  emitirFactura(
    tenantId: string,
    entrada: EmitirFacturaEntrada,
  ): Promise<EmitirFacturaResultado>;

  /**
   * Consulta el estado del DTE en el SII via el proveedor.
   * Consumido por el job de polling C5.
   */
  consultarEstadoDte(
    tenantId: string,
    idExternoProveedor: string,
  ): Promise<ConsultarEstadoDteResultado>;

  /**
   * Descarga el XML firmado del DTE.
   * Devuelve el contenido XML como string (base64 o texto, según proveedor).
   * Quien llama es responsable de almacenarlo en Storage privado — nunca
   * serializarlo en logs ni en respuestas HTTP directas.
   */
  descargarXmlDte(tenantId: string, idExternoProveedor: string): Promise<string>;

  /**
   * Descarga el PDF del DTE.
   * Devuelve el contenido como string base64. Quien llama es responsable
   * de almacenarlo en Storage privado y entregarlo al seller vía signed URL.
   */
  descargarPdfDte(tenantId: string, idExternoProveedor: string): Promise<string>;
}

// ---------------------------------------------------------------------------
// Forma interna de la fila de BD
// ---------------------------------------------------------------------------

/** Fila de `identidad.courier_config_dte` tal como Postgres la devuelve. */
interface FilaConfigDte {
  tenant_id: string;
  proveedor_dte: string;
  proveedor_credenciales_ref: string | null;
  certificado_digital_ref: string | null;
  estado_certificacion: string;
}

// ---------------------------------------------------------------------------
// Fábrica pública
// ---------------------------------------------------------------------------

/**
 * Lee la configuración DTE del tenant, descifra las credenciales y devuelve
 * el adaptador concreto adecuado al proveedor configurado.
 *
 * GARANTÍAS:
 * - Las credenciales descifradas no se loguean, no se incluyen en errores
 *   y no se asignan a estructuras de mayor vida que el alcance de esta función.
 * - Si la config no existe → `ErrorConfigDteInvalida` (no reintentable).
 * - Si el proveedor no es reconocido → `ErrorConfigDteInvalida`.
 * - Si las credenciales no se pueden descifrar → error operativo (propagado
 *   sin incluir el valor en claro).
 *
 * @param tenantId UUID del tenant (courier) para el que se necesita el puerto.
 */
export async function obtenerPuertoDte(tenantId: string): Promise<PuertoDte> {
  const supabase = crearClienteServiceRole();

  const { data, error } = await supabase
    .schema('identidad')
    .from('courier_config_dte')
    .select(
      'tenant_id, proveedor_dte, proveedor_credenciales_ref, ' +
      'certificado_digital_ref, estado_certificacion',
    )
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (error) {
    throw new ErrorConfigDteInvalida(
      tenantId,
      // Solo el mensaje de BD — sin credenciales ni secretos en el texto.
      `error al leer configuración DTE: ${error.message}`,
    );
  }

  if (!data) {
    throw new ErrorConfigDteInvalida(
      tenantId,
      'no existe configuración DTE para este tenant — completa el onboarding del courier',
    );
  }

  const fila = data as unknown as FilaConfigDte;

  // Descifrar las credenciales del proveedor.
  // Las credenciales descifradas se usan solo para construir el adaptador y
  // no se exportan, no se loguean ni se incluyen en ningún error de este
  // scope — el adaptador concreto es quien las usa internamente.
  let credencialesDescifradas: string | null = null;

  if (fila.proveedor_credenciales_ref) {
    try {
      const resultado = await descifrarSecreto(fila.proveedor_credenciales_ref);
      if (typeof resultado.valor !== 'string') {
        throw new Error('El valor descifrado de credenciales DTE no es texto.');
      }
      credencialesDescifradas = resultado.valor;
    } catch (errorDescifrado) {
      // No propagar el error original (podría incluir fragmentos del valor
      // cifrado). Lanzar un error operativo propio, sin datos sensibles.
      throw new ErrorConfigDteInvalida(
        tenantId,
        'no se pudieron descifrar las credenciales del proveedor DTE — ' +
        'verifica que la clave de cifrado esté configurada correctamente',
      );
    }
  }

  const proveedor = fila.proveedor_dte as ProveedorDte;

  switch (proveedor) {
    case 'simplefactura':
      return new SimplefacturaAdapter(credencialesDescifradas);

    case 'openfactura':
      // TODO (Fase C): implementar OpenfacturaAdapter.
      // Nota: con Openfactura el courier gestiona el CAF propio (descarga y
      // sube el archivo desde el SII) — ver NOTAS-FOLIOS.md. Requiere manejo
      // diferente del certificado_digital_ref comparado con SimpleFactura.
      throw new ErrorConfigDteInvalida(
        tenantId,
        "proveedor 'openfactura' aún no implementado — usa 'simplefactura' en el MVP",
      );

    default:
      throw new ErrorConfigDteInvalida(
        tenantId,
        // `proveedor` es texto libre de BD — podría ser cualquier string.
        // No lo incluimos en el error (defensa contra inyección de contenido).
        'proveedor DTE configurado no es reconocido por esta versión de la plataforma',
      );
  }
}

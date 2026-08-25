/**
 * GET /api/whatsapp/test — prueba de extremo a extremo de la cadena con Meta.
 * =============================================================================
 * Manda la plantilla `hello_world` (la predefinida de Meta, aprobada en toda
 * WABA nueva) a un número fijado por entorno, y devuelve **lo que respondió
 * Meta**. Sirve para separar los tres fallos que desde afuera se ven iguales:
 * token malo, número no registrado para la API, y plantilla que no existe.
 *
 * -----------------------------------------------------------------------------
 * TRES CANDADOS, PORQUE ESTA RUTA GASTA PLATA
 * -----------------------------------------------------------------------------
 *  1. **Nunca en producción.** `VERCEL_ENV === "production"` responde 404 — no
 *     403: una ruta de diagnóstico no debería ni existir para quien la sondea.
 *  2. **Destino por variable de entorno**, jamás en el código. Es un número de
 *     una persona real; escribirlo en el repo lo publica para siempre.
 *  3. **Sesión de un usuario interno**. Un ambiente de staging suele ser
 *     alcanzable desde internet, y sin esto cualquiera podría gastar mensajes.
 *
 * -----------------------------------------------------------------------------
 * SALTA LA COLA A PROPÓSITO
 * -----------------------------------------------------------------------------
 * El camino normal publica un evento y el job envía. Acá se llama al puerto
 * DIRECTO: lo que se quiere diagnosticar es la conversación con Meta, y meterla
 * detrás de un job escondería la respuesta justo cuando es lo único que importa.
 * Por lo mismo no toca `whatsapp_mensajes`: no hay contacto ni consentimiento
 * detrás de esta prueba, y ensuciar la bitácora con ella sería mentir.
 */

import { NextResponse } from "next/server";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import {
  obtenerPuertoWhatsApp,
  whatsappSandboxActivo,
  whatsappConfigurado,
  normalizarTelefonoE164,
  enmascararTelefono,
  obtenerPlantilla,
} from "@/modules/integraciones/notificaciones/whatsapp";

/** Clave del catálogo que apunta a `hello_world`. */
const CLAVE_PRUEBA = "prueba_conexion";

export async function GET(): Promise<NextResponse> {
  // ---- Candado 1: nunca en producción --------------------------------------
  if (process.env.VERCEL_ENV === "production") {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // ---- Candado 3: solo un usuario interno ----------------------------------
  const sesion = await obtenerSesionActual();
  if (!sesion || sesion.usuario.tipoUsuario !== "interno") {
    return NextResponse.json({ error: "no_autorizado" }, { status: 401 });
  }

  // ---- Diagnóstico de configuración, ANTES de intentar nada ----------------
  //
  // Se responde con el estado del gate incluso cuando no se puede enviar: "no
  // pasó nada" es la respuesta menos útil posible, y distinguir "estoy en
  // sandbox" de "me falta el token" ahorra la media hora de rigor.
  const configuracion = {
    sandbox: whatsappSandboxActivo(),
    credencialesPresentes: whatsappConfigurado(),
    phoneNumberIdPresente: Boolean(process.env.WHATSAPP_PHONE_NUMBER_ID),
    accessTokenPresente: Boolean(process.env.WHATSAPP_ACCESS_TOKEN),
    appSecretPresente: Boolean(process.env.WHATSAPP_APP_SECRET),
    verifyTokenPresente: Boolean(process.env.WHATSAPP_VERIFY_TOKEN),
    versionApi: process.env.WHATSAPP_API_VERSION?.trim() || "v25.0 (por defecto)",
  };

  // ---- Candado 2: destino por entorno --------------------------------------
  const destinoCrudo = process.env.WHATSAPP_TEST_NUMERO ?? "";
  const destino = normalizarTelefonoE164(destinoCrudo);
  if (!destino.valido) {
    return NextResponse.json(
      {
        enviado: false,
        configuracion,
        error:
          "Falta WHATSAPP_TEST_NUMERO (o no es un teléfono válido). Ponlo en .env.local con el número que va a recibir la prueba, en formato +56 9 XXXX XXXX.",
      },
      { status: 400 },
    );
  }

  const plantilla = obtenerPlantilla(CLAVE_PRUEBA);
  if (!plantilla) {
    return NextResponse.json(
      { enviado: false, configuracion, error: `El catálogo no tiene "${CLAVE_PRUEBA}".` },
      { status: 500 },
    );
  }

  const puerto = obtenerPuertoWhatsApp();
  const resultado = await puerto.enviarPlantilla({
    telefonoE164: destino.telefonoE164,
    nombrePlantilla: plantilla.nombre,
    idioma: plantilla.idioma,
    variables: [],
  });

  return NextResponse.json(
    {
      enviado: resultado.enviado,
      modo: resultado.modo,
      // Enmascarado: la respuesta puede terminar pegada en un chat o en un
      // ticket, y el número es de una persona.
      destino: enmascararTelefono(destino.telefonoE164),
      plantilla: `${plantilla.nombre} (${plantilla.idioma})`,
      metaMessageId: resultado.metaMessageId ?? null,
      error: resultado.errorDescripcion ?? null,
      reintentable: resultado.reintentable,
      configuracion,
      ...(resultado.modo === "stub"
        ? {
            comoEnviarDeVerdad:
              "Estás en sandbox. Para enviar de verdad: WHATSAPP_SANDBOX_MODE=false más WHATSAPP_ACCESS_TOKEN y WHATSAPP_PHONE_NUMBER_ID.",
          }
        : {}),
    },
    { status: resultado.enviado ? 200 : 502 },
  );
}

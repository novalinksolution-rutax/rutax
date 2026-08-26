/**
 * GET /api/whatsapp/test — diagnóstico de la cadena de WhatsApp.
 * =============================================================================
 * Responde dos preguntas que desde afuera se ven idénticas —«no llegó el
 * mensaje»— y tienen causas totalmente distintas:
 *
 *   `GET /api/whatsapp/test`
 *       Solo lee. Dice en qué estado está el gate (sandbox o real), qué
 *       credenciales hay cargadas y cuántos contactos con consentimiento
 *       existen. No manda nada ni cuesta un peso.
 *
 *   `GET /api/whatsapp/test?enviar=1`
 *       Manda `hello_world` a los contactos de rol `courier` **saltándose
 *       Inngest**: llama al servicio de envío directo. Ese salto es el punto
 *       de todo — si por acá llega el WhatsApp y por el camino normal no,
 *       el problema es la cola, no Meta ni la configuración.
 *
 * -----------------------------------------------------------------------------
 * POR QUÉ AHORA SÍ CORRE EN PRODUCCIÓN
 * -----------------------------------------------------------------------------
 * Hasta el 2026-08-25 esta ruta devolvía 404 fuera de desarrollo, por
 * precaución. Fue exceso de celo, y salió caro el primer día: con el envío real
 * recién abierto y ningún mensaje llegando, la única herramienta capaz de decir
 * por qué estaba apagada justo donde hacía falta.
 *
 * El cierre real no era el ambiente, son estas tres cosas, que siguen en pie:
 *  · sesión de un usuario INTERNO del courier (un seller o un conductor no
 *    entran, y sin sesión tampoco);
 *  · el envío exige `?enviar=1` explícito — un GET curioso no gasta nada;
 *  · el destino NO se elige por parámetro: sale del directorio de contactos con
 *    consentimiento otorgado, igual que cualquier otro envío. No hay forma de
 *    usar esta ruta para escribirle a un número arbitrario.
 *
 * -----------------------------------------------------------------------------
 * NO FILTRA SECRETOS
 * -----------------------------------------------------------------------------
 * De las credenciales solo informa SI ESTÁN, nunca su valor. Del teléfono, la
 * versión enmascarada. Un pantallazo de esta respuesta pegado en un chat no
 * compromete nada — que es justo lo que va a pasar con ella.
 */

import { NextRequest, NextResponse } from "next/server";
import { obtenerSesionActual } from "@/lib/identidad/usuario-actual-servidor";
import { consumirRateLimit } from "@/lib/rate-limit";
import { crearClienteServiceRole } from "@/lib/supabase/service-role";
import {
  whatsappSandboxActivo,
  whatsappConfigurado,
  enviarNotificacionWhatsApp,
} from "@/modules/integraciones/notificaciones/whatsapp";

/** Clave del catálogo que apunta a `hello_world`, la plantilla de Meta. */
const CLAVE_PRUEBA = "prueba_conexion";

/** Un envío de prueba cuesta plata. Pocos y espaciados. */
const LIMITE_ENVIOS = 5;
const VENTANA_SEGUNDOS = 300;

export async function GET(request: NextRequest): Promise<NextResponse> {
  const sesion = await obtenerSesionActual();
  if (!sesion?.usuario.tenantId || sesion.usuario.tipoUsuario !== "interno") {
    return NextResponse.json({ error: "no_autorizado" }, { status: 401 });
  }
  const tenantId = sesion.usuario.tenantId;


  // ---- Estado de la configuración ------------------------------------------
  const sandbox = whatsappSandboxActivo();
  const configuracion = {
    /** `true` = NO se envía nada, pase lo que pase. Es el primer sospechoso. */
    sandbox,
    credencialesCompletas: whatsappConfigurado(),
    accessTokenPresente: Boolean(process.env.WHATSAPP_ACCESS_TOKEN),
    phoneNumberIdPresente: Boolean(process.env.WHATSAPP_PHONE_NUMBER_ID),
    appSecretPresente: Boolean(process.env.WHATSAPP_APP_SECRET),
    verifyTokenPresente: Boolean(process.env.WHATSAPP_VERIFY_TOKEN),
    versionApi: process.env.WHATSAPP_API_VERSION?.trim() || "v25.0 (por defecto)",
    /** Sin esto, el evento se publica y no lo consume nadie. */
    inngestEventKeyPresente: Boolean(process.env.INNGEST_EVENT_KEY),
  };

  // ---- ¿Hay a quién escribirle? --------------------------------------------
  // La causa más común de "no llegó" que NO es un fallo: el directorio no tiene
  // un contacto del rol que la plantilla pide, o lo tiene sin consentimiento.
  const cliente = crearClienteServiceRole();
  // A qué seller apuntar la prueba. Obligatorio para enviar: todo aviso va a
  // los contactos de un seller, no hay otro tipo de destinatario.
  const sellerId = request.nextUrl.searchParams.get("sellerId");

  const { data: contactos } = await cliente
    .schema("integraciones")
    .from("whatsapp_contactos")
    .select("seller_id, opt_in_estado, origen")
    .eq("tenant_id", tenantId);

  const filas = (contactos ?? []) as Array<{
    seller_id: string;
    opt_in_estado: string;
    origen: string;
  }>;
  const conConsentimiento = filas.filter((c) => c.opt_in_estado === "otorgado");
  const destinatarios = {
    totalContactos: filas.length,
    conConsentimiento: conConsentimiento.length,
    /** Cuántos sellers distintos tienen al menos un contacto que sí consintió. */
    sellersAlcanzables: new Set(conConsentimiento.map((c) => c.seller_id)).size,
    /** Puesto por el propio seller: el consentimiento más sólido. */
    delPropioSeller: filas.filter((c) => c.origen === "perfil_seller").length,
    agregadosPorRutax: filas.filter((c) => c.origen === "agregado_por_rutax").length,
    aptosParaEstaPrueba: sellerId
      ? conConsentimiento.filter((c) => c.seller_id === sellerId).length
      : 0,
  };

  // ---- Modo lectura --------------------------------------------------------
  if (request.nextUrl.searchParams.get("enviar") !== "1") {
    return NextResponse.json({
      modo: "diagnostico",
      configuracion,
      destinatarios,
      comoEnviar:
        "Agrega ?enviar=1&sellerId=<id> para mandar saltándose Inngest. El sellerId es obligatorio: todo aviso va a los contactos de un seller.",
      ...diagnosticoLegible(configuracion, destinatarios),
    });
  }

  // ---- Modo envío ----------------------------------------------------------
  const limite = await consumirRateLimit(
    `whatsapp-test:${tenantId}`,
    LIMITE_ENVIOS,
    VENTANA_SEGUNDOS,
  );
  if (!limite.permitido) {
    return NextResponse.json(
      { error: "rate_limited", detalle: "Cada envío de prueba se cobra. Espera un poco." },
      { status: 429, headers: { "Retry-After": String(limite.reintentarEnSegundos) } },
    );
  }

  if (!sellerId) {
    return NextResponse.json(
      {
        error: "falta_seller",
        detalle: "Agrega &sellerId=<id> — todo aviso va a los contactos de un seller.",
        configuracion,
        destinatarios,
      },
      { status: 400 },
    );
  }

  // ⚠️ Llamada DIRECTA al servicio, sin pasar por Inngest. Es el punto de esta
  // ruta: si acá llega el mensaje y por el camino normal no, el problema está
  // en la cola y no en Meta ni en la configuración.
  const resultado = await enviarNotificacionWhatsApp({
    tenantId,
    claveEvento: CLAVE_PRUEBA,
    // Distinta en cada intento: si fuera fija, la llave de idempotencia haría
    // que el segundo diagnóstico no enviara nada y pareciera otro fallo.
    referencia: `diagnostico-${Date.now()}`,
    destino: { sellerId },
    variables: [],
  });

  return NextResponse.json(
    {
      modo: "envio_directo_sin_inngest",
      resultado,
      configuracion,
      destinatarios,
      ...diagnosticoLegible(configuracion, destinatarios, resultado),
    },
    { status: resultado.enviados > 0 ? 200 : 502 },
  );
}

/**
 * Traduce el estado a una frase accionable. La respuesta cruda ya trae todo,
 * pero leer ocho booleanos para deducir «te falta el token» es justo lo que
 * hace que la gente no use una herramienta de diagnóstico.
 */
function diagnosticoLegible(
  cfg: { sandbox: boolean; credencialesCompletas: boolean; inngestEventKeyPresente: boolean },
  dest: { aptosParaEstaPrueba: number; conConsentimiento: number; sellersAlcanzables: number },
  resultado?: { enviados: number; mensaje?: string; detalles: Array<{ error?: string }> },
): { diagnostico: string } {
  if (cfg.sandbox) {
    return {
      diagnostico:
        "SANDBOX ACTIVO: no se envía nada. Pon WHATSAPP_SANDBOX_MODE con el valor exacto 'false' y redespliega — cualquier otro valor, o que falte, mantiene el sandbox.",
    };
  }
  if (!cfg.credencialesCompletas) {
    return {
      diagnostico:
        "Faltan credenciales: se necesitan WHATSAPP_ACCESS_TOKEN y WHATSAPP_PHONE_NUMBER_ID en este ambiente.",
    };
  }
  if (dest.conConsentimiento === 0) {
    return {
      diagnostico:
        "No hay a quién escribirle: ningún contacto de este courier tiene el consentimiento otorgado. " +
        "El número lo pone el seller en su perfil; Rutax puede sumar otros desde el backstage.",
    };
  }
  if (resultado && dest.aptosParaEstaPrueba === 0) {
    return {
      diagnostico:
        `Ese seller no tiene ningún contacto con consentimiento. En todo el courier hay ` +
        `${dest.conConsentimiento} con consentimiento, repartidos en ${dest.sellersAlcanzables} seller(s).`,
    };
  }
  if (resultado && resultado.enviados === 0) {
    const primerError = resultado.detalles.find((d) => d.error)?.error;
    return {
      diagnostico: `Meta rechazó el envío: ${primerError ?? resultado.mensaje ?? "sin detalle"}`,
    };
  }
  if (resultado && resultado.enviados > 0) {
    return {
      diagnostico:
        "Enviado. Si te llegó por acá pero NO por el camino normal, el problema está en Inngest: revisa que la función 'notificaciones/enviarWhatsApp' aparezca registrada en su panel.",
    };
  }
  if (!cfg.inngestEventKeyPresente) {
    return {
      diagnostico:
        "Todo listo para enviar, pero falta INNGEST_EVENT_KEY: el camino normal publica un evento que nadie va a recibir.",
    };
  }
  return { diagnostico: "Configuración completa. Agrega ?enviar=1 para probar el envío." };
}

/**
 * Emisor de un webhook `transfer.inbound.succeeded` FIRMADO contra un endpoint real.
 * =============================================================================
 *
 * QUÉ HACE: construye el evento con la forma REAL del objeto `Transfer` de Fintoc,
 * lo firma con el secreto del Webhook Endpoint del tenant (mismo esquema que
 * Fintoc: HMAC-SHA256 hex sobre "<ts>.<raw_body>", header `t=,v1=`) y lo POSTea a
 * `/api/webhooks/fintoc/{tenantId}`. Sirve para probar el endpoint DESPLEGADO
 * antes de que se mueva dinero real.
 *
 * POR QUÉ SE REESCRIBIÓ (2026-09-26): la versión anterior reimplementaba el
 * algoritmo de firma DENTRO del propio script y lo verificaba contra esa misma
 * reimplementación. No probaba una sola línea del código de producción: si ambos
 * lados compartían un error, el script decía "✓ TODOS los casos pasaron" con la
 * integración rota. Es el patrón que ya mordió al proyecto dos veces (los tests de
 * `conciliar-periodo` que reimplementaban la lógica, y el pgTAP que reponía el
 * CHECK que debía detectar).
 *
 * DÓNDE VIVE AHORA LA PRUEBA DEL ALGORITMO (no aquí):
 *  - `src/modules/integraciones/pagos/vector-oficial-fintoc.test.ts` — ancla
 *    nuestro verificador al VECTOR OFICIAL del SDK `fintoc@1.27.0` (firma
 *    producida por Fintoc, no por nosotros).
 *  - `src/app/api/webhooks/fintoc/[tenantId]/route.test.ts` — la ruta completa con
 *    firma real y la forma real del evento.
 * Este script NO reemplaza a esos tests: prueba el DESPLIEGUE (URL, secreto
 * cargado, ruta viva), no la matemática.
 *
 * ⚠️ EFECTO REAL: un evento con firma válida CREA una fila en
 * `dinero.pagos_recibidos` y puede conciliar un período, marcando como pagada una
 * factura que nadie pagó. Por eso, contra una URL que no sea local, el script
 * exige `--si-esto-es-produccion-lo-asumo` y usa ids reconocibles (prefijo
 * `tr_PRUEBA_`) para que la fila se pueda encontrar y borrar después.
 *
 * Uso:
 *   node scripts/validacion-firma-webhook-fintoc.mjs \
 *     --url http://localhost:3000 \
 *     --tenant 11111111-2222-3333-4444-555555555555 \
 *     --secreto whsec_... \
 *     [--rut 74.593.127-8] [--monto 238000] [--caso firma-invalida|replay|saliente]
 *
 * El secreto puede venir también en la variable de entorno FINTOC_WEBHOOK_SECRETO
 * para no dejarlo en el historial del shell.
 */

import { createHmac } from "node:crypto";

function leerArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const clave = a.slice(2);
    const siguiente = argv[i + 1];
    if (!siguiente || siguiente.startsWith("--")) {
      args[clave] = true;
    } else {
      args[clave] = siguiente;
      i += 1;
    }
  }
  return args;
}

function salirConError(mensaje) {
  console.error(`✗ ${mensaje}`);
  process.exit(1);
}

/** Firma como firma Fintoc. Mismo esquema anclado al vector oficial del SDK. */
function firmar(cuerpoCrudo, secreto, tsSeg) {
  const firma = createHmac("sha256", secreto).update(`${tsSeg}.${cuerpoCrudo}`, "utf8").digest("hex");
  return `t=${tsSeg},v1=${firma}`;
}

/**
 * Evento con la forma REAL del `Transfer` de Fintoc (verificada contra la doc
 * oficial y el SDK, sep-2026): `object: 'transfer'`, `direction`, y la contraparte
 * en `counterparty` — NO `sender_account`, que es del recurso `Movement`.
 */
function construirEvento({ montoClp, rut, direction }) {
  const marca = Date.now();
  return {
    id: `evt_PRUEBA_${marca}`,
    type: "transfer.inbound.succeeded",
    mode: "test",
    object: "event",
    created_at: new Date().toISOString(),
    data: {
      id: `tr_PRUEBA_${marca}`,
      object: "transfer",
      direction,
      status: "succeeded",
      amount: montoClp,
      currency: "CLP",
      post_date: new Date().toISOString(),
      transaction_date: new Date().toISOString(),
      comment: "PRUEBA DE ENDPOINT — NO ES UN PAGO REAL",
      reference_id: `REF_PRUEBA_${marca}`,
      counterparty: {
        holder_id: rut,
        holder_name: "Seller de Prueba SpA",
        account_number: "998877665544",
        type: "checking_account",
      },
    },
  };
}

async function main() {
  const args = leerArgs(process.argv);

  const base = (args.url ?? "http://localhost:3000").replace(/\/+$/, "");
  const tenantId = args.tenant;
  const secreto = args.secreto ?? process.env.FINTOC_WEBHOOK_SECRETO;
  const montoClp = Number(args.monto ?? 238000);
  const rut = args.rut ?? "74.593.127-8";
  const caso = args.caso ?? "valido";

  if (!tenantId) salirConError("falta --tenant <uuid del courier>");
  if (!secreto) {
    salirConError(
      "falta el secreto del Webhook Endpoint: pásalo con --secreto o en FINTOC_WEBHOOK_SECRETO",
    );
  }
  if (!Number.isInteger(montoClp) || montoClp <= 0) {
    salirConError("--monto debe ser un entero CLP positivo");
  }

  const esLocal = /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(base);
  if (!esLocal && args["si-esto-es-produccion-lo-asumo"] !== true) {
    salirConError(
      `la URL ${base} no es local y un evento firmado CREA una fila de pago real ` +
        "(y puede marcar pagada una factura impaga). Si de verdad quieres enviarlo, " +
        "repite el comando con --si-esto-es-produccion-lo-asumo",
    );
  }

  const direction = caso === "saliente" ? "outbound" : "inbound";
  const evento = construirEvento({ montoClp, rut, direction });
  // El cuerpo se serializa UNA vez: la firma es sobre estos bytes exactos.
  const cuerpoCrudo = JSON.stringify(evento);

  const ahora = Math.floor(Date.now() / 1000);
  let firmaHeader;
  if (caso === "firma-invalida") {
    firmaHeader = firmar(cuerpoCrudo, `${secreto}_alterado`, ahora);
  } else if (caso === "replay") {
    firmaHeader = firmar(cuerpoCrudo, secreto, ahora - 3600);
  } else {
    firmaHeader = firmar(cuerpoCrudo, secreto, ahora);
  }

  const url = `${base}/api/webhooks/fintoc/${tenantId}`;
  const esperado = {
    valido: "200 con {ok:true} y un evento dinero/pago.recibido en Inngest",
    "firma-invalida": "401 firma_invalida, sin efectos",
    replay: "401 firma_invalida (fuera de la ventana anti-replay), sin efectos",
    saliente: "200 con {no_entrante:true}, sin evento",
  }[caso];

  console.log("=".repeat(78));
  console.log("ENVÍO DE WEBHOOK FIRMADO — transfer.inbound.succeeded");
  console.log("=".repeat(78));
  console.log(`destino     : ${url}`);
  console.log(`caso        : ${caso}`);
  console.log(`esperado    : ${esperado ?? "(caso desconocido)"}`);
  console.log(`monto       : ${montoClp} CLP`);
  console.log(`direction   : ${direction}`);
  console.log(`transfer id : ${evento.data.id}   ← búscalo para borrar la fila después`);
  console.log(`firma       : t=…,v1=… (secreto NO se imprime)`);
  console.log("-".repeat(78));

  let respuesta;
  try {
    respuesta = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "Fintoc-Signature": firmaHeader },
      body: cuerpoCrudo,
    });
  } catch (error) {
    salirConError(`no se pudo conectar a ${url}: ${error instanceof Error ? error.message : error}`);
  }

  const texto = await respuesta.text();
  console.log(`HTTP ${respuesta.status}`);
  console.log(texto || "(cuerpo vacío)");
  console.log("=".repeat(78));

  const okEsperado =
    caso === "firma-invalida" || caso === "replay" ? respuesta.status === 401 : respuesta.status === 200;
  if (!okEsperado) {
    console.error("✗ el endpoint NO respondió lo esperado para este caso.");
    process.exit(1);
  }
  console.log("✓ el endpoint respondió lo esperado.");
  if (caso === "valido") {
    console.log(
      "→ Verifica ahora en Inngest que corrió dinero/conciliarPago, y en " +
        "dinero.pagos_recibidos que la fila quedó con el RUT de la contraparte atribuido.",
    );
  }
}

main();

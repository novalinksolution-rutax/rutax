/**
 * Harness de VALIDACIÓN de la firma de webhook de Fintoc.
 * =============================================================================
 *
 * Objetivo: validar nuestra implementación de `validarFirmaWebhook` SIN depender
 * de que Fintoc dispare un webhook real (el sandbox no los emite de forma
 * trivial para transferencias entrantes — ver `docs/arquitectura/cobranza-fintoc.md`
 * §5b "Pendiente de validar"). Construye un payload + firma de prueba con el
 * MISMO esquema que la doc oficial de Fintoc
 * (https://docs.fintoc.com/docs/webhooks-validating) y verifica que:
 *   1) una firma válida se ACEPTA,
 *   2) una firma manipulada se RECHAZA,
 *   3) un cuerpo alterado tras firmar se RECHAZA,
 *   4) un timestamp viejo (replay) se RECHAZA.
 *
 * Reimplementa el MISMO algoritmo del adaptador (`validarFirmaWebhook`) en JS
 * puro, para no requerir transpilar TS en este script `.mjs`. Si ambos
 * coinciden, queda demostrado que el esquema (HMAC-SHA256 sobre
 * "<timestamp>.<raw_body>", header `t=,v1=`, tolerancia 300 s) está bien armado.
 *
 * Uso:  node scripts/validacion-firma-webhook-fintoc.mjs
 */

import { createHmac, timingSafeEqual } from "node:crypto";

const TOLERANCIA_SEGUNDOS = 300;

function linea(s = "") {
  console.log(s);
}

/** Construye un header `Fintoc-Signature` válido (lo que Fintoc enviaría). */
function firmar(cuerpoCrudo, secreto, timestampSeg) {
  const firma = createHmac("sha256", secreto)
    .update(`${timestampSeg}.${cuerpoCrudo}`, "utf8")
    .digest("hex");
  return `t=${timestampSeg},v1=${firma}`;
}

/** Réplica del algoritmo del adaptador (debe coincidir byte a byte). */
function validarFirmaWebhook({ cuerpoCrudo, firmaHeader, secretoWebhook }) {
  if (!firmaHeader || typeof firmaHeader !== "string") return false;

  let timestamp = null;
  let firmaRecibida = null;
  for (const segmento of firmaHeader.split(",")) {
    const i = segmento.indexOf("=");
    if (i === -1) continue;
    const clave = segmento.slice(0, i).trim();
    const valor = segmento.slice(i + 1).trim();
    if (clave === "t") {
      const n = Number(valor);
      if (Number.isFinite(n)) timestamp = n;
    } else if (clave === "v1") {
      firmaRecibida = valor;
    }
  }
  if (timestamp === null || !firmaRecibida) return false;

  const ahoraSeg = Math.floor(Date.now() / 1000);
  if (Math.abs(ahoraSeg - timestamp) > TOLERANCIA_SEGUNDOS) return false;

  const esperada = createHmac("sha256", secretoWebhook)
    .update(`${timestamp}.${cuerpoCrudo}`, "utf8")
    .digest("hex");

  const a = Buffer.from(esperada, "utf8");
  const b = Buffer.from(firmaRecibida, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function caso(nombre, esperado, real) {
  const ok = esperado === real;
  linea(`${ok ? "✓" : "✗"} ${nombre} → esperado=${esperado}, real=${real}`);
  return ok;
}

function main() {
  const secreto = "whsec_demo_para_harness";
  const cuerpo = JSON.stringify({
    id: "evt_DyzYBwdC07ao5MqG",
    type: "transfer.inbound.succeeded",
    mode: "test",
    data: {
      id: "mov_abc123",
      amount: 150000,
      currency: "CLP",
      type: "transfer",
      post_date: "2026-06-10T12:00:00Z",
      status: "confirmed",
      sender_account: { holder_id: "745931278", holder_name: "Seller SpA" },
    },
  });

  const ahora = Math.floor(Date.now() / 1000);
  const headerValido = firmar(cuerpo, secreto, ahora);
  const headerManipulado =
    headerValido.slice(0, -1) + (headerValido.slice(-1) === "a" ? "b" : "a");
  const headerViejo = firmar(cuerpo, secreto, ahora - 3600); // replay

  linea("=".repeat(78));
  linea("VALIDACIÓN DE FIRMA DE WEBHOOK FINTOC (HMAC-SHA256 sobre '<ts>.<body>')");
  linea("Fuente del esquema: https://docs.fintoc.com/docs/webhooks-validating");
  linea("=".repeat(78));

  const resultados = [
    caso(
      "firma válida se ACEPTA",
      true,
      validarFirmaWebhook({ cuerpoCrudo: cuerpo, firmaHeader: headerValido, secretoWebhook: secreto }),
    ),
    caso(
      "firma manipulada se RECHAZA",
      false,
      validarFirmaWebhook({ cuerpoCrudo: cuerpo, firmaHeader: headerManipulado, secretoWebhook: secreto }),
    ),
    caso(
      "cuerpo alterado tras firmar se RECHAZA",
      false,
      validarFirmaWebhook({ cuerpoCrudo: cuerpo + " ", firmaHeader: headerValido, secretoWebhook: secreto }),
    ),
    caso(
      "secreto incorrecto se RECHAZA",
      false,
      validarFirmaWebhook({ cuerpoCrudo: cuerpo, firmaHeader: headerValido, secretoWebhook: "whsec_otro" }),
    ),
    caso(
      "timestamp viejo (replay) se RECHAZA",
      false,
      validarFirmaWebhook({ cuerpoCrudo: cuerpo, firmaHeader: headerViejo, secretoWebhook: secreto }),
    ),
    caso(
      "header con formato inválido se RECHAZA",
      false,
      validarFirmaWebhook({ cuerpoCrudo: cuerpo, firmaHeader: "garbage", secretoWebhook: secreto }),
    ),
  ];

  linea("=".repeat(78));
  const todos = resultados.every(Boolean);
  linea(todos ? "✓ TODOS los casos pasaron." : "✗ HAY casos fallidos — revisa el esquema de firma.");
  process.exit(todos ? 0 : 1);
}

main();

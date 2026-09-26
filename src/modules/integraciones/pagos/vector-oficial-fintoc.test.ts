/**
 * Vector de prueba OFICIAL de Fintoc — prueba de interoperabilidad de la firma.
 * =============================================================================
 *
 * POR QUÉ ESTE ARCHIVO EXISTE (y por qué no basta con los otros tests de firma):
 * los tests de `fintoc/adaptador.test.ts` y de los webhooks de payout/suscripción
 * FIRMAN con un HMAC escrito en el propio test y VERIFICAN con el nuestro. Si
 * ambos lados compartieran el mismo error (separador equivocado, orden invertido,
 * digest en base64, header mal nombrado), los tests pasarían en verde con la
 * integración rota — es el mismo patrón que ya mordió al proyecto dos veces (las
 * pruebas de `conciliar-periodo` que reimplementaban la lógica, y el pgTAP que
 * reponía el CHECK que debía detectar). `scripts/validacion-firma-webhook-fintoc.mjs`
 * tenía exactamente ese defecto: reimplementaba el algoritmo dentro del script.
 *
 * Este test rompe el círculo: la firma NO la calculamos nosotros. Es el vector
 * publicado por el SDK oficial `fintoc@1.27.0` (`build/module/spec/webhook.spec.js`,
 * clase `WebhookSignature`), producido por el código de Fintoc. Si nuestro
 * verificador acepta ese header, nuestro HMAC es byte a byte el de Fintoc.
 *
 * CONTRATO CONFIRMADO CONTRA EL SDK OFICIAL (v1.27.0, leído el 2026-09-26):
 *  - Header `Fintoc-Signature`, formato `t=<unix_ts>,v1=<hmac_hex>`.
 *  - Mensaje firmado = `"<timestamp>.<raw_body>"`.
 *  - HMAC-SHA256, digest hex, comparación de tiempo constante.
 *  - Tolerancia anti-replay por defecto: 300 s (`DEFAULT_TOLERANCE_SECONDS`).
 *  - Solo existe `v1` (no hay v2 ni multi-secreto).
 *
 * El envelope del evento queda confirmado de paso: `{ id, type, mode, created_at,
 * data, object: "event" }` — nuestro `normalizarEventoTransferencia` desenvuelve
 * `data`, que es lo correcto.
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { verificarFirmaWebhookFintoc, TOLERANCIA_FIRMA_SEGUNDOS } from "./firma-webhook-fintoc";
import { FintocAdapter } from "./fintoc/adaptador";

// ---------------------------------------------------------------------------
// EL VECTOR OFICIAL — copiado literal de `fintoc@1.27.0`, spec/webhook.spec.js.
// No se toca: cualquier edición invalida la prueba.
// ---------------------------------------------------------------------------

const PAYLOAD_CRUDO_SDK = `{
  "id": "evt_2AaZeLCz0GjOW5zj",
  "type": "payment_intent.succeeded",
  "mode": "test",
  "created_at": "2025-04-05T21:57:31.834Z",
  "data": {
    "id": "pi_2vKOKniSGXRhXTKrJ67VXZxGCVt",
    "mode": "test",
    "amount": 1,
    "object": "payment_intent",
    "status": "succeeded",
    "currency": "MXN",
    "metadata": {},
    "created_at": "2025-04-05T21:57:17Z",
    "expires_at": null,
    "error_reason": null,
    "payment_type": "bank_transfer",
    "reference_id": null,
    "widget_token": null,
    "customer_email": null,
    "sender_account": {
      "type": "checking_account",
      "number": "501514890244223279",
      "holder_id": "mfiu593501oe4",
      "institution_id": "mx_stp"
    },
    "business_profile": null,
    "transaction_date": null,
    "recipient_account": {
      "type": "checking_account",
      "number": "646180357600000000",
      "holder_id": "fsm211008hz9",
      "institution_id": "mx_stp"
    },
    "payment_type_options": {}
  },
  "object": "event"
}`;

/**
 * El SDK firma el payload MINIFICADO (así construye su fixture:
 * `testPayloadRaw.replace(/\s+/g, '')`). Se reproduce igual para que el cuerpo
 * firmado sea idéntico byte a byte al que produjo la firma esperada.
 */
const PAYLOAD_FIRMADO = PAYLOAD_CRUDO_SDK.replace(/\s+/g, "");

const SECRETO_SDK = "whsec_test_secret";
const TIMESTAMP_SDK = 1743890251;
/** Firma producida por el código de Fintoc, NO por nosotros. Es el ancla. */
const FIRMA_ESPERADA_SDK = "11b98dd8f5500109246aa4d9875fad2e97d462560b012a5f50ff924411de0b0f";
const HEADER_SDK = `t=${TIMESTAMP_SDK},v1=${FIRMA_ESPERADA_SDK}`;

/**
 * El vector es de abril de 2025, muy fuera de la tolerancia de 300 s. Se fija el
 * reloj del sistema al instante del vector para ejercitar el camino real
 * (incluida la comprobación anti-replay) sin inventar un parámetro de tolerancia
 * que la implementación no expone.
 */
function conRelojEnElVector(): void {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(TIMESTAMP_SDK * 1000));
}

afterEach(() => {
  vi.useRealTimers();
});

describe("Firma de webhook Fintoc — vector oficial del SDK (interoperabilidad)", () => {
  it("el helper compartido ACEPTA el header firmado por Fintoc", () => {
    conRelojEnElVector();

    expect(
      verificarFirmaWebhookFintoc({
        cuerpoCrudo: PAYLOAD_FIRMADO,
        firmaHeader: HEADER_SDK,
        secreto: SECRETO_SDK,
      }),
    ).toBe(true);
  });

  it("el adaptador de COBRANZA acepta el mismo header (las dos implementaciones concuerdan)", () => {
    // El flujo 1 (cobranza) no usa el helper compartido: valida con su propio
    // método en el adaptador. Son dos implementaciones del mismo esquema, así que
    // el vector se pasa por AMBAS — si divergieran, este test lo delata.
    conRelojEnElVector();
    const adaptador = new FintocAdapter("sk_test_dummy");

    expect(
      adaptador.validarFirmaWebhook({
        cuerpoCrudo: PAYLOAD_FIRMADO,
        firmaHeader: HEADER_SDK,
        secretoWebhook: SECRETO_SDK,
      }),
    ).toBe(true);
  });

  it("rechaza el vector con el cuerpo NO minificado (la firma es sobre el raw body exacto)", () => {
    // Prueba de que de verdad firmamos sobre los bytes crudos: el mismo JSON
    // semánticamente idéntico pero con espacios ya no valida. Es la razón por la
    // que la ruta lee `request.text()` y nunca re-serializa el JSON.
    conRelojEnElVector();

    expect(
      verificarFirmaWebhookFintoc({
        cuerpoCrudo: PAYLOAD_CRUDO_SDK,
        firmaHeader: HEADER_SDK,
        secreto: SECRETO_SDK,
      }),
    ).toBe(false);
  });

  it("rechaza el vector fuera de la ventana anti-replay (reloj corrido)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date((TIMESTAMP_SDK + TOLERANCIA_FIRMA_SEGUNDOS + 1) * 1000));

    expect(
      verificarFirmaWebhookFintoc({
        cuerpoCrudo: PAYLOAD_FIRMADO,
        firmaHeader: HEADER_SDK,
        secreto: SECRETO_SDK,
      }),
    ).toBe(false);
  });

  it("la tolerancia por defecto es la del SDK oficial (300 s)", () => {
    expect(TOLERANCIA_FIRMA_SEGUNDOS).toBe(300);
  });
});

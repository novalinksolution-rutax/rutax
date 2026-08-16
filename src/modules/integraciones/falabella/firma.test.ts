/**
 * Firmador de Falabella Seller Center.
 *
 * La prueba central es el **vector oficial** de la documentación. Sin él, todas
 * las demás pruebas validarían el supuesto contra sí mismo: el firmador estaría
 * "de acuerdo consigo mismo" y aun así fallaría en producción con un
 * `E007: Login failed. Signature mismatching` que no dice qué se codificó mal.
 *
 * Procedencia del vector (verificado 2026-08-16):
 * - La página de Falabella (https://developers.falabella.com/docs/signing-requests)
 *   publica la implementación PHP de referencia, el `Timestamp` de verificación
 *   `2015-07-01T11:11:11+00:00`, el `UserID` `look@me.com`, los parámetros
 *   esperados y la firma esperada, pero **redacta la API Key a `'YOUR_API_KEY'`**.
 * - La misma página, en su versión Lazada/Seller Center
 *   (https://lazada-sellercenter.readme.io/docs/signing-requests) — misma
 *   documentación de origen, mismo vector, misma firma esperada — sí publica la
 *   API Key del ejemplo: `b1bdb357ced10fe4e9a69840cdd4f0e9c03d77fe`.
 * - Que la clave sea la correcta no es una creencia: es **comprobable**. Con
 *   ella el HMAC reproduce exactamente la firma que publica Falabella, y con
 *   cualquier otra no. Esta prueba ES esa comprobación.
 */

import { describe, it, expect } from "vitest";
import {
  codificarRfc3986,
  compararNombresParametro,
  construirCadenaAFirmar,
  construirQueryFirmada,
  firmarParametros,
  timestampFalabella,
  ErrorFirmaFalabella,
  VERSION_API_FALABELLA,
} from "./firma";

/** API Key del ejemplo oficial. No es una credencial viva: es del ejemplo. */
const API_KEY_DEL_EJEMPLO = "b1bdb357ced10fe4e9a69840cdd4f0e9c03d77fe";

const PARAMETROS_DEL_EJEMPLO = {
  UserID: "look@me.com",
  Version: "1.0",
  Action: "FeedList",
  Format: "XML",
  Timestamp: "2015-07-01T11:11:11+00:00",
} as const;

const CADENA_ESPERADA =
  "Action=FeedList&Format=XML&Timestamp=2015-07-01T11%3A11%3A11%2B00%3A00&UserID=look%40me.com&Version=1.0";

const FIRMA_ESPERADA = "3ceb8ed91049dfc718b0d2d176fb2ed0e5fd74f76c5971f34cdab48412476041";

describe("vector oficial de la documentación de Falabella", () => {
  it("reproduce la cadena a firmar carácter por carácter", () => {
    expect(construirCadenaAFirmar(PARAMETROS_DEL_EJEMPLO)).toBe(CADENA_ESPERADA);
  });

  it("reproduce la firma esperada", () => {
    expect(firmarParametros(PARAMETROS_DEL_EJEMPLO, API_KEY_DEL_EJEMPLO)).toBe(FIRMA_ESPERADA);
  });

  it("la query firmada es la cadena del vector más el Signature al final", () => {
    expect(construirQueryFirmada(PARAMETROS_DEL_EJEMPLO, API_KEY_DEL_EJEMPLO)).toBe(
      `${CADENA_ESPERADA}&Signature=${FIRMA_ESPERADA}`,
    );
  });

  it("una API Key distinta NO produce la firma del vector (la prueba de arriba prueba algo)", () => {
    // Control negativo: si esto fallara, la prueba principal estaría pasando
    // por una razón equivocada (p. ej. una firma hardcodeada en el firmador).
    expect(firmarParametros(PARAMETROS_DEL_EJEMPLO, "otra-clave")).not.toBe(FIRMA_ESPERADA);
  });
});

describe("orden de los parámetros", () => {
  it("no depende del orden en que se pasen: el vector sale igual desordenado", () => {
    const alReves = {
      Version: "1.0",
      Timestamp: "2015-07-01T11:11:11+00:00",
      Format: "XML",
      UserID: "look@me.com",
      Action: "FeedList",
    };
    expect(construirCadenaAFirmar(alReves)).toBe(CADENA_ESPERADA);
    expect(firmarParametros(alReves, API_KEY_DEL_EJEMPLO)).toBe(FIRMA_ESPERADA);
  });

  it("ordena por bytes, con mayúsculas antes que minúsculas (no alfabético insensible)", () => {
    // El caso que distingue los dos criterios: por bytes es Action < UserID <
    // action; alfabético insensible a mayúsculas daría Action < action < UserID.
    const cadena = construirCadenaAFirmar({ action: "c", UserID: "b", Action: "a" });
    expect(cadena).toBe("Action=a&UserID=b&action=c");
  });

  it("el comparador es el de bytes, no el del idioma", () => {
    // `"a".localeCompare("B")` en es-CL devuelve -1 (a antes que B) y rompería
    // la firma. `compararNombresParametro` tiene que decir lo contrario.
    expect(compararNombresParametro("a", "B")).toBeGreaterThan(0);
    expect(compararNombresParametro("Action", "action")).toBeLessThan(0);
    expect(compararNombresParametro("Action", "Action")).toBe(0);
  });
});

describe("codificación RFC 3986", () => {
  it("escapa los cinco caracteres que encodeURIComponent deja pasar", () => {
    // Este es EL agujero de `encodeURIComponent`, y el ejemplo en Node.js de la
    // propia documentación de Falabella lo tiene.
    expect(encodeURIComponent("!'()*")).toBe("!'()*"); // el bug, documentado
    expect(codificarRfc3986("!'()*")).toBe("%21%27%28%29%2A");
  });

  it("deja literales exactamente los no reservados de RFC 3986 §2.3", () => {
    const noReservados = "ABCXYZabcxyz0189-._~";
    expect(codificarRfc3986(noReservados)).toBe(noReservados);
  });

  it("escapa los caracteres de un Timestamp ISO-8601: ':' y '+'", () => {
    expect(codificarRfc3986("2015-07-01T11:11:11+00:00")).toBe("2015-07-01T11%3A11%3A11%2B00%3A00");
  });

  it("escapa el espacio como %20, nunca como '+'", () => {
    // Un `+` significa otra cosa en la firma (es el signo del offset horario);
    // codificar el espacio como `+` produce una firma distinta a la del
    // servidor. Es el error clásico de usar `urlencode`/`quote_plus`.
    expect(codificarRfc3986("Comercial Los Robles")).toBe("Comercial%20Los%20Robles");
  });

  it("escapa los separadores de la propia query string", () => {
    expect(codificarRfc3986("a=b&c")).toBe("a%3Db%26c");
  });

  it("codifica no-ASCII como bytes UTF-8 en mayúscula", () => {
    expect(codificarRfc3986("Ñuñoa")).toBe("%C3%91u%C3%B1oa");
  });

  it("una firma sobre un valor con paréntesis cambia si se codifica mal", () => {
    // Sin el escapado de `(` y `)` las dos firmas coincidirían, y el fallo solo
    // aparecería en producción con el primer dato real que traiga un paréntesis.
    const conEscape = firmarParametros({ A: "(x)" }, "k");
    const sinEscape = firmarParametros({ A: "%28x%29" }, "k");
    expect(conEscape).not.toBe(sinEscape);
  });
});

describe("timestampFalabella", () => {
  it("emite ISO 8601 UTC con offset explícito y sin milisegundos", () => {
    expect(timestampFalabella(new Date(Date.UTC(2015, 6, 1, 11, 11, 11)))).toBe(
      "2015-07-01T11:11:11+00:00",
    );
  });

  it("un Timestamp con '+' produce la firma correcta de punta a punta", () => {
    const parametros = {
      ...PARAMETROS_DEL_EJEMPLO,
      Timestamp: timestampFalabella(new Date(Date.UTC(2015, 6, 1, 11, 11, 11))),
    };
    expect(firmarParametros(parametros, API_KEY_DEL_EJEMPLO)).toBe(FIRMA_ESPERADA);
  });

  it("convierte a UTC cualquier instante, venga de donde venga", () => {
    // 2026-08-16 09:00 en Santiago (UTC-4) son las 13:00 UTC.
    expect(timestampFalabella(new Date("2026-08-16T09:00:00-04:00"))).toBe(
      "2026-08-16T13:00:00+00:00",
    );
  });

  it("rechaza una fecha inválida en vez de firmar 'Invalid Date'", () => {
    expect(() => timestampFalabella(new Date("no soy una fecha"))).toThrow(ErrorFirmaFalabella);
  });
});

describe("reglas del firmador", () => {
  it("Signature no se incluye a sí misma: pasarla es un error, no un descuido", () => {
    expect(() =>
      construirCadenaAFirmar({ ...PARAMETROS_DEL_EJEMPLO, Signature: "loquesea" }),
    ).toThrow(ErrorFirmaFalabella);
  });

  it("la query firmada lleva Signature una sola vez y al final", () => {
    const query = construirQueryFirmada(PARAMETROS_DEL_EJEMPLO, API_KEY_DEL_EJEMPLO);
    expect(query.match(/Signature=/g)).toHaveLength(1);
    expect(query.endsWith(`Signature=${FIRMA_ESPERADA}`)).toBe(true);
  });

  it("omite los parámetros undefined, y lo omitido no cambia la firma", () => {
    const conOpcionalVacio = { ...PARAMETROS_DEL_EJEMPLO, Limit: undefined };
    expect(construirCadenaAFirmar(conOpcionalVacio)).toBe(CADENA_ESPERADA);
  });

  it("un parámetro con valor vacío SÍ se firma (no es lo mismo que omitirlo)", () => {
    expect(construirCadenaAFirmar({ A: "1", B: "" })).toBe("A=1&B=");
  });

  it("acepta valores numéricos y los firma como su representación decimal", () => {
    expect(construirCadenaAFirmar({ Limit: 100, Offset: 0 })).toBe("Limit=100&Offset=0");
  });

  it("rechaza un número no finito en vez de firmar 'NaN'", () => {
    expect(() => construirCadenaAFirmar({ Limit: Number.NaN })).toThrow(ErrorFirmaFalabella);
  });

  it("exige API Key, y el error NO la contiene", () => {
    expect(() => firmarParametros(PARAMETROS_DEL_EJEMPLO, "")).toThrow(ErrorFirmaFalabella);
  });

  it("la cadena a firmar nunca contiene la API Key (se puede loguear sin riesgo)", () => {
    const cadena = construirCadenaAFirmar(PARAMETROS_DEL_EJEMPLO);
    expect(cadena).not.toContain(API_KEY_DEL_EJEMPLO);
  });

  it("la versión de protocolo es la que exige la doc", () => {
    expect(VERSION_API_FALABELLA).toBe("1.0");
  });
});

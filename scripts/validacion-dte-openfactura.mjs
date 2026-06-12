/**
 * Harness de VALIDACIÓN EN VIVO del contrato DTE contra el sandbox de Openfactura.
 * =============================================================================
 *
 * Objetivo (B1-3): confirmar/corregir las hipótesis del adaptador esqueleto
 * `src/modules/integraciones/dte/adaptadores/openfactura.ts` contra el proveedor
 * real, cerrando las 3 brechas del gap analysis:
 *   1. ¿PDF/XML llegan INLINE en base64 en la respuesta de emisión?
 *   2. ¿Cuál es el shape real del estado SII (consulta de documento)?
 *   3. ¿La clave de consulta es TOKEN o {rut}/{tipo}/{folio}? ¿Y el shape de error?
 *
 * SANDBOX: host `dev-api.haulmer.com`, CAF SIMULADO (el timbre NO se valida ante
 * el SII). API key de PRUEBA PÚBLICA documentada por Haulmer — sin efectos
 * tributarios. NO es un secreto de tenant; por eso va en claro aquí (solo dev).
 *
 * Uso:  node scripts/validacion-dte-openfactura.mjs
 */

const BASE_URL = 'https://dev-api.haulmer.com';
// API key de prueba pública del sandbox (haulmer.dev/factura-electronica/api).
// NO es un secreto: ambiente dev, CAF simulado, compartida en la documentación.
const APIKEY_SANDBOX = '928e15a2d14d4a6292345f04960f4bd3';

const hoy = new Date().toISOString().slice(0, 10);

// Payload tomado del ejemplo oficial (emisor de prueba HAULMER SPA, folio 0 =
// el sandbox auto-asigna). Pedimos XML+PDF+TIMBRE+FOLIO para verificar inline.
const payloadEmision = {
  response: ['XML', 'PDF', 'TIMBRE', 'FOLIO'],
  dte: {
    Encabezado: {
      IdDoc: { TipoDTE: 33, Folio: 0, FchEmis: hoy, TpoTranCompra: 1, TpoTranVenta: 1, FmaPago: 2 },
      Emisor: {
        RUTEmisor: '76795561-8',
        RznSoc: 'HAULMER SPA',
        GiroEmis: 'VENTA AL POR MENOR EN EMPRESAS DE VENTA A DISTANCIA VÍA INTERNET; COMERCIO ELEC',
        Acteco: 525130,
        DirOrigen: 'ARTURO PRAT 527   CURICO',
        CmnaOrigen: 'Curicó',
        CdgSIISucur: '81303347',
      },
      Receptor: {
        RUTRecep: '76430498-5',
        RznSocRecep: 'HOSTY SPA',
        GiroRecep: 'EMPRESAS DE SERVICIOS INTEGRALES DE INFO',
        Contacto: '+56 9 69195057',
        DirRecep: 'Arturo Prat 527 3 piso oficina 1',
        CmnaRecep: 'CURICÓ',
      },
      Totales: { MntNeto: 100, TasaIVA: '19', IVA: 19, MntTotal: 119 },
    },
    Detalle: [
      { NroLinDet: 1, NmbItem: 'TRANSPORTE DE CARGA', DscItem: 'Validacion de contrato', QtyItem: 1, PrcItem: 100, MontoItem: 100 },
    ],
  },
};

function linea(s = '') { console.log(s); }
function titulo(s) { linea(); linea('='.repeat(78)); linea(s); linea('='.repeat(78)); }

/** Describe un valor sin volcar base64 gigante ni secretos. */
function describir(valor) {
  if (valor === null) return 'null';
  if (valor === undefined) return 'undefined';
  if (typeof valor === 'string') {
    const pareceBase64 = /^[A-Za-z0-9+/=\r\n]+$/.test(valor) && valor.length > 64;
    return `string(len=${valor.length})${pareceBase64 ? ' [parece base64]' : ` = ${JSON.stringify(valor.slice(0, 60))}${valor.length > 60 ? '…' : ''}`}`;
  }
  if (typeof valor === 'number' || typeof valor === 'boolean') return `${typeof valor} = ${valor}`;
  if (Array.isArray(valor)) return `array(len=${valor.length})`;
  if (typeof valor === 'object') return `object{${Object.keys(valor).join(', ')}}`;
  return typeof valor;
}

function volcarShape(obj, etiqueta) {
  linea(`\n${etiqueta} — claves de primer nivel:`);
  if (obj === null || typeof obj !== 'object') { linea(`  (no es objeto) → ${describir(obj)}`); return; }
  for (const [k, v] of Object.entries(obj)) linea(`  ${k}: ${describir(v)}`);
}

async function peticion(metodo, ruta, cuerpo) {
  const headers = { accept: 'application/json', apikey: APIKEY_SANDBOX };
  if (cuerpo !== undefined) headers['content-type'] = 'application/json';
  const r = await fetch(`${BASE_URL}${ruta}`, {
    method: metodo,
    headers,
    body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined,
  });
  const texto = await r.text();
  let json;
  try { json = JSON.parse(texto); } catch { json = null; }
  return { status: r.status, ok: r.ok, headers: r.headers, texto, json };
}

/** Clona el payload base aplicando un override al Emisor (p. ej. Acteco). */
function conEmisor(override) {
  const p = structuredClone(payloadEmision);
  if (override.dropActeco) delete p.dte.Encabezado.Emisor.Acteco;
  else if (override.Acteco !== undefined) p.dte.Encabezado.Emisor.Acteco = override.Acteco;
  return p;
}

async function main() {
  titulo('1) EMISIÓN — POST /v2/dte/document (factura tipo 33)');
  // El Acteco del ejemplo oficial (525130) ya no está registrado para el emisor
  // de prueba. Probamos variantes hasta que una emita.
  const variantes = [
    { etiqueta: 'sin Acteco', payload: conEmisor({ dropActeco: true }) },
    { etiqueta: 'Acteco 829900 (otras act. de apoyo a empresas)', payload: conEmisor({ Acteco: 829900 }) },
    { etiqueta: 'Acteco 532000 (mensajería)', payload: conEmisor({ Acteco: 532000 }) },
    { etiqueta: 'Acteco 620200 (consultoría TI)', payload: conEmisor({ Acteco: 620200 }) },
    { etiqueta: 'Acteco 478900 (venta retail por internet)', payload: conEmisor({ Acteco: 478900 }) },
  ];
  let emi = null;
  for (const v of variantes) {
    const r = await peticion('POST', '/v2/dte/document', v.payload);
    linea(`  [${v.etiqueta}] → HTTP ${r.status}${r.ok ? '  ✓ EMITIÓ' : `  ✗ ${r.json?.error?.details?.[0]?.issue ?? r.json?.error?.message ?? ''}`}`);
    if (r.ok) { emi = r; break; }
  }
  if (!emi) { linea('\nNinguna variante emitió. Última respuesta arriba.'); return; }
  linea(`\nHTTP ${emi.status} (ok=${emi.ok})`);
  volcarShape(emi.json, 'Respuesta de emisión');

  // Brecha 1: ¿PDF/XML inline base64?
  titulo('Brecha 1 — ¿PDF/XML INLINE en base64?');
  for (const campo of ['PDF', 'XML', 'TIMBRE', 'FOLIO', 'TOKEN']) {
    linea(`  ${campo}: ${campo in emi.json ? describir(emi.json[campo]) : '(ausente)'}`);
  }

  // El WARNING puede traer pistas (códigos, verificación). Volcarlo completo.
  if (emi.json.WARNING !== undefined) {
    linea('\nWARNING (crudo):');
    linea(JSON.stringify(emi.json.WARNING, null, 2).slice(0, 600));
  }

  const token = emi.json.TOKEN ?? emi.json.token ?? null;
  const folio = emi.json.FOLIO ?? emi.json.folio ?? payloadEmision.dte.Encabezado.IdDoc.Folio;
  linea(`\n→ TOKEN capturado: ${token ?? '(ninguno)'} · FOLIO: ${folio}`);

  // Brecha 3: clave de consulta. Probamos GET por rut/tipo/folio.
  titulo('2) CONSULTA — GET /v2/dte/document/{rut}/{tipo}/{folio}/{value}');
  const rutEmisor = '76795561-8';
  // {value} candidatos: monto total (patrón SII), rut receptor, código de verif.
  const rutas = [
    `/v2/dte/document/${rutEmisor}/33/${folio}/100`,   // MntNeto
    `/v2/dte/document/${rutEmisor}/33/${folio}/${token}`, // TOKEN como value
    `/v2/dte/document/${rutEmisor}/33/${folio}/0`,     // cero
  ];
  for (const ruta of rutas) {
    const c = await peticion('GET', ruta, undefined);
    linea(`\nGET ${ruta}`);
    linea(`  HTTP ${c.status} (ok=${c.ok})`);
    if (c.json) {
      volcarShape(c.json, '  cuerpo');
      linea('  JSON crudo (recortado):');
      linea(JSON.stringify(c.json, null, 2).slice(0, 700).split('\n').map((l) => '    ' + l).join('\n'));
    } else linea(`  no-JSON: ${c.texto.slice(0, 300)}`);
    if (c.ok) break;
  }

  // Brecha 2 + mapeo de error: forzamos un payload inválido.
  titulo('3) CASO DE ERROR — POST con payload inválido (shape del error)');
  const err = await peticion('POST', '/v2/dte/document', { response: ['PDF'], dte: { Encabezado: {} } });
  linea(`HTTP ${err.status} (ok=${err.ok})`);
  if (err.json) {
    volcarShape(err.json, 'Cuerpo de error');
    linea(`\nCuerpo de error (JSON crudo, recortado):`);
    linea(JSON.stringify(err.json, null, 2).slice(0, 800));
  } else {
    linea(`no-JSON: ${err.texto.slice(0, 400)}`);
  }

  titulo('FIN — revisa arriba para confirmar/corregir el adaptador esqueleto');
}

main().catch((e) => { console.error('FALLO el harness:', e); process.exit(1); });

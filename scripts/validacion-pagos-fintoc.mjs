/**
 * Harness de VALIDACIÓN EN VIVO del contrato de Fintoc (cobranza / conciliación).
 * =============================================================================
 *
 * Objetivo: confirmar el contrato real de Fintoc antes de diseñar la migración
 * `dinero.pagos_recibidos` y el adaptador aislado. Ver el diseño en
 * `docs/arquitectura/cobranza-fintoc.md`.
 *
 * MODO PRUEBA: usa la `sk_test_…` (sin efectos reales, sin dinero). La llave se
 * lee de `.env.local` (NUNCA se imprime ni se commitea).
 *
 * Etapas:
 *   A) Auth + List Links — confirma que la key autentica y muestra las cuentas
 *      conectadas (probablemente vacío hasta conectar un Link de sandbox).
 *   B) Si hay una cuenta conectada, lista sus Movements y vuelca el shape real
 *      del objeto (amount, type, sender_account.holder_id/RUT, fechas).
 *
 * Uso:  node scripts/validacion-pagos-fintoc.mjs
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(__dirname, '..');

// --- Carga mínima de .env.local (sin dependencias) ---------------------------
function cargarEnvLocal() {
  const env = {};
  try {
    const texto = readFileSync(join(RAIZ, '.env.local'), 'utf8');
    for (const linea of texto.split('\n')) {
      const t = linea.trim();
      if (!t || t.startsWith('#')) continue;
      const i = t.indexOf('=');
      if (i === -1) continue;
      env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
    }
  } catch (e) {
    console.error('No pude leer .env.local:', e.message);
  }
  return env;
}

const env = cargarEnvLocal();
const SECRET_KEY = env.FINTOC_SECRET_KEY_TEST;
const LINK_TOKEN = env.FINTOC_LINK_TOKEN_TEST;
const BASE_URL = 'https://api.fintoc.com/v1';

function linea(s = '') { console.log(s); }
function titulo(s) { linea(); linea('='.repeat(78)); linea(s); linea('='.repeat(78)); }

function describir(valor) {
  if (valor === null) return 'null';
  if (valor === undefined) return 'undefined';
  if (typeof valor === 'string') return `string = ${JSON.stringify(valor.length > 50 ? valor.slice(0, 50) + '…' : valor)}`;
  if (typeof valor === 'number' || typeof valor === 'boolean') return `${typeof valor} = ${valor}`;
  if (Array.isArray(valor)) return `array(len=${valor.length})`;
  if (typeof valor === 'object') return `object{${Object.keys(valor).join(', ')}}`;
  return typeof valor;
}

function volcarShape(obj, etiqueta) {
  linea(`\n${etiqueta} — claves:`);
  if (obj === null || typeof obj !== 'object') { linea(`  (no es objeto) → ${describir(obj)}`); return; }
  for (const [k, v] of Object.entries(obj)) linea(`  ${k}: ${describir(v)}`);
}

async function fintoc(ruta) {
  // Fintoc autentica con la secret key DIRECTA en el header Authorization
  // (sin prefijo "Bearer"). Si esto diera 401, la respuesta lo dirá.
  const r = await fetch(`${BASE_URL}${ruta}`, {
    headers: { Authorization: SECRET_KEY, accept: 'application/json' },
  });
  const texto = await r.text();
  let json;
  try { json = JSON.parse(texto); } catch { json = null; }
  return { status: r.status, ok: r.ok, json, texto };
}

async function main() {
  if (!SECRET_KEY) {
    linea('✗ Falta FINTOC_SECRET_KEY_TEST en .env.local'); process.exit(1);
  }
  if (!SECRET_KEY.startsWith('sk_test_')) {
    linea(`✗ La key no parece una secret de prueba (esperaba sk_test_, recibí "${SECRET_KEY.slice(0, 8)}…").`);
    linea('  Revisa que FINTOC_SECRET_KEY_TEST tenga la SECRET (sk_), no la PUBLIC (pk_).');
    process.exit(1);
  }
  linea(`Usando secret key de prueba: ${SECRET_KEY.slice(0, 11)}… (modo test)`);

  titulo('A) AUTH + LIST LINKS — GET /v1/links');
  const links = await fintoc('/links');
  linea(`HTTP ${links.status} (ok=${links.ok})`);
  if (!links.ok) {
    linea('Respuesta de error (cruda, recortada):');
    linea((links.texto || '').slice(0, 600));
    linea('\n→ Si es 401, la key o el header de auth no calzan; ajustamos el harness.');
    return;
  }

  const lista = Array.isArray(links.json) ? links.json : links.json?.data ?? [];
  linea(`✓ Autenticación OK. Links conectados: ${lista.length}`);
  if (lista.length === 0) {
    linea('\nNo hay ninguna cuenta conectada todavía (esperado).');
    linea('Para obtener movimientos de prueba: en el dashboard (Modo prueba) →');
    linea('Conciliación → Conexiones → "+ Conectar" → usa el banco de sandbox que');
    linea('Fintoc ofrece. Luego corre este harness de nuevo.');
    return;
  }

  // Mostrar el shape del primer Link y sus cuentas.
  const primero = lista[0];
  volcarShape(primero, 'Link[0]');
  let cuentas = primero.accounts ?? [];

  // Si el listado no trae cuentas embebidas, recuperar el Link por su link_token
  // (que sí expone las cuentas conectadas).
  if (cuentas.length === 0 && LINK_TOKEN) {
    const detalle = await fintoc(`/links/${LINK_TOKEN}`);
    if (detalle.ok && detalle.json) {
      volcarShape(detalle.json, 'Link (por link_token)');
      cuentas = detalle.json.accounts ?? [];
    }
  }

  linea(`\nCuentas conectadas: ${cuentas.length}`);
  if (cuentas.length === 0) { linea('Sin cuentas en el Link — nada que listar.'); return; }

  const cuenta = cuentas[0];
  volcarShape(cuenta, 'Account[0]');
  const linkToken = LINK_TOKEN ?? primero.link_token ?? primero.id;

  titulo('B) MOVEMENTS — GET /v1/accounts/{id}/movements');
  const mov = await fintoc(`/accounts/${cuenta.id}/movements?link_token=${linkToken}&per_page=300`);
  linea(`HTTP ${mov.status} (ok=${mov.ok})`);
  if (!mov.ok) { linea((mov.texto || '').slice(0, 600)); return; }
  const movimientos = Array.isArray(mov.json) ? mov.json : mov.json?.data ?? [];
  linea(`✓ Movimientos recibidos: ${movimientos.length}`);

  // Resumen por `type` y cuántos traen sender_account (clave para atribuir por RUT).
  const porTipo = {};
  let conSender = 0, entrantes = 0;
  for (const m of movimientos) {
    porTipo[m.type] = (porTipo[m.type] ?? 0) + 1;
    if (m.sender_account) conSender++;
    if (typeof m.amount === 'number' && m.amount > 0) entrantes++;
  }
  linea(`\nPor type: ${JSON.stringify(porTipo)}`);
  linea(`Con sender_account poblado: ${conSender} de ${movimientos.length}`);
  linea(`Con amount > 0 (entrantes): ${entrantes}`);

  // Mostrar el primer movimiento que SÍ sea transferencia con remitente, si existe.
  const transferConSender = movimientos.find((m) => m.type === 'transfer' && m.sender_account);
  if (transferConSender) {
    linea('\n✓ HAY transferencia con remitente — shape de atribución:');
    volcarShape(transferConSender, 'Movement (transfer)');
    volcarShape(transferConSender.sender_account, '  sender_account');
    linea(JSON.stringify(transferConSender, null, 2).slice(0, 900));
  } else {
    linea('\n⚠ NINGÚN movimiento de sandbox trae type="transfer" + sender_account.');
    linea('  → En sandbox no se puede validar la atribución por RUT del remitente.');
    linea('  El shape de sender_account (holder_id/RUT) queda confirmado SOLO por doc.');
    if (movimientos[0]) {
      linea('\nMovement[0] (ejemplo, JSON crudo):');
      linea(JSON.stringify(movimientos[0], null, 2).slice(0, 700));
    }
  }

  titulo('FIN');
}

main().catch((e) => { console.error('FALLO el harness:', e); process.exit(1); });

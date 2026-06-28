/* TEMP read-only Marg fetch to verify AddField on post-19-Jun vouchers.
 * Reads config from DB, calls Marg EDE API, decrypts, dumps JSON. No DB writes. */
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const { createDecipheriv } = require('crypto');
const { inflateRawSync } = require('zlib');

// ---- env from .env.docker ----
const envText = fs.readFileSync(path.join(__dirname, '..', '..', '.env.docker'), 'utf8');
const envGet = (k) => (envText.match(new RegExp('^' + k + '=(.+)$', 'm')) || [])[1]?.trim().replace(/^"|"$/g, '');
const ENCRYPTION_KEY = envGet('ENCRYPTION_KEY');
const DB_URL = 'postgres://postgres:123456@127.0.0.1:5433/forecast';
const FROM_DATETIME = process.argv[2] || '2026-06-19 00:00:00';
const API_TYPE = process.argv[3] || '2'; // 2 = MDis transactional (vouchers/lines)
const TENANT = '2c2fbbeb-7591-4afe-a8a9-078e3a63cc2d';

function encKeyBuf() {
  const raw = (ENCRYPTION_KEY || '').trim();
  if (/^[0-9a-fA-F]+$/.test(raw) && (raw.length === 32 || raw.length === 64)) return Buffer.from(raw, 'hex');
  if (raw.length === 16 || raw.length === 32) return Buffer.from(raw, 'utf8');
  throw new Error('bad ENCRYPTION_KEY');
}
function decryptSecret(value, key) {
  if (!value || !value.startsWith('enc:')) return value;
  const [, ivB64, tagB64, ctB64] = value.split(':');
  const algo = key.length === 16 ? 'aes-128-gcm' : 'aes-256-gcm';
  const d = createDecipheriv(algo, key, Buffer.from(ivB64, 'base64'));
  d.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([d.update(Buffer.from(ctB64, 'base64')), d.final()]).toString('utf8');
}
// ---- Marg payload decoders (mirror marg-decrypt.util) ----
function aesEcb(b64, dkey) {
  const k = Buffer.alloc(16, 0); Buffer.from(dkey, 'utf8').copy(k);
  const d = createDecipheriv('aes-128-ecb', k, null); d.setAutoPadding(true);
  return d.update(Buffer.from(b64, 'base64'), undefined, 'utf8') + d.final('utf8');
}
function aesCbcInflate(b64, dkey) {
  const k = Buffer.alloc(16, 0); Buffer.from(dkey, 'utf8').copy(k);
  const d = createDecipheriv('aes-128-cbc', k, k); d.setAutoPadding(true);
  const s = Buffer.concat([d.update(Buffer.from(b64, 'base64')), d.final()]).toString('utf8');
  return inflateRawSync(Buffer.from(s, 'base64')).toString('utf8').replace(/^﻿/, '');
}
function tryJson(s) { try { const o = JSON.parse(String(s).replace(/^﻿/, '')); return (o && typeof o === 'object') ? o : null; } catch { return null; } }
function decodePayload(str, dkey) {
  const norm = String(str || '').trim();
  const direct = tryJson(norm); if (direct) return direct;
  for (const fn of [() => aesEcb(norm, dkey), () => aesCbcInflate(norm, dkey),
                    () => inflateRawSync(Buffer.from(norm, 'base64')).toString('utf8').replace(/^﻿/, '')]) {
    try { const p = tryJson(fn()); if (p) return p; } catch { /* next */ }
  }
  throw new Error('could not decode Marg payload');
}

// ---- recursively collect voucher-header-like records (have Type + AddField) ----
function collectVouchers(node, out) {
  if (Array.isArray(node)) { for (const x of node) collectVouchers(x, out); return; }
  if (node && typeof node === 'object') {
    if ('Type' in node && ('AddField' in node || 'Voucher' in node)) out.push(node);
    for (const k of Object.keys(node)) collectVouchers(node[k], out);
  }
}

(async () => {
  const key = encKeyBuf();
  const c = new Client({ connectionString: DB_URL }); await c.connect();
  const { rows } = await c.query('SELECT company_code, marg_key, decryption_key, api_base_url, company_id FROM marg_sync_configs WHERE tenant_id=$1::uuid LIMIT 1', [TENANT]);
  await c.end();
  const cfg = rows[0];
  const margKey = decryptSecret(cfg.marg_key, key);
  const dkey = decryptSecret(cfg.decryption_key, key);
  const origin = String(cfg.api_base_url).replace(/\/+$/, '');
  const url = origin + '/api/eOnlineData/MargCorporateEDE';
  const body = { CompanyCode: cfg.company_code, Datetime: FROM_DATETIME, MargKey: margKey, Index: '0', CompanyID: String(cfg.company_id), APIType: API_TYPE };
  console.log('POST', url, '\n  APIType=' + API_TYPE, 'Datetime=' + FROM_DATETIME, 'CompanyID=' + cfg.company_id);

  const ctrl = new AbortController(); const to = setTimeout(() => ctrl.abort(), 300000);
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctrl.signal });
  clearTimeout(to);
  const text = await res.text();
  let raw; try { raw = JSON.parse(text); } catch { raw = text; }
  const envelope = (raw && typeof raw === 'object') ? raw : null;
  if (envelope && String(envelope.Status || '').toUpperCase() === 'FAILURE') throw new Error('Marg failure: ' + envelope.Message);

  let payload;
  if (typeof raw === 'string') payload = decodePayload(raw, dkey);
  else if (envelope && typeof envelope.Data === 'string' && envelope.Data.trim()) payload = decodePayload(envelope.Data, dkey);
  else if (envelope && envelope.Data && typeof envelope.Data === 'object') payload = envelope.Data;
  else payload = envelope || {};

  const outFile = path.join(__dirname, 'marg-verify-after-april27.json');
  fs.writeFileSync(outFile, JSON.stringify(payload, null, 1));
  console.log('\nSaved decrypted payload ->', outFile, '(' + (fs.statSync(outFile).size / 1024 / 1024).toFixed(2) + ' MB)');
  console.log('top-level keys:', Object.keys(payload).join(', '));
  console.log('DataStatus:', payload.DataStatus, ' Index:', payload.Index, ' DateTime:', payload.DateTime);

  const vouchers = []; collectVouchers(payload, vouchers);
  const S = vouchers.filter((v) => String(v.Type).trim() === 'S');
  const emptyAF = S.filter((v) => !v.AddField || String(v.AddField).trim() === '');
  const presentAF = S.filter((v) => v.AddField && String(v.AddField).trim() !== '');
  console.log('\n=== type=S voucher AddField summary (from Marg, not DB) ===');
  console.log('total S vouchers in payload:', S.length, '| empty AddField:', emptyAF.length, '| present:', presentAF.length);
  const fmt = (v) => ({ Voucher: v.Voucher, VCN: String(v.VCN || '').trim(), Date: v.Date, AddField: JSON.stringify(v.AddField) });
  console.log('\nsample EMPTY-AddField S vouchers:'); console.table(emptyAF.slice(0, 8).map(fmt));
  console.log('\nsample PRESENT-AddField S vouchers:'); console.table(presentAF.slice(0, 5).map(fmt));
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });

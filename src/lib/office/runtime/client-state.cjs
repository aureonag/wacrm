'use strict';

const CLIENT_STATE_LIMITS = Object.freeze({
  'aureon-avatar-v1': 32768,
  'aureon-gather-avatar-plan-v1': 16384,
  'aureon-gather-avatar-applied-v1': 16384,
  'aureon-window-frame-v1': 64,
  'aureon-camera-device': 1024,
  'aureon-microphone-device': 1024,
  'aureon-reactions-v1': 8192,
  'aureon-soundboard-v1': 8192,
});
const CLIENT_STATE_KEYS = Object.freeze(Object.keys(CLIENT_STATE_LIMITS));
const CLIENT_STATE_MAX_BYTES = 96 * 1024;
const jsonKeys = new Set([
  'aureon-avatar-v1', 'aureon-gather-avatar-plan-v1', 'aureon-gather-avatar-applied-v1',
  'aureon-reactions-v1', 'aureon-soundboard-v1',
]);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = (status, message) => { const error = new Error(message); error.status = status; throw error; };

function validateClientStateEntries(entries) {
  if (!object(entries) || Object.keys(entries).length > CLIENT_STATE_KEYS.length) {
    fail(400, 'Personalização inválida.');
  }
  const patch = {};
  for (const [key, value] of Object.entries(entries)) {
    if (!Object.hasOwn(CLIENT_STATE_LIMITS, key)) fail(400, 'Esta chave de personalização não é permitida.');
    if (value === null) { patch[key] = null; continue; }
    if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > CLIENT_STATE_LIMITS[key]) {
      fail(400, 'A personalização excede o tamanho permitido.');
    }
    if (jsonKeys.has(key)) {
      let parsed;
      try { parsed = JSON.parse(value); } catch { fail(400, 'A personalização precisa ser um objeto JSON.'); }
      if (!object(parsed)) fail(400, 'A personalização precisa ser um objeto JSON.');
    }
    if (key === 'aureon-window-frame-v1' && !/^#[0-9a-f]{6}$/i.test(value)) {
      fail(400, 'Escolha uma cor no formato #RRGGBB.');
    }
    patch[key] = value;
  }
  if (Buffer.byteLength(JSON.stringify(patch), 'utf8') > CLIENT_STATE_MAX_BYTES) {
    fail(400, 'A personalização excede o tamanho permitido.');
  }
  return patch;
}

function readClientState(state, userId) {
  if (state.officeClientState === undefined) return {};
  if (!object(state.officeClientState)) fail(503, 'Personalização indisponível.');
  const current = Object.hasOwn(state.officeClientState, userId) ? state.officeClientState[userId] : {};
  let validated;
  try {
    validated = validateClientStateEntries(current);
    if (Object.values(validated).some(value => value === null)) throw new Error('Invalid stored deletion');
  } catch {
    fail(503, 'Personalização indisponível.');
  }
  return structuredClone(validated);
}

function patchClientState(state, userId, body) {
  if (!object(body) || Object.keys(body).length !== 1 || !Object.hasOwn(body, 'entries')) {
    fail(400, 'Informe somente as preferências de personalização.');
  }
  const patch = validateClientStateEntries(body.entries);
  const current = readClientState(state, userId);
  const merged = {...current};
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete merged[key];
    else merged[key] = value;
  }
  validateClientStateEntries(merged);
  if (JSON.stringify(current) !== JSON.stringify(merged)) {
    state.officeClientState ??= {};
    state.officeClientState[userId] = merged;
  }
  return structuredClone(merged);
}

module.exports = {
  CLIENT_STATE_LIMITS, CLIENT_STATE_KEYS, CLIENT_STATE_MAX_BYTES,
  validateClientStateEntries, readClientState, patchClientState,
};

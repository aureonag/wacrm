'use strict';

// Fixed public call-state codes only. Never derive a code or message from IDs,
// browser input, persistence errors, or arbitrary gateway response text.
const messages = Object.freeze({
  OFFICE_CALL_SESSION_REPLACED: 'Esta sessão de chamada foi substituída. Entre novamente quando quiser.',
  OFFICE_CALL_SESSION_MISSING: 'A sessão da chamada não está disponível. Reconecte-se para continuar.',
  OFFICE_SIGNAL_RECIPIENT_STALE: 'A conexão desse participante mudou. Aguarde a atualização da chamada.',
});

function normalizeOfficeCallConflict(status, code) {
  return status === 409 && typeof code === 'string' && Object.hasOwn(messages, code) ? code : undefined;
}

function officeCallConflictMessage(code) {
  return typeof code === 'string' && Object.hasOwn(messages, code) ? messages[code] : undefined;
}

module.exports = Object.freeze({normalizeOfficeCallConflict, officeCallConflictMessage});

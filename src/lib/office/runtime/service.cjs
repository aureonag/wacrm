/* eslint-disable @typescript-eslint/no-require-imports -- Private CommonJS compatibility boundary. */
'use strict';

const coreModule = require('./vendor/interface-api.cjs');
const {isDeepStrictEqual} = require('node:util');
const {isOfficeMap} = require('./map.cjs');
const {normalizeOfficeCallConflict, officeCallConflictMessage} = require('./call-conflicts.cjs');

class OfficeRuntimeError extends Error {
  constructor(status, message, code) {
    const safeCode = normalizeOfficeCallConflict(status, code);
    super(officeCallConflictMessage(safeCode) || message);
    this.name = 'OfficeRuntimeError';
    this.status = status;
    if (safeCode) this.code = safeCode;
  }
}

const unavailable = () => new OfficeRuntimeError(503, 'O escritório está indisponível. Tente novamente.');
const fail = (status, message) => { throw new OfficeRuntimeError(status, message); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function copyIdentity(identity) {
  if (!object(identity) || !object(identity.user) ||
      !['id', 'profileId', 'name'].every(key => typeof identity.user[key] === 'string' && identity.user[key].trim()) ||
      typeof identity.accountId !== 'string' || !identity.accountId ||
      !['owner', 'admin', 'agent', 'viewer'].includes(identity.role) ||
      !object(identity.capabilities) ||
      typeof identity.capabilities.canDecorate !== 'boolean' ||
      typeof identity.capabilities.canManageMembers !== 'boolean' ||
      !(identity.user.avatarUrl === null || typeof identity.user.avatarUrl === 'string')) {
    fail(401, 'Entre no CRM para continuar.');
  }
  // This argument is supplied only by the server's getOfficeContext(), never JSON.
  return structuredClone({
    accountId: identity.accountId,
    user: {
      id: identity.user.id,
      profileId: identity.user.profileId,
      name: identity.user.name,
      avatarUrl: identity.user.avatarUrl,
    },
    role: identity.role,
    capabilities: {
      canDecorate: identity.capabilities.canDecorate,
      canManageMembers: identity.capabilities.canManageMembers,
    },
  });
}

function validateRecord(record, accountId) {
  if (!object(record) || !Number.isSafeInteger(record.revision) || record.revision < 0 ||
      !(record.snapshot === null || object(record.snapshot))) throw unavailable();
  if (record.snapshot !== null) {
    const snapshot = record.snapshot;
    if (snapshot.version !== 1 ||
        !['users', 'channels', 'messages', 'events', 'activity', 'meetings'].every(key => Array.isArray(snapshot[key])) ||
        (snapshot.accountId !== undefined && snapshot.accountId !== accountId)) throw unavailable();
  }
  return structuredClone(record);
}

/**
 * Single Node instance pilot. Only the three spatial operations may reuse a
 * committed snapshot; HTTP must still authenticate/bind every request. All other
 * operations load fresh and can commit at most one CAS. Replicas remain unsupported.
 */
function createCrmInterfaceService({store, approvedMap, now = () => Date.now()} = {}) {
  if (!store || typeof store.load !== 'function' || typeof store.compareAndSwap !== 'function') throw unavailable();
  if (approvedMap !== undefined && !isOfficeMap(approvedMap)) throw unavailable();
  const mapSeed = approvedMap === undefined ? undefined : structuredClone(approvedMap);
  const queues = new Map(), slots = new Map();
  const spatial = (method, pathname) =>
    method === 'GET' && (pathname === '/spatial-state' || pathname === '/spatial-control' || pathname === '/proximity') ||
    method === 'POST' && pathname === '/spatial-presence';

  function matchesIdentity(slot, identity) {
    if (!object(slot?.snapshot)) return false;
    const user = slot.snapshot.users.find(user => user?.id === identity.user.id);
    return !!user && !user.archived &&
      user.name === identity.user.name && user.profileId === identity.user.profileId &&
      user.profilePhotoUrl === (identity.user.avatarUrl || '') && user.role === identity.role &&
      user.crmCapabilities?.canDecorate === identity.capabilities.canDecorate &&
      user.crmCapabilities?.canManageMembers === identity.capabilities.canManageMembers;
  }

  function projection(snapshot) {
    return {...snapshot, users: snapshot.users.map(user => {
      const fields = {...user};
      delete fields.lastSeen;
      return fields;
    })};
  }

  function coreFor(snapshot, revision, ephemeral, overlay) {
    const core = coreModule.createInterfaceService({snapshot, revision, approvedMap: mapSeed, ephemeral, now});
    const before = core.snapshot();
    if (overlay?.size) core.applyLastSeenOverlay(overlay);
    return {core, before};
  }

  async function executeSpatial(slot, identity, method, pathname, body, query) {
    const {core} = coreFor(slot.snapshot, slot.revision, slot.ephemeral, slot.lastSeen);
    const before = core.snapshot();
    const result = await core.requestAsCrm(identity, method, pathname, body, query);
    const next = core.snapshot();
    if (core.isDirty() || !isDeepStrictEqual(projection(slot.snapshot), projection(next))) {
      fail(500, 'Não foi possível concluir esta operação.');
    }
    const overlay = new Map(slot.lastSeen);
    const previousUsers = new Map(before.users.map(user => [user.id, user]));
    for (const user of next.users) {
      if (user.lastSeen !== previousUsers.get(user.id)?.lastSeen) {
        if (user.id !== identity.user.id || !Number.isFinite(user.lastSeen)) {
          fail(500, 'Não foi possível concluir esta operação.');
        }
        const committed = slot.snapshot.users.find(item => item.id === user.id)?.lastSeen;
        overlay.set(user.id, Math.max(Number.isFinite(committed) ? committed : 0, overlay.get(user.id) || 0, user.lastSeen));
      }
    }
    const response = structuredClone(result);
    const ephemeral = core.ephemeral();
    // Keep the last COMMITTED snapshot, never this working copy.
    slots.set(identity.accountId, {snapshot: slot.snapshot, revision: slot.revision, ephemeral, lastSeen: overlay});
    return response;
  }

  async function executeDurable(identity, method, pathname, body, query) {
    let record;
    try { record = validateRecord(await store.load(identity.accountId), identity.accountId); }
    catch { throw unavailable(); }
    let slot = slots.get(identity.accountId);
    if (slot && slot.revision !== record.revision) {
      slots.delete(identity.accountId);
      slot = undefined;
    }
    const {core, before} = coreFor(record.snapshot, record.revision, slot?.ephemeral, slot?.lastSeen);
    const result = await core.requestAsCrm(identity, method, pathname, body, query);
    const next = core.snapshot();
    next.accountId = identity.accountId;
    // Overlay is applied after "before", so any durable job coalesces lastSeen,
    // including a heartbeat whose value is already equal to the latest publish.
    const dirty = core.isDirty() || !isDeepStrictEqual(before, next);
    const nextRevision = record.revision + (dirty ? 1 : 0);
    if (!Number.isSafeInteger(nextRevision)) throw unavailable();
    next.revision = nextRevision;
    const response = structuredClone(result);
    if (Object.hasOwn(response, 'revision')) response.revision = nextRevision;
    const ephemeral = core.ephemeral();
    if (dirty) {
      let committed;
      try { committed = await store.compareAndSwap(identity.accountId, record.revision, next); }
      catch {
        // A lost response can follow a successful DB commit. Force a fresh read.
        slots.delete(identity.accountId);
        throw unavailable();
      }
      if (committed === false) {
        slots.delete(identity.accountId);
        fail(409, 'O escritório foi atualizado em outra instância. Recarregue e tente novamente.');
      }
      if (committed !== true) {
        slots.delete(identity.accountId);
        throw unavailable();
      }
    }
    // Only a confirmed write, or the actual fresh record for a read-only job,
    // becomes the next fast-path base. The overlay has now been coalesced.
    slots.set(identity.accountId, {
      snapshot: structuredClone(dirty ? next : record.snapshot), revision: nextRevision,
      ephemeral, lastSeen: new Map(),
    });
    return response;
  }

  function normalize(error) {
    if (error instanceof OfficeRuntimeError) return error;
    if ([400, 403, 404, 405, 409].includes(error?.status) && typeof error.message === 'string' && error.message.length <= 500) {
      return new OfficeRuntimeError(error.status, error.message, error.code);
    }
    if (error?.status === 503) return unavailable();
    return new OfficeRuntimeError(500, 'Não foi possível concluir esta operação.');
  }

  async function execute(identity, method, pathname, body, query) {
    const slot = slots.get(identity.accountId);
    if (spatial(method, pathname) && matchesIdentity(slot, identity)) {
      return executeSpatial(slot, identity, method, pathname, body, query);
    }
    // Cold/changed identity: run this operation exactly once on the durable path.
    return executeDurable(identity, method, pathname, body, query);
  }

  async function requestAsCrm(identity, method, pathname, body = {}, query = {}) {
    if (!object(identity) || typeof identity.accountId !== 'string' || !identity.accountId) {
      fail(401, 'Entre no CRM para continuar.');
    }
    const accountId = identity.accountId;
    let queue = queues.get(accountId);
    if (queue?.count >= 128) fail(429, 'O escritório está ocupado. Tente novamente.');
    if (!queue) {
      queue = {tail: Promise.resolve(), count: 0};
      queues.set(accountId, queue);
    }
    // Reserve before any cloning/enqueue; finally releases every accepted slot,
    // including invalid arguments and rejected durable/spatial operations.
    queue.count++;
    try {
      const actor = copyIdentity(identity);
      if (pathname === '/session') fail(403, 'Use sua sessão do CRM para entrar no escritório.');
      if (!['GET', 'POST'].includes(method)) fail(405, 'Método não permitido.');
      if (typeof pathname !== 'string' || !/^\/[a-z][a-z-]*$/.test(pathname)) fail(404, 'Função não encontrada.');
      if (!object(body) || !object(query)) fail(400, 'Conteúdo inválido.');
      const safeBody = structuredClone(body), safeQuery = structuredClone(query);
      const job = queue.tail.then(() => execute(actor, method, pathname, safeBody, safeQuery)).catch(error => { throw normalize(error); });
      queue.tail = job.then(() => undefined, () => undefined);
      return await job;
    } finally {
      queue.count--;
      if (queue.count === 0 && queues.get(accountId) === queue) queues.delete(accountId);
    }
  }

  return {requestAsCrm};
}

module.exports = {createCrmInterfaceService, OfficeRuntimeError};

'use strict';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function isConstruction(value) {
  if (!object(value) && !Array.isArray(value)) return false;
  if (Array.isArray(value) && value.length > 5000) return false;
  let visited = 0;
  function json(node, depth) {
    if (++visited > 100000 || depth > 32) return false;
    if (node === null || typeof node === 'string' || typeof node === 'boolean') return true;
    if (typeof node === 'number') return Number.isFinite(node);
    if (Array.isArray(node)) return node.every(item => json(item, depth + 1));
    if (!object(node) || ![Object.prototype, null].includes(Object.getPrototypeOf(node))) return false;
    return Object.values(node).every(item => json(item, depth + 1));
  }
  try {
    return json(value, 0) && Buffer.byteLength(JSON.stringify(value), 'utf8') <= 512 * 1024;
  } catch {
    return false;
  }
}

function isOfficeMap(value) {
  return object(value) && Array.isArray(value.objects) && typeof value.floor === 'string' &&
    (!Object.hasOwn(value, 'construction') || isConstruction(value.construction));
}

module.exports = {isOfficeMap};

/**
 * Manual, fictional UI harness. This is NOT a CRM/SSO/authentication bypass.
 * Two loopback origins select fixed fixtures; data exists only in this process.
 *
 * node scripts/test-office-server.mjs --bundle .office-runtime
 * Optional: --ports 4192,4193 (one or two distinct unprivileged ports).
 * It never packages files, reads credentials, talks to a DB or writes user data.
 */
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {constants} from 'node:fs';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

import runtimeService from '../src/lib/office/runtime/service.cjs';
const {createCrmInterfaceService, OfficeRuntimeError} = runtimeService;
const ACCOUNT_ID = '737433a3-ec29-4e90-b4ba-9989192ca735'; // Test fixture scope, NOT a real authenticated session.
const FIXTURES = Object.freeze([
  {label: 'Ana', id: 'a11aa11a-a11a-411a-811a-a11aa11aa11a', profileId: '11111111-aaaa-4111-8111-111111111111'},
  {label: 'Bruno', id: 'b22bb22b-b22b-422b-822b-b22bb22bb22b', profileId: '22222222-bbbb-4222-8222-222222222222'},
]);
const BODY_LIMIT = 512 * 1024;
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav',
  '.woff': 'font/woff', '.woff2': 'font/woff2',
};
const HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'X-Aureon-Test-Harness': 'fictional-local-only',
};
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
class HarnessError extends Error {
  constructor(status, message, code) { super(message); this.status = status; if (code) this.code = code; }
}
const fail = (status, message) => { throw new HarnessError(status, message); };
const unavailable = () => fail(503, 'Pacote de teste indisponível ou alterado.');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const stamp = info => [info.dev, info.ino, info.size, info.mtimeMs, info.ctimeMs, info.birthtimeMs].join(':');
const inside = (base, target) => {
  const relative = path.relative(base, target);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep));
};

export function parseArguments(args) {
  let bundle, ports = [4192, 4193], seenPorts = false;
  for (let i = 0; i < args.length; i++) {
    const option = args[i];
    if (option === '--help' && args.length === 1) return {help: true};
    if (option === '--bundle' && bundle === undefined && args[i + 1] && !args[i + 1].startsWith('--')) {
      bundle = path.resolve(args[++i]);
    } else if (option === '--ports' && !seenPorts && args[i + 1]) {
      seenPorts = true;
      const values = args[++i].split(',');
      if (!values.length || values.length > FIXTURES.length || values.some(value => !/^\d{4,5}$/.test(value))) {
        throw new Error('Use uma ou duas portas entre 1024 e 65535.');
      }
      ports = values.map(Number);
      if (ports.some(port => port < 1024 || port > 65535) || new Set(ports).size !== ports.length) {
        throw new Error('Use portas distintas entre 1024 e 65535.');
      }
    } else {
      throw new Error('Argumento inválido.');
    }
  }
  if (!bundle) throw new Error('Informe --bundle DIR; não existe fallback de arquivos.');
  return {bundle, ports};
}

/** Only reviewed manifest records are readable. No source-directory fallback. */
async function createBundleLoader(directory) {
  const root = path.resolve(directory);
  const inspect = async relative => {
    const absolute = path.resolve(root, ...relative.split('/'));
    if (!inside(root, absolute)) unavailable();
    const parsed = path.parse(absolute);
    let current = parsed.root, final;
    const parts = absolute.slice(parsed.root.length).split(path.sep).filter(Boolean);
    for (let i = 0; i < parts.length; i++) {
      current = path.join(current, parts[i]);
      const info = await fs.lstat(current);
      if (info.isSymbolicLink() || (i < parts.length - 1 ? !info.isDirectory() : !info.isFile())) unavailable();
      final = info;
    }
    if (!final) unavailable();
    const [realRoot, realFile] = await Promise.all([fs.realpath(root), fs.realpath(absolute)]);
    if (!inside(realRoot, realFile)) unavailable();
    return {absolute, size: final.size, stamp: stamp(final)};
  };
  const readChecked = async (relative, initial, limit) => {
    if (!Number.isSafeInteger(initial.size) || initial.size < 0 || initial.size > limit) unavailable();
    const handle = await fs.open(initial.absolute, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const before = await handle.stat();
      if (!before.isFile() || stamp(before) !== initial.stamp) unavailable();
      const buffer = Buffer.allocUnsafe(initial.size + 1);
      let length = 0;
      while (length < buffer.length) {
        const {bytesRead} = await handle.read(buffer, length, buffer.length - length, length);
        if (!bytesRead) break;
        length += bytesRead;
      }
      if (length !== initial.size || stamp(await handle.stat()) !== initial.stamp ||
          (await inspect(relative)).stamp !== initial.stamp) unavailable();
      return buffer.subarray(0, length);
    } finally { await handle.close(); }
  };
  const safeName = value => {
    if (typeof value !== 'string' || !value || value.length > 1024 ||
        !/^[a-zA-Z0-9_./-]+$/.test(value) || value.startsWith('/') ||
        value.toLowerCase() === 'manifest.json' ||
        value.split('/').some(part => !part || part.length > 255 || part.startsWith('.') || part.endsWith('.') ||
          /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part))) {
      fail(404, 'Arquivo não encontrado.');
    }
    return value;
  };
  const manifestInfo = await inspect('manifest.json');
  const manifestBytes = await readChecked('manifest.json', manifestInfo, 16 * 1024 * 1024);
  let manifest;
  try { manifest = JSON.parse(manifestBytes.toString('utf8')); } catch { unavailable(); }
  if (!object(manifest) || manifest.version !== 1 || manifest.mode !== 'written' ||
      manifest.crmBootstrapVersion !== 1 || manifest.crmSessionRequired !== true ||
      manifest.mapReadOnly !== true || !Array.isArray(manifest.files) ||
      manifest.files.length < 1 || manifest.files.length > 100000 ||
      (manifest.fileCount !== undefined && manifest.fileCount !== manifest.files.length)) unavailable();
  const records = new Map(), folded = new Set();
  let total = 0;
  for (const item of manifest.files) {
    if (!object(item)) unavailable();
    let name;
    try { name = safeName(item.path); } catch { unavailable(); }
    const contentType = MIME[path.posix.extname(name).toLowerCase()];
    if (!contentType || !Number.isSafeInteger(item.bytes) || item.bytes < 0 || item.bytes > 64 * 1024 * 1024 ||
        typeof item.sha256 !== 'string' || !/^[0-9a-f]{64}$/i.test(item.sha256) || folded.has(name.toLowerCase())) unavailable();
    total += item.bytes;
    if (total > 8 * 1024 * 1024 * 1024) unavailable();
    records.set(name, {bytes: item.bytes, sha256: item.sha256.toLowerCase(), contentType});
    folded.add(name.toLowerCase());
  }
  if (!records.has('index.html')) unavailable();
  const cache = new Map();
  let cacheBytes = 0;
  return {
    async load(relative) {
      const name = safeName(relative);
      const record = records.get(name);
      if (!record) fail(404, 'Arquivo não encontrado.');
      try {
        if ((await inspect('manifest.json')).stamp !== manifestInfo.stamp) unavailable();
        const info = await inspect(name);
        if (info.size !== record.bytes) unavailable();
        let cached = cache.get(name);
        let bytes;
        if (cached?.stamp === info.stamp) {
          bytes = cached.bytes;
          cache.delete(name); cache.set(name, cached);
        } else {
          bytes = await readChecked(name, info, 64 * 1024 * 1024);
          if (digest(bytes) !== record.sha256) unavailable();
          if (cached) { cacheBytes -= cached.bytes.length; cache.delete(name); }
          if (bytes.length <= 32 * 1024 * 1024) {
            while (cache.size && cacheBytes + bytes.length > 32 * 1024 * 1024) {
              const oldest = cache.keys().next().value;
              cacheBytes -= cache.get(oldest).bytes.length; cache.delete(oldest);
            }
            cached = {stamp: info.stamp, bytes};
            cache.set(name, cached); cacheBytes += bytes.length;
          }
        }
        if ((await inspect('manifest.json')).stamp !== manifestInfo.stamp) unavailable();
        return {bytes, contentType: record.contentType, etag: '"' + record.sha256 + '"'};
      } catch (error) {
        if (error instanceof HarnessError) throw error;
        unavailable();
      }
    },
  };
}

function fixtureIdentity(fixture) {
  return {
    accountId: ACCOUNT_ID,
    user: {id: fixture.id, profileId: fixture.profileId, name: fixture.label + ' — teste local', avatarUrl: null},
    role: 'agent',
    capabilities: {canDecorate: false, canManageMembers: false},
  };
}

function createMemoryStore() {
  const records = new Map();
  return {
    async load(accountId) {
      return structuredClone(records.get(accountId) ?? {revision: 0, snapshot: null});
    },
    async compareAndSwap(accountId, expectedRevision, nextSnapshot) {
      const current = records.get(accountId) ?? {revision: 0, snapshot: null};
      if (current.revision !== expectedRevision) return false;
      records.set(accountId, {revision: expectedRevision + 1, snapshot: structuredClone(nextSnapshot)});
      return true;
    },
  };
}

function send(res, body, status = 200, headers = {}, head = false) {
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body);
  res.writeHead(status, {...HEADERS, 'Content-Length': String(bytes.length), ...headers});
  res.end(head ? undefined : bytes);
}
function json(res, value, status = 200) {
  send(res, JSON.stringify(value), status, {'Content-Type': 'application/json; charset=utf-8'});
}
function boundIdentity(req, identity) {
  if (req.headers['x-aureon-office-account'] !== identity.accountId ||
      req.headers['x-aureon-office-user'] !== identity.user.id) {
    throw new HarnessError(403, 'Vínculo da identidade fictícia inválido. Recarregue esta guia de teste.', 'OFFICE_ACCESS_DENIED');
  }
}
function queryValues(url) {
  const entries = [...url.searchParams.entries()];
  if (entries.length > 20 || new Set(entries.map(([key]) => key)).size !== entries.length ||
      entries.some(([key, value]) => key.length > 80 || value.length > 2000)) fail(400, 'Parâmetros inválidos.');
  return Object.fromEntries(entries);
}
async function bodyValue(req, origin) {
  if (req.headers.origin !== origin || req.headers['sec-fetch-site'] === 'cross-site') fail(403, 'Origem de teste inválida.');
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) fail(415, 'Envie um conteúdo JSON.');
  const announced = Number(req.headers['content-length'] || '0');
  if (!Number.isSafeInteger(announced) || announced < 0 || announced > BODY_LIMIT) fail(413, 'Conteúdo muito grande.');
  const raw = await new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0, settled = false;
    const rejectOnce = error => { if (!settled) { settled = true; chunks.length = 0; reject(error); } };
    req.on('data', chunk => {
      if (settled) return;
      size += chunk.length;
      if (size > BODY_LIMIT) return rejectOnce(new HarnessError(413, 'Conteúdo muito grande.'));
      chunks.push(chunk);
    });
    req.once('end', () => { if (!settled) { settled = true; resolve(Buffer.concat(chunks)); } });
    req.once('aborted', () => rejectOnce(new HarnessError(400, 'Conteúdo inválido.')));
    req.once('error', () => rejectOnce(new HarnessError(400, 'Conteúdo inválido.')));
  });
  let value;
  try { value = JSON.parse(raw.toString('utf8')); } catch { fail(400, 'Conteúdo inválido.'); }
  if (!object(value)) fail(400, 'Conteúdo inválido.');
  return value;
}

function parentHtml(label) {
  return '<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>Teste local — ' + label + '</title><style>html,body{margin:0;height:100%;background:#202226;color:#eee;font:14px Segoe UI,Arial,sans-serif}' +
    'body{display:flex;flex-direction:column}header{padding:10px 16px;display:flex;align-items:center;gap:18px;border-bottom:1px solid #41434a}' +
    'strong{white-space:nowrap}small{color:#b9bdc7}#status{margin-left:auto}iframe{display:block;flex:1;border:0;width:100%;min-height:0}</style>' +
    '<header><strong>Teste local — ' + label + '</strong><small>Dados fictícios na memória · sem login ou banco real</small>' +
    '<span id="status" role="status">Carregando…</span></header><iframe id="office" title="Escritório fictício — ' + label + '" ' +
    'src="/api/office/runtime/" allow="camera; microphone; display-capture; autoplay"></iframe><script>' +
    'const office=document.getElementById("office"),statusBox=document.getElementById("status");' +
    'window.addEventListener("message",event=>{if(event.origin!==location.origin||event.source!==office.contentWindow)return;' +
    'const texts={"aureon-office-ready":"Pronto para testar","aureon-office-unavailable":"Indisponível",' +
    '"aureon-office-session-ended":"Vínculo de teste encerrado"};const text=texts[event.data?.type];if(text)statusBox.textContent=text;});' +
    '</script></html>';
}

export async function startTestOfficeServer({bundle, ports = [4192, 4193]}) {
  // Revalidate programmatic calls too; there is no host/bypass flag.
  const options = parseArguments(['--bundle', bundle, '--ports', ports.join(',')]);
  const loader = await createBundleLoader(options.bundle);
  await loader.load('index.html'); // Verify the entry hash, not a 649 MB eager scan.
  const approvedPath = new URL('../src/lib/office/runtime/seeds/approved-map.json', import.meta.url);
  const approved = JSON.parse(await fs.readFile(approvedPath, 'utf8'));
  const service = createCrmInterfaceService({store: createMemoryStore(), approvedMap: approved.map});
  const servers = [];
  const urls = [];
  const close = async () => {
    await Promise.all(servers.map(server => new Promise(resolve => {
      const force = setTimeout(() => { server.closeAllConnections?.(); resolve(); }, 5000);
      force.unref();
      server.close(() => { clearTimeout(force); resolve(); });
      server.closeIdleConnections?.();
    })));
  };
  try {
    for (let i = 0; i < options.ports.length; i++) {
      const port = options.ports[i], fixture = FIXTURES[i], identity = fixtureIdentity(fixture);
      const server = createServer(async (req, res) => {
        try {
          const host = req.headers.host;
          if (host !== 'localhost:' + port && host !== '127.0.0.1:' + port) fail(403, 'Host de teste inválido.');
          if (!req.url?.startsWith('/') || req.url.startsWith('//') || req.url.length > 8192 || /[\u0000-\u001f\\]/.test(req.url)) {
            fail(400, 'Endereço inválido.');
          }
          const origin = 'http://' + host, url = new URL(req.url, origin);
          const rawPath = req.url.split('?')[0], method = req.method;
          if (rawPath === '/' && (method === 'GET' || method === 'HEAD')) {
            return send(res, parentHtml(fixture.label), 200, {'Content-Type': MIME['.html']}, method === 'HEAD');
          }
          if (rawPath === '/health' && method === 'GET') {
            return json(res, {testOnly: true, status: 'ok', authentication: 'fixed-fixtures', store: 'memory', crmBootstrapVersion: 1});
          }
          if (rawPath === '/api/office/context' && method === 'GET') {
            return json(res, {...identity, testOnly: true, authentication: 'fixed-fixtures'});
          }
          if (rawPath === '/api/office/bootstrap' && method === 'GET') {
            const bootstrap = await service.requestAsCrm(identity, 'GET', '/bootstrap');
            return json(res, {...bootstrap, identity, testOnly: true});
          }
          const runtimePrefix = '/api/office/runtime';
          if (rawPath === runtimePrefix || rawPath.startsWith(runtimePrefix + '/')) {
            if (method !== 'GET' && method !== 'HEAD') fail(405, 'Método não permitido.');
            const relative = rawPath === runtimePrefix || rawPath === runtimePrefix + '/' ? 'index.html' : rawPath.slice(runtimePrefix.length + 1);
            const asset = await loader.load(relative);
            return send(res, asset.bytes, 200, {'Content-Type': asset.contentType, ETag: asset.etag}, method === 'HEAD');
          }
          if (rawPath === '/api/office/avatar-composition' || rawPath.startsWith('/api/office/avatar-composition/')) {
            return json(res, {error: 'Compositor de avatar desativado neste teste fictício.'}, 503);
          }
          const interfacePrefix = '/api/office/interface/';
          if (rawPath.startsWith(interfacePrefix)) {
            if (method !== 'GET' && method !== 'POST') fail(405, 'Método não permitido.');
            boundIdentity(req, identity);
            const endpoint = rawPath.slice(interfacePrefix.length);
            if (!/^[a-z][a-z-]*$/.test(endpoint)) fail(404, 'Função não encontrada.');
            const body = method === 'POST' ? await bodyValue(req, origin) : {};
            const value = await service.requestAsCrm(identity, method, '/' + endpoint, body, queryValues(url));
            return json(res, value);
          }
          fail(404, 'Página de teste não encontrada.');
        } catch (error) {
          if (res.headersSent) { res.destroy(); return; }
          if (error instanceof HarnessError || error instanceof OfficeRuntimeError) {
            return json(res, {error: error.message, ...(error.code ? {code: error.code} : {})}, error.status);
          }
          return json(res, {error: 'Falha no ambiente fictício de teste.'}, 500);
        }
      });
      server.requestTimeout = 30000;
      server.headersTimeout = 10000;
      servers.push(server);
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => { server.removeListener('error', reject); resolve(); });
      });
      urls.push('http://localhost:' + port + '/');
    }
    return {urls, close};
  } catch (error) {
    await close();
    throw error;
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    console.error('Uso: node scripts/test-office-server.mjs --bundle DIR [--ports 4192,4193]');
    return;
  }
  const harness = await startTestOfficeServer(options);
  let closing = false;
  const stop = async () => {
    if (closing) return;
    closing = true;
    await harness.close();
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  for (const url of harness.urls) console.log(url);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch(() => {
    // No paths, identities, snapshots, tokens or stack traces in CLI output.
    console.error('Não foi possível iniciar o teste local. Confira o pacote privado e as portas.');
    process.exitCode = 1;
  });
}

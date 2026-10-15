#!/usr/bin/env node
/* Copied byte-for-byte to the private gateway build as start.mjs. Never loads the CRM/Next app. */
import { createRequire } from "node:module";
import * as fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
export function parseGatewayArguments(args) {
  let port = 4194, host = "127.0.0.1", containerBind = false;
  const seen = new Set();
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (seen.has(flag)) throw Error("Invalid gateway arguments"); seen.add(flag);
    if (flag === "--allow-container-bind") containerBind = true;
    else if (flag === "--port") { const raw = args[++i]; if (!/^\d{4,5}$/.test(raw || "")) throw Error("Invalid gateway port"); port = Number(raw); }
    else if (flag === "--host") host = args[++i];
    else throw Error("Invalid gateway arguments");
  }
  if (!Number.isInteger(port) || port < 1024 || port > 65535 ||
      !(host === "127.0.0.1" || containerBind && host === "0.0.0.0")) throw Error("Gateway bind is not allowed");
  return { port, host };
}
export async function startOfficeGateway(args = [], env = process.env) {
  const { port, host } = parseGatewayArguments(args);
  const { createOfficeGatewayServer } = require("./lib/office/gateway/node-server.js");
  const { decodeOfficeGatewayKey } = require("./lib/office/gateway/protocol.js");
  const seedPath = new URL("./lib/office/runtime/seeds/approved-map.json", import.meta.url);
  const stat = await fs.stat(seedPath); if (!stat.isFile() || stat.size > 2 * 1024 * 1024) throw Error("Invalid gateway seed");
  const seed = JSON.parse(await fs.readFile(seedPath, "utf8"));
  const server = createOfficeGatewayServer({ enabled: env.AUREON_OFFICE_ENABLED,
    key: decodeOfficeGatewayKey(env.AUREON_OFFICE_GATEWAY_KEY),
    storeCallbackUrl: env.AUREON_OFFICE_STORE_CALLBACK_URL,
    runtimeDirectory: env.AUREON_OFFICE_RUNTIME_DIR, approvedMap: seed.map });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, host, () => { server.off("error", reject); resolve(); }); });
  let stopping = false;
  const stop = () => {
    if (stopping) return; stopping = true;
    const deadline = setTimeout(() => { server.closeAllConnections(); }, 10_000); deadline.unref();
    server.close(() => clearTimeout(deadline));
  };
  process.once("SIGINT", stop); process.once("SIGTERM", stop);
  // Local address only; never print config, key, callback body, users or database state.
  console.log(host === "127.0.0.1" ? "Office gateway listening at http://127.0.0.1:" + port : "Office gateway container listener started; host exposure must remain loopback.");
  return server;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startOfficeGateway(process.argv.slice(2)).catch(() => { console.error("Office gateway could not start. Check the reviewed private configuration."); process.exitCode = 1; });
}

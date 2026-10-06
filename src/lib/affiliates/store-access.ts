// Permissions of the people of a client (loja) in the Afiliados portal.
// Pure functions — usable on the server (guards) and in the browser (hide what
// a person cannot use; the server still checks every request).
//
// A person has a ROLE (a preset) and optional per-person OVERRIDES stored in
// aff_client_users.permissions as {"modulo": ["view","edit"]}. An override for
// a module replaces the preset of that module (an empty list removes access).
// "edit" always includes "view".
//
// Reading reports does not allow exporting personal data: export needs
// reports:edit (finance / owner).

export const STORE_MODULES = [
  "campaigns",
  "affiliates",
  "commissions",
  "invoices",
  "payments",
  "reports",
  "integrations",
  "team",
] as const;
export type StoreModule = (typeof STORE_MODULES)[number];

export type StoreAction = "view" | "edit";
export const STORE_ROLES = ["owner", "manager", "finance", "viewer"] as const;
export type StoreRole = (typeof STORE_ROLES)[number];

export type StorePermissions = Record<StoreModule, StoreAction[]>;
export type StoreOverrides = Partial<Record<StoreModule, StoreAction[]>>;

const EDIT: StoreAction[] = ["view", "edit"];
const VIEW: StoreAction[] = ["view"];
const NONE: StoreAction[] = [];

export const ROLE_PRESETS: Record<StoreRole, StorePermissions> = {
  owner: {
    campaigns: EDIT,
    affiliates: EDIT,
    commissions: EDIT,
    invoices: EDIT,
    payments: EDIT,
    reports: EDIT,
    integrations: EDIT,
    team: EDIT,
  },
  manager: {
    campaigns: EDIT,
    affiliates: EDIT,
    commissions: VIEW,
    invoices: VIEW,
    payments: NONE,
    reports: VIEW,
    integrations: VIEW,
    team: NONE,
  },
  finance: {
    campaigns: VIEW,
    affiliates: VIEW,
    commissions: EDIT,
    invoices: EDIT,
    payments: EDIT,
    reports: EDIT,
    integrations: VIEW,
    team: NONE,
  },
  viewer: {
    campaigns: VIEW,
    affiliates: VIEW,
    commissions: VIEW,
    invoices: VIEW,
    payments: NONE,
    reports: VIEW,
    integrations: VIEW,
    team: NONE,
  },
};

/** The Aureon team sees and does everything on every account. */
export const FULL_ACCESS: StorePermissions = ROLE_PRESETS.owner;

export function isStoreRole(v: unknown): v is StoreRole {
  return typeof v === "string" && (STORE_ROLES as readonly string[]).includes(v);
}

function cleanActions(v: unknown): StoreAction[] | null {
  if (!Array.isArray(v)) return null;
  const set = new Set(v.filter((a): a is StoreAction => a === "view" || a === "edit"));
  if (set.has("edit")) set.add("view");
  return [...set];
}

/** Reads the jsonb stored in the database / sent by the browser, ignoring junk. */
export function parseOverrides(raw: unknown): StoreOverrides {
  const out: StoreOverrides = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const m of STORE_MODULES) {
    const actions = cleanActions((raw as Record<string, unknown>)[m]);
    if (actions) out[m] = actions;
  }
  return out;
}

export function effectivePermissions(role: StoreRole, overrides: unknown): StorePermissions {
  const preset = ROLE_PRESETS[role] ?? ROLE_PRESETS.viewer;
  const o = parseOverrides(overrides);
  const result = {} as StorePermissions;
  for (const m of STORE_MODULES) result[m] = o[m] ?? preset[m];
  return result;
}

export function can(perms: StorePermissions, module: StoreModule, action: StoreAction): boolean {
  return perms[module].includes(action);
}

/** What a route needs: ANY of the listed pairs is enough; "any-view" = any module. */
export type Need = "any-view" | ReadonlyArray<readonly [StoreModule, StoreAction]>;

export function satisfies(perms: StorePermissions, need: Need): boolean {
  if (need === "any-view") return STORE_MODULES.some((m) => perms[m].includes("view"));
  return need.some(([m, a]) => can(perms, m, a));
}

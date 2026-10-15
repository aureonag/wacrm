import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AccountRole } from "@/lib/auth/roles";

const createClient = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => createClient(),
}));

const { ForbiddenError, UnauthorizedError } = await import("@/lib/auth/account");
const { getOfficeContext, OfficeConfigurationError } = await import("./access");

const ACCOUNT_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ACCOUNT_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "user-from-session";
const PROFILE_ID = "profile-from-rls";
const PILOT_USER_ID = "abcdefab-abcd-4abc-8abc-abcdefabcdef";
const OTHER_PILOT_USER_ID = "fedcba98-7654-4321-8fed-cba987654321";
const { officeError } = await import("./http");

interface QueryCall {
  table: string;
  columns?: string;
  eqArgs: [string, unknown][];
}

function makeClient(opts: {
  user?: { id: string; user_metadata?: Record<string, unknown> } | null;
  accountId?: string;
  accountName?: string;
  role?: string;
  profile?: Record<string, unknown> | null;
  profileError?: unknown;
} = {}) {
  const calls: QueryCall[] = [];
  let profileReads = 0;
  const accountId = opts.accountId ?? ACCOUNT_ID;
  const role = opts.role ?? "agent";
  const profile = opts.profile === undefined
    ? { id: PROFILE_ID, full_name: "  Ana Teste  ", avatar_url: null, account_role: role }
    : opts.profile;
  const client = {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: opts.user === undefined ? { id: USER_ID } : opts.user },
        error: null,
      }),
    },
    from(table: string) {
      const call: QueryCall = { table, eqArgs: [] };
      calls.push(call);
      const profileRead = table === "profiles" ? ++profileReads : 0;
      const builder = {
        select(columns: string) {
          call.columns = columns;
          return builder;
        },
        eq(column: string, value: unknown) {
          call.eqArgs.push([column, value]);
          return builder;
        },
        maybeSingle() {
          if (table === "accounts") {
            return Promise.resolve({
              data: { id: accountId, name: opts.accountName ?? "Nome mutável" },
              error: null,
            });
          }
          return Promise.resolve(profileRead === 1
            ? { data: { account_id: accountId, account_role: role }, error: null }
            : { data: profile, error: opts.profileError ?? null });
        },
      };
      return builder;
    },
  };
  createClient.mockReturnValue(client);
  return { calls, client };
}

beforeEach(() => {
  vi.stubEnv("AUREON_OFFICE_ACCOUNT_ID", ACCOUNT_ID);
  vi.stubEnv("AUREON_OFFICE_PILOT_USER_IDS", undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("getOfficeContext", () => {
  it("requires a verified CRM session, including when office config is absent", async () => {
    const { calls } = makeClient({ user: null });
    vi.stubEnv("AUREON_OFFICE_ACCOUNT_ID", undefined);
    await expect(getOfficeContext()).rejects.toBeInstanceOf(UnauthorizedError);
    expect(calls).toEqual([]);
  });

  it.each([undefined, "", "  ", "*", "not-an-account-id"])(
    "fails closed for missing or malformed server config (%s)",
    async (configuredId) => {
      const { calls } = makeClient();
      vi.stubEnv("AUREON_OFFICE_ACCOUNT_ID", configuredId);
      await expect(getOfficeContext()).rejects.toBeInstanceOf(OfficeConfigurationError);
      expect(calls).toHaveLength(2);
    },
  );

  it("denies another account even for its owner and forged Aureon metadata", async () => {
    const { calls } = makeClient({
      accountId: OTHER_ACCOUNT_ID,
      accountName: "Aureon",
      role: "owner",
      user: {
        id: USER_ID,
        user_metadata: {
          account_id: ACCOUNT_ID,
          account_role: "owner",
          name: "Forged browser identity",
        },
      },
    });
    await expect(getOfficeContext()).rejects.toBeInstanceOf(ForbiddenError);
    expect(calls).toHaveLength(2);
  });

  it.each([
    ["viewer", false],
    ["agent", false],
    ["admin", true],
    ["owner", true],
  ] as const)("admits the configured account's %s with CRM capabilities", async (role, privileged) => {
    makeClient({ role });
    const context = await getOfficeContext();
    expect(context.role).toBe(role);
    expect(context.capabilities).toEqual({
      canDecorate: privileged,
      canManageMembers: privileged,
    });
  });

  it("loads minimal identity through the same RLS client and serializes no session data", async () => {
    const { calls } = makeClient({
      user: { id: USER_ID, user_metadata: { full_name: "Untrusted name" } },
      profile: {
        id: PROFILE_ID,
        full_name: "  Ana Teste  ",
        avatar_url: "https://example.test/avatar.png",
        account_role: "agent",
        email: "not-for-office@example.test",
        access_token: "not-for-office",
      },
    });
    const context = await getOfficeContext();
    expect(context).toEqual({
      user: {
        id: USER_ID,
        profileId: PROFILE_ID,
        name: "Ana Teste",
        avatarUrl: "https://example.test/avatar.png",
      },
      accountId: ACCOUNT_ID,
      role: "agent",
      capabilities: { canDecorate: false, canManageMembers: false },
    });
    expect(calls[2]).toEqual({
      table: "profiles",
      columns: "id, full_name, avatar_url, account_role",
      eqArgs: [["user_id", USER_ID], ["account_id", ACCOUNT_ID]],
    });
    expect(JSON.stringify(context)).not.toMatch(/email|access_token|supabase|Untrusted/);
  });

  it("keeps stable CRM IDs when the member and account are renamed", async () => {
    makeClient({ accountName: "Before" });
    const first = await getOfficeContext();
    makeClient({
      accountName: "After",
      profile: { id: PROFILE_ID, full_name: "Nome novo", avatar_url: null, account_role: "agent" },
    });
    const second = await getOfficeContext();
    expect(second.user.id).toBe(first.user.id);
    expect(second.user.profileId).toBe(first.user.profileId);
    expect(second.accountId).toBe(first.accountId);
    expect(second.user.name).toBe("Nome novo");
  });

  it("uses the freshly read membership role after a concurrent downgrade", async () => {
    makeClient({
      role: "owner",
      profile: { id: PROFILE_ID, full_name: "Ana", avatar_url: null, account_role: "viewer" },
    });
    expect(await getOfficeContext()).toMatchObject({
      role: "viewer",
      capabilities: { canDecorate: false, canManageMembers: false },
    });
  });

  it("denies a removed/transferred member on the next scoped profile read", async () => {
    makeClient({ profile: null });
    await expect(getOfficeContext()).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("does not retain access when membership or server configuration changes on later requests", async () => {
    makeClient();
    await expect(getOfficeContext()).resolves.toMatchObject({ accountId: ACCOUNT_ID });
    makeClient({ accountId: OTHER_ACCOUNT_ID });
    await expect(getOfficeContext()).rejects.toBeInstanceOf(ForbiddenError);
    makeClient();
    vi.stubEnv("AUREON_OFFICE_ACCOUNT_ID", undefined);
    await expect(getOfficeContext()).rejects.toBeInstanceOf(OfficeConfigurationError);
  });

  it("rejects an unknown current membership role", async () => {
    makeClient({
      profile: { id: PROFILE_ID, full_name: "Ana", account_role: "superadmin" },
    });
    await expect(getOfficeContext()).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("does not return a partial identity when the profile query fails", async () => {
    makeClient({ profile: null, profileError: { message: "database detail must stay private" } });
    await expect(getOfficeContext()).rejects.toThrow("Could not load office profile");
  });

  it("normalizes a valid configured UUID and gives empty names a generic label", async () => {
    const accountWithLetters = "abcdefab-abcd-4abc-8abc-abcdefabcdef";
    makeClient({
      accountId: accountWithLetters,
      profile: { id: PROFILE_ID, full_name: " ", avatar_url: null, account_role: "agent" satisfies AccountRole },
    });
    vi.stubEnv("AUREON_OFFICE_ACCOUNT_ID", " " + accountWithLetters.toUpperCase() + " ");
    expect((await getOfficeContext()).user.name).toBe("Membro da Aureon");
  });
});


describe("optional office pilot UID gate", () => {
  it("admits exact authenticated UIDs from a normalized server-only list", async () => {
    vi.stubEnv("AUREON_OFFICE_PILOT_USER_IDS", "  " + PILOT_USER_ID.toUpperCase() + ", " + OTHER_PILOT_USER_ID + " ");
    for (const id of [PILOT_USER_ID, OTHER_PILOT_USER_ID]) {
      makeClient({ user: { id } });
      const context = await getOfficeContext();
      expect(context.user.id).toBe(id);
      expect(JSON.stringify(context)).not.toMatch(/PILOT|pilot|USER_IDS/);
    }
  });

  it.each([
    { label: "empty", value: "" },
    { label: "whitespace", value: "  " },
    { label: "wildcard", value: "*" },
    { label: "non UUID", value: "owner" },
    { label: "trailing empty entry", value: PILOT_USER_ID + "," },
    { label: "duplicate", value: PILOT_USER_ID + "," + PILOT_USER_ID.toUpperCase() },
    { label: "wrong delimiter", value: PILOT_USER_ID + ";" + OTHER_PILOT_USER_ID },
    { label: "oversized setting", value: " ".repeat(2049) },
  ])("fails closed when a present pilot setting is $label", async ({ value }) => {
    makeClient({ user: { id: PILOT_USER_ID }, role: "owner" });
    vi.stubEnv("AUREON_OFFICE_PILOT_USER_IDS", value);
    await expect(getOfficeContext()).rejects.toBeInstanceOf(OfficeConfigurationError);
  });

  it("accepts at most 20 unique UUIDs and rejects the twenty-first", async () => {
    const ids = Array.from({ length: 21 }, (_, index) => "11111111-1111-4111-8111-" + String(index).padStart(12, "0"));
    makeClient({ user: { id: ids[19] } });
    vi.stubEnv("AUREON_OFFICE_PILOT_USER_IDS", ids.slice(0, 20).join(","));
    await expect(getOfficeContext()).resolves.toMatchObject({ user: { id: ids[19] } });
    makeClient({ user: { id: ids[19] } });
    vi.stubEnv("AUREON_OFFICE_PILOT_USER_IDS", ids.join(","));
    await expect(getOfficeContext()).rejects.toBeInstanceOf(OfficeConfigurationError);
  });

  it.each(["agent", "owner"])("cannot bypass the UID list with a %s role, matching profile ID, or browser claims", async role => {
    makeClient({
      role,
      user: { id: OTHER_PILOT_USER_ID, user_metadata: { id: PILOT_USER_ID, user_id: PILOT_USER_ID, role: "owner" } },
      profile: { id: PILOT_USER_ID, full_name: "Owner", avatar_url: null, account_role: "owner" },
    });
    vi.stubEnv("AUREON_OFFICE_PILOT_USER_IDS", PILOT_USER_ID);
    await expect(getOfficeContext()).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("never lets a listed UID bypass the Aureon account gate or current membership", async () => {
    vi.stubEnv("AUREON_OFFICE_PILOT_USER_IDS", PILOT_USER_ID);
    makeClient({ accountId: OTHER_ACCOUNT_ID, user: { id: PILOT_USER_ID }, role: "owner" });
    await expect(getOfficeContext()).rejects.toBeInstanceOf(ForbiddenError);
    makeClient({ user: { id: PILOT_USER_ID }, role: "owner", profile: null });
    await expect(getOfficeContext()).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("rechecks the setting and verified user on every call, including removal", async () => {
    makeClient({ user: { id: OTHER_PILOT_USER_ID } });
    await expect(getOfficeContext()).resolves.toMatchObject({ user: { id: OTHER_PILOT_USER_ID } });
    vi.stubEnv("AUREON_OFFICE_PILOT_USER_IDS", PILOT_USER_ID);
    makeClient({ user: { id: OTHER_PILOT_USER_ID } });
    await expect(getOfficeContext()).rejects.toBeInstanceOf(ForbiddenError);
    makeClient({ user: { id: PILOT_USER_ID } });
    await expect(getOfficeContext()).resolves.toMatchObject({ user: { id: PILOT_USER_ID } });
    vi.stubEnv("AUREON_OFFICE_PILOT_USER_IDS", OTHER_PILOT_USER_ID);
    makeClient({ user: { id: PILOT_USER_ID } });
    await expect(getOfficeContext()).rejects.toBeInstanceOf(ForbiddenError);
    vi.stubEnv("AUREON_OFFICE_PILOT_USER_IDS", undefined);
    makeClient({ user: { id: PILOT_USER_ID } });
    await expect(getOfficeContext()).resolves.toMatchObject({ user: { id: PILOT_USER_ID } });
  });

  it("keeps CRM auth mandatory and classifies pilot removal as access denial", async () => {
    vi.stubEnv("AUREON_OFFICE_PILOT_USER_IDS", PILOT_USER_ID);
    makeClient({ user: null });
    await expect(getOfficeContext()).rejects.toBeInstanceOf(UnauthorizedError);
    makeClient({ user: { id: OTHER_PILOT_USER_ID }, role: "owner" });
    const error: unknown = await getOfficeContext().catch(failure => failure);
    expect(error).toBeInstanceOf(ForbiddenError);
    const response = officeError(error);
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "OFFICE_ACCESS_DENIED" });
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
  });
});

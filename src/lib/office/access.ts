import { ForbiddenError, getCurrentAccount } from "@/lib/auth/account";
import {
  canEditSettings,
  canManageMembers,
  isAccountRole,
  type AccountRole,
} from "@/lib/auth/roles";

export class OfficeConfigurationError extends Error {
  readonly status = 503 as const;

  constructor() {
    super("Office is not configured");
    this.name = "OfficeConfigurationError";
  }
}

/** Serializable CRM identity only; this is not an office session/token. */
export interface OfficeContext {
  user: {
    /** Stable auth.users.id, shared with the CRM. */
    id: string;
    profileId: string;
    name: string;
    avatarUrl: string | null;
  };
  accountId: string;
  role: AccountRole;
  capabilities: {
    canDecorate: boolean;
    canManageMembers: boolean;
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_PILOT_USERS = 20;
const MAX_PILOT_CONFIG_LENGTH = 2048;

/** Absent opens the existing account gate; a present invalid list never does. */
function pilotUserIds(): ReadonlySet<string> | null {
  const configured = process.env.AUREON_OFFICE_PILOT_USER_IDS;
  if (configured === undefined) return null;
  if (configured.length > MAX_PILOT_CONFIG_LENGTH) throw new OfficeConfigurationError();
  const ids = configured.split(",").map(id => id.trim().toLowerCase());
  if (ids.length > MAX_PILOT_USERS || ids.some(id => !UUID.test(id)) || new Set(ids).size !== ids.length) {
    throw new OfficeConfigurationError();
  }
  return new Set(ids);
}

/** Server-only: account context imports the cookie-backed Supabase SSR client. */
export async function getOfficeContext(): Promise<OfficeContext> {
  const ctx = await getCurrentAccount();
  const allowedAccountId = process.env.AUREON_OFFICE_ACCOUNT_ID?.trim();

  // No default: a missing or malformed deployment setting never opens access.
  if (!allowedAccountId || !UUID.test(allowedAccountId)) {
    throw new OfficeConfigurationError();
  }
  if (ctx.accountId.toLowerCase() !== allowedAccountId.toLowerCase()) {
    throw new ForbiddenError("Office access is restricted");
  }

  // Stable auth.users.id from getUser(), never profile.id or client claims.
  // Read every request so removal takes effect without a cached authorization.
  const pilotIds = pilotUserIds();
  if (pilotIds && !pilotIds.has(ctx.userId.toLowerCase())) {
    throw new ForbiddenError("Office access is restricted");
  }

  // Reuse the caller's SSR/RLS client, never a service-role client or browser ID.
  // Read current membership again with the identity so a concurrent account/role
  // change cannot pair old capabilities with a newly fetched profile.
  const { data: profile, error } = await ctx.supabase
    .from("profiles")
    .select("id, full_name, avatar_url, account_role")
    .eq("user_id", ctx.userId)
    .eq("account_id", ctx.accountId)
    .maybeSingle();

  if (error) throw new Error("Could not load office profile");
  if (!profile || typeof profile.id !== "string" || !profile.id || !isAccountRole(profile.account_role)) {
    throw new ForbiddenError("Office membership is unavailable");
  }

  return {
    user: {
      id: ctx.userId,
      profileId: profile.id,
      name: typeof profile.full_name === "string" && profile.full_name.trim()
        ? profile.full_name.trim()
        : "Membro da Aureon",
      avatarUrl: typeof profile.avatar_url === "string" ? profile.avatar_url : null,
    },
    accountId: ctx.accountId,
    role: profile.account_role,
    capabilities: {
      canDecorate: canEditSettings(profile.account_role),
      canManageMembers: canManageMembers(profile.account_role),
    },
  };
}

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { useRuntimeConfig } from "nitro/runtime-config";
import { createError, getHeader } from "nitro/h3";

/**
 * Server-side access to Supabase.
 *
 * Supabase is both the datastore and the identity provider, so this module has
 * three jobs:
 *
 *  1. Prove who is calling. The browser sends the Supabase access token it
 *     already holds; we verify it against Supabase Auth rather than trusting it.
 *  2. Resolve what that person is allowed to do, from the `profiles` row, so the
 *     rules live on the server instead of in the browser.
 *  3. Hand out Supabase clients. `getUserClient` speaks as the caller, so
 *     Postgres row level security applies exactly as it does today. `getServiceClient`
 *     bypasses RLS and is only ever used after a role check in this file's callers.
 */

export type UserRole = "admin" | "preparer" | "approver";

export type Company = {
  id: string;
  name: string;
  code: string;
  description: string | null;
  color: string;
  isActive: boolean;
};

export type Caller = {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  companyId: string | null;
  company: Company | null;
  isAdmin: boolean;
  /** Approvers and admins both approve; that is the single rule used everywhere. */
  isApprover: boolean;
  /** Preparers and admins both create vouchers. */
  canPrepare: boolean;
  /** True when the multi-company migration has not been run yet. */
  needsMigration: boolean;
};

type ProfileRow = {
  id: string;
  full_name: string | null;
  role: string | null;
  company_id: string | null;
};

const getConfig = () => {
  // eslint-disable-next-line react-hooks/rules-of-hooks -- Nitro helper, not a React hook.
  const runtime = useRuntimeConfig();
  return {
    url: String(runtime.supabaseUrl || ""),
    anonKey: String(runtime.supabaseAnonKey || ""),
    serviceKey: String(runtime.supabaseServiceKey || ""),
  };
};

export const isSupabaseConfigured = () => {
  const { url, anonKey } = getConfig();
  return Boolean(url && anonKey);
};

const requireConfig = () => {
  const config = getConfig();
  if (!config.url || !config.anonKey) {
    throw createError({
      statusCode: 503,
      statusMessage:
        "Supabase is not configured on the server. Add NITRO_SUPABASE_URL and NITRO_SUPABASE_ANON_KEY to .env, then restart the dev server.",
    });
  }
  return config;
};

/** Speaks as the signed-in person, so row level security applies to every query. */
export const getUserClient = (accessToken: string): SupabaseClient => {
  const { url, anonKey } = requireConfig();
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
};

/** Bypasses row level security. Never call this without an admin check first. */
export const getServiceClient = (): SupabaseClient => {
  const { url, serviceKey } = requireConfig();
  if (!serviceKey) {
    throw createError({
      statusCode: 503,
      statusMessage:
        "NITRO_SUPABASE_SERVICE_KEY is missing from .env. The admin panel needs it to create and manage user accounts.",
    });
  }
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
};

export const readAccessToken = (event: Parameters<typeof getHeader>[0]): string => {
  const header = String(getHeader(event, "authorization") || "");
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : "";
};

const normaliseRole = (value: string | null): UserRole =>
  value === "admin" || value === "approver" || value === "preparer" ? value : "preparer";

const mapCompany = (row: Record<string, unknown>): Company => ({
  id: String(row.id),
  name: String(row.name),
  code: String(row.code ?? ""),
  description: (row.description as string | null) ?? null,
  color: String(row.color ?? "#d71939"),
  isActive: row.is_active !== false,
});

/**
 * Verifies the caller's access token and resolves their profile.
 *
 * If `profiles.company_id` is missing the multi-company migration has not been
 * run. Rather than failing every request we fall back to the legacy profile
 * shape and flag it, so the app still loads and can tell the user what to do.
 */
export const requireCaller = async (event: Parameters<typeof getHeader>[0]): Promise<Caller> => {
  const token = readAccessToken(event);
  if (!token) {
    throw createError({ statusCode: 401, statusMessage: "Sign in to continue." });
  }

  const client = getUserClient(token);
  const { data: userData, error: userError } = await client.auth.getUser(token);
  const authUser = userData?.user;

  if (userError || !authUser) {
    throw createError({ statusCode: 401, statusMessage: "Your session has expired. Sign in again." });
  }

  let needsMigration = false;
  let profile: ProfileRow | null = null;

  const profileQuery = await client
    .from("profiles")
    .select("id, full_name, role, company_id")
    .eq("id", authUser.id)
    .maybeSingle();

  if (profileQuery.error) {
    const legacy = await client.from("profiles").select("id, full_name, role").eq("id", authUser.id).maybeSingle();
    if (legacy.error) {
      throw createError({ statusCode: 500, statusMessage: `Could not read your profile: ${legacy.error.message}` });
    }
    needsMigration = true;
    profile = legacy.data ? { ...(legacy.data as ProfileRow), company_id: null } : null;
  } else {
    profile = profileQuery.data as ProfileRow | null;
  }

  if (!profile) {
    throw createError({
      statusCode: 403,
      statusMessage:
        "Your sign-in works but there is no profile row for you yet. Ask a workspace admin to add you in the admin panel.",
    });
  }

  const role = normaliseRole(profile.role);

  let company: Company | null = null;
  if (profile.company_id) {
    const companyQuery = await client
      .from("companies")
      .select("id, name, code, description, color, is_active")
      .eq("id", profile.company_id)
      .maybeSingle();
    if (companyQuery.error) {
      needsMigration = true;
    } else if (companyQuery.data) {
      company = mapCompany(companyQuery.data as Record<string, unknown>);
    }
  }

  return {
    id: authUser.id,
    email: String(authUser.email ?? ""),
    fullName: profile.full_name || String(authUser.email ?? "").split("@")[0] || "Longhorn user",
    role,
    companyId: company?.id ?? null,
    company,
    isAdmin: role === "admin",
    isApprover: role === "approver" || role === "admin",
    canPrepare: role === "preparer" || role === "admin",
    needsMigration,
  };
};

export const requireAdmin = async (event: Parameters<typeof getHeader>[0]): Promise<Caller> => {
  const caller = await requireCaller(event);
  if (!caller.isAdmin) {
    throw createError({ statusCode: 403, statusMessage: "Only workspace admins can do that." });
  }
  return caller;
};
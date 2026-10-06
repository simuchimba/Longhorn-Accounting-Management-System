import { defineHandler } from "nitro";
import { requireAdmin, getServiceClient } from "../../../utils/supabase";

type AdminUser = {
  id: string;
  email: string;
  fullName: string;
  role: string;
  companyId: string | null;
  companyName: string | null;
  companyCode: string | null;
  isActive: boolean;
  hasProfile: boolean;
  createdAt: string | null;
  lastLoginAt: string | null;
};

const PAGE = 200;

/**
 * Everyone who can sign in, with their role and the branch they work for.
 *
 * Emails live in Supabase Auth and roles live in `profiles`, so this joins the
 * two. A Supabase account with no profile row is still returned, flagged with
 * `hasProfile: false`, because otherwise it would be invisible and the admin
 * would never know why that person cannot see anything.
 */
export default defineHandler(async (event) => {
  await requireAdmin(event);
  const service = getServiceClient();

  const authUsers: Array<Record<string, unknown>> = [];
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await service.auth.admin.listUsers({ page, perPage: PAGE });
    if (error) {
      throw new Error(error.message);
    }
    authUsers.push(...((data?.users ?? []) as unknown as Array<Record<string, unknown>>));
    if (!data?.users || data.users.length < PAGE) break;
  }

  const [profilesResult, companiesResult] = await Promise.all([
    service.from("profiles").select("id, full_name, role, company_id"),
    service.from("companies").select("id, name, code, color").order("name"),
  ]);
  if (profilesResult.error) throw new Error(profilesResult.error.message);
  if (companiesResult.error) throw new Error(companiesResult.error.message);

  const companies = companiesResult.data ?? [];
  const companyById = new Map(
    companies.map((row) => [String(row.id), { name: String(row.name), code: String(row.code ?? "") }]),
  );
  const profileById = new Map(
    (profilesResult.data ?? []).map((row) => [String(row.id), row as { full_name: string | null; role: string | null; company_id: string | null }]),
  );

  const users: AdminUser[] = authUsers.map((authUser) => {
    const id = String(authUser.id);
    const profile = profileById.get(id);
    const company = profile?.company_id ? companyById.get(profile.company_id) : undefined;
    const bannedUntil = authUser.banned_until ? new Date(String(authUser.banned_until)).getTime() : 0;
    return {
      id,
      email: String(authUser.email ?? ""),
      fullName: profile?.full_name || String(authUser.email ?? "").split("@")[0] || "Unnamed user",
      role: profile?.role ?? "preparer",
      companyId: profile?.company_id ?? null,
      companyName: company?.name ?? null,
      companyCode: company?.code ?? null,
      // A future ban date is how Supabase marks a disabled account.
      isActive: bannedUntil <= Date.now(),
      hasProfile: Boolean(profile),
      createdAt: authUser.created_at ? String(authUser.created_at) : null,
      lastLoginAt: authUser.last_sign_in_at ? String(authUser.last_sign_in_at) : null,
    };
  });

  users.sort((a, b) => {
    if (!a.companyId && b.companyId) return 1;
    if (a.companyId && !b.companyId) return -1;
    const byCompany = (a.companyCode || "zzz").localeCompare(b.companyCode || "zzz");
    if (byCompany !== 0) return byCompany;
    return a.fullName.localeCompare(b.fullName);
  });

  return { users, companies };
});
import { defineHandler } from "nitro";
import { getUserClient, readAccessToken, requireCaller } from "../../utils/supabase";

type DirectoryMember = {
  id: string;
  fullName: string;
  role: string;
  companyId: string | null;
  companyName: string | null;
  companyCode: string | null;
  companyColor: string | null;
};

/**
 * Reference data the voucher composer needs.
 *
 * `companies` drives the branch filter and the company shown on a voucher.
 * `approvers` powers the "who should approve this?" dropdown.
 *
 * Only role 'approver' is listed. Admins can approve anything, but they run the
 * workspace rather than sign off its payments day to day, so offering them here
 * would push routine vouchers at whoever happens to be the system admin.
 * Admins remain able to approve; they are simply not the default choice a
 * preparer is offered.
 */
export default defineHandler(async (event) => {
  const caller = await requireCaller(event);
  const client = getUserClient(readAccessToken(event));

  const [companiesResult, membersResult] = await Promise.all([
    client.from("companies").select("id, name, code, description, color, is_active").order("name"),
    client
      .from("profiles")
      .select("id, full_name, role, company_id")
      .eq("role", "approver")
      .order("full_name"),
  ]);

  if (companiesResult.error && /company_id|companies/i.test(companiesResult.error.message)) {
    // Migration not run yet: send empty lists so the composer still opens.
    return { companies: [], approvers: [], needsMigration: true };
  }
  if (companiesResult.error) {
    throw new Error(companiesResult.error.message);
  }

  const companies = (companiesResult.data ?? []).map((row) => ({
    id: String(row.id),
    name: String(row.name),
    code: String(row.code ?? ""),
    description: (row.description as string | null) ?? null,
    color: String(row.color ?? "#d71939"),
    isActive: row.is_active !== false,
  }));

  const byId = new Map(companies.map((company) => [company.id, company]));
  const approvers: DirectoryMember[] = (membersResult.data ?? []).map((row) => {
    const profile = row as { id: string; full_name: string | null; role: string; company_id: string | null };
    const company = profile.company_id ? byId.get(profile.company_id) : undefined;
    return {
      id: profile.id,
      fullName: profile.full_name || "Unnamed user",
      role: profile.role,
      companyId: profile.company_id ?? null,
      companyName: company?.name ?? null,
      companyCode: company?.code ?? null,
      companyColor: company?.color ?? null,
    };
  });

  // Own branch first, then everyone else alphabetically. Done here so the
  // dropdown order is the same for every screen that opens it.
  approvers.sort((a, b) => {
    const aMine = a.companyId && a.companyId === caller.companyId ? 0 : 1;
    const bMine = b.companyId && b.companyId === caller.companyId ? 0 : 1;
    if (aMine !== bMine) return aMine - bMine;
    return a.fullName.localeCompare(b.fullName);
  });

  return { companies, approvers, needsMigration: caller.needsMigration };
});
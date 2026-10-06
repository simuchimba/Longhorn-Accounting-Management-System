import { defineHandler } from "nitro";
import { requireAdmin, getServiceClient } from "../../../utils/supabase";

/**
 * The admin panel's summary: one card per branch.
 *
 * Runs as the service client so an admin genuinely sees every branch, which is
 * the whole point of their job. Everyone else is served by the row level
 * security policies on `vouchers` instead.
 */
export default defineHandler(async (event) => {
  await requireAdmin(event);
  const service = getServiceClient();

  const [companiesResult, profilesResult, vouchersResult] = await Promise.all([
    service.from("companies").select("id, name, code, description, color, is_active").order("name"),
    service.from("profiles").select("id, role, company_id"),
    service
      .from("vouchers")
      .select("id, company_id, amount, status, prepared_by, assigned_approver_id, created_at"),
  ]);

  if (companiesResult.error) throw new Error(companiesResult.error.message);
  if (profilesResult.error) throw new Error(profilesResult.error.message);
  if (vouchersResult.error) throw new Error(vouchersResult.error.message);

  const companies = companiesResult.data ?? [];
  const profiles = profilesResult.data ?? [];
  const vouchers = vouchersResult.data ?? [];

  type VoucherRow = {
    id: string;
    company_id: string | null;
    amount: number | string | null;
    status: string;
    prepared_by: string | null;
    assigned_approver_id: string | null;
    created_at: string | null;
  };

  const branches = companies.map((company) => {
    const companyId = String(company.id);
    const members = profiles.filter(
      (row) => String(row.company_id ?? "") === companyId && row.role !== undefined,
    ) as Array<{ id: string; role: string }>;
    const rows = vouchers.filter((row) => String((row as VoucherRow).company_id ?? "") === companyId) as VoucherRow[];

    const sum = rows.reduce((total, row) => total + Number(row.amount ?? 0), 0);

    return {
      id: companyId,
      name: String(company.name),
      code: String(company.code ?? ""),
      description: (company.description as string | null) ?? null,
      color: String(company.color ?? "#d71939"),
      isActive: company.is_active !== false,
      users: {
        total: members.length,
        admins: members.filter((row) => row.role === "admin").length,
        preparers: members.filter((row) => row.role === "preparer").length,
        approvers: members.filter((row) => row.role === "approver").length,
      },
      vouchers: {
        total: rows.length,
        pending: rows.filter((row) => row.status === "Pending approval").length,
        approved: rows.filter((row) => row.status === "Approved").length,
        draft: rows.filter((row) => row.status === "Draft").length,
        value: sum,
      },
    };
  });

  const unassigned = profiles.filter((row) => !row.company_id).length;
  const unassignedVouchers = vouchers.filter((row) => !row.company_id).length;
  const latestActivity = vouchers
    .map((row) => ({ at: row.created_at, companyId: row.company_id }))
    .filter((row) => Boolean(row.at))
    .sort((a, b) => String(b.at).localeCompare(String(a.at)))[0]?.at ?? null;

  return {
    branches,
    unassignedUsers: unassigned,
    unassignedVouchers,
    lastActivityAt: latestActivity,
  };
});
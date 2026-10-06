import { supabase } from "@/integrations/supabase/client";
import type {
  AdminOverview,
  AdminUser,
  Company,
  CurrentUser,
  DirectoryMember,
  NewCompanyInput,
  NewUserInput,
  UserRole,
} from "@/lib/types";

export type { AdminOverview, AdminUser, Company, CurrentUser, DirectoryMember, UserRole, VoucherStatus } from "@/lib/types";

/**
 * Client for the ledger's server layer in `server/`.
 *
 * Supabase Auth owns sign-in, so the browser already holds an access token. It is
 * attached to every call as a bearer token and the server verifies it before
 * doing anything. Role and company checks happen on the server, which is why the
 * admin routes need no client-side guard of their own.
 *
 * Note the split in responsibilities: voucher rows are read straight from
 * Supabase with the same session token, where Postgres row level security is what
 * keeps one branch's books private. This file covers identity, the approver
 * directory and everything the admin panel does.
 */

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

const request = async <T>(url: string, init?: RequestInit): Promise<T> => {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  let response: Response;
  try {
    response = await fetch(url, {
      credentials: "include",
      ...init,
      headers: {
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...(init?.headers ?? {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
  } catch {
    throw new ApiError("Cannot reach the ledger server. Check your connection and try again.", 0);
  }

  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const payload = (await response.json()) as { statusMessage?: string; message?: string };
      message = payload.statusMessage || payload.message || message;
    } catch {
      // A non-JSON error body means something upstream failed; keep the default.
    }
    throw new ApiError(message, response.status);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
};

const json = (body: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(body) });

/* ------------------------------------------------------------------ identity */

export type MeResponse = {
  user: CurrentUser | null;
  /** True when database/multi_company_setup.sql has not been run yet. */
  needsMigration: boolean;
  /** True when the server has no Supabase keys at all. */
  setupRequired: boolean;
};

export const fetchMe = () => request<MeResponse>("/api/me");

export type DirectoryResponse = {
  companies: Company[];
  approvers: DirectoryMember[];
  needsMigration: boolean;
};

export const fetchDirectory = () => request<DirectoryResponse>("/api/directory");

/* -------------------------------------------------------------------- admin */

export type AdminUsersResponse = { users: AdminUser[]; companies: Company[] };

export const fetchAdminUsers = () => request<AdminUsersResponse>("/api/admin/users");

export const fetchAdminOverview = () => request<AdminOverview>("/api/admin/overview");

export const createUser = (input: NewUserInput) =>
  request<{ user: AdminUser }>("/api/admin/users", json(input));

export type UpdateUserInput = {
  fullName?: string;
  role?: UserRole;
  companyId?: string | null;
  isActive?: boolean;
  newPassword?: string;
  email?: string;
};

export const updateUser = (id: string, input: UpdateUserInput) =>
  request<{ user: Partial<AdminUser> }>(`/api/admin/users/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });

export const createCompany = (input: NewCompanyInput) =>
  request<{ company: Company }>("/api/admin/companies", json(input));

export type UpdateCompanyInput = {
  name?: string;
  description?: string | null;
  color?: string;
  isActive?: boolean;
};

export const updateCompany = (id: string, input: UpdateCompanyInput) =>
  request<{ company: Company }>(`/api/admin/companies/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });

/* ------------------------------------------------------------------ account */

/**
 * Changes the signed-in person's sign-in email.
 *
 * This has to go through the server. Supabase's own email change only sends a
 * confirmation link and leaves the stored address alone until it is clicked, which
 * on this project's mail setup never happens. The current password is required so a
 * stolen session cannot quietly redirect an account.
 */
export const changeOwnEmail = (email: string, currentPassword: string) =>
  request<{ email: string; changedAt: string }>("/api/account/email", {
    method: "PATCH",
    body: JSON.stringify({ email, currentPassword }),
  });

/* --------------------------------------------------------------- approving */

export type BulkApproveResult = {
  approved: Array<{ id: string; voucherNo: string }>;
  approvedCount: number;
  skipped: Array<{ id: string; voucherNo: string | null; reason: string }>;
  failed: Array<{ id: string; reason: string }>;
  approvedBy: string;
  month: string | null;
};

/**
 * Approves a set of vouchers in one request.
 *
 * `month` is sent so the server can refuse anything that has moved out of the
 * month the approver was looking at, instead of approving a stale selection.
 */
export const bulkApproveVouchers = (ids: string[], month?: string) =>
  request<BulkApproveResult>("/api/vouchers/bulk-approve", {
    method: "POST",
    body: JSON.stringify({ ids, month }),
  });
export type VoucherStatus = "Draft" | "Pending approval" | "Approved";

export type Voucher = {
  id: string;
  voucherNo: string;
  date: string;
  amount: number;
  currency: string;
  paidTo: string;
  beingPayment: string;
  amountWords: string;
  paymentMethod: string;
  reference: string;
  department: string;
  departmentId: string;
  preparedBy: string;
  approvedBy: string;
  status: VoucherStatus;
};

export type Department = {
  id: string;
  name: string;
  description: string | null;
  voucherCount: number;
};

export type TeamMember = {
  id: string;
  email: string;
  fullName: string;
  role: string;
  isActive: boolean;
  lastLoginAt: string | null;
};

export type SessionUser = {
  id: string;
  email: string;
  fullName: string;
  role: string;
};

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: "include", ...init });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { statusMessage?: string } | null;
    throw new Error(payload?.statusMessage || `Request failed (${response.status})`);
  }
  return response.json() as Promise<T>;
}

export const fetchVouchers = () =>
  request<{ vouchers: Voucher[] }>("/api/vouchers").then((data) => data.vouchers);

export const fetchDepartments = () =>
  request<{ departments: Department[] }>("/api/departments").then((data) => data.departments);

export const fetchTeam = () =>
  request<{ members: TeamMember[]; departments: Department[]; stats: { memberCount: number; departmentCount: number; approverCount: number } }>(
    "/api/team",
  );

export const fetchMe = () =>
  request<{ user: SessionUser }>("/api/auth/me").then((data) => data.user);

export type CreateVoucherInput = {
  date: string;
  amount: number;
  currency: string;
  paidTo: string;
  beingPayment: string;
  amountWords: string;
  paymentMethod: string;
  reference: string;
  department: string;
};

export const createVoucherRequest = (input: CreateVoucherInput) =>
  request<{ voucher: { id: string; voucherNo: string } }>("/api/vouchers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

export const approveVoucherRequest = (id: string) =>
  request<{ voucher: { id: string; voucherNo: string; status: string } }>(
    `/api/vouchers/${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "approve" }),
    },
  );

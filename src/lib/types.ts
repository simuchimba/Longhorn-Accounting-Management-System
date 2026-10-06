export type UserRole = "admin" | "preparer" | "approver";
export type VoucherStatus = "Draft" | "Pending approval" | "Approved";

/**
 * A voucher as the ledger displays it.
 *
 * Lives here rather than in pages/Index.tsx so the approvals panel and the main
 * page can share one definition.
 */
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
  /** The branch this payment belongs to. Preparers only ever load their own. */
  companyId: string | null;
  companyName: string;
  companyCode: string;
  companyColor: string;
  preparedBy: string;
  preparedById: string;
  approvedBy: string;
  approvedById: string | null;
  /** When it was signed off, ISO. Null until approved. */
  approvedAt: string | null;
  /** Who the preparer nominated to sign this off, chosen in the composer. */
  assignedApproverId: string | null;
  assignedApproverName: string;
  status: VoucherStatus;
};

export type Company = {
  id: string;
  name: string;
  code: string;
  description: string | null;
  color: string;
  isActive: boolean;
};

/** The signed-in person, as resolved by the server from their `profiles` row. */
export type CurrentUser = {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  companyId: string | null;
  company: Company | null;
  isAdmin: boolean;
  /** Approvers and admins both approve. */
  isApprover: boolean;
  /** Preparers and admins both create vouchers. */
  canPrepare: boolean;
};

/** An approver or admin, used to populate the "who approves this?" dropdown. */
export type DirectoryMember = {
  id: string;
  fullName: string;
  role: string;
  companyId: string | null;
  companyName: string | null;
  companyCode: string | null;
  companyColor: string | null;
};

/** A user as the admin panel sees them: Auth account joined to their profile. */
export type AdminUser = {
  id: string;
  email: string;
  fullName: string;
  role: string;
  companyId: string | null;
  companyName: string | null;
  companyCode: string | null;
  isActive: boolean;
  /** False means the account can sign in but has no profile row yet. */
  hasProfile: boolean;
  createdAt: string | null;
  lastLoginAt: string | null;
};

export type BranchOverview = {
  id: string;
  name: string;
  code: string;
  description: string | null;
  color: string;
  isActive: boolean;
  users: { total: number; admins: number; preparers: number; approvers: number };
  vouchers: { total: number; pending: number; approved: number; draft: number; value: number };
};

export type AdminOverview = {
  branches: BranchOverview[];
  unassignedUsers: number;
  unassignedVouchers: number;
  lastActivityAt: string | null;
};

export type Department = {
  id: string;
  name: string;
  description: string | null;
};

export type NewUserInput = {
  fullName: string;
  email: string;
  password: string;
  role: UserRole;
  companyId: string | null;
};

export type NewCompanyInput = {
  name: string;
  code: string;
  description: string;
  color: string;
};
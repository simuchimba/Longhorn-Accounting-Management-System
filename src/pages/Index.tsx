import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import {
  AlertTriangle,
  ArrowUpRight,
  BadgeCheck,
  Banknote,
  Building2,
  Bell,
  CalendarDays,
  Check,
  ChevronRight,
  CircleHelp,
  Clock3,
  Download,
  FileCheck2,
  FilePlus2,
  FileSpreadsheet,
  FileText,
  Filter,
  LayoutDashboard,
  Loader2,
  LockKeyhole,
  LogOut,
  Menu,
  MoreHorizontal,
  Plus,
  Printer,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Stamp,
  Trash2,
  Undo2,
  Upload,
  UserRound,
  X,
} from "lucide-react";
import { useNavigate as useRouterNavigate, useSearchParams } from "react-router-dom";
import { createPortal } from "react-dom";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import Logo from "@/components/Logo";
import AppShell, { type NavKey } from "@/components/AppShell";
import ApprovalsPanel from "@/pages/ApprovalsPanel";
import HelpCentre from "@/pages/Help";
import CompanyChip from "@/components/CompanyChip";
import PaginationBar from "@/components/PaginationBar";
import { supabase } from "@/integrations/supabase/client";
import { useSessionContext } from "@/components/SessionContextProvider";
import { bulkApproveVouchers, changeOwnEmail, fetchDirectory, fetchTakenVoucherNumbers } from "@/lib/api";
import { printBlocker, readStoredPageSize, storePageSize } from "@/lib/pagination";
import type { Company, DirectoryMember, Voucher, VoucherStatus } from "@/lib/types";
import {
  IMPORT_FILE_ACCEPT,
  IMPORT_FILE_HINT,
  describeSheetColumns,
  parseImportFile,
  type ImportDirection,
  type ParsedImportFile,
  type ParsedImportSheet,
} from "@/lib/spreadsheetImport";

type View = "dashboard" | "approvals" | "pending" | "approved" | "settings" | "help";

type Department = {
  id: string;
  name: string;
  description: string | null;
};

type VoucherForm = {
  date: string;
  amount: number;
  currency: string;
  paidTo: string;
  beingPayment: string;
  paymentMethod: string;
  reference: string;
  preparedBy: string;
  approverId: string;
};

type DbVoucher = {
  id: string;
  voucher_no: string;
  voucher_date: string;
  amount: number | string;
  currency: string;
  amount_in_words: string;
  paid_to: string;
  being_payment: string;
  payment_method: string;
  reference: string | null;
  department_id: string;
  company_id: string | null;
  prepared_by: string;
  prepared_by_name: string;
  approved_by: string | null;
  approved_by_name: string | null;
  approved_at: string | null;
  assigned_approver_id: string | null;
  assigned_approver_name: string | null;
  status: VoucherStatus;
};

/** The columns the voucher list needs, including the multi-company ones. */
const VOUCHER_COLUMNS =
  "id, voucher_no, voucher_date, amount, currency, amount_in_words, paid_to, being_payment, payment_method, reference, department_id, company_id, prepared_by, prepared_by_name, approved_by, approved_by_name, approved_at, assigned_approver_id, assigned_approver_name, status";

const paymentMethods = ["Bank transfer", "Petty cash", "Mobile money", "Cheque"];
const ALL_COMPANIES = "All companies";
const emptyForm: VoucherForm = {
  date: new Date().toISOString().slice(0, 10),
  amount: 0,
  currency: "ZMW",
  paidTo: "",
  beingPayment: "",
  paymentMethod: "Bank transfer",
  reference: "",
  preparedBy: "",
  approverId: "",
};

const numberWords = [
  "Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
  "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen",
];
const tensWords = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

const underThousandToWords = (value: number): string => {
  const words: string[] = [];
  if (value >= 100) {
    words.push(`${numberWords[Math.floor(value / 100)]} Hundred`);
    value %= 100;
  }
  if (value >= 20) {
    words.push(tensWords[Math.floor(value / 10)]);
    value %= 10;
  }
  if (value > 0) words.push(numberWords[value]);
  return words.join(" ");
};

const wholeNumberToWords = (value: number): string => {
  if (value === 0) return "Zero";
  const scales = [
    { value: 1_000_000_000, label: "Billion" },
    { value: 1_000_000, label: "Million" },
    { value: 1_000, label: "Thousand" },
  ];
  let remaining = Math.floor(value);
  const words: string[] = [];
  scales.forEach((scale) => {
    if (remaining >= scale.value) {
      words.push(`${underThousandToWords(Math.floor(remaining / scale.value))} ${scale.label}`);
      remaining %= scale.value;
    }
  });
  if (remaining > 0) words.push(underThousandToWords(remaining));
  return words.join(" ");
};

const amountToWords = (amount: number, currency: string): string => {
  if (!amount || amount < 0) return "Enter an amount to generate words";
  const whole = Math.floor(amount);
  const cents = Math.round((amount - whole) * 100);
  const currencyName = currency === "ZMW" ? "Kwacha" : currency;
  const centsName = currency === "ZMW" ? "Ngwee" : "Cents";
  const words = `${wholeNumberToWords(whole)} ${currencyName}`;
  return cents ? `${words} and ${underThousandToWords(cents)} ${centsName} Only` : `${words} Only`;
};

const formatMoney = (amount: number, currency = "ZMW") => `${currency} ${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const formatDate = (date: string) => new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(`${date}T00:00:00`));
const getInitials = (name: string) => name.split(" ").filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "LH";

const statusStyles: Record<VoucherStatus, string> = {
  Approved: "bg-[#e5f4ec] text-[#197447] border-[#bce3ca]",
  "Pending approval": "bg-[#fff3dc] text-[#9b650d] border-[#efd7a6]",
  Draft: "bg-[#eef0f5] text-[#5b6476] border-[#d8dce6]",
};

const mapVoucher = (row: DbVoucher, departmentMap: Map<string, string>, companyMap: Map<string, Company>): Voucher => {
  const company = row.company_id ? companyMap.get(row.company_id) : undefined;
  // A voucher's department is the branch that raised it, which is what
  // company_id records. It used to be read from department_id instead, and that
  // column says "General" for every voucher, because the bulk import defaulted
  // every unrecognised value to it. So all 780 read "General" while the branch
  // sat right there in company_id, correct, the whole time.
  //
  // company_id is the right source because it is the one the rest of the system
  // already trusts: branch filters, row-level security and the approver list all
  // read it. Two columns both claiming to hold the branch is how they ended up
  // disagreeing in the first place.
  const departmentFromTable = departmentMap.get(row.department_id) || "";
  return {
    id: row.id,
    voucherNo: row.voucher_no,
    date: row.voucher_date,
    amount: Number(row.amount),
    currency: row.currency,
    paidTo: row.paid_to,
    beingPayment: row.being_payment,
    amountWords: row.amount_in_words,
    paymentMethod: row.payment_method,
    reference: row.reference || "",
    department: company?.name || departmentFromTable || "Unassigned",
    departmentId: row.department_id,
    companyId: row.company_id ?? null,
    companyName: company?.name || "",
    companyCode: company?.code || "",
    companyColor: company?.color || "#8490a5",
    preparedBy: row.prepared_by_name,
    preparedById: row.prepared_by,
    approvedBy: row.approved_by_name || "",
    approvedById: row.approved_by,
    approvedAt: row.approved_at,
    assignedApproverId: row.assigned_approver_id ?? null,
    assignedApproverName: row.assigned_approver_name || "",
    status: row.status,
  };
};

const NavItem = ({ active, icon: Icon, label, onClick, count }: { active: boolean; icon: typeof LayoutDashboard; label: string; onClick: () => void; count?: number }) => (
  <button onClick={onClick} className={`nav-item ${active ? "nav-item-active" : ""}`}><Icon size={18} strokeWidth={active ? 2.3 : 1.8} /><span>{label}</span>{count !== undefined && <span className="ml-auto rounded-full bg-[#fff4f5] px-2 py-0.5 text-[10px] font-bold text-[#D71939]">{count}</span>}</button>
);

/** "2026-08" -> "August 2026". */
const monthLabel = (month: string) =>
  new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric" }).format(new Date(`${month}-01T00:00:00`));

/** The three months a date input can step through, as `YYYY-MM`. */
const monthValue = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
const shiftMonth = (month: string, by: number) => {
  const [year, index] = month.split("-").map(Number);
  return monthValue(new Date(year, index - 1 + by, 1));
};

/** True when a month is in the past or the current one, never a future month. */
const isSettledMonth = (month: string, today = new Date()) => month <= monthValue(today);

/** The department name that is only ever a placeholder, never a real branch. */
const PLACEHOLDER_DEPARTMENT = "General";

/**
 * The department row to stamp on a voucher someone is creating or importing.
 *
 * A voucher's department is its branch, so this prefers a department row named
 * after that branch. "General" is deliberately never chosen: it is what made
 * every voucher look like it belonged to nowhere, and database/fix_voucher_department.sql
 * rewrites the existing rows off it.
 */
const departmentForBranch = (departments: Department[], branchName: string | undefined): Department | undefined => {
  const named = branchName ? departments.find((department) => department.name === branchName) : undefined;
  return named ?? departments.find((department) => department.name !== PLACEHOLDER_DEPARTMENT) ?? departments[0];
};

const StatusBadge = ({ status }: { status: VoucherStatus }) => <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${statusStyles[status]}`}><span className="h-1.5 w-1.5 rounded-full bg-current" />{status}</span>;

const VoucherPrint = ({ voucher }: { voucher: Voucher }) => (
  <article className="print-voucher">
    <div className="print-brand-row"><Logo height={58} /></div>
    <div className="print-rule" /><h1>PAYMENT VOUCHER</h1>
    <div className="print-meta-grid"><strong>PV NO. <span>{voucher.voucherNo}</span></strong><strong>TPIN: <span>1009055576</span></strong><strong>Date: <span>{formatDate(voucher.date)}</span></strong></div>
    <div className="print-body"><div className="print-line"><b>Amount:</b><span className="amount-box">{formatMoney(voucher.amount, voucher.currency)}</span></div><div className="print-line"><b>Amount paid to:</b><span>{voucher.paidTo}</span></div><div className="print-line print-tall"><b>Amount in words:</b><span>{voucher.amountWords}</span></div><div className="print-line print-tall"><b>Being Payment:</b><span>{voucher.beingPayment}</span></div><div className="print-detail-row"><span><b>Department:</b> {voucher.department}</span><span><b>Payment:</b> {voucher.paymentMethod}</span><span><b>Reference:</b> {voucher.reference || "—"}</span></div></div>
    <div className="print-signatures"><div><b>Prepared by:</b><span>{voucher.preparedBy || "________________________"}</span><em>Signature: __________________</em><small>Date: {formatDate(voucher.date)}</small></div><div><b>Approved by:</b><span>{voucher.approvedBy || "________________________"}</span><em>Signature: __________________</em><small>Date: {voucher.approvedAt ? formatDate(voucher.approvedAt.slice(0, 10)) : "__________________"}</small></div></div>
    <div className="print-footer">Ground Floor, Plot 1146 / 15 Lagos Road, Rhodes Park, P.O Box 50655, Ridgeway, Lusaka · Tel / Fax: +260 211 252 540 · info@longhorn-associates.com</div>
  </article>
);

const Index = () => {
  const routerNavigate = useRouterNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { session, user, profile, needsMigration, setupRequired, profileError, refreshProfile } = useSessionContext();
  const [view, setView] = useState<View>(() => {
    const requested = searchParams.get("view");
    const allowed: View[] = ["pending", "approved", "settings", "help"];
    return allowed.includes(requested as View) ? (requested as View) : "dashboard";
  });
  const [companies, setCompanies] = useState<Company[]>([]);
  const [approvers, setApprovers] = useState<DirectoryMember[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [vouchers, setVouchers] = useState<Voucher[]>([]);
  // True once a fetch has actually produced data, so later refreshes know to keep
  // the existing rows on screen rather than flashing the splash again.
  const hasLoadedOnceRef = useRef(false);

  const [loading, setLoading] = useState(true);
  const [companyFilter, setCompanyFilter] = useState(ALL_COMPANIES);
  const [showComposer, setShowComposer] = useState(false);
  const [showMobileNav, setShowMobileNav] = useState(false);
  // Monthly sign-off, approvers only.
  const [approvalMonth, setApprovalMonth] = useState(monthValue(new Date()));
  const [approvalSelected, setApprovalSelected] = useState<string[]>([]);
  const [approvalSearch, setApprovalSearch] = useState("");
  // There is no department filter: a voucher's department is its branch, and the
// branch picker above already does that job. Filtering by department as well
// would have been a second control that could only ever agree or contradict it.
  const [bulkTarget, setBulkTarget] = useState<{ ids: string[]; label: string } | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [form, setForm] = useState<VoucherForm>(emptyForm);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"All statuses" | VoucherStatus>("All statuses");
  const [selected, setSelected] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  // Rows per page, remembered between visits. One setting covers both archive
  // views, since they page through the same ledger.
  const [pageSize, setPageSize] = useState(() => readStoredPageSize(window.localStorage));
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [approvedSearch, setApprovedSearch] = useState("");
    const [approvedSelected, setApprovedSelected] = useState<string[]>([]);
  const [approvedPage, setApprovedPage] = useState(1);
  const [approvedFrom, setApprovedFrom] = useState("");
  const [approvedTo, setApprovedTo] = useState("");
  const [showImporter, setShowImporter] = useState(false);
  const [importStatus, setImportStatus] = useState<VoucherStatus>("Pending approval");
  const [importRows, setImportRows] = useState<ImportRow[]>([]);
  const [importFile, setImportFile] = useState<ParsedImportFile | null>(null);
  const [importSheetName, setImportSheetName] = useState("");
  const [importNotices, setImportNotices] = useState<string[]>([]);
  const [importError, setImportError] = useState("");
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [parsingImport, setParsingImport] = useState(false);
  const [dragOverImport, setDragOverImport] = useState(false);
  const [importDefaults, setImportDefaults] = useState({
    currency: "ZMW",
    paymentMethod: "Bank transfer",
    department: "",
    includeReceipts: false,
  });
  const [importApproverId, setImportApproverId] = useState("");
  const [activeVoucher, setActiveVoucher] = useState<Voucher | null>(null);
  const [printVouchers, setPrintVouchers] = useState<Voucher[]>([]);
  const [notice, setNotice] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<string[] | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [undoRows, setUndoRows] = useState<DbVoucher[]>([]);
  const [restoring, setRestoring] = useState(false);
  const [undoIds, setUndoIds] = useState<string[]>([]);
  const [settingsName, setSettingsName] = useState("");
  const [settingsEmail, setSettingsEmail] = useState("");
  const [emailPassword, setEmailPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [settingsBusy, setSettingsBusy] = useState<"name" | "email" | "password" | "">("");

  const displayName = profile?.fullName || user?.user_metadata?.full_name || user?.email?.split("@")[0] || "Longhorn user";

  // The loader reads this to seed the composer's "prepared by". It settles twice
  // on a cold load -- first from the auth session, then again once /api/me
  // returns the profile -- so it is held in a ref. Depending on the value itself
  // re-ran the whole fetch a second time and blanked the screen for it.
  const displayNameRef = useRef(displayName);
  displayNameRef.current = displayName;

  const userRole = profile?.role || "preparer";
  const canPrepare = profile?.canPrepare ?? userRole !== "approver";
  const canApprove = profile?.isApprover ?? (userRole === "approver" || userRole === "admin");
  const myCompanyId = profile?.companyId ?? null;
  // The signed-in person's own branch name. A voucher's department is this, so
  // it is resolved once here rather than re-derived at each write path.
  const myBranchLabel = companies.find((company) => company.id === myCompanyId)?.name ?? "";
  const initials = getInitials(displayName);
  const todayLabel = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "2-digit", month: "long", year: "numeric" }).format(new Date());
  const dayHour = new Date().getHours();
  const greeting = dayHour < 5 || dayHour >= 17 ? "Good evening" : dayHour < 12 ? "Good morning" : "Good afternoon";

  const departmentMap = useMemo(() => new Map(departments.map((department) => [department.id, department.name])), [departments]);
  const companyMap = useMemo(() => new Map(companies.map((company) => [company.id, company])), [companies]);
  const toVoucher = (row: DbVoucher) => mapVoucher(row, departmentMap, companyMap);

  useEffect(() => {
    if (!session || !user) return;
    let cancelled = false;
    const loadData = async () => {
      // Only blank the screen on the very first load. After that the data is
      // already on screen, so a refetch must not tear it down again.
      setLoading((current) => (hasLoadedOnceRef.current ? false : current));

      // Companies and the approver list come from the server, which also resolves
      // role. If the multi-company migration has not been run there is nothing to
      // read yet, so fall back quietly and let the banner explain it.
      const [directoryResult, departmentsResponse, vouchersResponse] = await Promise.all([
        fetchDirectory().catch(() => null),
        supabase.from("departments").select("id, name, description").order("name"),
        supabase.from("vouchers").select(VOUCHER_COLUMNS).order("voucher_date", { ascending: false }).order("created_at", { ascending: false }),
      ]);

      // Older databases do not have the company columns yet. Fall back to the old
      // column list so the ledger still loads instead of showing nothing.
      let voucherRows = (vouchersResponse.data || []) as DbVoucher[];
      let voucherError = vouchersResponse.error;
      if (voucherError && /company_id|assigned_approver/i.test(voucherError.message)) {
        const legacy = await supabase.from("vouchers").select("*").order("voucher_date", { ascending: false }).order("created_at", { ascending: false });
        voucherRows = (legacy.data || []) as DbVoucher[];
        voucherError = legacy.error;
      }

      const firstError = departmentsResponse.error || voucherError;
      if (cancelled) return;
      if (firstError) {
        setNotice(firstError.message);
      } else {
        const loadedCompanies = directoryResult?.companies ?? [];
        let loadedDepartments = (departmentsResponse.data || []) as Department[];

        // Make sure every branch has a department row of its own, so a voucher
        // can be stamped with the branch it belongs to. This used to create a
        // single row called "General" instead, which every voucher then carried.
        const missingBranchDepartments = loadedCompanies
          .filter((company) => company.isActive && !loadedDepartments.some((department) => department.name === company.name))
          .map((company) => ({ name: company.name, description: company.description ?? `${company.name} branch` }));
        if (missingBranchDepartments.length) {
          const { data: created } = await supabase
            .from("departments")
            .upsert(missingBranchDepartments, { onConflict: "name" })
            .select("id, name, description");
          if (created?.length) loadedDepartments = [...loadedDepartments, ...(created as Department[])];
        }

        setCompanies(loadedCompanies);
        setApprovers(directoryResult?.approvers ?? []);
        setDepartments(loadedDepartments);

        const nameFor = new Map<string, Company>(loadedCompanies.map((company) => [company.id, company]));
        const mapped = voucherRows.map((row) => mapVoucher(row, new Map(loadedDepartments.map((department) => [department.id, department.name])), nameFor));
        setVouchers(mapped);
        setForm((current) => ({
          ...current,
          preparedBy: current.preparedBy || displayNameRef.current,
        }));

        // No branch department and no other department is not a reason to block anyone.
        // A voucher with no department row still shows its branch, because
        // mapVoucher reads company_id first.
        if (!loadedDepartments.length) setNotice("No branch has a department record yet, so vouchers will be stamped with the branch name only.");
      }
      // Record that real data has landed before clearing `loading`, so the next
      // refetch takes the non-blanking path.
      hasLoadedOnceRef.current = true;
      setLoading(false);
    };
    void loadData();
    return () => {
      cancelled = true;
    };
  // Deliberately keyed on the user id only. Adding `session` back would
    // reintroduce the bug: the session object is replaced on every token refresh,
    // including the automatic one when a backgrounded tab regains focus, and the
    // ledger would refetch and blank the screen each time. `user` is only read as
    // a guard above, and the id already covers it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.id, user?.id]);

  useEffect(() => {
    if (!printVouchers.length) return;
    let cancelled = false;
    const printWhenReady = async () => {
      // Wait for the logo image so it is included in the exported PDF
      const images = Array.from(document.querySelectorAll(".print-only img")) as HTMLImageElement[];
      await Promise.all(
        images.map(
          (img) =>
            img.complete && img.naturalWidth > 0
              ? Promise.resolve()
              : new Promise<void>((resolve) => {
                  const done = () => resolve();
                  img.addEventListener("load", done, { once: true });
                  img.addEventListener("error", done, { once: true });
                  window.setTimeout(done, 3000);
                }),
        ),
      );
      await new Promise((resolve) => window.setTimeout(resolve, 120));
      if (!cancelled) window.print();
    };
    void printWhenReady();
    const clearPrint = () => setPrintVouchers([]);
    window.addEventListener("afterprint", clearPrint);
    return () => {
      cancelled = true;
      window.removeEventListener("afterprint", clearPrint);
    };
  }, [printVouchers]);

  // A preparer only ever receives the vouchers they raised themselves, so a
  // branch filter is only meaningful for approvers and admins, who can see them
  // all and need a way to narrow it down.
  const branchOptions = useMemo(
    () => (canApprove ? companies.filter((company) => company.isActive) : companies.filter((company) => company.id === myCompanyId)),
    [canApprove, companies, myCompanyId],
  );
  const selectedCompanyId = branchOptions.find((company) => company.name === companyFilter)?.id ?? null;
  // Vouchers with no branch set yet still belong in an approver's list, so only
  // drop them once a specific branch has been chosen.
  const matchesBranch = useCallback(
    (voucher: Voucher) => !selectedCompanyId || !voucher.companyId || voucher.companyId === selectedCompanyId,
    [selectedCompanyId],
  );

  const pendingCount = vouchers.filter((voucher) => voucher.status === "Pending approval").length;
  const approvedCount = vouchers.filter((voucher) => voucher.status === "Approved").length;
  const totalValue = vouchers.reduce((sum, voucher) => sum + voucher.amount, 0);
  const latestMonth = vouchers.reduce((max, voucher) => (voucher.date.slice(0, 7) > max ? voucher.date.slice(0, 7) : max), "");
  const latestMonthTotal = latestMonth ? vouchers.filter((voucher) => voucher.date.slice(0, 7) === latestMonth).reduce((sum, voucher) => sum + voucher.amount, 0) : 0;
  const latestMonthLabel = latestMonth ? new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric" }).format(new Date(`${latestMonth}-01T00:00:00`)) : "";
  const approvalRate = vouchers.length ? Math.round((approvedCount / vouchers.length) * 100) : 0;
  const filteredVouchers = useMemo(() => vouchers.filter((voucher) => voucher.status !== "Approved").filter((voucher) => {
    const searchable = `${voucher.voucherNo} ${voucher.paidTo} ${voucher.beingPayment} ${voucher.reference}`.toLowerCase();
    return matchesBranch(voucher) && searchable.includes(search.toLowerCase()) && (statusFilter === "All statuses" || voucher.status === statusFilter) && (!dateFrom || voucher.date >= dateFrom) && (!dateTo || voucher.date <= dateTo);
  }), [dateFrom, dateTo, matchesBranch, search, statusFilter, vouchers]);

  const pendingPages = Math.max(1, Math.ceil(filteredVouchers.length / pageSize));
  const safePage = Math.min(page, pendingPages);
  const pagedVouchers = filteredVouchers.slice((safePage - 1) * pageSize, safePage * pageSize);
  const pageSelected = pagedVouchers.length > 0 && pagedVouchers.every((voucher) => selected.includes(voucher.id));
  const everyFilteredSelected = filteredVouchers.length > 0 && filteredVouchers.every((voucher) => selected.includes(voucher.id));
  const selectedVouchers = vouchers.filter((voucher) => selected.includes(voucher.id));
  const selectedTotal = selectedVouchers.reduce((sum, voucher) => sum + voucher.amount, 0);

  /**
   * Applies a new rows-per-page and returns both views to the first page.
   *
   * Without the reset a reader on page 8 of a 10-row view who switches to 200
   * would land on an empty page, because page 8 of one page does not exist.
   */
  const changePageSize = (value: number) => {
    setPageSize(value);
    setPage(1);
    setApprovedPage(1);
    storePageSize(value, window.localStorage);
  };
  const deleteTargetVouchers = deleteTarget ? vouchers.filter((voucher) => deleteTarget.includes(voucher.id)) : [];
  const deleteTargetTotal = deleteTargetVouchers.reduce((sum, voucher) => sum + voucher.amount, 0);
  const deleteTargetHasApproved = deleteTargetVouchers.some((voucher) => voucher.status === "Approved");

  const updateField = (field: keyof VoucherForm, value: string) => setForm((current) => ({ ...current, [field]: field === "amount" ? Number(value) : value }));
  const amountWords = amountToWords(form.amount, form.currency);

  /**
   * Which voucher numbers are already used, per month.
   *
   * This has to come from the server rather than from the rows on screen. Each
   * preparer now has a workspace of their own, so the ledger only holds their own
   * vouchers: numbering from that would restart at 1 for every preparer, and two
   * people paying on the same day would keep picking the same number, which the
   * unique constraint then refuses. The server reads past row level security,
   * because seeing those numbers is the entire point.
   *
   * The rows already loaded are folded in as well. They are a subset of what the
   * server returns, and they keep the answer usable in the rare case where the
   * service key is not configured and the fallback below cannot reach anything
   * either.
   */
  const loadTakenNumbers = async (dates: string[]): Promise<Map<string, { numbers: string[]; seq: number }>> => {
    const pool = new Map<string, { numbers: string[]; seq: number }>();
    const record = (month: string, voucherNo: string) => {
      if (!month || !voucherNo) return;
      const entry = pool.get(month) ?? { numbers: [], seq: 0 };
      entry.numbers.push(voucherNo);
      // The trailing digits are the sequence, so the next free number is one
      // past the highest already used in that month.
      const match = /(\d{4})\s*$/.exec(voucherNo);
      if (match) entry.seq = Math.max(entry.seq, parseInt(match[1], 10));
      pool.set(month, entry);
    };

    vouchers.forEach((voucher) => record(voucher.date.slice(0, 7), voucher.voucherNo.trim()));

    try {
      const result = await fetchTakenVoucherNumbers(dates);
      Object.entries(result.numbersByMonth).forEach(([month, numbers]) => {
        numbers.forEach((voucherNo) => record(month, String(voucherNo).trim()));
      });
      return pool;
    } catch {
      // The service key is not set, so the server cannot read past row level
      // security. Fall back to the caller's own visible rows, which is what this
      // did before per-preparer workspaces existed. Degraded rather than broken:
      // a clash is refused by the unique constraint and reported plainly.
    }

    const months = [...new Set(dates.map((date) => date.slice(0, 7)))].sort();
    if (months.length) {
      const lastYear = Number(months[months.length - 1].slice(0, 4));
      const lastMonth = Number(months[months.length - 1].slice(5, 7));
      const to = `${lastYear}-${String(lastMonth + 1).padStart(2, "0")}-01`;
      const { data } = await supabase
        .from("vouchers")
        .select("voucher_no, voucher_date")
        .gte("voucher_date", `${months[0]}-01`)
        .lt("voucher_date", to);
      ((data || []) as { voucher_no: string; voucher_date: string }[]).forEach((row) =>
        record(String(row.voucher_date).slice(0, 7), String(row.voucher_no).trim()),
      );
    }
    return pool;
  };

  const nextVoucherNo = async (dateStr: string, taken: Set<string>): Promise<string> => {
    const d = new Date(`${dateStr}T00:00:00`);
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const pool = await loadTakenNumbers([dateStr]);
    const entry = pool.get(dateStr.slice(0, 7));
    let seq = entry?.seq ?? 0;
    // Numbers from the server, plus the ones this screen is already holding, so a
    // voucher saved a moment ago in the same tab cannot be handed out twice.
    const used = new Set([...(entry?.numbers ?? []), ...taken]);
    for (let attempt = 0; attempt < 50; attempt++) {
      seq += 1;
      const candidate = `${dd}/${mm}/${String(seq).padStart(4, "0")}`;
      if (!used.has(candidate)) {
        used.add(candidate);
        return candidate;
      }
    }
    const fallback = `${dd}/${mm}/${Date.now().toString().slice(-4)}`;
    used.add(fallback);
    return fallback;
  };

  const createVoucher = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canPrepare) { setNotice("Voucher creation is reserved for preparers."); return; }
    // The department follows the branch, so it is not something to choose and not
    // something to refuse a voucher over. The composer's old code demanded a
    // department nobody could pick, because there was no field for it.
    const selectedDepartment = departmentForBranch(departments, myBranchLabel);
    const chosenApprover = approvers.find((member) => member.id === form.approverId);
    if (!user || !form.amount || !form.paidTo.trim() || !form.beingPayment.trim() || !form.preparedBy.trim()) {
      setNotice("Add the amount, payee, payment purpose and prepared by name to continue.");
      return;
    }
    // The approver is nominated in the composer so the voucher lands with the
    // right signatory straight away, instead of waiting for someone to route it.
    if (!chosenApprover || chosenApprover.role !== "approver") {
      setNotice("Choose who should approve this voucher before saving it.");
      return;
    }
    if (!approvers.some((member) => member.role === "approver")) {
      setNotice("No approvers exist yet. Ask a workspace admin to promote someone to approver.");
      return;
    }
    const taken = new Set(vouchers.map((v) => v.voucherNo));
    let data: DbVoucher | null = null;
    let error: { message: string; code?: string } | null = null;
    for (let attempt = 0; attempt < 3 && !data; attempt++) {
      const voucherNo = await nextVoucherNo(form.date, taken);
      // Admins are never offered here: they run the workspace rather than sign off
      // its payments. Filtered again below so a stale directory cannot slip one in.
      const eligible = approvers.filter((member) => member.role === "approver");
      const result = await supabase.from("vouchers").insert({
        voucher_no: voucherNo,
      voucher_date: form.date,
      amount: form.amount,
      currency: form.currency,
      amount_in_words: amountWords,
      paid_to: form.paidTo.trim(),
      being_payment: form.beingPayment.trim(),
      payment_method: form.paymentMethod,
      reference: form.reference.trim() || null,
      department_id: selectedDepartment?.id ?? null,
      company_id: myCompanyId,
      prepared_by: user.id,
      prepared_by_name: form.preparedBy.trim(),
      assigned_approver_id: eligible.some((member) => member.id === chosenApprover.id) ? chosenApprover.id : null,
      assigned_approver_name: eligible.some((member) => member.id === chosenApprover.id) ? chosenApprover.fullName : null,
      status: "Pending approval",
      }).select(VOUCHER_COLUMNS).single();
      if (!result.error) {
        data = result.data as DbVoucher;
        error = null;
      } else if (result.error.code === "23505") {
        error = result.error;
      } else {
        error = result.error;
        break;
      }
    }
    if (error || !data) {
      setNotice(explainWriteError(error));
      return;
    }
    const mapped = mapVoucher(data, departmentMap, companyMap);
    setVouchers((current) => [mapped, ...current]);
    setForm({ ...emptyForm, preparedBy: displayName });
    setShowComposer(false);
    setView("pending");
    setSearchParams({ view: "pending" }, { replace: true });
    setNotice(
      `${mapped.voucherNo} was saved and sent to ${chosenApprover.fullName} for approval.` +
        (chosenApprover.companyName ? ` at ${chosenApprover.companyName}.` : "."),
    );
  };

  const toggleSelected = (id: string) => setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  const toggleAll = () => setSelected((current) => pagedVouchers.every((voucher) => current.includes(voucher.id)) ? current.filter((id) => !pagedVouchers.some((voucher) => voucher.id === id)) : [...current, ...pagedVouchers.filter((voucher) => !current.includes(voucher.id)).map((voucher) => voucher.id)]);

  /** Extends the selection from the visible page to every row matching the filters. */
  const toggleEveryFiltered = () =>
    setSelected((current) =>
      everyFilteredSelected
        ? current.filter((id) => !filteredVouchers.some((voucher) => voucher.id === id))
        : Array.from(new Set([...current, ...filteredVouchers.map((voucher) => voucher.id)])),
    );

  const clearSelected = () => setSelected([]);

  /**
   * Hands a set of vouchers to the print job.
   *
   * Large jobs are refused with an explanation rather than attempted: each voucher
   * is a whole A4 sheet, and asking the browser to render several hundred at
   * once stalls the print dialog badly enough to look like a crash. The reader is
   * told to narrow the date range instead.
   */
  const printVoucherSet = (chosen: Voucher[]) => {
    const blocked = printBlocker(chosen.length);
    if (blocked) { setNotice(blocked); return; }
    setNotice("");
    setPrintVouchers(chosen);
  };

  const exportSelected = () => printVoucherSet(selectedVouchers);

  const requestDelete = (ids: string[]) => {
    if (!ids.length) return;
    if (!canPrepare) { setNotice("Deleting records is reserved for preparers."); return; }
    setDeleteTarget(ids);
  };

  /** Turns a raw Postgres error into something the user can act on. */
const explainDeleteError = (error: { message?: string } | null): string => {
  const message = error?.message || "";
  if (/permission denied|row-level security|row level security/i.test(message)) {
    return "Your role is not allowed to delete vouchers yet. Run database/vouchers_rls_policies.sql in the Supabase SQL editor to enable it.";
  }
  if (/violates foreign key|is still referenced/i.test(message)) {
    return "That record is referenced somewhere else, so it cannot be deleted yet.";
  }
  return message ? `Could not delete: ${message}` : "Could not delete those records.";
};

  const confirmDelete = async () => {
    const ids = deleteTarget ?? [];
    setDeleteTarget(null);
    if (!ids.length) return;
    setDeleting(true);
    // Read the rows first so Undo can put them back exactly as they were.
    const { data: raw } = await supabase.from("vouchers").select("*").in("id", ids);
    const { error } = await supabase.from("vouchers").delete().in("id", ids);
    setDeleting(false);
    if (error) { setUndoRows([]); setUndoIds([]); setNotice(explainDeleteError(error)); return; }
    setVouchers((current) => current.filter((voucher) => !ids.includes(voucher.id)));
    setSelected((current) => current.filter((id) => !ids.includes(id)));
    setApprovedSelected((current) => current.filter((id) => !ids.includes(id)));
    setPrintVouchers((current) => current.filter((voucher) => !ids.includes(voucher.id)));
    setActiveVoucher((current) => (current && ids.includes(current.id) ? null : current));
    // Only offer Undo for rows we actually asked to delete, never for anything
    // else that happened to come back from the read.
    const restorable = ((raw || []) as DbVoucher[]).filter((row) => row && ids.includes(row.id));
    setUndoRows(restorable);
    setUndoIds(ids);
    setNotice(`${ids.length} voucher${ids.length === 1 ? "" : "s"} deleted.`);
  };

  const undoDelete = async () => {
    const rows = undoRows.filter((row) => undoIds.includes(row.id));
    if (!rows.length || restoring) { setUndoRows([]); setUndoIds([]); return; }
    setRestoring(true);
    // Send only the columns the app owns, so this stays independent of
    // database-side columns such as created_at.
    const payload = rows.map((row) => ({
      voucher_no: row.voucher_no,
      voucher_date: row.voucher_date,
      amount: row.amount,
      currency: row.currency,
      amount_in_words: row.amount_in_words,
      paid_to: row.paid_to,
      being_payment: row.being_payment,
      payment_method: row.payment_method,
      reference: row.reference ?? null,
      department_id: row.department_id,
      company_id: row.company_id ?? null,
      prepared_by: row.prepared_by,
      prepared_by_name: row.prepared_by_name,
      approved_by: row.approved_by ?? null,
      approved_by_name: row.approved_by_name ?? null,
      approved_at: row.approved_at ?? null,
      assigned_approver_id: row.assigned_approver_id ?? null,
      assigned_approver_name: row.assigned_approver_name ?? null,
      status: row.status,
    }));
    const { data, error } = await supabase.from("vouchers").insert(payload).select(VOUCHER_COLUMNS);
    setRestoring(false);
    setUndoRows([]);
    setUndoIds([]);
    if (error) { setNotice(`Could not restore those records: ${error.message}`); return; }
    const restored = ((data || []) as DbVoucher[]).map((item) => mapVoucher(item, departmentMap, companyMap));
    setVouchers((current) => [...restored, ...current]);
    setNotice(`${restored.length} voucher${restored.length === 1 ? "" : "s"} restored.`);
  };

  const dismissNotice = () => {
    setNotice("");
    setUndoRows([]);
    setUndoIds([]);
  };

  const approveVoucher = async (id: string) => {
    if (!user) return;
    if (!canApprove) { setNotice("Voucher approval is reserved for approvers."); return; }
    // approved_at is the voucher's own date, so the printed sheet and the ledger
    // agree. approved_recorded_at keeps the real moment, and the database trigger
    // sets it, so it is deliberately not sent from here.
    const { data, error } = await supabase.from("vouchers").update({ status: "Approved", approved_by: user.id, approved_by_name: displayName, approved_at: `${vouchers.find((voucher) => voucher.id === id)?.date ?? new Date().toISOString().slice(0, 10)}T00:00:00Z` }).eq("id", id).select(VOUCHER_COLUMNS).single();
    if (error) {
      setNotice(error.message);
      return;
    }
    const updated = mapVoucher(data as DbVoucher, departmentMap, companyMap);
    setVouchers((current) => current.map((voucher) => voucher.id === id ? updated : voucher));
    setActiveVoucher(updated);
    setNotice("Voucher approved. It is ready to export for signing.");
  };

  /**
 * Turns a Postgres refusal into something the user can act on.
 *
 * The duplicate guard and the unique voucher_no both raise 23505, so the code
 * alone cannot tell them apart; the message text is what identifies them.
 */
  const explainWriteError = (error: { message?: string; code?: string } | null): string => {
    const message = error?.message || "";
    if (/already exists \(/.test(message) || /already been recorded/i.test(message)) {
      // The guard names the voucher it clashed with, so keep that part.
      const clash = /\(([^)]+)\)/.exec(message);
      return clash
        ? `That payment looks like it has already been entered, on voucher ${clash[1]}. Check the date and amount, or change one of them if this really is a separate payment.`
        : "That payment looks like it has already been entered. Check the date and amount, or change one of them if this really is a separate payment.";
    }
    if (/invoice reference/i.test(message)) {
      return "That invoice reference has already been used in this branch. Each invoice should only be paid once.";
    }
    if (/duplicate key value violates unique constraint/i.test(message)) {
      return "That voucher number is already taken. Close the form and try again to get the next one.";
    }
    if (/permission denied|row-level security|row level security/i.test(message)) {
      return "Your role is not allowed to do that. Ask a workspace admin if you expected to be able to.";
    }
    return message ? `Could not save: ${message}` : "Could not save that record.";
  };

  /* ------------------------------------------------- monthly bulk approval */
  const monthsWithVouchers = useMemo(() => {
    const seen = new Set<string>();
    for (const voucher of vouchers) seen.add(voucher.date.slice(0, 7));
    return [...seen].sort().reverse();
  }, [vouchers]);

  // Point at the newest month that has something waiting, rather than a month
  // that could be empty.
  useEffect(() => {
    if (!canApprove || !monthsWithVouchers.length) return;
    const hasWaiting = monthsWithVouchers.some(
      (month) => month === approvalMonth && vouchers.some((voucher) => voucher.date.slice(0, 7) === month && voucher.status === "Pending approval"),
    );
    if (!hasWaiting) {
      const firstWaiting = monthsWithVouchers.find((month) => vouchers.some((voucher) => voucher.date.slice(0, 7) === month && voucher.status === "Pending approval"));
      setApprovalMonth(firstWaiting ?? approvalMonth);
    }
  }, [approvalMonth, canApprove, monthsWithVouchers, vouchers]);

  const approvalVouchers = useMemo(() => {
    const term = approvalSearch.trim().toLowerCase();
    return vouchers.filter((voucher) => {
      if (voucher.status !== "Pending approval") return false;
      if (voucher.date.slice(0, 7) !== approvalMonth) return false;
      if (!matchesBranch(voucher)) return false;
      
      if (!term) return true;
      return `${voucher.voucherNo} ${voucher.paidTo} ${voucher.beingPayment} ${voucher.reference} ${voucher.preparedBy} ${voucher.assignedApproverName}`
        .toLowerCase()
        .includes(term);
    });
  }, [approvalMonth, approvalSearch, matchesBranch, vouchers]);

  const approvalTotal = approvalVouchers.reduce((sum, voucher) => sum + voucher.amount, 0);
  // Only allow ticking what can actually be approved, so the count always matches
  // what the button will do.
  const approvalSelectable = approvalVouchers.map((voucher) => voucher.id);
  const approvalSelectedCount = approvalSelectable.filter((id) => approvalSelected.includes(id)).length;
  const allApprovalSelected = approvalSelectable.length > 0 && approvalSelectedCount === approvalSelectable.length;
  const approvalSelectedVouchers = approvalVouchers.filter((voucher) => approvalSelected.includes(voucher.id));
  const approvalSelectedTotal = approvalSelectedVouchers.reduce((sum, voucher) => sum + voucher.amount, 0);
  // Only completed months can be signed off in bulk: the current month is still
  // collecting vouchers, so approving it wholesale would be premature.
  const approvalMonthSettled = isSettledMonth(approvalMonth) && approvalMonth !== monthValue(new Date());

  const toggleApprovalSelected = (id: string) =>
    setApprovalSelected((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));

  const toggleAllApprovalSelected = () =>
    setApprovalSelected((current) =>
      allApprovalSelected
        ? current.filter((id) => !approvalSelectable.includes(id))
        : Array.from(new Set([...current, ...approvalSelectable])),
    );

  const clearApprovalSelection = () => setApprovalSelected([]);

  const requestBulkApprove = (ids: string[]) => {
    if (!canApprove) { setNotice("Voucher approval is reserved for approvers."); return; }
    if (!ids.length) return;
    if (!approvalMonthSettled) {
      setNotice(`${monthLabel(approvalMonth)} is still open. Approve vouchers one at a time until the month closes.`);
      return;
    }
    const value = approvalVouchers.filter((voucher) => ids.includes(voucher.id)).reduce((sum, voucher) => sum + voucher.amount, 0);
    setBulkTarget({ ids, label: `${ids.length} voucher${ids.length === 1 ? "" : "s"} from ${monthLabel(approvalMonth)} worth ${formatMoney(value)}` });
  };

  /**
   * Drops ticked rows that have left the visible set, e.g. after changing the
   * month or a filter. `approvalSelectable` is rebuilt every render, so the ids
   * are derived from the memoised list inside the effect instead of depending on
   * the array identity.
   */
  useEffect(() => {
    const visibleIds = new Set(approvalVouchers.map((voucher) => voucher.id));
    setApprovalSelected((current) => {
      const next = current.filter((id) => visibleIds.has(id));
      return next.length === current.length ? current : next;
    });
  }, [approvalVouchers]);

  const confirmBulkApprove = async () => {
    if (!bulkTarget || bulkBusy) return;
    const ids = bulkTarget.ids;
    setBulkTarget(null);
    if (!ids.length) return;
    setBulkBusy(true);
    setNotice("");
    try {
      const result = await bulkApproveVouchers(ids, approvalMonth);
      // Reflect the result locally so the list updates without a reload. Each
      // voucher keeps its own date as the approval date, matching what the
      // database now stores, so the printed sheet and the list agree.
      const approvedIds = new Set(result.approved.map((row) => row.id));
      setVouchers((current) =>
        current.map((voucher) =>
          approvedIds.has(voucher.id)
            ? { ...voucher, status: "Approved", approvedBy: result.approvedBy, approvedById: user?.id ?? null, approvedAt: `${voucher.date}T00:00:00Z` }
            : voucher,
        ) as Voucher[],
      );
      setApprovalSelected([]);

      const parts = [`${result.approvedCount} voucher${result.approvedCount === 1 ? "" : "s"} approved.`];
      if (result.skipped.length) parts.push(`${result.skipped.length} skipped: ${result.skipped.map((row) => `${row.voucherNo ?? "one"} (${row.reason})`).join(", ")}.`);
      if (result.failed.length) parts.push(`${result.failed.length} could not be saved.`);
      setNotice(parts.join(" "));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Those vouchers could not be approved.");
    } finally {
      setBulkBusy(false);
    }
  };

  const openCreate = () => {
    if (!canPrepare) { setNotice("Voucher creation is reserved for preparers."); return; }
    setNotice("");
    // Default to an approver from the preparer's own branch, since that is who
    // signs off their payments nine times out of ten.
    const suggested = approvers.find((member) => member.companyId === myCompanyId) ?? approvers[0];
    setForm({
      ...emptyForm,
      date: new Date().toISOString().slice(0, 10),
      preparedBy: displayName,
      approverId: suggested?.id ?? "",
    });
    setShowComposer(true);
  };
  const navigate = (nextView: NavKey) => {
    if (nextView === "admin") { routerNavigate("/admin"); return; }
    if (nextView === "help") { setView("help"); setSearchParams({ view: "help" }, { replace: true }); setShowMobileNav(false); return; }
    // Approvers land on monthly sign-off, since that is their main job.
    if (nextView === "approvals" && !canApprove) {
      setNotice("Monthly sign-off is for approvers and admins.");
      return;
    }
    if (nextView === "settings") {
      setSettingsName((current) => current || profile?.fullName || "");
      setSettingsEmail((current) => current || user?.email || "");
    }
    setView(nextView);
    setSearchParams(nextView === "dashboard" ? {} : { view: nextView }, { replace: true });
  };
  const saveDisplayName = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!user) return;
    const name = settingsName.trim();
    if (!name) { setNotice("Enter a display name first."); return; }
    setSettingsBusy("name");
    setNotice("");
    const { error } = await supabase.from("profiles").update({ full_name: name }).eq("id", user.id);
    if (error) {
      setNotice(`Could not save name: ${error.message}`);
    } else {
      await supabase.auth.updateUser({ data: { full_name: name } });
      // Role and company are server-owned, so ask the server for the new name.
      await refreshProfile();
      setNotice("Display name updated.");
    }
    setSettingsBusy("");
  };
  /**
   * Changes the sign-in email.
   *
   * Supabase's own email change only sends a confirmation link and leaves the stored
   * address untouched until it is clicked. On this project's mail setup that link
   * never arrives, so the address simply never changed. The server applies it
   * directly instead, and asks for the current password first.
   */
  const saveEmail = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextEmail = settingsEmail.trim();
    if (!nextEmail || nextEmail === user?.email) { setNotice("Enter a new email address."); return; }
    if (!emailPassword) { setNotice("Enter your current password to confirm the email change."); return; }
    setSettingsBusy("email");
    setNotice("");
    try {
      const result = await changeOwnEmail(nextEmail, emailPassword);
      setEmailPassword("");
      setSettingsEmail(result.email);
      // The session still belongs to this person, but the address it reports has
      // moved, so re-read it rather than leaving the old one on screen.
      await supabase.auth.refreshSession();
      await refreshProfile();
      setNotice(`Sign-in email changed to ${result.email}. Use it next time you sign in.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not change that email address.");
    } finally {
      setSettingsBusy("");
    }
  };
  const savePassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (newPassword.length < 6) { setNotice("Password must be at least 6 characters."); return; }
    if (newPassword !== confirmPassword) { setNotice("Passwords do not match."); return; }
    setSettingsBusy("password");
    setNotice("");
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setSettingsBusy("");
    if (error) { setNotice(error.message); return; }
    setNewPassword("");
    setConfirmPassword("");
    setNotice("Password updated. Use it next time you sign in.");
  };
  type ImportRow = {
    key: string;
    sourceRow: number;
    date: string;
    /** Amount stays as text so a half-typed edit is never thrown away. */
    amount: string;
    paidTo: string;
    beingPayment: string;
    currency: string;
    paymentMethod: string;
    reference: string;
    department: string;
    voucherNo: string;
    direction: ImportDirection;
    included: boolean;
    skipped: boolean;
    skipNote: string;
    warnings: string[];
  };

  /** First blocking problem with a row, or "" when it can be imported. */
  const importRowError = (row: ImportRow): string => {
    if (row.skipped) return row.skipNote;
    if (!row.date) return "Missing date";
    const amount = Number(String(row.amount).replace(/[, ]/g, ""));
    if (!String(row.amount).trim() || !Number.isFinite(amount) || amount <= 0) return "Amount must be greater than zero";
    if (!row.paidTo.trim()) return "Missing payee";
    if (!row.beingPayment.trim()) return "Missing payment purpose";
    return "";
  };

  const importRowAmount = (row: ImportRow): number =>
    Math.round(Number(String(row.amount).replace(/[, ]/g, "")) * 100) / 100 || 0;

  const IMPORT_CHUNK = 100;

  const approvedVouchers = useMemo(() => vouchers.filter((voucher) => voucher.status === "Approved").filter((voucher) => {
    const searchable = `${voucher.voucherNo} ${voucher.paidTo} ${voucher.beingPayment} ${voucher.reference}`.toLowerCase();
    return matchesBranch(voucher) && searchable.includes(approvedSearch.toLowerCase()) && (!approvedFrom || voucher.date >= approvedFrom) && (!approvedTo || voucher.date <= approvedTo);
  }), [approvedFrom, approvedSearch, approvedTo, matchesBranch, vouchers]);

  const approvedPages = Math.max(1, Math.ceil(approvedVouchers.length / pageSize));
  const safeApprovedPage = Math.min(approvedPage, approvedPages);
  const pagedApproved = approvedVouchers.slice((safeApprovedPage - 1) * pageSize, safeApprovedPage * pageSize);
  const approvedPageSelected = pagedApproved.length > 0 && pagedApproved.every((voucher) => approvedSelected.includes(voucher.id));
  const everyApprovedSelected = approvedVouchers.length > 0 && approvedVouchers.every((voucher) => approvedSelected.includes(voucher.id));
  const approvedSelectedVouchers = approvedVouchers.filter((voucher) => approvedSelected.includes(voucher.id));
  const approvedSelectedTotal = approvedSelectedVouchers.reduce((sum, voucher) => sum + voucher.amount, 0);

  const toggleApproved = (id: string) => setApprovedSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  const toggleAllApproved = () => setApprovedSelected((current) => pagedApproved.every((voucher) => current.includes(voucher.id)) ? current.filter((id) => !pagedApproved.some((voucher) => voucher.id === id)) : [...current, ...pagedApproved.filter((voucher) => !current.includes(voucher.id)).map((voucher) => voucher.id)]);
  const toggleEveryApproved = () =>
    setApprovedSelected((current) =>
      everyApprovedSelected
        ? current.filter((id) => !approvedVouchers.some((voucher) => voucher.id === id))
        : Array.from(new Set([...current, ...approvedVouchers.map((voucher) => voucher.id)])),
    );
  const exportApproved = () => printVoucherSet(approvedSelectedVouchers);

  const closeImporter = () => {
    if (importing) return;
    setShowImporter(false);
    setImportRows([]);
    setImportFile(null);
    setImportError("");
    setImportNotices([]);
    setImportSheetName("");
  };

  const openImporter = (status: VoucherStatus) => {
    if (!canPrepare) { setNotice("Bulk import is reserved for preparers."); return; }
    setImportStatus(status);
    // The department is the preparer's own branch, so there is nothing to choose
    // here. The picker defaulted to departments[0], which is how imported rows
    // came out as "General".
    setImportRows([]);
    setImportFile(null);
    setImportError("");
    setImportNotices([]);
    setImportSheetName("");
    setShowImporter(true);
  };

  const buildImportRows = (sheet: ParsedImportSheet | undefined, defaults: typeof importDefaults): ImportRow[] =>
    (sheet?.rows ?? []).map((parsed) => {
      const row: ImportRow = {
        key: parsed.key,
        sourceRow: parsed.sourceRow,
        date: parsed.date,
        amount: parsed.amount ? String(parsed.amount) : "",
        paidTo: parsed.paidTo,
        beingPayment: parsed.beingPayment,
        currency: parsed.currency || defaults.currency,
        paymentMethod: parsed.paymentMethod || defaults.paymentMethod,
        reference: parsed.reference,
        department: parsed.department || defaults.department,
        voucherNo: parsed.voucherNo,
        direction: parsed.direction,
        included: false,
        skipped: parsed.skipped,
        skipNote: parsed.skipNote,
        warnings: parsed.warnings,
      };
      row.included = !row.skipped && !importRowError(row) && (row.direction !== "receipt" || defaults.includeReceipts);
      return row;
    });

  const loadSheetIntoImport = (sheet: ParsedImportSheet | undefined) => {
    if (!sheet) {
      setImportRows([]);
      return;
    }
    setImportSheetName(sheet.name);
    setImportRows(buildImportRows(sheet, importDefaults));
  };

  const importFromFile = async (file: File) => {
    setImportError("");
    setImportNotices([]);
    setParsingImport(true);
    try {
      const parsed = await parseImportFile(file);
      const usable = parsed.sheets.filter((sheet) => !sheet.error);
      setImportFile(parsed);
      setImportNotices([
        ...parsed.warnings,
        ...parsed.sheets.filter((sheet) => sheet.error).map((sheet) => `Sheet "${sheet.name}" was skipped. ${sheet.error}`),
      ]);
      if (!usable.length) {
        setImportRows([]);
        setImportSheetName("");
        setImportError(parsed.sheets.find((sheet) => sheet.error)?.error || "No sheets in this file could be read.");
        return;
      }
      // Prefer the sheet that actually holds transactions.
      const best = usable.reduce((a, b) => (b.rows.length > a.rows.length ? b : a));
      loadSheetIntoImport(best);
    } catch (error) {
      setImportRows([]);
      setImportFile(null);
      setImportSheetName("");
      setImportError(error instanceof Error ? error.message : "That file could not be read. Try saving it as .xlsx or .csv and import again.");
    } finally {
      setParsingImport(false);
    }
  };

  const handleImportFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) await importFromFile(file);
  };

  const switchImportSheet = (name: string) => {
    setImportSheetName(name);
    setImportRows(buildImportRows(importFile?.sheets.find((sheet) => sheet.name === name), importDefaults));
  };

  const patchImportRow = (key: string, patch: Partial<ImportRow>) =>
    setImportRows((rows) => rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));

  const patchImportDefaults = (field: "currency" | "paymentMethod" | "department", value: string) => {
    const previous = importDefaults[field];
    // Rows still carrying the previous default follow the change; rows that
    // supplied their own value in the file are left alone.
    setImportRows((rows) => rows.map((row) => (row[field] === previous || !row[field] ? { ...row, [field]: value } : row)));
    setImportDefaults((current) => ({ ...current, [field]: value }));
  };

  const setImportReceipts = (include: boolean) => {
    setImportDefaults((current) => ({ ...current, includeReceipts: include }));
    setImportRows((rows) =>
      rows.map((row) => {
        if (row.skipped) return row;
        if (row.direction === "receipt") return { ...row, included: include };
        return { ...row, included: !importRowError(row) };
      }),
    );
  };

  const selectableImportRows = importRows.filter((row) => !row.skipped && !importRowError(row));
  const allImportRowsSelected = selectableImportRows.length > 0 && selectableImportRows.every((row) => row.included);
  const importSheet = importFile?.sheets.find((sheet) => sheet.name === importSheetName);
  const selectedImportRows = importRows.filter((row) => row.included && !importRowError(row));
  const selectedImportTotal = selectedImportRows.reduce((sum, row) => sum + importRowAmount(row), 0);
  const importRowProblemCount = importRows.filter((row) => !row.skipped && importRowError(row)).length;
  const importSkippedCount = importRows.filter((row) => row.skipped).length;
  const receiptCount = importRows.filter((row) => row.direction === "receipt" && !row.skipped).length;

  const toggleAllImportRows = () => {
    const next = !allImportRowsSelected;
    setImportRows((rows) => rows.map((row) => (!row.skipped && !importRowError(row) ? { ...row, included: next } : row)));
  };

  /**
   * Builds the voucher numbers for a whole import up front: one request for the
   * affected months instead of one round trip per row.
   *
   * The numbers come from loadTakenNumbers, so an import cannot hand out a
   * number another preparer has already used on the same day.
   */
  const reserveVoucherNumbers = async (dates: string[]) => {
    const taken = new Set<string>();
    const seqByMonth = new Map<string, number>();
    (await loadTakenNumbers(dates)).forEach((entry, month) => {
      entry.numbers.forEach((voucherNo) => taken.add(voucherNo));
      seqByMonth.set(month, entry.seq);
    });
    return { taken, seqByMonth };
  };

  const takeVoucherNumber = (dateIso: string, pool: { taken: Set<string>; seqByMonth: Map<string, number> }): string => {
    const key = dateIso.slice(0, 7);
    const [, month, day] = dateIso.split("-");
    let seq = pool.seqByMonth.get(key) ?? 0;
    for (let attempt = 0; attempt < 500; attempt++) {
      seq += 1;
      const candidate = `${day}/${month}/${String(seq).padStart(4, "0")}`;
      if (!pool.taken.has(candidate)) {
        pool.taken.add(candidate);
        pool.seqByMonth.set(key, seq);
        return candidate;
      }
    }
    const fallback = `IMP/${dateIso}/${Date.now().toString().slice(-6)}`;
    pool.taken.add(fallback);
    return fallback;
  };

  const reserveVoucherNumber = (row: ImportRow, pool: { taken: Set<string>; seqByMonth: Map<string, number> }): string => {
    const fromFile = row.voucherNo.trim();
    // A voucher number carried in the file wins, unless it is already taken.
    if (fromFile && !pool.taken.has(fromFile)) {
      pool.taken.add(fromFile);
      return fromFile;
    }
    return takeVoucherNumber(row.date, pool);
  };

  const confirmImport = async () => {
    if (!user) return;
    const valid = importRows.filter((row) => row.included && !importRowError(row));
    if (!valid.length) {
      setImportError("Nothing to import. Tick at least one row that has a date, an amount, a payee and a payment purpose.");
      return;
    }
    // A voucher's department is its branch, so the import stamps the preparer's own
    // branch. It used to fall back to "General", which is why every one of the 780
    // bulk-imported vouchers came out reading "General" instead of "Longhorn
    // Associates" even though company_id was correct on every row.
    const branchDept = departmentForBranch(departments, myBranchLabel);

    setImporting(true);
    setImportProgress(0);
    setImportError("");
    try {
      const pool = await reserveVoucherNumbers(valid.map((row) => row.date));
      const approved = importStatus === "Approved";
      // Bulk rows all go to one approver, so the importer asks for one up front.
      const importApprover = approvers.find((member) => member.id === importApproverId)
        ?? approvers.find((member) => member.companyId === myCompanyId)
        ?? approvers[0];
      if (!importApprover) {
        // Every status needs an approver on record, and importing as "Approved"
        // credits that approver, so the picker is required either way.
        setImportError("Choose who should approve the imported rows, or ask an admin to promote someone to approver.");
        setImporting(false);
        return;
      }
      const payload = valid.map((row) => {
        const amount = importRowAmount(row);
        const currency = (row.currency.trim() || "ZMW").toUpperCase();
        return {
          voucher_no: reserveVoucherNumber(row, pool),
          voucher_date: row.date,
          amount,
          currency,
          amount_in_words: amountToWords(amount, currency),
          paid_to: row.paidTo.trim(),
          being_payment: row.beingPayment.trim(),
          payment_method: row.paymentMethod.trim() || "Bank transfer",
          reference: row.reference.trim() || null,
          department_id: branchDept?.id ?? null,
          company_id: myCompanyId,
          prepared_by: user.id,
          prepared_by_name: displayName,
          assigned_approver_id: importApprover?.id ?? null,
          assigned_approver_name: importApprover?.fullName ?? null,
          // The nominated approver is credited, never the person running the
          // import. Stamping the importer here is what put an admin's name on
          // hundreds of Longhorn Associates vouchers.
          approved_by: approved ? importApprover?.id ?? null : null,
          approved_by_name: approved ? importApprover?.fullName ?? null : null,
          // Each imported row keeps its own date, so an approved import shows the
          // date printed on the voucher rather than the day the file was loaded.
          approved_at: approved ? `${row.date}T00:00:00Z` : null,
          status: importStatus,
        };
      });

      const inserted: DbVoucher[] = [];
      for (let index = 0; index < payload.length; index += IMPORT_CHUNK) {
        const chunk = payload.slice(index, index + IMPORT_CHUNK);
        const { data, error } = await supabase.from("vouchers").insert(chunk).select(VOUCHER_COLUMNS);
        if (error) {
          setImportError(`Imported ${inserted.length} of ${payload.length} rows, then stopped. ${explainWriteError(error)}`);
          return;
        }
        inserted.push(...((data || []) as DbVoucher[]));
        setImportProgress(inserted.length);
      }

      const departmentMap = new Map(departments.map((department) => [department.id, department.name]));
      const mapped = inserted.map((item) => mapVoucher(item, departmentMap, companyMap));
      setVouchers((current) => [...mapped, ...current]);
      const total = mapped.reduce((sum, voucher) => sum + voucher.amount, 0);
      setImportRows([]);
      setImportFile(null);
      setImportSheetName("");
      setShowImporter(false);
      if (importStatus === "Pending approval") setView("pending");
      setNotice(
        `${mapped.length} voucher${mapped.length === 1 ? "" : "s"} worth ${formatMoney(total)} imported as ${importStatus}.` +
          (importStatus === "Pending approval" ? " They are waiting for approval." : ""),
      );
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "The import could not be completed.");
    } finally {
      setImporting(false);
    }
  };
  const logout = async () => { await supabase.auth.signOut(); routerNavigate("/login", { replace: true }); };

  if (loading) return <div className="auth-loading"><div className="auth-loading-mark"><ShieldCheck size={20} /></div><span>Loading your workspace...</span></div>;

  return (
    <AppShell active={view} onNavigate={navigate} user={profile} counts={{ pending: pendingCount, approved: approvedCount }} onSignOut={logout} >
        <div>{needsMigration && <div className="notice notice-warn"><AlertTriangle size={16} /><span>Multi-company is not set up on this database yet. Run <b>database/multi_company_setup.sql</b> in the Supabase SQL editor to add branches and per-preparer voucher visibility.</span></div>}
        {setupRequired && <div className="notice notice-error"><AlertTriangle size={16} /><span>The ledger server has no Supabase credentials, so your role and branch cannot be read. Add <b>NITRO_SUPABASE_URL</b> and <b>NITRO_SUPABASE_ANON_KEY</b> to the deployment environment, then redeploy. This is a server setting, not a database one.</span></div>}
        {!setupRequired && !needsMigration && profileError && <div className="notice notice-warn"><AlertTriangle size={16} /><span>Could not read your profile: {profileError} Until this resolves you will see the ledger as a single unnamed company and the admin panel will stay hidden.</span></div>}
        {notice && <div className="notice"><Check size={16} /><span>{notice}</span>{undoRows.length > 0 && <Button className="notice-action" onClick={undoDelete} disabled={restoring}><Undo2 size={14} />{restoring ? "Restoring..." : "Undo"}</Button>}<button onClick={dismissNotice} aria-label="Dismiss"><X size={15} /></button></div>}
          {view === "dashboard" && <><div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line" /> FINANCE CONTROL CENTRE</div><h1>Payment overview</h1><p>A live view of every voucher moving through Longhorn.</p></div>{canPrepare && <Button onClick={openCreate} className="primary-action"><Plus size={17} /> New voucher</Button>}</div>
            <section className="metric-grid"><div className="metric-card metric-card-dark"><div className="metric-icon"><Banknote size={17} /></div><div className="metric-label">{latestMonthLabel ? `${latestMonthLabel} value` : "Total voucher value"}</div><div className="metric-value">{formatMoney(latestMonthTotal)}</div><div className="metric-foot"><ArrowUpRight size={14} /> Live workspace data</div><div className="metric-watermark">ZMW</div></div><div className="metric-card"><div className="metric-icon soft-red"><Clock3 size={17} /></div><div className="metric-label">Awaiting approval</div><div className="metric-value text-[#1a253b]">{String(pendingCount).padStart(2, "0")}</div><div className="metric-foot muted-foot">Updated live</div>{pendingCount > 0 && <div className="metric-badge">Needs attention</div>}</div><div className="metric-card"><div className="metric-icon soft-green"><BadgeCheck size={17} /></div><div className="metric-label">Approved records</div><div className="metric-value text-[#1a253b]">{String(approvedCount).padStart(2, "0")}</div><div className="metric-foot muted-foot">{approvalRate}% signable records</div><div className="mini-bars"><i /><i /><i /><i /><i /></div></div><div className="metric-card metric-card-red"><div className="metric-icon"><FileCheck2 size={17} /></div><div className="metric-label">Records on file</div><div className="metric-value">{String(vouchers.length).padStart(2, "0")}</div><div className="metric-foot">Up to date</div><div className="record-ring"><span>+{vouchers.length}</span></div></div></section>
            <div className="dashboard-grid"><section className="panel recent-panel"><div className="panel-heading"><div><h2>Recent vouchers</h2><p>Your latest activity</p></div><button className="text-link" onClick={() => navigate("pending")}>View all <ArrowUpRight size={14} /></button></div>{vouchers.length ? <div className="table-wrap"><table><thead><tr><th>Voucher</th><th>Paid to</th><th>Amount</th><th>Status</th></tr></thead><tbody>{vouchers.slice(0, 4).map((voucher) => <tr key={voucher.id} onClick={() => setActiveVoucher(voucher)}><td><div className="voucher-id">{voucher.voucherNo}</div><div className="table-sub">{formatDate(voucher.date)}</div></td><td><div className="payee-cell"><div className="payee-icon">{voucher.paidTo.slice(0, 1)}</div><span>{voucher.paidTo}</span></div></td><td className="amount-cell">{formatMoney(voucher.amount, voucher.currency)}</td><td><StatusBadge status={voucher.status} /></td></tr>)}</tbody></table></div> : <div className="empty-state"><div className="empty-art"><FileText size={27} /></div><h3>No vouchers yet</h3><p>Create the first voucher for this workspace.</p>{canPrepare && <Button onClick={openCreate} className="secondary-action"><Plus size={16} /> Create voucher</Button>}</div>}</section><section className="panel action-panel"><div className="panel-heading"><div><h2>Quick actions</h2><p>Move work forward</p></div><SlidersHorizontal size={17} className="text-[#9ca5b5]" /></div>{canPrepare && <button className="quick-action" onClick={openCreate}><span className="quick-action-icon red"><FilePlus2 size={18} /></span><span><b>Create a voucher</b><small>Start a new payment record</small></span><ChevronRight size={17} /></button>}<button className="quick-action" onClick={() => navigate("pending")}><span className="quick-action-icon navy"><Download size={18} /></span><span><b>Export for signing</b><small>Print selected vouchers to PDF</small></span><ChevronRight size={17} /></button><button className="quick-action" onClick={() => navigate("settings")}><span className="quick-action-icon gold"><Settings2 size={18} /></span><span><b>Account settings</b><small>Update your profile</small></span><ChevronRight size={17} /></button></section></div>
            <section className="insight-banner"><div className="insight-icon"><Stamp size={20} /></div><div><div className="eyebrow text-[#e2a6ae]"><span className="eyebrow-line bg-[#e2a6ae]" /> WORKFLOW INSIGHT</div><h3>Every voucher tells a complete story.</h3><p>Keep payment purpose, reference and signatures together for faster month-end reviews.</p></div><div className="insight-stat"><b>{formatMoney(totalValue)}</b><span>tracked value</span></div></section></>}

          {view === "approvals" && canApprove && (
            <ApprovalsPanel
              vouchers={approvalVouchers}
              companies={companies}
              branchOptions={branchOptions}
              companyFilter={companyFilter}
              onCompanyFilterChange={(value) => { setCompanyFilter(value); setApprovalSelected([]); }}
              month={approvalMonth}
              onMonthChange={(value) => { setApprovalMonth(value); setApprovalSelected([]); }}
              monthsWithVouchers={monthsWithVouchers}
              search={approvalSearch}
              onSearchChange={setApprovalSearch}
              selected={approvalSelected}
              onToggle={toggleApprovalSelected}
              onToggleAll={toggleAllApprovalSelected}
              onClearSelection={clearApprovalSelection}
              allSelected={allApprovalSelected}
              selectableCount={approvalSelectable.length}
              selectedCount={approvalSelectedCount}
              totalValue={approvalTotal}
              selectedTotal={approvalSelectedTotal}
              monthSettled={approvalMonthSettled}
              canApprove={canApprove}
              onApproveAll={() => requestBulkApprove(approvalSelectable.filter((id) => approvalSelected.includes(id)))}
              onApproveOne={(voucher) => { setBulkTarget({ ids: [voucher.id], label: `${voucher.voucherNo} · ${formatMoney(voucher.amount, voucher.currency)}` }); }}
              formatMoney={formatMoney}
              formatDate={formatDate}
            />
          )}

          {view === "help" && <HelpCentre user={profile} onBack={() => navigate("dashboard")} />}

          {view === "pending" && <><div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line" /> PENDING APPROVAL</div><h1>Pending vouchers</h1><p>Review pending items and prepare records for signing.</p></div>{canPrepare && <Button onClick={openCreate} className="primary-action"><Plus size={17} /> New voucher</Button>}</div><section className="panel archive-panel"><div className="archive-toolbar"><div className="search-box"><Search size={17} /><input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Search voucher, payee or reference..." /></div><div className="filter-row">{canApprove && branchOptions.length > 1 && <select value={companyFilter} onChange={(event) => { setCompanyFilter(event.target.value); setPage(1); }} title="Filter by branch" aria-label="Filter by branch"><option value={ALL_COMPANIES}>{ALL_COMPANIES}</option>{branchOptions.map((company) => <option key={company.id} value={company.name}>{company.name}</option>)}</select>}<select value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value as typeof statusFilter); setPage(1); }}><option value="All statuses">All pending</option><option>Pending approval</option><option>Draft</option></select><input type="date" value={dateFrom} max={dateTo || undefined} onChange={(event) => { setDateFrom(event.target.value); setPage(1); }} className="date-filter" aria-label="From date" title="From date" /><input type="date" value={dateTo} min={dateFrom || undefined} onChange={(event) => { setDateTo(event.target.value); setPage(1); }} className="date-filter" aria-label="To date" title="To date" /><button className="filter-button"><Filter size={15} /> <span className="hidden sm:inline">More filters</span></button></div></div><div className="selection-bar"><label className="check-control"><input type="checkbox" checked={pageSelected} onChange={toggleAll} /><span><Check size={12} /></span>Select all visible</label><span className="selection-count">{selected.length ? `${selected.length} selected` : `${filteredVouchers.length} records`}</span>{!everyFilteredSelected && filteredVouchers.length > pagedVouchers.length && <button className="select-all-link" onClick={toggleEveryFiltered}>Select all {filteredVouchers.length} vouchers</button>}{selected.length > 0 && <button className="select-all-link" onClick={clearSelected}>Clear selection</button>}<Button disabled={!selected.length} onClick={exportSelected} className="export-button"><Printer size={15} /> Print selected{selected.length ? ` (${selected.length})` : ""}</Button>{canPrepare && <Button disabled={!selected.length} onClick={() => requestDelete(selected)} className="delete-button"><Trash2 size={15} /> Delete{selected.length ? ` (${selected.length})` : ""}</Button>}{canPrepare && <Button onClick={() => openImporter("Pending approval")} className="export-button"><Upload size={15} /> Import Excel / CSV</Button>}</div>{selected.length > 0 && <div className="selection-summary"><b>{selected.length} selected</b> worth {formatMoney(selectedTotal)}<span>{selectedVouchers.some((voucher) => voucher.status === "Draft") && ` · ${selectedVouchers.filter((voucher) => voucher.status === "Draft").length} draft`}</span></div>}<div className="table-wrap archive-table"><table><thead><tr><th className="check-col" /><th>Voucher no.</th><th>Paid to</th><th>Payment date</th><th>Amount</th><th>Status</th><th /></tr></thead><tbody>{pagedVouchers.map((voucher) => <tr key={voucher.id}><td className="check-col"><label className="check-control"><input type="checkbox" checked={selected.includes(voucher.id)} onChange={() => toggleSelected(voucher.id)} /><span><Check size={12} /></span></label></td><td><button className="voucher-link" onClick={() => setActiveVoucher(voucher)}>{voucher.voucherNo}</button><div className="table-sub">{voucher.reference || "No reference"}</div></td><td><div className="payee-cell"><div className="payee-icon">{voucher.paidTo.slice(0, 1)}</div><span>{voucher.paidTo}</span></div></td><td className="muted-cell">{formatDate(voucher.date)}</td><td className="amount-cell">{formatMoney(voucher.amount, voucher.currency)}</td><td><StatusBadge status={voucher.status} /></td><td><div className="row-actions">{canPrepare && <button className="row-more row-more-danger" onClick={() => requestDelete([voucher.id])} aria-label={`Delete ${voucher.voucherNo}`} title={`Delete ${voucher.voucherNo}`}><Trash2 size={16} /></button>}<button className="row-more" onClick={() => setActiveVoucher(voucher)} aria-label={`View ${voucher.voucherNo}`}><MoreHorizontal size={18} /></button></div></td></tr>)}</tbody></table>{!filteredVouchers.length && <div className="empty-state"><div className="empty-art"><FileText size={27} /></div><h3>No vouchers match these filters</h3><p>Try a different search or create a new payment record.</p>{canPrepare && <Button onClick={openCreate} className="secondary-action"><Plus size={16} /> Create voucher</Button>}</div>}{filteredVouchers.length > 0 && <PaginationBar total={filteredVouchers.length} page={safePage} pages={pendingPages} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={changePageSize} />}</div></section></>}
          {view === "approved" && <><div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line" /> SIGNED ARCHIVE</div><h1>Approved vouchers</h1><p>Tick the vouchers you need, then print them together as one batch of signed sheets.</p></div></div><section className="panel archive-panel"><div className="archive-toolbar"><div className="search-box"><Search size={17} /><input value={approvedSearch} onChange={(event) => { setApprovedSearch(event.target.value); setApprovedPage(1); }} placeholder="Search voucher, payee or reference..." /></div><div className="filter-row">{canApprove && branchOptions.length > 1 && <select value={companyFilter} onChange={(event) => { setCompanyFilter(event.target.value); setApprovedPage(1); }} title="Filter by branch" aria-label="Filter by branch"><option value={ALL_COMPANIES}>{ALL_COMPANIES}</option>{branchOptions.map((company) => <option key={company.id} value={company.name}>{company.name}</option>)}</select>}<input type="date" value={approvedFrom} max={approvedTo || undefined} onChange={(event) => { setApprovedFrom(event.target.value); setApprovedPage(1); }} className="date-filter" aria-label="From date" title="From date" /><input type="date" value={approvedTo} min={approvedFrom || undefined} onChange={(event) => { setApprovedTo(event.target.value); setApprovedPage(1); }} className="date-filter" aria-label="To date" title="To date" /></div></div><div className="selection-bar"><label className="check-control"><input type="checkbox" checked={approvedPageSelected} onChange={toggleAllApproved} /><span><Check size={12} /></span>Select all visible</label><span className="selection-count">{approvedSelected.length ? `${approvedSelected.length} selected` : `${approvedVouchers.length} records`}</span>{!everyApprovedSelected && approvedVouchers.length > pagedApproved.length && <button className="select-all-link" onClick={toggleEveryApproved}>Select all {approvedVouchers.length} vouchers</button>}{approvedSelected.length > 0 && <button className="select-all-link" onClick={() => setApprovedSelected([])}>Clear selection</button>}<Button disabled={!approvedSelected.length} onClick={exportApproved} className="export-button"><Printer size={15} /> Print selected{approvedSelected.length ? ` (${approvedSelected.length})` : ""}</Button>{canPrepare && <Button disabled={!approvedSelected.length} onClick={() => requestDelete(approvedSelected)} className="delete-button"><Trash2 size={15} /> Delete{approvedSelected.length ? ` (${approvedSelected.length})` : ""}</Button>}{canPrepare && <Button onClick={() => openImporter("Approved")} className="export-button"><Upload size={15} /> Import Excel / CSV</Button>}</div>{approvedSelected.length > 0 && <div className="selection-summary"><b>{approvedSelected.length} selected</b> worth {formatMoney(approvedSelectedTotal)}<span>ready to print, one sheet each</span></div>}<div className="table-wrap archive-table"><table><thead><tr><th className="check-col" /><th>Voucher no.</th><th>Paid to</th><th>Payment date</th><th>Amount</th><th>Status</th><th /></tr></thead><tbody>{pagedApproved.map((voucher) => <tr key={voucher.id}><td className="check-col"><label className="check-control"><input type="checkbox" checked={approvedSelected.includes(voucher.id)} onChange={() => toggleApproved(voucher.id)} /><span><Check size={12} /></span></label></td><td><button className="voucher-link" onClick={() => setActiveVoucher(voucher)}>{voucher.voucherNo}</button><div className="table-sub">{voucher.reference || "No reference"}</div></td><td><div className="payee-cell"><div className="payee-icon">{voucher.paidTo.slice(0, 1)}</div><span>{voucher.paidTo}</span></div></td><td className="muted-cell">{formatDate(voucher.date)}</td><td className="amount-cell">{formatMoney(voucher.amount)}</td><td><StatusBadge status={voucher.status} /></td><td><div className="row-actions">{canPrepare && <button className="row-more row-more-danger" onClick={() => requestDelete([voucher.id])} aria-label={`Delete ${voucher.voucherNo}`} title={`Delete ${voucher.voucherNo}`}><Trash2 size={16} /></button>}<button className="row-more" onClick={() => setActiveVoucher(voucher)} aria-label={`View ${voucher.voucherNo}`}><MoreHorizontal size={18} /></button></div></td></tr>)}</tbody></table>{!approvedVouchers.length && <div className="empty-state"><div className="empty-art"><FileText size={27} /></div><h3>No approved vouchers yet</h3><p>Approved items move here automatically.</p></div>}{approvedVouchers.length > 0 && <PaginationBar total={approvedVouchers.length} page={safeApprovedPage} pages={approvedPages} pageSize={pageSize} onPageChange={setApprovedPage} onPageSizeChange={changePageSize} />}</div></section></>}

{view === "settings" && <><div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line" /> ACCOUNT SETTINGS</div><h1>Settings</h1><p>Update your profile and sign-in credentials. Changes apply immediately.</p></div></div><div className="team-grid"><section className="panel team-summary"><div className="summary-hero"><div className="avatar" style={{ width: 46, height: 46, fontSize: 16 }}>{initials}</div><div><h2>{displayName}</h2><p>{user?.email || "No email on file"}</p></div><span className="admin-pill capitalize">{userRole}</span>{profile?.company && <CompanyChip name={profile.company.name} code={profile.company.code} color={profile.company.color} variant="code" className="ml-2" />}</div><div className="team-stat-row"><div><b>{canApprove ? "Yes" : "No"}</b><span>Can approve</span></div><div><b>{departments.length}</b><span>Departments</span></div><div><b>{vouchers.filter((voucher) => voucher.preparedById === (user?.id || "")).length}</b><span>Prepared by you</span></div></div><div className="role-note"><ShieldCheck size={16} /><span><b>Your access</b><small>{profile?.company?.name ? `You work for ${profile.company.name}. ` : ""}{canApprove ? "You can see every branch’s vouchers." : "Your workspace holds only the vouchers you prepared."} Contact your workspace admin to change your role or branch.</small></span></div></section><section className="panel settings-panel"><div className="panel-heading"><div><h2>Sign-in &amp; profile</h2><p>Your account credentials</p></div><Settings2 size={17} className="text-[#9ca5b5]" /></div><div className="form-section-title"><span>01</span><div><b>Display name</b><small>Shown on vouchers you prepare</small></div></div><form onSubmit={saveDisplayName} className="grid gap-3"><label className="field"><span>Full name</span><Input value={settingsName} onChange={(event) => setSettingsName(event.target.value)} placeholder="Your full name" required /></label><div><Button type="submit" disabled={settingsBusy === "name"} className="secondary-action">{settingsBusy === "name" ? "Saving..." : "Save name"}</Button></div></form><div className="form-section-title divider"><span>02</span><div><b>Sign-in email</b><small>What you sign in with</small></div></div>
<form onSubmit={saveEmail} className="grid gap-3">
<label className="field"><span>Email address</span>
<Input type="email" value={settingsEmail} onChange={(event) => setSettingsEmail(event.target.value)} placeholder="you@longhorn-associates.com" required />
</label>
<label className="field"><span>Current password <em>*</em></span>
<Input type="password" autoComplete="current-password" value={emailPassword} onChange={(event) => setEmailPassword(event.target.value)} placeholder="Confirm it is you" required />
<small className="field-hint">Required so a borrowed session cannot redirect your account. Your new address takes effect straight away.</small>
</label>
<div>
<Button type="submit" disabled={settingsBusy === "email"} className="secondary-action">
{settingsBusy === "email" ? "Updating..." : "Update email"}
</Button>
</div>
</form>
<div className="form-section-title divider"><span>03</span><div><b>Password</b><small>Minimum 6 characters</small></div></div><form onSubmit={savePassword} className="grid gap-3"><label className="field"><span>New password</span><Input type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} placeholder="Enter a new password" required /></label><label className="field"><span>Confirm new password</span><Input type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} placeholder="Repeat the new password" required /></label><div><Button type="submit" disabled={settingsBusy === "password"} className="secondary-action">{settingsBusy === "password" ? "Updating..." : "Update password"}</Button></div></form></section></div></>}
        </div>

{showImporter && (
        <div className="modal-backdrop" onMouseDown={closeImporter}>
          <section className="composer !w-full sm:!w-[min(100%,900px)]" onMouseDown={(event) => event.stopPropagation()}>
            <div className="composer-header">
              <div>
                <div className="eyebrow"><span className="eyebrow-line" /> BULK IMPORT</div>
                <h2>Import vouchers</h2>
                <p>{IMPORT_FILE_HINT}</p>
              </div>
              <button className="close-button" onClick={closeImporter} aria-label="Close importer"><X size={20} /></button>
            </div>

            <div className="composer-form space-y-4">
              <label
                className={`flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-2xl border-2 border-dashed px-5 py-6 text-center transition ${dragOverImport ? "border-[#d71939] bg-[#fff0f2]" : "border-[#e1dbd3] bg-white hover:border-[#d71939]/40"}`}
                onDragOver={(event) => { event.preventDefault(); setDragOverImport(true); }}
                onDragLeave={() => setDragOverImport(false)}
                onDrop={(event) => { event.preventDefault(); setDragOverImport(false); const dropped = event.dataTransfer.files?.[0]; if (dropped) void importFromFile(dropped); }}
              >
                <input type="file" accept={IMPORT_FILE_ACCEPT} className="sr-only" onChange={handleImportFile} />
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-[#fff0f2] text-[#d71939]">
                  {parsingImport ? <Loader2 size={19} className="animate-spin" /> : <FileSpreadsheet size={19} />}
                </span>
                {importFile ? (
                  <>
                    <b className="text-[12px] text-[#1a253b]">{importFile.fileName}</b>
                    <small className="text-[10px] text-[#919baa]">{importFile.kind === "excel" ? "Excel workbook" : "Delimited text file"} · click to choose another file</small>
                  </>
                ) : (
                  <>
                    <b className="text-[12px] text-[#1a253b]">{parsingImport ? "Reading your file..." : "Drop your Excel or CSV file here"}</b>
                    <small className="text-[10px] text-[#919baa]">.xlsx, .xlsm, .tsv or .csv</small>
                  </>
                )}
              </label>

              {importError && <div className="login-error"><LockKeyhole size={15} /><span>{importError}</span></div>}
              {importNotices.map((notice, index) => (
                <div key={index} className="flex items-start gap-2 rounded-xl border border-[#efd7a6] bg-[#fff9ee] px-3 py-2 text-[11px] text-[#9b650d]">
                  <AlertTriangle size={14} className="mt-px shrink-0" /><span>{notice}</span>
                </div>
              ))}

              {importFile && importRows.length > 0 && (
                <>
                  <div className="rounded-xl border border-[#eee8e0] bg-[#fcfaf7] px-3.5 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-[#e9eef7] px-2.5 py-1 text-[10px] font-bold text-[#375787]">
                        {importSheet?.layout === "statement" ? "Cash book / statement layout" : "Voucher table layout"}
                      </span>
                      {importFile.sheets.length > 1 && (
                        <select
                          value={importSheetName}
                          onChange={(event) => switchImportSheet(event.target.value)}
                          className="h-7 rounded-lg border border-[#e4dfd7] bg-white px-2 text-[11px] text-[#647084] outline-none"
                        >
                          {importFile.sheets.map((sheet) => (
                            <option key={sheet.name} value={sheet.name}>{sheet.name}{sheet.error ? " (skipped)" : ` (${sheet.rows.length} rows)`}</option>
                          ))}
                        </select>
                      )}
                      {importSheet && (
                        <span className="text-[10px] text-[#919baa]">
                          Header on {importSheet.headerRows.length > 1 ? `rows ${importSheet.headerRows.join(", ")}` : `row ${importSheet.headerRows[0]}`} · columns: {describeSheetColumns(importSheet) || "none recognised"}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="form-grid">
                    <label className="field">
                      <span>Send imported rows to</span>
                      <select value={importStatus} onChange={(event) => setImportStatus(event.target.value as VoucherStatus)}>
                        <option>Pending approval</option>
                        <option>Draft</option>
                        <option>Approved</option>
                      </select>
                    </label>
                    <label className="field">
                      <span>Approve with</span>
                      <select value={importApproverId} onChange={(event) => setImportApproverId(event.target.value)}>
                        <option value="">Closest branch approver</option>
                        {approvers.map((member) => (
                          <option key={member.id} value={member.id}>{member.fullName} ({member.companyCode || "No branch"})</option>
                        ))}
                      </select>
                    </label>
<label className="field">
                      <span>Department (branch)</span>
                      <div className="input-icon">
                        <Building2 size={15} />
                        <Input value={myBranchLabel || "Your branch"} readOnly />
                      </div>
                      <small className="field-hint">Taken from your profile, so every imported row lands in the right branch's books.</small>
                    </label>
                    <label className="field">
                      <span>Currency when the file has none</span>
                      <select value={importDefaults.currency} onChange={(event) => patchImportDefaults("currency", event.target.value)}>
                        <option>ZMW</option><option>USD</option><option>GBP</option>
                      </select>
                    </label>
                    <label className="field">
                      <span>Payment method when the file has none</span>
                      <select value={importDefaults.paymentMethod} onChange={(event) => patchImportDefaults("paymentMethod", event.target.value)}>
                        {paymentMethods.map((method) => <option key={method}>{method}</option>)}
                      </select>
                    </label>
                  </div>

                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                    <label className="check-control">
                      <input type="checkbox" checked={allImportRowsSelected} onChange={toggleAllImportRows} />
                      <span><Check size={12} /></span>
                      Select all valid rows
                    </label>
                    <label className="check-control">
                      <input type="checkbox" checked={importDefaults.includeReceipts} onChange={(event) => setImportReceipts(event.target.checked)} />
                      <span><Check size={12} /></span>
                      Include money received
                    </label>
                    <button className="text-link" onClick={() => setImportRows((rows) => rows.map((row) => ({ ...row, included: false })))}>Clear selection</button>
                  </div>

                  <div className="overflow-auto rounded-xl border border-[#eee8e0] bg-white" style={{ maxHeight: "46vh" }}>
                    <table className="import-table">
                      <thead>
                        <tr>
                          <th style={{ width: 36 }} />
                          <th style={{ width: 46 }}>Row</th>
                          <th style={{ width: 116 }}>Date</th>
                          <th style={{ width: "26%" }}>Paid to</th>
                          <th>Being payment for</th>
                          <th style={{ width: 118 }}>Amount</th>
                          <th style={{ width: 78 }} />
                        </tr>
                      </thead>
                      <tbody>
                        {importRows.map((row) => {
                          const problem = importRowError(row);
                          return (
                            <tr key={row.key} className={`${problem && !row.skipped ? "import-row-problem" : ""} ${!row.included ? "import-row-off" : ""}`}>
                              <td>
                                <label className="check-control">
                                  <input
                                    type="checkbox"
                                    checked={row.included}
                                    disabled={row.skipped || !!problem}
                                    onChange={(event) => patchImportRow(row.key, { included: event.target.checked })}
                                  />
                                  <span><Check size={12} /></span>
                                </label>
                              </td>
                              <td className="table-sub !mt-0">{row.sourceRow}</td>
                              <td>
                                <input
                                  type="date"
                                  className={`import-cell ${!row.date && !row.skipped ? "import-cell-bad" : ""}`}
                                  value={row.date}
                                  onChange={(event) => patchImportRow(row.key, { date: event.target.value })}
                                />
                              </td>
                              <td>
                                <input
                                  className={`import-cell ${!row.paidTo && !row.skipped ? "import-cell-bad" : ""}`}
                                  value={row.paidTo}
                                  placeholder="Payee"
                                  onChange={(event) => patchImportRow(row.key, { paidTo: event.target.value })}
                                />
                              </td>
                              <td>
                                <input
                                  className={`import-cell ${!row.beingPayment && !row.skipped ? "import-cell-bad" : ""}`}
                                  value={row.beingPayment}
                                  placeholder="Purpose"
                                  onChange={(event) => patchImportRow(row.key, { beingPayment: event.target.value })}
                                />
                                {row.direction === "receipt" && (
                                  <div className="mt-1 text-[9px] font-bold uppercase tracking-wide text-[#bd801e]">Money in</div>
                                )}
                              </td>
                              <td>
                                <input
                                  inputMode="decimal"
                                  className={`import-cell text-right font-semibold ${!row.amount && !row.skipped ? "import-cell-bad" : ""}`}
                                  value={row.amount}
                                  placeholder="0.00"
                                  onChange={(event) => patchImportRow(row.key, { amount: event.target.value })}
                                />
                              </td>
                              <td>
                                <span className={`import-note ${problem && !row.skipped ? "import-note-bad" : ""}`}>{row.skipped ? "skipped" : problem || ""}</span>
                                {!row.skipped && (
                                  <button className="row-more" onClick={() => setImportRows((rows) => rows.filter((item) => item.key !== row.key))} aria-label={`Remove row ${row.sourceRow}`}>
                                    <Trash2 size={15} />
                                  </button>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              )}

              {importFile && importRows.length === 0 && !parsingImport && (
                <div className="empty-state"><div className="empty-art"><FileText size={27} /></div><h3>No transactions found</h3><p>This sheet has a header row but no rows with an amount.</p></div>
              )}
            </div>

            <div className="import-footer">
              <div className="min-w-0">
                <div className="text-[12px] font-bold text-[#1a253b]">
                  {selectedImportRows.length} voucher{selectedImportRows.length === 1 ? "" : "s"} ready · {formatMoney(selectedImportTotal, importDefaults.currency)}
                </div>
                <small className="text-[10px] text-[#919baa]">
                  {importRows.length
                    ? `${importRows.filter((row) => !row.skipped && !importRowError(row)).length} valid · ${importRowProblemCount} need${importRowProblemCount === 1 ? "s" : ""} attention · ${importSkippedCount} skipped${receiptCount && !importDefaults.includeReceipts ? ` · ${receiptCount} receipt${receiptCount === 1 ? "" : "s"} excluded` : ""}`
                    : "Choose a file to start."}
                </small>
              </div>
              <div className="flex gap-2">
                <Button className="cancel-button" onClick={closeImporter} disabled={importing}>Cancel</Button>
                <Button className="primary-action" disabled={!selectedImportRows.length || importing} onClick={confirmImport}>
                  <Upload size={16} />
                  {importing ? `Importing ${importProgress}...` : `Import ${selectedImportRows.length || ""} to ${importStatus.toLowerCase()}`}
                </Button>
              </div>
            </div>
          </section>
        </div>
      )}
      {showComposer && <div className="modal-backdrop" onMouseDown={() => setShowComposer(false)}><section className="composer" onMouseDown={(event) => event.stopPropagation()}><div className="composer-header"><div><div className="eyebrow"><span className="eyebrow-line" /> NEW RECORD</div><h2>Create payment voucher</h2><p>Capture the details once. Keep the approval trail complete.</p></div><div className="composer-branch-note">{profile?.company && <CompanyChip name={profile.company.name} code={profile.company.code} color={profile.company.color} variant="full" />}<span>Saving to your branch</span></div><button className="close-button" onClick={() => setShowComposer(false)}><X size={20} /></button></div><form onSubmit={createVoucher} className="composer-form"><div className="form-section-title"><span>01</span><div><b>Payment details</b><small>What is being paid?</small></div></div><div className="form-grid"><label className="field wide"><span>Amount paid <em>*</em></span><div className="amount-input"><select value={form.currency} onChange={(event) => updateField("currency", event.target.value)}><option>ZMW</option><option>USD</option><option>GBP</option></select><Input type="number" min="0" step="0.01" value={form.amount || ""} onChange={(event) => updateField("amount", event.target.value)} placeholder="0.00" /></div></label><label className="field"><span>Payment date <em>*</em></span><div className="input-icon"><CalendarDays size={15} /><Input type="date" value={form.date} onChange={(event) => updateField("date", event.target.value)} /></div></label><label className="field"><span>Amount in words</span><div className="words-preview"><Sparkles size={14} /><span>{amountWords}</span></div></label><label className="field wide"><span>Amount paid to <em>*</em></span><Input value={form.paidTo} onChange={(event) => updateField("paidTo", event.target.value)} placeholder="e.g. Petty Cash or supplier name" /></label><label className="field wide"><span>Being payment for <em>*</em></span><textarea value={form.beingPayment} onChange={(event) => updateField("beingPayment", event.target.value)} placeholder="Describe the purpose of this payment" rows={2} /></label></div><div className="form-section-title divider"><span>02</span><div><b>Sign-off owners</b><small>Who prepares and approves the voucher?</small></div></div><div className="form-grid"><label className="field"><span>Prepared by <em>*</em></span><div className="input-icon"><UserRound size={15} /><Input value={form.preparedBy} readOnly /></div></label><label className="field"><span>Send to approver <em>*</em></span><div className="input-icon"><ShieldCheck size={15} /><select value={form.approverId} onChange={(event) => updateField("approverId", event.target.value)} required><option value="">Choose an approver...</option>{approvers.map((member) => (<option key={member.id} value={member.id}>{member.fullName} ({member.companyCode || "No branch"}{member.role === "admin" ? " · Admin" : ""})</option>))}</select></div><small className="field-hint">They approve this voucher across all branches. Your own branch is listed first.</small></label></div>{notice && <div className="form-error">{notice}</div>}<div className="composer-footer"><span><ShieldCheck size={15} /> Saved securely</span><div className="flex gap-2"><Button type="button" onClick={() => setShowComposer(false)} className="cancel-button">Cancel</Button><Button type="submit" className="primary-action">Create voucher <ArrowUpRight size={16} /></Button></div></div></form></section></div>}

      {activeVoucher && <div className="modal-backdrop" onMouseDown={() => setActiveVoucher(null)}><section className="preview-modal" onMouseDown={(event) => event.stopPropagation()}><div className="preview-header"><div><div className="eyebrow"><span className="eyebrow-line" /> VOUCHER PREVIEW</div><h2>{activeVoucher.voucherNo}</h2><p>Created {formatDate(activeVoucher.date)} · {activeVoucher.department}</p></div><div className="flex flex-wrap items-center justify-end gap-2"><CompanyChip name={activeVoucher.companyName} code={activeVoucher.companyCode} color={activeVoucher.companyColor} variant="full" /><StatusBadge status={activeVoucher.status} /><button className="close-button" onClick={() => setActiveVoucher(null)}><X size={20} /></button></div></div><div className="preview-paper"><VoucherPrint voucher={activeVoucher} /></div><div className="preview-actions"><Button className="cancel-button" onClick={() => setActiveVoucher(null)}>Close</Button>{activeVoucher.status === "Pending approval" && canApprove && <Button className="approve-button" onClick={() => approveVoucher(activeVoucher.id)}><Check size={16} /> Approve voucher</Button>}<Button className="primary-action" onClick={() => setPrintVouchers([activeVoucher])}><Download size={16} /> Export PDF</Button></div></section></div>}
      {/* The print area is portalled to <body> rather than rendered here.

          The print stylesheet hides everything under <body> except `.print-only`,
          which only works if the sheets are a direct child of <body>. Inside the
          app shell they are not: AppShell wraps everything in `.content-wrap`
          inside `.main-content`, so hiding the shell to reveal the sheets also
          hid the sheets. Printed blank pages.

          It also means the voucher preview dialog, which sits inside the shell,
          is left behind rather than printed on top of the sheets. */}
      {printVouchers.length > 0 && createPortal(
        <div className="print-only">{printVouchers.map((voucher) => <VoucherPrint key={voucher.id} voucher={voucher} />)}</div>,
        document.body,
      )}

      <AlertDialog
        open={bulkTarget !== null}
        onOpenChange={(open) => { if (!open && !bulkBusy) setBulkTarget(null); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <span className="delete-dialog-icon" style={{ background: "#e5f4ec", color: "#197447" }}>
                <Stamp size={17} />
              </span>
              Approve {bulkTarget?.label}?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="delete-dialog-body">
                <p>
                  These vouchers will be marked <b>Approved</b> and stamped with your name and today's date. They
                  become ready to export for signing straight away.
                </p>
                <p className="delete-dialog-hint">
                  Only vouchers still in <b>Pending approval</b> from {monthLabel(approvalMonth)} are touched. Anything
                  that changed while this dialog was open is skipped and reported back.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkBusy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="approve-button"
              disabled={bulkBusy}
              onClick={(event) => { event.preventDefault(); void confirmBulkApprove(); }}
            >
              {bulkBusy ? "Approving..." : "Yes, approve them"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => { if (!open && !deleting) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <span className="delete-dialog-icon"><Trash2 size={17} /></span>
              Delete {deleteTargetVouchers.length === 1 ? "this voucher" : `${deleteTargetVouchers.length} vouchers`}?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="delete-dialog-body">
                <p>
                  {deleteTargetVouchers.length === 1
                    ? <>You are about to delete <b>{deleteTargetVouchers[0]?.voucherNo}</b> · {deleteTargetVouchers[0]?.paidTo} · {formatMoney(deleteTargetVouchers[0]?.amount ?? 0, deleteTargetVouchers[0]?.currency)}.</>
                    : <>You are about to delete <b>{deleteTargetVouchers.length} vouchers</b> worth {formatMoney(deleteTargetTotal)}.</>}
                </p>
                {deleteTargetHasApproved && <p className="delete-dialog-warn">Some of these are already approved. If they have been signed, deleting them removes them from your records.</p>}
                <p className="delete-dialog-hint">You will get an Undo button straight afterwards, but do not close or refresh the page if you might need it.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Keep them</AlertDialogCancel>
            <AlertDialogAction className="danger-action" disabled={deleting} onClick={(event) => { event.preventDefault(); void confirmDelete(); }}>
              {deleting ? "Deleting..." : "Delete permanently"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
};

export default Index;

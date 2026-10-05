import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from "react";
import {
  AlertTriangle,
  ArrowUpRight,
  BadgeCheck,
  Banknote,
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
import { useNavigate as useRouterNavigate } from "react-router-dom";
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
import { supabase } from "@/integrations/supabase/client";
import { useSessionContext } from "@/components/SessionContextProvider";
import {
  IMPORT_FILE_ACCEPT,
  IMPORT_FILE_HINT,
  describeSheetColumns,
  parseImportFile,
  type ImportDirection,
  type ParsedImportFile,
  type ParsedImportSheet,
} from "@/lib/spreadsheetImport";

type VoucherStatus = "Draft" | "Pending approval" | "Approved";
type View = "dashboard" | "pending" | "approved" | "settings";

type Department = {
  id: string;
  name: string;
  description: string | null;
};

type Profile = {
  full_name: string;
  role: "admin" | "preparer" | "approver";
  department_id: string | null;
};

type Voucher = {
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
  preparedById: string;
  approvedBy: string;
  approvedById: string | null;
  status: VoucherStatus;
};

type VoucherForm = {
  date: string;
  amount: number;
  currency: string;
  paidTo: string;
  beingPayment: string;
  paymentMethod: string;
  reference: string;
  department: string;
  preparedBy: string;
  approvedBy: string;
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
  prepared_by: string;
  prepared_by_name: string;
  approved_by: string | null;
  approved_by_name: string | null;
  approved_at: string | null;
  status: VoucherStatus;
};

const paymentMethods = ["Bank transfer", "Petty cash", "Mobile money", "Cheque"];
const emptyForm: VoucherForm = {
  date: new Date().toISOString().slice(0, 10),
  amount: 0,
  currency: "ZMW",
  paidTo: "",
  beingPayment: "",
  paymentMethod: "Bank transfer",
  reference: "",
  department: "",
  preparedBy: "",
  approvedBy: "",
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

const PAGE_SIZE = 10;

const pageNumbers = (current: number, total: number): number[] => {
  const pages: number[] = [];
  const start = Math.max(1, Math.min(current - 2, Math.max(1, total - 4)));
  const end = Math.min(total, start + 4);
  for (let i = Math.max(1, end - 4); i <= end; i++) pages.push(i);
  return pages;
};

const statusStyles: Record<VoucherStatus, string> = {
  Approved: "bg-[#e5f4ec] text-[#197447] border-[#bce3ca]",
  "Pending approval": "bg-[#fff3dc] text-[#9b650d] border-[#efd7a6]",
  Draft: "bg-[#eef0f5] text-[#5b6476] border-[#d8dce6]",
};

const mapVoucher = (row: DbVoucher, departmentMap: Map<string, string>): Voucher => ({
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
  department: departmentMap.get(row.department_id) || "Unassigned",
  departmentId: row.department_id,
  preparedBy: row.prepared_by_name,
  preparedById: row.prepared_by,
  approvedBy: row.approved_by_name || "",
  approvedById: row.approved_by,
  status: row.status,
});

const NavItem = ({ active, icon: Icon, label, onClick, count }: { active: boolean; icon: typeof LayoutDashboard; label: string; onClick: () => void; count?: number }) => (
  <button onClick={onClick} className={`nav-item ${active ? "nav-item-active" : ""}`}><Icon size={18} strokeWidth={active ? 2.3 : 1.8} /><span>{label}</span>{count !== undefined && <span className="ml-auto rounded-full bg-[#fff4f5] px-2 py-0.5 text-[10px] font-bold text-[#D71939]">{count}</span>}</button>
);

const StatusBadge = ({ status }: { status: VoucherStatus }) => <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${statusStyles[status]}`}><span className="h-1.5 w-1.5 rounded-full bg-current" />{status}</span>;

const VoucherPrint = ({ voucher }: { voucher: Voucher }) => (
  <article className="print-voucher">
    <div className="print-brand-row"><Logo height={58} /></div>
    <div className="print-rule" /><h1>PAYMENT VOUCHER</h1>
    <div className="print-meta-grid"><strong>PV NO. <span>{voucher.voucherNo}</span></strong><strong>TPIN: <span>1009055576</span></strong><strong>Date: <span>{formatDate(voucher.date)}</span></strong></div>
    <div className="print-body"><div className="print-line"><b>Amount:</b><span className="amount-box">{formatMoney(voucher.amount, voucher.currency)}</span></div><div className="print-line"><b>Amount paid to:</b><span>{voucher.paidTo}</span></div><div className="print-line print-tall"><b>Amount in words:</b><span>{voucher.amountWords}</span></div><div className="print-line print-tall"><b>Being Payment:</b><span>{voucher.beingPayment}</span></div><div className="print-detail-row"><span><b>Department:</b> {voucher.department}</span><span><b>Payment:</b> {voucher.paymentMethod}</span><span><b>Reference:</b> {voucher.reference || "—"}</span></div></div>
    <div className="print-signatures"><div><b>Prepared by:</b><span>{voucher.preparedBy || "________________________"}</span><em>Signature: __________________</em><small>Date: {formatDate(voucher.date)}</small></div><div><b>Approved by:</b><span>{voucher.approvedBy || "________________________"}</span><em>Signature: __________________</em><small>Date: __________________</small></div></div>
    <div className="print-footer">Ground Floor, Plot 1146 / 15 Lagos Road, Rhodes Park, P.O Box 50655, Ridgeway, Lusaka · Tel / Fax: +260 211 252 540 · info@longhorn-associates.com</div>
  </article>
);

const Index = () => {
  const routerNavigate = useRouterNavigate();
  const { session, user } = useSessionContext();
  const [view, setView] = useState<View>("dashboard");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [vouchers, setVouchers] = useState<Voucher[]>([]);
  const [loading, setLoading] = useState(true);
  const [showComposer, setShowComposer] = useState(false);
  const [showMobileNav, setShowMobileNav] = useState(false);
  const [form, setForm] = useState<VoucherForm>(emptyForm);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"All statuses" | VoucherStatus>("All statuses");
  const [departmentFilter, setDepartmentFilter] = useState("All departments");
  const [selected, setSelected] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [approvedSearch, setApprovedSearch] = useState("");
  const [approvedDept, setApprovedDept] = useState("All departments");
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
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [settingsBusy, setSettingsBusy] = useState<"name" | "email" | "password" | "">("");

  const displayName = profile?.full_name || user?.user_metadata?.full_name || user?.email?.split("@")[0] || "Longhorn user";
  const userRole = profile?.role || "preparer";
  const canPrepare = userRole !== "approver";
  const initials = getInitials(displayName);
  const todayLabel = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "2-digit", month: "long", year: "numeric" }).format(new Date());
  const dayHour = new Date().getHours();
  const greeting = dayHour < 5 || dayHour >= 17 ? "Good evening" : dayHour < 12 ? "Good morning" : "Good afternoon";

  useEffect(() => {
    if (!session || !user) return;
    const loadData = async () => {
      setLoading(true);
      const [profileResponse, departmentsResponse, vouchersResponse] = await Promise.all([
        supabase.from("profiles").select("full_name, role, department_id").eq("id", user.id).maybeSingle(),
        supabase.from("departments").select("id, name, description").order("name"),
        supabase.from("vouchers").select("*").order("voucher_date", { ascending: false }).order("created_at", { ascending: false }),
      ]);
      const firstError = profileResponse.error || departmentsResponse.error || vouchersResponse.error;
      if (firstError) {
        setNotice(firstError.message);
      } else {
        let loadedDepartments = (departmentsResponse.data || []) as Department[];
        if (!loadedDepartments.length) {
          const { data: generalDepartment } = await supabase.from("departments").insert({ name: "General", description: "Default department" }).select("id, name, description").single();
          if (generalDepartment) loadedDepartments = [generalDepartment as Department];
        }
        const departmentMap = new Map(loadedDepartments.map((department) => [department.id, department.name]));
        const loadedProfile = profileResponse.data as Profile | null;
        setProfile(loadedProfile);
        setDepartments(loadedDepartments);
        setVouchers(((vouchersResponse.data || []) as DbVoucher[]).map((row) => mapVoucher(row, departmentMap)));
        setForm((current) => ({ ...current, preparedBy: loadedProfile?.full_name || displayName, department: current.department || loadedDepartments[0]?.name || "" }));
        if (!loadedDepartments.length) setNotice("No departments exist yet. Ask your workspace admin to add one before creating vouchers.");
      }
      setLoading(false);
    };
    void loadData();
  }, [displayName, session, user]);

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

  const pendingCount = vouchers.filter((voucher) => voucher.status === "Pending approval").length;
  const approvedCount = vouchers.filter((voucher) => voucher.status === "Approved").length;
  const totalValue = vouchers.reduce((sum, voucher) => sum + voucher.amount, 0);
  const latestMonth = vouchers.reduce((max, voucher) => (voucher.date.slice(0, 7) > max ? voucher.date.slice(0, 7) : max), "");
  const latestMonthTotal = latestMonth ? vouchers.filter((voucher) => voucher.date.slice(0, 7) === latestMonth).reduce((sum, voucher) => sum + voucher.amount, 0) : 0;
  const latestMonthLabel = latestMonth ? new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric" }).format(new Date(`${latestMonth}-01T00:00:00`)) : "";
  const approvalRate = vouchers.length ? Math.round((approvedCount / vouchers.length) * 100) : 0;
  const filteredVouchers = useMemo(() => vouchers.filter((voucher) => voucher.status !== "Approved").filter((voucher) => {
    const searchable = `${voucher.voucherNo} ${voucher.paidTo} ${voucher.beingPayment} ${voucher.reference}`.toLowerCase();
    return searchable.includes(search.toLowerCase()) && (statusFilter === "All statuses" || voucher.status === statusFilter) && (departmentFilter === "All departments" || voucher.department === departmentFilter) && (!dateFrom || voucher.date >= dateFrom) && (!dateTo || voucher.date <= dateTo);
  }), [dateFrom, dateTo, departmentFilter, search, statusFilter, vouchers]);

  const pendingPages = Math.max(1, Math.ceil(filteredVouchers.length / PAGE_SIZE));
  const safePage = Math.min(page, pendingPages);
  const pagedVouchers = filteredVouchers.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const pageSelected = pagedVouchers.length > 0 && pagedVouchers.every((voucher) => selected.includes(voucher.id));
  const everyFilteredSelected = filteredVouchers.length > 0 && filteredVouchers.every((voucher) => selected.includes(voucher.id));
  const selectedVouchers = vouchers.filter((voucher) => selected.includes(voucher.id));
  const selectedTotal = selectedVouchers.reduce((sum, voucher) => sum + voucher.amount, 0);
  const deleteTargetVouchers = deleteTarget ? vouchers.filter((voucher) => deleteTarget.includes(voucher.id)) : [];
  const deleteTargetTotal = deleteTargetVouchers.reduce((sum, voucher) => sum + voucher.amount, 0);
  const deleteTargetHasApproved = deleteTargetVouchers.some((voucher) => voucher.status === "Approved");

  const updateField = (field: keyof VoucherForm, value: string) => setForm((current) => ({ ...current, [field]: field === "amount" ? Number(value) : value }));
  const amountWords = amountToWords(form.amount, form.currency);

  const nextVoucherNo = async (dateStr: string, taken: Set<string>): Promise<string> => {
    const d = new Date(`${dateStr}T00:00:00`);
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const monthStart = `${d.getFullYear()}-${mm}-01`;
    const nextStart = d.getMonth() === 11 ? `${d.getFullYear() + 1}-01-01` : `${d.getFullYear()}-${String(d.getMonth() + 2).padStart(2, "0")}-01`;
    const { data } = await supabase.from("vouchers").select("voucher_no").gte("voucher_date", monthStart).lt("voucher_date", nextStart);
    let seq = 0;
    for (const row of ((data || []) as { voucher_no: string }[])) {
      const m = /(\d{4})$/.exec(row.voucher_no || "");
      if (m) seq = Math.max(seq, parseInt(m[1], 10));
    }
    for (let attempt = 0; attempt < 50; attempt++) {
      seq += 1;
      const candidate = `${dd}/${mm}/${String(seq).padStart(4, "0")}`;
      if (!taken.has(candidate)) {
        taken.add(candidate);
        return candidate;
      }
    }
    const fallback = `${dd}/${mm}/${Date.now().toString().slice(-4)}`;
    taken.add(fallback);
    return fallback;
  };

  const createVoucher = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canPrepare) { setNotice("Voucher creation is reserved for preparers."); return; }
    const selectedDepartment = departments.find((department) => department.name === form.department);
    if (!user || !selectedDepartment || !form.amount || !form.paidTo.trim() || !form.beingPayment.trim() || !form.preparedBy.trim()) {
      setNotice("Add the amount, department, payee, payment purpose and prepared by name to continue.");
      return;
    }
    const taken = new Set(vouchers.map((v) => v.voucherNo));
    let data: DbVoucher | null = null;
    let error: { message: string; code?: string } | null = null;
    for (let attempt = 0; attempt < 3 && !data; attempt++) {
      const voucherNo = await nextVoucherNo(form.date, taken);
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
      department_id: selectedDepartment.id,
      prepared_by: user.id,
      prepared_by_name: form.preparedBy.trim(),
      approved_by_name: form.approvedBy.trim() || null,
      status: "Pending approval",
      }).select().single();
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
      setNotice(error ? error.message : "Unable to create voucher.");
      return;
    }
    const mapped = mapVoucher(data, new Map(departments.map((department) => [department.id, department.name])));
    setVouchers((current) => [mapped, ...current]);
    setForm({ ...emptyForm, preparedBy: displayName, department: selectedDepartment.name });
    setShowComposer(false);
    setView("pending");
    setNotice(`${mapped.voucherNo} was saved and sent for approval.`);
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

  const exportSelected = () => setPrintVouchers(vouchers.filter((voucher) => selected.includes(voucher.id)));

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
      prepared_by: row.prepared_by,
      prepared_by_name: row.prepared_by_name,
      approved_by: row.approved_by ?? null,
      approved_by_name: row.approved_by_name ?? null,
      approved_at: row.approved_at ?? null,
      status: row.status,
    }));
    const { data, error } = await supabase.from("vouchers").insert(payload).select();
    setRestoring(false);
    setUndoRows([]);
    setUndoIds([]);
    if (error) { setNotice(`Could not restore those records: ${error.message}`); return; }
    const departmentMap = new Map(departments.map((department) => [department.id, department.name]));
    const restored = ((data || []) as DbVoucher[]).map((item) => mapVoucher(item, departmentMap));
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
    const { data, error } = await supabase.from("vouchers").update({ status: "Approved", approved_by: user.id, approved_by_name: displayName, approved_at: new Date().toISOString() }).eq("id", id).select().single();
    if (error) {
      setNotice(error.message);
      return;
    }
    const updated = mapVoucher(data as DbVoucher, new Map(departments.map((department) => [department.id, department.name])));
    setVouchers((current) => current.map((voucher) => voucher.id === id ? updated : voucher));
    setActiveVoucher(updated);
    setNotice("Voucher approved. It is ready to export for signing.");
  };

  const openCreate = () => {
    if (!canPrepare) { setNotice("Voucher creation is reserved for preparers."); return; }
    setNotice("");
    setForm({ ...emptyForm, date: new Date().toISOString().slice(0, 10), preparedBy: displayName, department: form.department || departments[0]?.name || "" });
    setShowComposer(true);
  };
  const navigate = (nextView: View) => {
    if (nextView === "settings") {
      setSettingsName((current) => current || profile?.full_name || "");
      setSettingsEmail((current) => current || user?.email || "");
    }
    setView(nextView);
    setShowMobileNav(false);
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
      setProfile((current) => (current ? { ...current, full_name: name } : current));
      setNotice("Display name updated.");
    }
    setSettingsBusy("");
  };
  const saveEmail = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextEmail = settingsEmail.trim();
    if (!nextEmail || nextEmail === user?.email) { setNotice("Enter a new email address."); return; }
    setSettingsBusy("email");
    setNotice("");
    const { error } = await supabase.auth.updateUser({ email: nextEmail });
    setSettingsBusy("");
    if (error) setNotice(error.message);
    else setNotice("Confirmation links sent. Your sign-in email changes once you confirm.");
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
    return searchable.includes(approvedSearch.toLowerCase()) && (approvedDept === "All departments" || voucher.department === approvedDept) && (!approvedFrom || voucher.date >= approvedFrom) && (!approvedTo || voucher.date <= approvedTo);
  }), [approvedDept, approvedFrom, approvedSearch, approvedTo, vouchers]);

  const approvedPages = Math.max(1, Math.ceil(approvedVouchers.length / PAGE_SIZE));
  const safeApprovedPage = Math.min(approvedPage, approvedPages);
  const pagedApproved = approvedVouchers.slice((safeApprovedPage - 1) * PAGE_SIZE, safeApprovedPage * PAGE_SIZE);
  const approvedPageSelected = pagedApproved.length > 0 && pagedApproved.every((voucher) => approvedSelected.includes(voucher.id));
  const everyApprovedSelected = approvedVouchers.length > 0 && approvedVouchers.every((voucher) => approvedSelected.includes(voucher.id));

  const toggleApproved = (id: string) => setApprovedSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  const toggleAllApproved = () => setApprovedSelected((current) => pagedApproved.every((voucher) => current.includes(voucher.id)) ? current.filter((id) => !pagedApproved.some((voucher) => voucher.id === id)) : [...current, ...pagedApproved.filter((voucher) => !current.includes(voucher.id)).map((voucher) => voucher.id)]);
  const toggleEveryApproved = () =>
    setApprovedSelected((current) =>
      everyApprovedSelected
        ? current.filter((id) => !approvedVouchers.some((voucher) => voucher.id === id))
        : Array.from(new Set([...current, ...approvedVouchers.map((voucher) => voucher.id)])),
    );
  const exportApproved = () => setPrintVouchers(approvedVouchers.filter((voucher) => approvedSelected.includes(voucher.id)));

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
    setImportDefaults((current) => ({ ...current, department: current.department || departments[0]?.name || "" }));
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
   * Builds the voucher numbers for a whole import up front: one query for the
   * affected months instead of one round trip per row.
   */
  const reserveVoucherNumbers = async (dates: string[]) => {
    const taken = new Set(vouchers.map((voucher) => voucher.voucherNo.trim()).filter(Boolean));
    const seqByMonth = new Map<string, number>();
    const bump = (dateIso: string, voucherNo: string) => {
      const match = /(\d{4})\s*$/.exec(voucherNo || "");
      if (!match || !dateIso) return;
      const key = dateIso.slice(0, 7);
      seqByMonth.set(key, Math.max(seqByMonth.get(key) ?? 0, parseInt(match[1], 10)));
    };
    vouchers.forEach((voucher) => bump(voucher.date, voucher.voucherNo));

    if (dates.length) {
      const sorted = [...new Set(dates)].sort();
      const from = `${sorted[0].slice(0, 7)}-01`;
      const lastYear = Number(sorted[sorted.length - 1].slice(0, 4));
      const lastMonth = Number(sorted[sorted.length - 1].slice(5, 7));
      const nextStart = new Date(lastYear, lastMonth, 1);
      const to = `${nextStart.getFullYear()}-${String(nextStart.getMonth() + 1).padStart(2, "0")}-01`;
      const { data, error } = await supabase
        .from("vouchers")
        .select("voucher_no, voucher_date")
        .gte("voucher_date", from)
        .lt("voucher_date", to);
      if (error) throw error;
      ((data || []) as { voucher_no: string; voucher_date: string }[]).forEach((row) =>
        bump(String(row.voucher_date).slice(0, 10), String(row.voucher_no)),
      );
    }
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
    const fallbackDept = departments.find((d) => d.name === "General") || departments[0];
    if (!fallbackDept) { setImportError("No departments exist. Ask your workspace admin to add one first."); return; }

    setImporting(true);
    setImportProgress(0);
    setImportError("");
    try {
      const pool = await reserveVoucherNumbers(valid.map((row) => row.date));
      const now = new Date().toISOString();
      const approved = importStatus === "Approved";
      const payload = valid.map((row) => {
        const dept = departments.find((d) => d.name.toLowerCase() === row.department.trim().toLowerCase()) || fallbackDept;
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
          department_id: dept.id,
          prepared_by: user.id,
          prepared_by_name: displayName,
          approved_by: approved ? user.id : null,
          approved_by_name: approved ? displayName : null,
          approved_at: approved ? now : null,
          status: importStatus,
        };
      });

      const inserted: DbVoucher[] = [];
      for (let index = 0; index < payload.length; index += IMPORT_CHUNK) {
        const chunk = payload.slice(index, index + IMPORT_CHUNK);
        const { data, error } = await supabase.from("vouchers").insert(chunk).select();
        if (error) {
          setImportError(`Imported ${inserted.length} of ${payload.length} rows, then stopped: ${error.message}`);
          return;
        }
        inserted.push(...((data || []) as DbVoucher[]));
        setImportProgress(inserted.length);
      }

      const departmentMap = new Map(departments.map((department) => [department.id, department.name]));
      const mapped = inserted.map((item) => mapVoucher(item, departmentMap));
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
    <div className="app-shell">
      <aside className={`sidebar ${showMobileNav ? "sidebar-open" : ""}`}>
        <div className="flex items-center justify-between"><Logo /><button className="mobile-close" onClick={() => setShowMobileNav(false)} aria-label="Close navigation"><X size={20} /></button></div>
        <div className="workspace-switcher"><div className="workspace-avatar">LA</div><div className="min-w-0"><div className="truncate text-xs font-bold text-[#1a253b]">Longhorn Associates</div><div className="mt-0.5 text-[10px] text-[#8490a5]">{userRole === "preparer" ? "Preparer workspace" : "Approval workspace"}</div></div><ChevronRight className="ml-auto text-[#a3abb9]" size={16} /></div>
        <div className="sidebar-label">Workspace</div><nav className="space-y-1"><NavItem active={view === "dashboard"} icon={LayoutDashboard} label="Overview" onClick={() => navigate("dashboard")} /><NavItem active={view === "pending"} icon={FileText} label="Pending vouchers" count={pendingCount} onClick={() => navigate("pending")} /><NavItem active={view === "approved"} icon={FileCheck2} label="Approved vouchers" count={approvedCount} onClick={() => navigate("approved")} /></nav>
        <div className="sidebar-label mt-8">Manage</div><nav className="space-y-1"><NavItem active={view === "settings"} icon={Settings2} label="Settings" onClick={() => navigate("settings")} /><NavItem active={false} icon={CircleHelp} label="Help centre" onClick={() => setNotice("Need help? Contact your workspace admin to update roles and departments.")} /></nav>
        <div className="mt-auto rounded-2xl bg-[#182238] p-4 text-white shadow-lg shadow-[#182238]/10"><div className="mb-3 flex h-8 w-8 items-center justify-center rounded-xl bg-[#D71939]"><Sparkles size={16} /></div><div className="text-sm font-semibold">Keep every payment accounted for.</div><p className="mt-1 text-[11px] leading-relaxed text-[#b9c2d2]">Create clean, signable vouchers your whole team can trust.</p></div>
        <div className="sidebar-user"><div className="avatar">{initials}</div><div className="min-w-0 flex-1"><div className="truncate text-xs font-semibold text-[#29344a]">{displayName}</div><div className="text-[10px] capitalize text-[#8b94a5]">{userRole}</div></div><button className="row-more" onClick={logout} aria-label="Sign out"><LogOut size={17} /></button></div>
      </aside>

      <main className="main-content"><header className="topbar"><button className="mobile-menu" onClick={() => setShowMobileNav(true)} aria-label="Open navigation"><Menu size={22} /></button><div className="hidden md:block"><div className="text-xs font-medium text-[#9aa3b2]">{todayLabel}</div><div className="mt-1 font-display text-lg font-semibold text-[#1a253b]">{greeting}, {displayName.split(" ")[0]} <span className="text-[#D71939]">↗</span></div></div><div className="ml-auto flex items-center gap-2 sm:gap-4"><button className="icon-button" aria-label="Notifications"><Bell size={18} /><span className="notification-dot" /></button><div className="topbar-separator" /><div className="hidden text-right sm:block"><div className="text-xs font-semibold text-[#29344a]">{displayName}</div><div className="text-[10px] capitalize text-[#9aa3b2]">{userRole}</div></div><div className="avatar">{initials}</div></div></header>
        <div className="content-wrap">{notice && <div className="notice"><Check size={16} /><span>{notice}</span>{undoRows.length > 0 && <Button className="notice-action" onClick={undoDelete} disabled={restoring}><Undo2 size={14} />{restoring ? "Restoring..." : "Undo"}</Button>}<button onClick={dismissNotice} aria-label="Dismiss"><X size={15} /></button></div>}
          {view === "dashboard" && <><div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line" /> FINANCE CONTROL CENTRE</div><h1>Payment overview</h1><p>A live view of every voucher moving through Longhorn.</p></div>{canPrepare && <Button onClick={openCreate} className="primary-action"><Plus size={17} /> New voucher</Button>}</div>
            <section className="metric-grid"><div className="metric-card metric-card-dark"><div className="metric-icon"><Banknote size={17} /></div><div className="metric-label">{latestMonthLabel ? `${latestMonthLabel} value` : "Total voucher value"}</div><div className="metric-value">{formatMoney(latestMonthTotal)}</div><div className="metric-foot"><ArrowUpRight size={14} /> Live workspace data</div><div className="metric-watermark">ZMW</div></div><div className="metric-card"><div className="metric-icon soft-red"><Clock3 size={17} /></div><div className="metric-label">Awaiting approval</div><div className="metric-value text-[#1a253b]">{String(pendingCount).padStart(2, "0")}</div><div className="metric-foot muted-foot">Updated live</div>{pendingCount > 0 && <div className="metric-badge">Needs attention</div>}</div><div className="metric-card"><div className="metric-icon soft-green"><BadgeCheck size={17} /></div><div className="metric-label">Approved records</div><div className="metric-value text-[#1a253b]">{String(approvedCount).padStart(2, "0")}</div><div className="metric-foot muted-foot">{approvalRate}% signable records</div><div className="mini-bars"><i /><i /><i /><i /><i /></div></div><div className="metric-card metric-card-red"><div className="metric-icon"><FileCheck2 size={17} /></div><div className="metric-label">Records on file</div><div className="metric-value">{String(vouchers.length).padStart(2, "0")}</div><div className="metric-foot">Up to date</div><div className="record-ring"><span>+{vouchers.length}</span></div></div></section>
            <div className="dashboard-grid"><section className="panel recent-panel"><div className="panel-heading"><div><h2>Recent vouchers</h2><p>Your latest activity</p></div><button className="text-link" onClick={() => navigate("pending")}>View all <ArrowUpRight size={14} /></button></div>{vouchers.length ? <div className="table-wrap"><table><thead><tr><th>Voucher</th><th>Paid to</th><th>Amount</th><th>Status</th></tr></thead><tbody>{vouchers.slice(0, 4).map((voucher) => <tr key={voucher.id} onClick={() => setActiveVoucher(voucher)}><td><div className="voucher-id">{voucher.voucherNo}</div><div className="table-sub">{formatDate(voucher.date)}</div></td><td><div className="payee-cell"><div className="payee-icon">{voucher.paidTo.slice(0, 1)}</div><span>{voucher.paidTo}</span></div></td><td className="amount-cell">{formatMoney(voucher.amount, voucher.currency)}</td><td><StatusBadge status={voucher.status} /></td></tr>)}</tbody></table></div> : <div className="empty-state"><div className="empty-art"><FileText size={27} /></div><h3>No vouchers yet</h3><p>Create the first voucher for this workspace.</p>{canPrepare && <Button onClick={openCreate} className="secondary-action"><Plus size={16} /> Create voucher</Button>}</div>}</section><section className="panel action-panel"><div className="panel-heading"><div><h2>Quick actions</h2><p>Move work forward</p></div><SlidersHorizontal size={17} className="text-[#9ca5b5]" /></div>{canPrepare && <button className="quick-action" onClick={openCreate}><span className="quick-action-icon red"><FilePlus2 size={18} /></span><span><b>Create a voucher</b><small>Start a new payment record</small></span><ChevronRight size={17} /></button>}<button className="quick-action" onClick={() => navigate("pending")}><span className="quick-action-icon navy"><Download size={18} /></span><span><b>Export for signing</b><small>Print selected vouchers to PDF</small></span><ChevronRight size={17} /></button><button className="quick-action" onClick={() => navigate("settings")}><span className="quick-action-icon gold"><Settings2 size={18} /></span><span><b>Account settings</b><small>Update your profile</small></span><ChevronRight size={17} /></button></section></div>
            <section className="insight-banner"><div className="insight-icon"><Stamp size={20} /></div><div><div className="eyebrow text-[#e2a6ae]"><span className="eyebrow-line bg-[#e2a6ae]" /> WORKFLOW INSIGHT</div><h3>Every voucher tells a complete story.</h3><p>Keep payment purpose, reference and signatures together for faster month-end reviews.</p></div><div className="insight-stat"><b>{formatMoney(totalValue)}</b><span>tracked value</span></div></section></>}

          {view === "pending" && <><div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line" /> PENDING APPROVAL</div><h1>Pending vouchers</h1><p>Review pending items and prepare records for signing.</p></div>{canPrepare && <Button onClick={openCreate} className="primary-action"><Plus size={17} /> New voucher</Button>}</div><section className="panel archive-panel"><div className="archive-toolbar"><div className="search-box"><Search size={17} /><input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Search voucher, payee or reference..." /></div><div className="filter-row"><select value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value as typeof statusFilter); setPage(1); }}><option value="All statuses">All pending</option><option>Pending approval</option><option>Draft</option></select><input type="date" value={dateFrom} max={dateTo || undefined} onChange={(event) => { setDateFrom(event.target.value); setPage(1); }} className="date-filter" aria-label="From date" title="From date" /><input type="date" value={dateTo} min={dateFrom || undefined} onChange={(event) => { setDateTo(event.target.value); setPage(1); }} className="date-filter" aria-label="To date" title="To date" /><button className="filter-button"><Filter size={15} /> <span className="hidden sm:inline">More filters</span></button></div></div><div className="selection-bar"><label className="check-control"><input type="checkbox" checked={pageSelected} onChange={toggleAll} /><span><Check size={12} /></span>Select all visible</label><span className="selection-count">{selected.length ? `${selected.length} selected` : `${filteredVouchers.length} records`}</span>{pageSelected && !everyFilteredSelected && filteredVouchers.length > pagedVouchers.length && <button className="select-all-link" onClick={toggleEveryFiltered}>Select all {filteredVouchers.length} vouchers</button>}{selected.length > 0 && <button className="select-all-link" onClick={clearSelected}>Clear selection</button>}<Button disabled={!selected.length} onClick={exportSelected} className="export-button"><Download size={15} /> Export selected PDF</Button>{canPrepare && <Button disabled={!selected.length} onClick={() => requestDelete(selected)} className="delete-button"><Trash2 size={15} /> Delete{selected.length ? ` (${selected.length})` : ""}</Button>}{canPrepare && <Button onClick={() => openImporter("Pending approval")} className="export-button"><Upload size={15} /> Import Excel / CSV</Button>}</div>{selected.length > 0 && <div className="selection-summary"><b>{selected.length} selected</b> worth {formatMoney(selectedTotal)}<span>{selectedVouchers.some((voucher) => voucher.status === "Draft") && ` · ${selectedVouchers.filter((voucher) => voucher.status === "Draft").length} draft`}</span></div>}<div className="table-wrap archive-table"><table><thead><tr><th className="check-col" /><th>Voucher no.</th><th>Paid to</th><th>Payment date</th><th>Amount</th><th>Status</th><th /></tr></thead><tbody>{pagedVouchers.map((voucher) => <tr key={voucher.id}><td className="check-col"><label className="check-control"><input type="checkbox" checked={selected.includes(voucher.id)} onChange={() => toggleSelected(voucher.id)} /><span><Check size={12} /></span></label></td><td><button className="voucher-link" onClick={() => setActiveVoucher(voucher)}>{voucher.voucherNo}</button><div className="table-sub">{voucher.reference || "No reference"}</div></td><td><div className="payee-cell"><div className="payee-icon">{voucher.paidTo.slice(0, 1)}</div><span>{voucher.paidTo}</span></div></td><td className="muted-cell">{formatDate(voucher.date)}</td><td className="amount-cell">{formatMoney(voucher.amount, voucher.currency)}</td><td><StatusBadge status={voucher.status} /></td><td><div className="row-actions">{canPrepare && <button className="row-more row-more-danger" onClick={() => requestDelete([voucher.id])} aria-label={`Delete ${voucher.voucherNo}`} title={`Delete ${voucher.voucherNo}`}><Trash2 size={16} /></button>}<button className="row-more" onClick={() => setActiveVoucher(voucher)} aria-label={`View ${voucher.voucherNo}`}><MoreHorizontal size={18} /></button></div></td></tr>)}</tbody></table>{!filteredVouchers.length && <div className="empty-state"><div className="empty-art"><FileText size={27} /></div><h3>No vouchers match these filters</h3><p>Try a different search or create a new payment record.</p>{canPrepare && <Button onClick={openCreate} className="secondary-action"><Plus size={16} /> Create voucher</Button>}</div>}{filteredVouchers.length > PAGE_SIZE && <div className="pagination-bar"><span className="page-info">Page {safePage} of {pendingPages} · {filteredVouchers.length} records</span><div className="page-buttons"><button className="page-button" disabled={safePage <= 1} onClick={() => setPage(safePage - 1)}>Previous</button>{pageNumbers(safePage, pendingPages).map((n) => <button key={n} className={`page-button${n === safePage ? " page-button-active" : ""}`} onClick={() => setPage(n)}>{n}</button>)}<button className="page-button" disabled={safePage >= pendingPages} onClick={() => setPage(safePage + 1)}>Next</button></div></div>}</div></section></>}
          {view === "approved" && <><div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line" /> SIGNED ARCHIVE</div><h1>Approved vouchers</h1><p>Search and export signed records for your files.</p></div></div><section className="panel archive-panel"><div className="archive-toolbar"><div className="search-box"><Search size={17} /><input value={approvedSearch} onChange={(event) => { setApprovedSearch(event.target.value); setApprovedPage(1); }} placeholder="Search voucher, payee or reference..." /></div><div className="filter-row"><input type="date" value={approvedFrom} max={approvedTo || undefined} onChange={(event) => { setApprovedFrom(event.target.value); setApprovedPage(1); }} className="date-filter" aria-label="From date" title="From date" /><input type="date" value={approvedTo} min={approvedFrom || undefined} onChange={(event) => { setApprovedTo(event.target.value); setApprovedPage(1); }} className="date-filter" aria-label="To date" title="To date" /></div></div><div className="selection-bar"><label className="check-control"><input type="checkbox" checked={approvedPageSelected} onChange={toggleAllApproved} /><span><Check size={12} /></span>Select all visible</label><span className="selection-count">{approvedSelected.length ? `${approvedSelected.length} selected` : `${approvedVouchers.length} records`}</span>{approvedPageSelected && !everyApprovedSelected && approvedVouchers.length > pagedApproved.length && <button className="select-all-link" onClick={toggleEveryApproved}>Select all {approvedVouchers.length} vouchers</button>}{approvedSelected.length > 0 && <button className="select-all-link" onClick={() => setApprovedSelected([])}>Clear selection</button>}<Button disabled={!approvedSelected.length} onClick={exportApproved} className="export-button"><Download size={15} /> Export selected PDF</Button>{canPrepare && <Button disabled={!approvedSelected.length} onClick={() => requestDelete(approvedSelected)} className="delete-button"><Trash2 size={15} /> Delete{approvedSelected.length ? ` (${approvedSelected.length})` : ""}</Button>}{canPrepare && <Button onClick={() => openImporter("Approved")} className="export-button"><Upload size={15} /> Import Excel / CSV</Button>}</div><div className="table-wrap archive-table"><table><thead><tr><th className="check-col" /><th>Voucher no.</th><th>Paid to</th><th>Payment date</th><th>Amount</th><th>Status</th><th /></tr></thead><tbody>{pagedApproved.map((voucher) => <tr key={voucher.id}><td className="check-col"><label className="check-control"><input type="checkbox" checked={approvedSelected.includes(voucher.id)} onChange={() => toggleApproved(voucher.id)} /><span><Check size={12} /></span></label></td><td><button className="voucher-link" onClick={() => setActiveVoucher(voucher)}>{voucher.voucherNo}</button><div className="table-sub">{voucher.reference || "No reference"}</div></td><td><div className="payee-cell"><div className="payee-icon">{voucher.paidTo.slice(0, 1)}</div><span>{voucher.paidTo}</span></div></td><td className="muted-cell">{formatDate(voucher.date)}</td><td className="amount-cell">{formatMoney(voucher.amount)}</td><td><StatusBadge status={voucher.status} /></td><td><div className="row-actions">{canPrepare && <button className="row-more row-more-danger" onClick={() => requestDelete([voucher.id])} aria-label={`Delete ${voucher.voucherNo}`} title={`Delete ${voucher.voucherNo}`}><Trash2 size={16} /></button>}<button className="row-more" onClick={() => setActiveVoucher(voucher)} aria-label={`View ${voucher.voucherNo}`}><MoreHorizontal size={18} /></button></div></td></tr>)}</tbody></table>{!approvedVouchers.length && <div className="empty-state"><div className="empty-art"><FileText size={27} /></div><h3>No approved vouchers yet</h3><p>Approved items move here automatically.</p></div>}{approvedVouchers.length > PAGE_SIZE && <div className="pagination-bar"><span className="page-info">Page {safeApprovedPage} of {approvedPages} · {approvedVouchers.length} records</span><div className="page-buttons"><button className="page-button" disabled={safeApprovedPage <= 1} onClick={() => setApprovedPage(safeApprovedPage - 1)}>Previous</button>{pageNumbers(safeApprovedPage, approvedPages).map((n) => <button key={n} className={`page-button${n === safeApprovedPage ? " page-button-active" : ""}`} onClick={() => setApprovedPage(n)}>{n}</button>)}<button className="page-button" disabled={safeApprovedPage >= approvedPages} onClick={() => setApprovedPage(safeApprovedPage + 1)}>Next</button></div></div>}</div></section></>}

{view === "settings" && <><div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line" /> ACCOUNT SETTINGS</div><h1>Settings</h1><p>Update your profile and sign-in credentials. Changes apply immediately.</p></div></div><div className="team-grid"><section className="panel team-summary"><div className="summary-hero"><div className="avatar" style={{ width: 46, height: 46, fontSize: 16 }}>{initials}</div><div><h2>{displayName}</h2><p>{user?.email || "No email on file"}</p></div><span className="admin-pill capitalize">{userRole}</span></div><div className="team-stat-row"><div><b>{userRole === "admin" || userRole === "approver" ? "Yes" : "No"}</b><span>Can approve</span></div><div><b>{departments.length}</b><span>Departments</span></div><div><b>{vouchers.filter((voucher) => voucher.preparedById === (user?.id || "")).length}</b><span>Prepared by you</span></div></div><div className="role-note"><ShieldCheck size={16} /><span><b>Secure workspace</b><small>Contact your workspace admin to change roles or departments.</small></span></div></section><section className="panel settings-panel"><div className="panel-heading"><div><h2>Sign-in &amp; profile</h2><p>Your account credentials</p></div><Settings2 size={17} className="text-[#9ca5b5]" /></div><div className="form-section-title"><span>01</span><div><b>Display name</b><small>Shown on vouchers you prepare</small></div></div><form onSubmit={saveDisplayName} className="grid gap-3"><label className="field"><span>Full name</span><Input value={settingsName} onChange={(event) => setSettingsName(event.target.value)} placeholder="Your full name" required /></label><div><Button type="submit" disabled={settingsBusy === "name"} className="secondary-action">{settingsBusy === "name" ? "Saving..." : "Save name"}</Button></div></form><div className="form-section-title divider"><span>02</span><div><b>Email address</b><small>Used for sign-in</small></div></div><form onSubmit={saveEmail} className="grid gap-3"><label className="field"><span>Email address</span><Input type="email" value={settingsEmail} onChange={(event) => setSettingsEmail(event.target.value)} placeholder="you@longhorn-associates.com" required /></label><div><Button type="submit" disabled={settingsBusy === "email"} className="secondary-action">{settingsBusy === "email" ? "Sending..." : "Change email"}</Button></div></form><div className="form-section-title divider"><span>03</span><div><b>Password</b><small>Minimum 6 characters</small></div></div><form onSubmit={savePassword} className="grid gap-3"><label className="field"><span>New password</span><Input type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} placeholder="Enter a new password" required /></label><label className="field"><span>Confirm new password</span><Input type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} placeholder="Repeat the new password" required /></label><div><Button type="submit" disabled={settingsBusy === "password"} className="secondary-action">{settingsBusy === "password" ? "Updating..." : "Update password"}</Button></div></form></section></div></>}
        </div>
      </main>

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
                      <span>Department for these rows</span>
                      <select value={importDefaults.department} onChange={(event) => patchImportDefaults("department", event.target.value)}>
                        {departments.length === 0 && <option value="">No departments yet</option>}
                        {departments.map((department) => <option key={department.id} value={department.name}>{department.name}</option>)}
                      </select>
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
      {showComposer && <div className="modal-backdrop" onMouseDown={() => setShowComposer(false)}><section className="composer" onMouseDown={(event) => event.stopPropagation()}><div className="composer-header"><div><div className="eyebrow"><span className="eyebrow-line" /> NEW RECORD</div><h2>Create payment voucher</h2><p>Capture the details once. Keep the approval trail complete.</p></div><button className="close-button" onClick={() => setShowComposer(false)}><X size={20} /></button></div><form onSubmit={createVoucher} className="composer-form"><div className="form-section-title"><span>01</span><div><b>Payment details</b><small>What is being paid?</small></div></div><div className="form-grid"><label className="field wide"><span>Amount paid <em>*</em></span><div className="amount-input"><select value={form.currency} onChange={(event) => updateField("currency", event.target.value)}><option>ZMW</option><option>USD</option><option>GBP</option></select><Input type="number" min="0" step="0.01" value={form.amount || ""} onChange={(event) => updateField("amount", event.target.value)} placeholder="0.00" /></div></label><label className="field"><span>Payment date <em>*</em></span><div className="input-icon"><CalendarDays size={15} /><Input type="date" value={form.date} onChange={(event) => updateField("date", event.target.value)} /></div></label><label className="field"><span>Amount in words</span><div className="words-preview"><Sparkles size={14} /><span>{amountWords}</span></div></label><label className="field wide"><span>Amount paid to <em>*</em></span><Input value={form.paidTo} onChange={(event) => updateField("paidTo", event.target.value)} placeholder="e.g. Petty Cash or supplier name" /></label><label className="field wide"><span>Being payment for <em>*</em></span><textarea value={form.beingPayment} onChange={(event) => updateField("beingPayment", event.target.value)} placeholder="Describe the purpose of this payment" rows={2} /></label></div><div className="form-section-title divider"><span>02</span><div><b>Sign-off owners</b><small>Who prepares and approves the voucher?</small></div></div><div className="form-grid"><label className="field"><span>Prepared by <em>*</em></span><div className="input-icon"><UserRound size={15} /><Input value={form.preparedBy} readOnly /></div></label><label className="field"><span>Approved by</span><div className="input-icon"><ShieldCheck size={15} /><Input value={form.approvedBy} onChange={(event) => updateField("approvedBy", event.target.value)} placeholder={userRole === "preparer" ? "Set when approved" : "Approver name for signature"} disabled={userRole === "preparer"} /></div></label></div>{notice && <div className="form-error">{notice}</div>}<div className="composer-footer"><span><ShieldCheck size={15} /> Saved securely</span><div className="flex gap-2"><Button type="button" onClick={() => setShowComposer(false)} className="cancel-button">Cancel</Button><Button type="submit" className="primary-action">Create voucher <ArrowUpRight size={16} /></Button></div></div></form></section></div>}

      {activeVoucher && <div className="modal-backdrop" onMouseDown={() => setActiveVoucher(null)}><section className="preview-modal" onMouseDown={(event) => event.stopPropagation()}><div className="preview-header"><div><div className="eyebrow"><span className="eyebrow-line" /> VOUCHER PREVIEW</div><h2>{activeVoucher.voucherNo}</h2><p>Created {formatDate(activeVoucher.date)} · {activeVoucher.department}</p></div><div className="flex items-center gap-2"><StatusBadge status={activeVoucher.status} /><button className="close-button" onClick={() => setActiveVoucher(null)}><X size={20} /></button></div></div><div className="preview-paper"><VoucherPrint voucher={activeVoucher} /></div><div className="preview-actions"><Button className="cancel-button" onClick={() => setActiveVoucher(null)}>Close</Button>{activeVoucher.status === "Pending approval" && (userRole === "admin" || userRole === "approver") && <Button className="approve-button" onClick={() => approveVoucher(activeVoucher.id)}><Check size={16} /> Approve voucher</Button>}<Button className="primary-action" onClick={() => setPrintVouchers([activeVoucher])}><Download size={16} /> Export PDF</Button></div></section></div>}
      {printVouchers.length > 0 && <div className="print-only">{printVouchers.map((voucher) => <VoucherPrint key={voucher.id} voucher={voucher} />)}</div>}

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
    </div>
  );
};

export default Index;

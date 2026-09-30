<<<<<<< HEAD
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
=======
import { useEffect, useMemo, useState, type FormEvent } from "react";
>>>>>>> c27fa6790a8eb0a14a327ccb370983ac5a548dfa
import {
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
  FileText,
  Filter,
  LayoutDashboard,
  LogOut,
  Menu,
  MoreHorizontal,
  PencilLine,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Stamp,
  UserRound,
  UsersRound,
  X,
} from "lucide-react";
import { useNavigate as useRouterNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
<<<<<<< HEAD
import Logo from "@/components/Logo";
import {
  approveVoucherRequest,
  createVoucherRequest,
  fetchDepartments,
  fetchMe,
  fetchTeam,
  fetchVouchers,
  type Voucher,
  type VoucherStatus,
} from "@/lib/api";
=======
import { supabase } from "@/integrations/supabase/client";
import { useSessionContext } from "@/components/SessionContextProvider";
>>>>>>> c27fa6790a8eb0a14a327ccb370983ac5a548dfa

type View = "dashboard" | "vouchers" | "team";

<<<<<<< HEAD
type VoucherForm = {
=======
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
>>>>>>> c27fa6790a8eb0a14a327ccb370983ac5a548dfa
  date: string;
  amount: number;
  currency: string;
  paidTo: string;
  beingPayment: string;
  paymentMethod: string;
  reference: string;
  department: string;
  departmentId: string;
  preparedBy: string;
  preparedById: string;
  approvedBy: string;
<<<<<<< HEAD
};

const fallbackDepartments = ["Finance", "Operations", "Human Resources", "Procurement", "Projects"];

=======
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
  status: VoucherStatus;
};

const paymentMethods = ["Bank transfer", "Petty cash", "Mobile money", "Cheque"];
>>>>>>> c27fa6790a8eb0a14a327ccb370983ac5a548dfa
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

const statusStyles: Record<VoucherStatus, string> = {
  Approved: "bg-[#e5f4ec] text-[#197447] border-[#bce3ca]",
  "Pending approval": "bg-[#fff3dc] text-[#9b650d] border-[#efd7a6]",
  Draft: "bg-[#eef0f5] text-[#5b6476] border-[#d8dce6]",
};

<<<<<<< HEAD
=======
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

const Logo = () => (
  <div className="flex items-center gap-3">
    <div className="brand-mark" aria-hidden="true"><span>LH</span></div>
    <div><div className="font-display text-[19px] font-semibold tracking-[-0.04em] text-[#182238]">longhorn</div><div className="-mt-1 text-[9px] font-semibold uppercase tracking-[0.3em] text-[#D71939]">associates</div></div>
  </div>
);

>>>>>>> c27fa6790a8eb0a14a327ccb370983ac5a548dfa
const NavItem = ({ active, icon: Icon, label, onClick, count }: { active: boolean; icon: typeof LayoutDashboard; label: string; onClick: () => void; count?: number }) => (
  <button onClick={onClick} className={`nav-item ${active ? "nav-item-active" : ""}`}><Icon size={18} strokeWidth={active ? 2.3 : 1.8} /><span>{label}</span>{count !== undefined && <span className="ml-auto rounded-full bg-[#fff4f5] px-2 py-0.5 text-[10px] font-bold text-[#D71939]">{count}</span>}</button>
);

const StatusBadge = ({ status }: { status: VoucherStatus }) => <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${statusStyles[status]}`}><span className="h-1.5 w-1.5 rounded-full bg-current" />{status}</span>;

const VoucherPrint = ({ voucher }: { voucher: Voucher }) => (
  <article className="print-voucher">
<<<<<<< HEAD
    <div className="print-brand-row">
      <Logo variant="red" height={58} />
    </div>
    <div className="print-rule" />
    <h1>PAYMENT VOUCHER</h1>
    <div className="print-meta-grid">
      <strong>PV NO. <span>{voucher.voucherNo}</span></strong>
      <strong>TPIN: <span>1009055576</span></strong>
      <strong>Date: <span>{formatDate(voucher.date)}</span></strong>
    </div>
    <div className="print-body">
      <div className="print-line"><b>Amount:</b><span className="amount-box">{formatMoney(voucher.amount, voucher.currency)}</span></div>
      <div className="print-line"><b>Amount paid to:</b><span>{voucher.paidTo}</span></div>
      <div className="print-line print-tall"><b>Amount in words:</b><span>{voucher.amountWords}</span></div>
      <div className="print-line print-tall"><b>Being Payment:</b><span>{voucher.beingPayment}</span></div>
      <div className="print-detail-row"><span><b>Department:</b> {voucher.department}</span><span><b>Payment:</b> {voucher.paymentMethod}</span><span><b>Reference:</b> {voucher.reference || "—"}</span></div>
    </div>
    <div className="print-signatures">
      <div><b>Prepared by:</b><span>{voucher.preparedBy || "________________________"}</span><em>Signature: __________________</em><small>Date: {formatDate(voucher.date)}</small></div>
      <div><b>Approved by:</b><span>{voucher.approvedBy || "________________________"}</span><em>Signature: __________________</em><small>Date: __________________</small></div>
    </div>
=======
    <div className="print-brand-row"><Logo /><div className="print-company-copy">Your Innovative Financing &amp; Investment Partner</div></div>
    <div className="print-rule" /><h1>PAYMENT VOUCHER</h1>
    <div className="print-meta-grid"><strong>PV NO. <span>{voucher.voucherNo}</span></strong><strong>TPIN: <span>1009055576</span></strong><strong>Date: <span>{formatDate(voucher.date)}</span></strong></div>
    <div className="print-body"><div className="print-line"><b>Amount:</b><span className="amount-box">{formatMoney(voucher.amount, voucher.currency)}</span></div><div className="print-line"><b>Amount paid to:</b><span>{voucher.paidTo}</span></div><div className="print-line print-tall"><b>Amount in words:</b><span>{voucher.amountWords}</span></div><div className="print-line print-tall"><b>Being Payment:</b><span>{voucher.beingPayment}</span></div><div className="print-detail-row"><span><b>Department:</b> {voucher.department}</span><span><b>Payment:</b> {voucher.paymentMethod}</span><span><b>Reference:</b> {voucher.reference || "—"}</span></div></div>
    <div className="print-signatures"><div><b>Prepared by:</b><span>{voucher.preparedBy || "________________________"}</span><em>Signature: __________________</em><small>Date: {formatDate(voucher.date)}</small></div><div><b>Approved by:</b><span>{voucher.approvedBy || "________________________"}</span><em>Signature: __________________</em><small>Date: __________________</small></div></div>
>>>>>>> c27fa6790a8eb0a14a327ccb370983ac5a548dfa
    <div className="print-footer">Ground Floor, Plot 1146 / 15 Lagos Road, Rhodes Park, P.O Box 50655, Ridgeway, Lusaka · Tel / Fax: +260 211 252 540 · info@longhorn-associates.com</div>
  </article>
);

const Index = () => {
  const routerNavigate = useRouterNavigate();
<<<<<<< HEAD
  const queryClient = useQueryClient();
  const [view, setView] = useState<View>("dashboard");
=======
  const { session, user } = useSessionContext();
  const [view, setView] = useState<View>("dashboard");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [vouchers, setVouchers] = useState<Voucher[]>([]);
  const [loading, setLoading] = useState(true);
>>>>>>> c27fa6790a8eb0a14a327ccb370983ac5a548dfa
  const [showComposer, setShowComposer] = useState(false);
  const [showMobileNav, setShowMobileNav] = useState(false);
  const [form, setForm] = useState<VoucherForm>(emptyForm);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"All statuses" | VoucherStatus>("All statuses");
  const [departmentFilter, setDepartmentFilter] = useState("All departments");
  const [selected, setSelected] = useState<string[]>([]);
  const [activeVoucher, setActiveVoucher] = useState<Voucher | null>(null);
  const [printVouchers, setPrintVouchers] = useState<Voucher[]>([]);
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [approvingId, setApprovingId] = useState("");

<<<<<<< HEAD
  // Live data from PostgreSQL (poll every 5s for real-time updates)
  const {
    data: vouchers = [],
    isLoading: vouchersLoading,
    isError: vouchersError,
    refetch: refetchVouchers,
  } = useQuery({ queryKey: ["vouchers"], queryFn: fetchVouchers, refetchInterval: 5000, refetchOnWindowFocus: true });
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: fetchMe, retry: false });
  const { data: departmentRows } = useQuery({ queryKey: ["departments"], queryFn: fetchDepartments, refetchInterval: 15000 });
  const { data: team } = useQuery({ queryKey: ["team"], queryFn: fetchTeam, refetchInterval: 15000 });

  const departments = useMemo(
    () => (departmentRows && departmentRows.length ? departmentRows.map((d) => d.name) : fallbackDepartments),
    [departmentRows],
  );

  // Default prepared-by to the signed-in user
  useEffect(() => {
    if (me && !form.preparedBy) setForm((current) => ({ ...current, preparedBy: me.fullName }));
  }, [me, form.preparedBy]);
=======
  const displayName = profile?.full_name || user?.user_metadata?.full_name || user?.email?.split("@")[0] || "Longhorn user";
  const userRole = profile?.role || "preparer";
  const initials = getInitials(displayName);
  const todayLabel = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "2-digit", month: "long", year: "numeric" }).format(new Date());

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
        const loadedDepartments = (departmentsResponse.data || []) as Department[];
        const departmentMap = new Map(loadedDepartments.map((department) => [department.id, department.name]));
        const loadedProfile = profileResponse.data as Profile | null;
        setProfile(loadedProfile);
        setDepartments(loadedDepartments);
        setVouchers(((vouchersResponse.data || []) as DbVoucher[]).map((row) => mapVoucher(row, departmentMap)));
        setForm((current) => ({ ...current, preparedBy: loadedProfile?.full_name || displayName, department: current.department || loadedDepartments[0]?.name || "" }));
      }
      setLoading(false);
    };
    void loadData();
  }, [displayName, session, user]);
>>>>>>> c27fa6790a8eb0a14a327ccb370983ac5a548dfa

  useEffect(() => {
    if (!printVouchers.length) return;
    let cancelled = false;
    const printWhenReady = async () => {
      // Wait for the logo image so it is included in the exported PDF
      const images = Array.from(document.querySelectorAll(".print-only img")) as HTMLImageElement[];
      await Promise.all(
        images.map(
          (img) =>
            img.complete
              ? Promise.resolve()
              : new Promise<void>((resolve) => {
                  const done = () => resolve();
                  img.addEventListener("load", done, { once: true });
                  img.addEventListener("error", done, { once: true });
                  window.setTimeout(done, 2500);
                }),
        ),
      );
      await new Promise((resolve) => window.setTimeout(resolve, 120));
      if (!cancelled) window.print();
    };
    printWhenReady();
    const clearPrint = () => setPrintVouchers([]);
    window.addEventListener("afterprint", clearPrint);
<<<<<<< HEAD
    return () => {
      cancelled = true;
      window.removeEventListener("afterprint", clearPrint);
    };
=======
    return () => { window.clearTimeout(timeout); window.removeEventListener("afterprint", clearPrint); };
>>>>>>> c27fa6790a8eb0a14a327ccb370983ac5a548dfa
  }, [printVouchers]);

  // Keep the preview in sync with live data
  useEffect(() => {
    if (!activeVoucher) return;
    const fresh = vouchers.find((v) => v.id === activeVoucher.id);
    if (fresh && fresh !== activeVoucher) setActiveVoucher(fresh);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vouchers]);

  const pendingCount = vouchers.filter((voucher) => voucher.status === "Pending approval").length;
  const approvedCount = vouchers.filter((voucher) => voucher.status === "Approved").length;
  const totalValue = vouchers.reduce((sum, voucher) => sum + voucher.amount, 0);
  const approvalRate = vouchers.length ? Math.round((approvedCount / vouchers.length) * 100) : 0;
  const filteredVouchers = useMemo(() => vouchers.filter((voucher) => {
    const searchable = `${voucher.voucherNo} ${voucher.paidTo} ${voucher.beingPayment} ${voucher.reference}`.toLowerCase();
    return searchable.includes(search.toLowerCase()) && (statusFilter === "All statuses" || voucher.status === statusFilter) && (departmentFilter === "All departments" || voucher.department === departmentFilter);
  }), [departmentFilter, search, statusFilter, vouchers]);

  const updateField = (field: keyof VoucherForm, value: string) =>
    setForm((current) => {
      if (field !== "amount") return { ...current, [field]: value };
      // Allow thousand separators while typing (e.g. 2,866); ignore invalid keystrokes
      const cleaned = value.replace(/[, ]/g, "");
      if (cleaned === "") return { ...current, amount: 0 };
      const parsed = Number(cleaned);
      if (Number.isNaN(parsed) || parsed < 0) return current;
      return { ...current, amount: parsed };
    });
  const amountWords = amountToWords(form.amount, form.currency);

<<<<<<< HEAD
  const createVoucher = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const missing: string[] = [];
    if (!form.date) missing.push("payment date");
    if (!form.amount || Number.isNaN(form.amount)) missing.push("amount");
    if (!form.paidTo.trim()) missing.push("payee (amount paid to)");
    if (!form.beingPayment.trim()) missing.push("payment purpose (being payment for)");
    if (missing.length) {
      setNotice(`Please complete the following: ${missing.join(", ")}.`);
      return;
    }
    setSaving(true);
    setNotice("");
    try {
      const result = await createVoucherRequest({ ...form, amountWords });
      await queryClient.invalidateQueries({ queryKey: ["vouchers"] });
      await queryClient.invalidateQueries({ queryKey: ["departments"] });
      await queryClient.invalidateQueries({ queryKey: ["team"] });
      setForm({ ...emptyForm, date: new Date().toISOString().slice(0, 10), preparedBy: me?.fullName || "" });
      setShowComposer(false);
      setView("vouchers");
      setNotice(`${result.voucher.voucherNo} created in PostgreSQL and sent for approval.`);
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : "Unable to create voucher.");
    } finally {
      setSaving(false);
    }
=======
  const createVoucher = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const selectedDepartment = departments.find((department) => department.name === form.department);
    if (!user || !selectedDepartment || !form.amount || !form.paidTo.trim() || !form.beingPayment.trim() || !form.preparedBy.trim()) {
      setNotice("Add the amount, department, payee, payment purpose and prepared by name to continue.");
      return;
    }
    const voucherNo = `PV-${String(new Date(form.date).getFullYear()).slice(-2)}-${String(Date.now()).slice(-6)}`;
    const { data, error } = await supabase.from("vouchers").insert({
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
    if (error) {
      setNotice(error.message);
      return;
    }
    const mapped = mapVoucher(data as DbVoucher, new Map(departments.map((department) => [department.id, department.name])));
    setVouchers((current) => [mapped, ...current]);
    setForm({ ...emptyForm, preparedBy: displayName, department: selectedDepartment.name });
    setShowComposer(false);
    setView("vouchers");
    setNotice(`${mapped.voucherNo} was saved to Supabase and sent for approval.`);
>>>>>>> c27fa6790a8eb0a14a327ccb370983ac5a548dfa
  };

  const toggleSelected = (id: string) => setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  const toggleAll = () => setSelected(selected.length === filteredVouchers.length ? [] : filteredVouchers.map((voucher) => voucher.id));
<<<<<<< HEAD
  const exportSelected = () => {
    const records = vouchers.filter((voucher) => selected.includes(voucher.id));
    if (!records.length) return;
    setPrintVouchers(records);
  };
  const approveVoucher = async (id: string) => {
    setApprovingId(id);
    setNotice("");
    try {
      await approveVoucherRequest(id);
      await queryClient.invalidateQueries({ queryKey: ["vouchers"] });
      setNotice("Voucher approved in PostgreSQL. It is ready to export for signing.");
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : "Unable to approve voucher.");
    } finally {
      setApprovingId("");
    }
=======
  const exportSelected = () => setPrintVouchers(vouchers.filter((voucher) => selected.includes(voucher.id)));

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
    setNotice("Voucher approved in Supabase. It is ready to export for signing.");
>>>>>>> c27fa6790a8eb0a14a327ccb370983ac5a548dfa
  };

  const openCreate = () => {
    setNotice("");
<<<<<<< HEAD
    setForm({ ...emptyForm, date: new Date().toISOString().slice(0, 10), preparedBy: me?.fullName || "" });
=======
    setForm({ ...emptyForm, date: new Date().toISOString().slice(0, 10), preparedBy: displayName, department: form.department || departments[0]?.name || "" });
>>>>>>> c27fa6790a8eb0a14a327ccb370983ac5a548dfa
    setShowComposer(true);
  };
  const navigate = (nextView: View) => { setView(nextView); setShowMobileNav(false); };
  const logout = async () => { await supabase.auth.signOut(); routerNavigate("/login", { replace: true }); };

  if (loading) return <div className="auth-loading"><div className="auth-loading-mark"><ShieldCheck size={20} /></div><span>Loading your Supabase workspace...</span></div>;

  const initials = (me?.fullName || "LA").split(" ").map((part) => part.slice(0, 1)).join("").slice(0, 2).toUpperCase();
  const displayName = me?.fullName || "Ledger user";
  const displayRole = me?.role ? me.role.charAt(0).toUpperCase() + me.role.slice(1) : "Member";

  return (
    <div className="app-shell">
      <aside className={`sidebar ${showMobileNav ? "sidebar-open" : ""}`}>
<<<<<<< HEAD
        <div className="flex items-center justify-between">
          <Logo />
          <button className="mobile-close" onClick={() => setShowMobileNav(false)} aria-label="Close navigation"><X size={20} /></button>
        </div>
        <div className="workspace-switcher">
          <div className="workspace-avatar">LA</div>
          <div className="min-w-0"><div className="truncate text-xs font-bold text-[#1a253b]">Longhorn Associates</div><div className="mt-0.5 flex items-center gap-1 text-[10px] text-[#8490a5]"><span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />Live · PostgreSQL</div></div>
          <ChevronRight className="ml-auto text-[#a3abb9]" size={16} />
        </div>
        <div className="sidebar-label">Workspace</div>
        <nav className="space-y-1">
          <NavItem active={view === "dashboard"} icon={LayoutDashboard} label="Overview" onClick={() => navigate("dashboard")} />
          <NavItem active={view === "vouchers"} icon={FileText} label="Payment vouchers" count={pendingCount} onClick={() => navigate("vouchers")} />
          <NavItem active={view === "team"} icon={UsersRound} label="Team & departments" onClick={() => navigate("team")} />
        </nav>
        <div className="sidebar-label mt-8">Manage</div>
        <nav className="space-y-1">
          <NavItem active={false} icon={Settings2} label="Settings" onClick={() => { setNotice("Workspace settings are managed by Finance Admin."); setShowMobileNav(false); }} />
          <NavItem active={false} icon={CircleHelp} label="Help centre" onClick={() => setNotice("Need help? Your Finance Admin can update roles and departments.")} />
        </nav>
        <div className="mt-auto rounded-2xl bg-[#182238] p-4 text-white shadow-lg shadow-[#182238]/10">
          <div className="mb-3 flex h-8 w-8 items-center justify-center rounded-xl bg-[#D71939]"><Sparkles size={16} /></div>
          <div className="text-sm font-semibold">Keep every payment accounted for.</div>
          <p className="mt-1 text-[11px] leading-relaxed text-[#b9c2d2]">Create clean, signable vouchers your whole team can trust.</p>
        </div>
        <div className="sidebar-user"><div className="avatar">{initials}</div><div className="min-w-0 flex-1"><div className="truncate text-xs font-semibold text-[#29344a]">{displayName}</div><div className="text-[10px] text-[#8b94a5]">{displayRole}</div></div><button className="row-more" onClick={logout} aria-label="Sign out"><LogOut size={17} /></button></div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <button className="mobile-menu" onClick={() => setShowMobileNav(true)} aria-label="Open navigation"><Menu size={22} /></button>
          <div className="hidden md:block"><div className="text-xs font-medium text-[#9aa3b2]">Wednesday, 09 September 2026</div><div className="mt-1 font-display text-lg font-semibold text-[#1a253b]">Good morning, {displayName.split(" ")[0]} <span className="text-[#D71939]">↗</span></div></div>
          <div className="ml-auto flex items-center gap-2 sm:gap-4"><button className="icon-button" aria-label="Notifications"><Bell size={18} /><span className="notification-dot" /></button><div className="topbar-separator" /><div className="hidden text-right sm:block"><div className="text-xs font-semibold text-[#29344a]">{displayName}</div><div className="text-[10px] text-[#9aa3b2]">{displayRole}</div></div><div className="avatar">{initials}</div></div>
        </header>

        <div className="content-wrap">
          {notice && <div className="notice"><Check size={16} /><span>{notice}</span><button onClick={() => setNotice("")}><X size={15} /></button></div>}
          {vouchersError && (
            <div className="notice"><X size={16} /><span>Unable to reach PostgreSQL. Check .env and run npm run db:seed.</span><button onClick={() => refetchVouchers()}>Retry</button></div>
          )}
          {view === "dashboard" && (
            <>
              <div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line" /> FINANCE CONTROL CENTRE</div><h1>Payment overview</h1><p>{vouchersLoading ? "Loading live vouchers from PostgreSQL…" : "A clear view of every voucher moving through Longhorn."}</p></div><Button onClick={openCreate} className="primary-action"><Plus size={17} /> New voucher</Button></div>
              <section className="metric-grid">
                <div className="metric-card metric-card-dark"><div className="metric-icon"><Banknote size={17} /></div><div className="metric-label">Total voucher value</div><div className="metric-value">{formatMoney(totalValue)}</div><div className="metric-foot"><ArrowUpRight size={14} /> Live from PostgreSQL</div><div className="metric-watermark">ZMW</div></div>
                <div className="metric-card"><div className="metric-icon soft-red"><Clock3 size={17} /></div><div className="metric-label">Awaiting approval</div><div className="metric-value text-[#1a253b]">{String(pendingCount).padStart(2, "0")}</div><div className="metric-foot muted-foot">Across {departments.length} departments</div><div className="metric-badge">Needs attention</div></div>
                <div className="metric-card"><div className="metric-icon soft-green"><BadgeCheck size={17} /></div><div className="metric-label">Approved this month</div><div className="metric-value text-[#1a253b]">{String(vouchers.filter((voucher) => voucher.status === "Approved").length).padStart(2, "0")}</div><div className="metric-foot muted-foot">100% signable records</div><div className="mini-bars"><i /><i /><i /><i /><i /></div></div>
                <div className="metric-card metric-card-red"><div className="metric-icon"><FileCheck2 size={17} /></div><div className="metric-label">Records on file</div><div className="metric-value">{String(vouchers.length).padStart(2, "0")}</div><div className="metric-foot">Ready for audit trail</div><div className="record-ring"><span>+{vouchers.length}</span></div></div>
              </section>
              <div className="dashboard-grid">
                <section className="panel recent-panel"><div className="panel-heading"><div><h2>Recent vouchers</h2><p>Your latest payment activity</p></div><button className="text-link" onClick={() => navigate("vouchers")}>View all <ArrowUpRight size={14} /></button></div><div className="table-wrap"><table><thead><tr><th>Voucher</th><th>Paid to</th><th>Amount</th><th>Status</th></tr></thead><tbody>{vouchers.slice(0, 4).map((voucher) => <tr key={voucher.id} onClick={() => setActiveVoucher(voucher)}><td><div className="voucher-id">{voucher.voucherNo}</div><div className="table-sub">{formatDate(voucher.date)}</div></td><td><div className="payee-cell"><div className="payee-icon">{voucher.paidTo.slice(0, 1)}</div><span>{voucher.paidTo}</span></div></td><td className="amount-cell">{formatMoney(voucher.amount)}</td><td><StatusBadge status={voucher.status} /></td></tr>)}</tbody></table></div></section>
                <section className="panel action-panel"><div className="panel-heading"><div><h2>Quick actions</h2><p>Move work forward</p></div><SlidersHorizontal size={17} className="text-[#9ca5b5]" /></div><button className="quick-action" onClick={openCreate}><span className="quick-action-icon red"><FilePlus2 size={18} /></span><span><b>Create a voucher</b><small>Start a new payment record</small></span><ChevronRight size={17} /></button><button className="quick-action" onClick={() => navigate("vouchers")}><span className="quick-action-icon navy"><Download size={18} /></span><span><b>Export for signing</b><small>Print selected vouchers to PDF</small></span><ChevronRight size={17} /></button><button className="quick-action" onClick={() => navigate("team")}><span className="quick-action-icon gold"><UsersRound size={18} /></span><span><b>Manage departments</b><small>Review access and approvers</small></span><ChevronRight size={17} /></button></section>
              </div>
              <section className="insight-banner"><div className="insight-icon"><Stamp size={20} /></div><div><div className="eyebrow text-[#e2a6ae]"><span className="eyebrow-line bg-[#e2a6ae]" /> WORKFLOW INSIGHT</div><h3>Every voucher tells a complete story.</h3><p>Keep payment purpose, reference and signatures together for faster month-end reviews.</p></div><div className="insight-stat"><b>{formatMoney(totalValue)}</b><span>tracked value</span></div></section>
            </>
          )}

          {view === "vouchers" && (
            <>
              <div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line" /> VOUCHER ARCHIVE</div><h1>Payment vouchers</h1><p>Search, review and prepare records for signing.</p></div><Button onClick={openCreate} className="primary-action"><Plus size={17} /> New voucher</Button></div>
              <section className="panel archive-panel">
                <div className="archive-toolbar"><div className="search-box"><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search voucher, payee or reference..." /></div><div className="filter-row"><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}><option>All statuses</option><option>Pending approval</option><option>Approved</option><option>Draft</option></select><select value={departmentFilter} onChange={(event) => setDepartmentFilter(event.target.value)}><option>All departments</option>{departments.map((department) => <option key={department}>{department}</option>)}</select><button className="filter-button"><Filter size={15} /> <span className="hidden sm:inline">More filters</span></button></div></div>
                <div className="selection-bar"><label className="check-control"><input type="checkbox" checked={filteredVouchers.length > 0 && selected.length === filteredVouchers.length} onChange={toggleAll} /><span><Check size={12} /></span>Select all visible</label><span className="selection-count">{selected.length ? `${selected.length} selected` : `${filteredVouchers.length} records`}</span><Button disabled={!selected.length} onClick={exportSelected} className="export-button"><Download size={15} /> Export selected PDF</Button></div>
                <div className="table-wrap archive-table"><table><thead><tr><th className="check-col" /><th>Voucher no.</th><th>Paid to</th><th>Department</th><th>Payment date</th><th>Amount</th><th>Status</th><th /></tr></thead><tbody>{filteredVouchers.map((voucher) => <tr key={voucher.id}><td className="check-col"><label className="check-control"><input type="checkbox" checked={selected.includes(voucher.id)} onChange={() => toggleSelected(voucher.id)} /><span><Check size={12} /></span></label></td><td><button className="voucher-link" onClick={() => setActiveVoucher(voucher)}>{voucher.voucherNo}</button><div className="table-sub">{voucher.reference || "No reference"}</div></td><td><div className="payee-cell"><div className="payee-icon">{voucher.paidTo.slice(0, 1)}</div><span>{voucher.paidTo}</span></div></td><td className="muted-cell">{voucher.department}</td><td className="muted-cell">{formatDate(voucher.date)}</td><td className="amount-cell">{formatMoney(voucher.amount)}</td><td><StatusBadge status={voucher.status} /></td><td><button className="row-more" onClick={() => setActiveVoucher(voucher)} aria-label={`View ${voucher.voucherNo}`}><MoreHorizontal size={18} /></button></td></tr>)}</tbody></table>{!vouchersLoading && !filteredVouchers.length && <div className="empty-state"><div className="empty-art"><FileText size={27} /></div><h3>No vouchers match these filters</h3><p>Try a different search or create your first record.</p><Button onClick={openCreate} className="secondary-action"><Plus size={16} /> Create voucher</Button></div>}</div>
              </section>
            </>
          )}

          {view === "team" && (
            <>
              <div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line" /> ADMINISTRATION</div><h1>Team &amp; departments</h1><p>Keep ownership and approvals clear across Longhorn.</p></div><Button onClick={() => setNotice("Invite links are available to workspace admins.")} className="secondary-action"><Plus size={17} /> Invite member</Button></div>
              <div className="team-grid">
                <section className="panel team-summary"><div className="summary-hero"><div className="summary-icon"><ShieldCheck size={22} /></div><div><h2>Admin controls</h2><p>You have full workspace access</p></div><span className="admin-pill">{displayRole}</span></div><div className="team-stat-row"><div><b>{String(team?.stats.memberCount ?? 0).padStart(2, "0")}</b><span>Team members</span></div><div><b>{team?.stats.departmentCount ?? departments.length}</b><span>Departments</span></div><div><b>{String(team?.stats.approverCount ?? 0).padStart(2, "0")}</b><span>Approvers</span></div></div><div className="role-note"><PencilLine size={16} /><span><b>Approval flow</b><small>Every voucher is routed to an approver before it can be exported.</small></span></div>
                  {(team?.members || []).map((member) => (
                    <div className="department-row" key={member.id}><div className="payee-icon">{member.fullName.slice(0, 1)}</div><div className="flex-1"><b>{member.fullName}</b><small>{member.email} · {member.role}</small></div><span>{member.isActive ? "Active" : "Inactive"}</span></div>
                  ))}
                </section>
                <section className="panel department-panel"><div className="panel-heading"><div><h2>Departments</h2><p>Voucher ownership by team</p></div><button className="icon-button"><Plus size={17} /></button></div>{(team?.departments || departmentRows || []).map((department, index) => <div className="department-row" key={typeof department === "string" ? department : department.id}><div className={`department-dot dot-${index}`} /><div className="flex-1"><b>{typeof department === "string" ? department : department.name}</b><small>{typeof department === "string" ? `${vouchers.filter((voucher) => voucher.department === department).length} vouchers` : `${department.voucherCount} vouchers`}</small></div><span>{typeof department === "string" ? vouchers.filter((voucher) => voucher.department === department).length : department.voucherCount} vouchers</span><ChevronRight size={16} className="text-[#adb4c1]" /></div>)}</section>
              </div>
            </>
          )}
        </div>
      </main>

      {showComposer && <div className="modal-backdrop" onMouseDown={() => setShowComposer(false)}><section className="composer" onMouseDown={(event) => event.stopPropagation()}><div className="composer-header"><div><div className="eyebrow"><span className="eyebrow-line" /> NEW RECORD</div><h2>Create payment voucher</h2><p>Capture the details once. Keep the approval trail complete.</p></div><button className="close-button" onClick={() => setShowComposer(false)}><X size={20} /></button></div><form onSubmit={createVoucher} className="composer-form"><div className="form-section-title"><span>01</span><div><b>Payment details</b><small>What is being paid?</small></div></div><div className="form-grid"><label className="field wide"><span>Amount paid <em>*</em></span><div className="amount-input"><select value={form.currency} onChange={(event) => updateField("currency", event.target.value)}><option>ZMW</option><option>USD</option><option>GBP</option></select><Input type="number" min="0" step="0.01" value={form.amount || ""} onChange={(event) => updateField("amount", event.target.value)} placeholder="0.00" /></div></label><label className="field"><span>Payment date <em>*</em></span><div className="input-icon"><CalendarDays size={15} /><Input type="date" value={form.date} onChange={(event) => updateField("date", event.target.value)} /></div></label><label className="field"><span>Amount in words</span><div className="words-preview"><Sparkles size={14} /><span>{amountWords}</span></div></label><label className="field wide"><span>Amount paid to <em>*</em></span><Input value={form.paidTo} onChange={(event) => updateField("paidTo", event.target.value)} placeholder="e.g. Petty Cash or supplier name" /></label><label className="field wide"><span>Being payment for <em>*</em></span><textarea value={form.beingPayment} onChange={(event) => updateField("beingPayment", event.target.value)} placeholder="Describe the purpose of this payment" rows={2} /></label></div><div className="form-section-title divider"><span>02</span><div><b>Sign-off owners</b><small>Who prepares and approves the voucher?</small></div></div><div className="form-grid"><label className="field"><span>Prepared by <em>*</em></span><div className="input-icon"><UserRound size={15} /><Input value={form.preparedBy} onChange={(event) => updateField("preparedBy", event.target.value)} placeholder="Full name" /></div></label><label className="field"><span>Approved by</span><div className="input-icon"><ShieldCheck size={15} /><Input value={form.approvedBy} onChange={(event) => updateField("approvedBy", event.target.value)} placeholder="Assigned on approval" disabled /></div></label></div>{notice && <div className="form-error">{notice}</div>}<div className="composer-footer"><span><ShieldCheck size={15} /> Saved live to PostgreSQL</span><div className="flex gap-2"><Button type="button" onClick={() => setShowComposer(false)} className="cancel-button">Cancel</Button><Button type="submit" disabled={saving} className="primary-action">{saving ? "Saving…" : "Create voucher"} <ArrowUpRight size={16} /></Button></div></div></form></section></div>}

      {activeVoucher && <div className="modal-backdrop" onMouseDown={() => setActiveVoucher(null)}><section className="preview-modal" onMouseDown={(event) => event.stopPropagation()}><div className="preview-header"><div><div className="eyebrow"><span className="eyebrow-line" /> VOUCHER PREVIEW</div><h2>{activeVoucher.voucherNo}</h2><p>Created {formatDate(activeVoucher.date)} · {activeVoucher.department}</p></div><div className="flex items-center gap-2"><StatusBadge status={activeVoucher.status} /><button className="close-button" onClick={() => setActiveVoucher(null)}><X size={20} /></button></div></div><div className="preview-paper"><VoucherPrint voucher={activeVoucher} /></div><div className="preview-actions"><Button className="cancel-button" onClick={() => setActiveVoucher(null)}>Close</Button>{activeVoucher.status === "Pending approval" && <Button className="approve-button" disabled={!!approvingId} onClick={() => approveVoucher(activeVoucher.id)}><Check size={16} /> {approvingId ? "Approving…" : "Approve voucher"}</Button>}<Button className="primary-action" onClick={() => setPrintVouchers([activeVoucher])}><Download size={16} /> Export PDF</Button></div></section></div>}
=======
        <div className="flex items-center justify-between"><Logo /><button className="mobile-close" onClick={() => setShowMobileNav(false)} aria-label="Close navigation"><X size={20} /></button></div>
        <div className="workspace-switcher"><div className="workspace-avatar">LA</div><div className="min-w-0"><div className="truncate text-xs font-bold text-[#1a253b]">Longhorn Associates</div><div className="mt-0.5 text-[10px] text-[#8490a5]">Supabase workspace</div></div><ChevronRight className="ml-auto text-[#a3abb9]" size={16} /></div>
        <div className="sidebar-label">Workspace</div><nav className="space-y-1"><NavItem active={view === "dashboard"} icon={LayoutDashboard} label="Overview" onClick={() => navigate("dashboard")} /><NavItem active={view === "vouchers"} icon={FileText} label="Payment vouchers" count={pendingCount} onClick={() => navigate("vouchers")} /><NavItem active={view === "team"} icon={UsersRound} label="Team & departments" onClick={() => navigate("team")} /></nav>
        <div className="sidebar-label mt-8">Manage</div><nav className="space-y-1"><NavItem active={false} icon={Settings2} label="Settings" onClick={() => setNotice("Workspace settings are managed through Supabase and your Finance Admin.")} /><NavItem active={false} icon={CircleHelp} label="Help centre" onClick={() => setNotice("Need help? Your Finance Admin can update roles and departments.")} /></nav>
        <div className="mt-auto rounded-2xl bg-[#182238] p-4 text-white shadow-lg shadow-[#182238]/10"><div className="mb-3 flex h-8 w-8 items-center justify-center rounded-xl bg-[#D71939]"><Sparkles size={16} /></div><div className="text-sm font-semibold">Keep every payment accounted for.</div><p className="mt-1 text-[11px] leading-relaxed text-[#b9c2d2]">Create clean, signable vouchers your whole team can trust.</p></div>
        <div className="sidebar-user"><div className="avatar">{initials}</div><div className="min-w-0 flex-1"><div className="truncate text-xs font-semibold text-[#29344a]">{displayName}</div><div className="text-[10px] capitalize text-[#8b94a5]">{userRole}</div></div><button className="row-more" onClick={logout} aria-label="Sign out"><LogOut size={17} /></button></div>
      </aside>

      <main className="main-content"><header className="topbar"><button className="mobile-menu" onClick={() => setShowMobileNav(true)} aria-label="Open navigation"><Menu size={22} /></button><div className="hidden md:block"><div className="text-xs font-medium text-[#9aa3b2]">{todayLabel}</div><div className="mt-1 font-display text-lg font-semibold text-[#1a253b]">Good morning, {displayName.split(" ")[0]} <span className="text-[#D71939]">↗</span></div></div><div className="ml-auto flex items-center gap-2 sm:gap-4"><button className="icon-button" aria-label="Notifications"><Bell size={18} /><span className="notification-dot" /></button><div className="topbar-separator" /><div className="hidden text-right sm:block"><div className="text-xs font-semibold text-[#29344a]">{displayName}</div><div className="text-[10px] capitalize text-[#9aa3b2]">{userRole}</div></div><div className="avatar">{initials}</div></div></header>
        <div className="content-wrap">{notice && <div className="notice"><Check size={16} /><span>{notice}</span><button onClick={() => setNotice("")}><X size={15} /></button></div>}
          {view === "dashboard" && <><div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line" /> FINANCE CONTROL CENTRE</div><h1>Payment overview</h1><p>A live view of every voucher moving through Longhorn.</p></div><Button onClick={openCreate} className="primary-action"><Plus size={17} /> New voucher</Button></div>
            <section className="metric-grid"><div className="metric-card metric-card-dark"><div className="metric-icon"><Banknote size={17} /></div><div className="metric-label">Total voucher value</div><div className="metric-value">{formatMoney(totalValue)}</div><div className="metric-foot"><ArrowUpRight size={14} /> Live Supabase data</div><div className="metric-watermark">ZMW</div></div><div className="metric-card"><div className="metric-icon soft-red"><Clock3 size={17} /></div><div className="metric-label">Awaiting approval</div><div className="metric-value text-[#1a253b]">{String(pendingCount).padStart(2, "0")}</div><div className="metric-foot muted-foot">Across {new Set(vouchers.map((voucher) => voucher.departmentId)).size} departments</div>{pendingCount > 0 && <div className="metric-badge">Needs attention</div>}</div><div className="metric-card"><div className="metric-icon soft-green"><BadgeCheck size={17} /></div><div className="metric-label">Approved records</div><div className="metric-value text-[#1a253b]">{String(approvedCount).padStart(2, "0")}</div><div className="metric-foot muted-foot">{approvalRate}% signable records</div><div className="mini-bars"><i /><i /><i /><i /><i /></div></div><div className="metric-card metric-card-red"><div className="metric-icon"><FileCheck2 size={17} /></div><div className="metric-label">Records on file</div><div className="metric-value">{String(vouchers.length).padStart(2, "0")}</div><div className="metric-foot">Synced from database</div><div className="record-ring"><span>+{vouchers.length}</span></div></div></section>
            <div className="dashboard-grid"><section className="panel recent-panel"><div className="panel-heading"><div><h2>Recent vouchers</h2><p>Your latest Supabase activity</p></div><button className="text-link" onClick={() => navigate("vouchers")}>View all <ArrowUpRight size={14} /></button></div>{vouchers.length ? <div className="table-wrap"><table><thead><tr><th>Voucher</th><th>Paid to</th><th>Amount</th><th>Status</th></tr></thead><tbody>{vouchers.slice(0, 4).map((voucher) => <tr key={voucher.id} onClick={() => setActiveVoucher(voucher)}><td><div className="voucher-id">{voucher.voucherNo}</div><div className="table-sub">{formatDate(voucher.date)}</div></td><td><div className="payee-cell"><div className="payee-icon">{voucher.paidTo.slice(0, 1)}</div><span>{voucher.paidTo}</span></div></td><td className="amount-cell">{formatMoney(voucher.amount, voucher.currency)}</td><td><StatusBadge status={voucher.status} /></td></tr>)}</tbody></table></div> : <div className="empty-state"><div className="empty-art"><FileText size={27} /></div><h3>No vouchers yet</h3><p>Create the first voucher for this workspace.</p><Button onClick={openCreate} className="secondary-action"><Plus size={16} /> Create voucher</Button></div>}</section><section className="panel action-panel"><div className="panel-heading"><div><h2>Quick actions</h2><p>Move work forward</p></div><SlidersHorizontal size={17} className="text-[#9ca5b5]" /></div><button className="quick-action" onClick={openCreate}><span className="quick-action-icon red"><FilePlus2 size={18} /></span><span><b>Create a voucher</b><small>Start a new database record</small></span><ChevronRight size={17} /></button><button className="quick-action" onClick={() => navigate("vouchers")}><span className="quick-action-icon navy"><Download size={18} /></span><span><b>Export for signing</b><small>Print selected vouchers to PDF</small></span><ChevronRight size={17} /></button><button className="quick-action" onClick={() => navigate("team")}><span className="quick-action-icon gold"><UsersRound size={18} /></span><span><b>Manage departments</b><small>Review Supabase workspace access</small></span><ChevronRight size={17} /></button></section></div>
            <section className="insight-banner"><div className="insight-icon"><Stamp size={20} /></div><div><div className="eyebrow text-[#e2a6ae]"><span className="eyebrow-line bg-[#e2a6ae]" /> WORKFLOW INSIGHT</div><h3>Every voucher tells a complete story.</h3><p>Keep payment purpose, reference and signatures together for faster month-end reviews.</p></div><div className="insight-stat"><b>{formatMoney(totalValue)}</b><span>tracked value</span></div></section></>}

          {view === "vouchers" && <><div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line" /> VOUCHER ARCHIVE</div><h1>Payment vouchers</h1><p>Search, review and prepare database records for signing.</p></div><Button onClick={openCreate} className="primary-action"><Plus size={17} /> New voucher</Button></div><section className="panel archive-panel"><div className="archive-toolbar"><div className="search-box"><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search voucher, payee or reference..." /></div><div className="filter-row"><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}><option>All statuses</option><option>Pending approval</option><option>Approved</option><option>Draft</option></select><select value={departmentFilter} onChange={(event) => setDepartmentFilter(event.target.value)}><option>All departments</option>{departments.map((department) => <option key={department.id}>{department.name}</option>)}</select><button className="filter-button"><Filter size={15} /> <span className="hidden sm:inline">More filters</span></button></div></div><div className="selection-bar"><label className="check-control"><input type="checkbox" checked={filteredVouchers.length > 0 && selected.length === filteredVouchers.length} onChange={toggleAll} /><span><Check size={12} /></span>Select all visible</label><span className="selection-count">{selected.length ? `${selected.length} selected` : `${filteredVouchers.length} records`}</span><Button disabled={!selected.length} onClick={exportSelected} className="export-button"><Download size={15} /> Export selected PDF</Button></div><div className="table-wrap archive-table"><table><thead><tr><th className="check-col" /><th>Voucher no.</th><th>Paid to</th><th>Department</th><th>Payment date</th><th>Amount</th><th>Status</th><th /></tr></thead><tbody>{filteredVouchers.map((voucher) => <tr key={voucher.id}><td className="check-col"><label className="check-control"><input type="checkbox" checked={selected.includes(voucher.id)} onChange={() => toggleSelected(voucher.id)} /><span><Check size={12} /></span></label></td><td><button className="voucher-link" onClick={() => setActiveVoucher(voucher)}>{voucher.voucherNo}</button><div className="table-sub">{voucher.reference || "No reference"}</div></td><td><div className="payee-cell"><div className="payee-icon">{voucher.paidTo.slice(0, 1)}</div><span>{voucher.paidTo}</span></div></td><td className="muted-cell">{voucher.department}</td><td className="muted-cell">{formatDate(voucher.date)}</td><td className="amount-cell">{formatMoney(voucher.amount, voucher.currency)}</td><td><StatusBadge status={voucher.status} /></td><td><button className="row-more" onClick={() => setActiveVoucher(voucher)} aria-label={`View ${voucher.voucherNo}`}><MoreHorizontal size={18} /></button></td></tr>)}</tbody></table>{!filteredVouchers.length && <div className="empty-state"><div className="empty-art"><FileText size={27} /></div><h3>No vouchers match these filters</h3><p>Try a different search or create a new database record.</p><Button onClick={openCreate} className="secondary-action"><Plus size={16} /> Create voucher</Button></div>}</div></section></>}

          {view === "team" && <><div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line" /> ADMINISTRATION</div><h1>Team &amp; departments</h1><p>Keep ownership and approvals clear across Longhorn.</p></div><Button onClick={() => setNotice("Invite users from Supabase Authentication, then assign their profile role and department.")} className="secondary-action"><Plus size={17} /> Invite member</Button></div><div className="team-grid"><section className="panel team-summary"><div className="summary-hero"><div className="summary-icon"><ShieldCheck size={22} /></div><div><h2>Admin controls</h2><p>Database-backed workspace access</p></div><span className="admin-pill capitalize">{userRole}</span></div><div className="team-stat-row"><div><b>{profile ? "1" : "0"}</b><span>Current user</span></div><div><b>{departments.length}</b><span>Departments</span></div><div><b>{userRole === "admin" || userRole === "approver" ? "Yes" : "No"}</b><span>Can approve</span></div></div><div className="role-note"><PencilLine size={16} /><span><b>Approval flow</b><small>Every voucher is routed to an approver before it can be exported.</small></span></div></section><section className="panel department-panel"><div className="panel-heading"><div><h2>Departments</h2><p>Live department records</p></div><button className="icon-button" onClick={() => setNotice("Create departments from your Supabase administration workflow.")}><Plus size={17} /></button></div>{departments.map((department, index) => <div className="department-row" key={department.id}><div className={`department-dot dot-${index}`} /><div className="flex-1"><b>{department.name}</b><small>{department.description || "Department workspace"}</small></div><span>{vouchers.filter((voucher) => voucher.departmentId === department.id).length} vouchers</span><ChevronRight size={16} className="text-[#adb4c1]" /></div>)}{!departments.length && <div className="empty-state"><div className="empty-art"><UsersRound size={27} /></div><h3>No departments configured</h3><p>Add departments in Supabase before creating vouchers.</p></div>}</section></div></>}
        </div>
      </main>

      {showComposer && <div className="modal-backdrop" onMouseDown={() => setShowComposer(false)}><section className="composer" onMouseDown={(event) => event.stopPropagation()}><div className="composer-header"><div><div className="eyebrow"><span className="eyebrow-line" /> NEW RECORD</div><h2>Create payment voucher</h2><p>Capture the details once. Keep the approval trail complete.</p></div><button className="close-button" onClick={() => setShowComposer(false)}><X size={20} /></button></div><form onSubmit={createVoucher} className="composer-form"><div className="form-section-title"><span>01</span><div><b>Payment details</b><small>What is being paid?</small></div></div><div className="form-grid"><label className="field wide"><span>Amount paid <em>*</em></span><div className="amount-input"><select value={form.currency} onChange={(event) => updateField("currency", event.target.value)}><option>ZMW</option><option>USD</option><option>GBP</option></select><Input type="number" min="0" step="0.01" value={form.amount || ""} onChange={(event) => updateField("amount", event.target.value)} placeholder="0.00" /></div></label><label className="field"><span>Payment date <em>*</em></span><div className="input-icon"><CalendarDays size={15} /><Input type="date" value={form.date} onChange={(event) => updateField("date", event.target.value)} /></div></label><label className="field"><span>Amount in words</span><div className="words-preview"><Sparkles size={14} /><span>{amountWords}</span></div></label><label className="field wide"><span>Amount paid to <em>*</em></span><Input value={form.paidTo} onChange={(event) => updateField("paidTo", event.target.value)} placeholder="e.g. Petty Cash or supplier name" /></label><label className="field wide"><span>Being payment for <em>*</em></span><textarea value={form.beingPayment} onChange={(event) => updateField("beingPayment", event.target.value)} placeholder="Describe the purpose of this payment" rows={2} /></label></div><div className="form-section-title divider"><span>02</span><div><b>Payment trail</b><small>Make reconciliation effortless</small></div></div><div className="form-grid"><label className="field"><span>Payment method</span><select value={form.paymentMethod} onChange={(event) => updateField("paymentMethod", event.target.value)}>{paymentMethods.map((method) => <option key={method}>{method}</option>)}</select></label><label className="field"><span>Reference / invoice no.</span><Input value={form.reference} onChange={(event) => updateField("reference", event.target.value)} placeholder="e.g. INV-1029" /></label><label className="field wide"><span>Department <em>*</em></span><select value={form.department} onChange={(event) => updateField("department", event.target.value)}><option value="">Select department</option>{departments.map((department) => <option key={department.id} value={department.name}>{department.name}</option>)}</select></label></div><div className="form-section-title divider"><span>03</span><div><b>Sign-off owners</b><small>Who prepares and approves the voucher?</small></div></div><div className="form-grid"><label className="field"><span>Prepared by <em>*</em></span><div className="input-icon"><UserRound size={15} /><Input value={form.preparedBy} readOnly /></div></label><label className="field"><span>Approved by</span><div className="input-icon"><ShieldCheck size={15} /><Input value={form.approvedBy} onChange={(event) => updateField("approvedBy", event.target.value)} placeholder="Approver name for signature" /></div></label></div>{notice && <div className="form-error">{notice}</div>}<div className="composer-footer"><span><ShieldCheck size={15} /> Saved securely in Supabase</span><div className="flex gap-2"><Button type="button" onClick={() => setShowComposer(false)} className="cancel-button">Cancel</Button><Button type="submit" className="primary-action">Create voucher <ArrowUpRight size={16} /></Button></div></div></form></section></div>}
>>>>>>> c27fa6790a8eb0a14a327ccb370983ac5a548dfa

      {activeVoucher && <div className="modal-backdrop" onMouseDown={() => setActiveVoucher(null)}><section className="preview-modal" onMouseDown={(event) => event.stopPropagation()}><div className="preview-header"><div><div className="eyebrow"><span className="eyebrow-line" /> VOUCHER PREVIEW</div><h2>{activeVoucher.voucherNo}</h2><p>Created {formatDate(activeVoucher.date)} · {activeVoucher.department}</p></div><div className="flex items-center gap-2"><StatusBadge status={activeVoucher.status} /><button className="close-button" onClick={() => setActiveVoucher(null)}><X size={20} /></button></div></div><div className="preview-paper"><VoucherPrint voucher={activeVoucher} /></div><div className="preview-actions"><Button className="cancel-button" onClick={() => setActiveVoucher(null)}>Close</Button>{activeVoucher.status === "Pending approval" && (userRole === "admin" || userRole === "approver") && <Button className="approve-button" onClick={() => approveVoucher(activeVoucher.id)}><Check size={16} /> Approve voucher</Button>}<Button className="primary-action" onClick={() => setPrintVouchers([activeVoucher])}><Download size={16} /> Export PDF</Button></div></section></div>}
      {printVouchers.length > 0 && <div className="print-only">{printVouchers.map((voucher) => <VoucherPrint key={voucher.id} voucher={voucher} />)}</div>}
    </div>
  );
};

export default Index;

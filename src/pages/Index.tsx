import { useEffect, useMemo, useState } from "react";
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type VoucherStatus = "Draft" | "Pending approval" | "Approved";
type View = "dashboard" | "vouchers" | "team";

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
  preparedBy: string;
  approvedBy: string;
  status: VoucherStatus;
};

type VoucherForm = Omit<Voucher, "id" | "voucherNo" | "amountWords" | "status">;

const STORAGE_KEY = "longhorn-ledger-vouchers";
const departments = ["Finance", "Operations", "Human Resources", "Procurement", "Projects"];
const paymentMethods = ["Bank transfer", "Petty cash", "Mobile money", "Cheque"];

const sampleVouchers: Voucher[] = [
  {
    id: "pv-0035",
    voucherNo: "PV-26-0035",
    date: "2026-08-31",
    amount: 2866,
    currency: "ZMW",
    paidTo: "Petty Cash",
    beingPayment: "Solwezi petty cash replenishment",
    amountWords: "Two Thousand Eight Hundred and Sixty Six Kwacha Only",
    paymentMethod: "Petty cash",
    reference: "PC-SOL-0831",
    department: "Operations",
    preparedBy: "Tezza Mutepeka",
    approvedBy: "Izukanji Mwanza",
    status: "Approved",
  },
  {
    id: "pv-0034",
    voucherNo: "PV-26-0034",
    date: "2026-08-29",
    amount: 12450,
    currency: "ZMW",
    paidTo: "Copperbelt Couriers Ltd",
    beingPayment: "August logistics and delivery services",
    amountWords: "Twelve Thousand Four Hundred and Fifty Kwacha Only",
    paymentMethod: "Bank transfer",
    reference: "INV-CCL-8821",
    department: "Procurement",
    preparedBy: "Naledi Phiri",
    approvedBy: "James Banda",
    status: "Pending approval",
  },
  {
    id: "pv-0033",
    voucherNo: "PV-26-0033",
    date: "2026-08-26",
    amount: 3780,
    currency: "ZMW",
    paidTo: "Lusaka Office Supplies",
    beingPayment: "Stationery and print supplies",
    amountWords: "Three Thousand Seven Hundred and Eighty Kwacha Only",
    paymentMethod: "Mobile money",
    reference: "LOS-44109",
    department: "Finance",
    preparedBy: "Chanda Mulenga",
    approvedBy: "Izukanji Mwanza",
    status: "Approved",
  },
  {
    id: "pv-0032",
    voucherNo: "PV-26-0032",
    date: "2026-08-22",
    amount: 950,
    currency: "ZMW",
    paidTo: "M. Kunda",
    beingPayment: "Staff transport reimbursement",
    amountWords: "Nine Hundred and Fifty Kwacha Only",
    paymentMethod: "Petty cash",
    reference: "TR-0822-14",
    department: "Human Resources",
    preparedBy: "Tezza Mutepeka",
    approvedBy: "James Banda",
    status: "Draft",
  },
];

const emptyForm: VoucherForm = {
  date: new Date().toISOString().slice(0, 10),
  amount: 0,
  currency: "ZMW",
  paidTo: "",
  beingPayment: "",
  paymentMethod: "Bank transfer",
  reference: "",
  department: "Finance",
  preparedBy: "",
  approvedBy: "",
};

const readVouchers = (): Voucher[] => {
  if (typeof window === "undefined") return sampleVouchers;
  const saved = window.localStorage.getItem(STORAGE_KEY);
  if (!saved) return sampleVouchers;
  try {
    return JSON.parse(saved) as Voucher[];
  } catch {
    return sampleVouchers;
  }
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

const statusStyles: Record<VoucherStatus, string> = {
  Approved: "bg-[#e5f4ec] text-[#197447] border-[#bce3ca]",
  "Pending approval": "bg-[#fff3dc] text-[#9b650d] border-[#efd7a6]",
  Draft: "bg-[#eef0f5] text-[#5b6476] border-[#d8dce6]",
};

const Logo = () => (
  <div className="flex items-center gap-3">
    <div className="brand-mark" aria-hidden="true">
      <span>LH</span>
    </div>
    <div>
      <div className="font-display text-[19px] font-semibold tracking-[-0.04em] text-[#182238]">longhorn</div>
      <div className="-mt-1 text-[9px] font-semibold uppercase tracking-[0.3em] text-[#D71939]">associates</div>
    </div>
  </div>
);

const NavItem = ({ active, icon: Icon, label, onClick, count }: { active: boolean; icon: typeof LayoutDashboard; label: string; onClick: () => void; count?: number }) => (
  <button onClick={onClick} className={`nav-item ${active ? "nav-item-active" : ""}`}>
    <Icon size={18} strokeWidth={active ? 2.3 : 1.8} />
    <span>{label}</span>
    {count !== undefined && <span className="ml-auto rounded-full bg-[#fff4f5] px-2 py-0.5 text-[10px] font-bold text-[#D71939]">{count}</span>}
  </button>
);

const StatusBadge = ({ status }: { status: VoucherStatus }) => <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${statusStyles[status]}`}><span className="h-1.5 w-1.5 rounded-full bg-current" />{status}</span>;

const VoucherPrint = ({ voucher }: { voucher: Voucher }) => (
  <article className="print-voucher">
    <div className="print-brand-row">
      <Logo />
      <div className="print-company-copy">Your Innovative Financing &amp; Investment Partner</div>
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
    <div className="print-footer">Ground Floor, Plot 1146 / 15 Lagos Road, Rhodes Park, P.O Box 50655, Ridgeway, Lusaka · Tel / Fax: +260 211 252 540 · info@longhorn-associates.com</div>
  </article>
);

const Index = () => {
  const [view, setView] = useState<View>("dashboard");
  const [vouchers, setVouchers] = useState<Voucher[]>(readVouchers);
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

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(vouchers));
  }, [vouchers]);

  useEffect(() => {
    if (!printVouchers.length) return;
    const timeout = window.setTimeout(() => window.print(), 150);
    const clearPrint = () => setPrintVouchers([]);
    window.addEventListener("afterprint", clearPrint);
    return () => {
      window.clearTimeout(timeout);
      window.removeEventListener("afterprint", clearPrint);
    };
  }, [printVouchers]);

  const pendingCount = vouchers.filter((voucher) => voucher.status === "Pending approval").length;
  const totalValue = vouchers.reduce((sum, voucher) => sum + voucher.amount, 0);
  const filteredVouchers = useMemo(() => vouchers.filter((voucher) => {
    const searchable = `${voucher.voucherNo} ${voucher.paidTo} ${voucher.beingPayment} ${voucher.reference}`.toLowerCase();
    return searchable.includes(search.toLowerCase()) && (statusFilter === "All statuses" || voucher.status === statusFilter) && (departmentFilter === "All departments" || voucher.department === departmentFilter);
  }), [departmentFilter, search, statusFilter, vouchers]);

  const updateField = (field: keyof VoucherForm, value: string) => setForm((current) => ({ ...current, [field]: field === "amount" ? Number(value) : value }));
  const amountWords = amountToWords(form.amount, form.currency);

  const createVoucher = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!form.amount || !form.paidTo.trim() || !form.beingPayment.trim() || !form.preparedBy.trim()) {
      setNotice("Add the amount, payee, payment purpose and prepared by name to continue.");
      return;
    }
    const nextNumber = Math.max(...vouchers.map((voucher) => Number(voucher.voucherNo.split("-").pop()) || 0), 0) + 1;
    const newVoucher: Voucher = {
      ...form,
      id: `pv-${Date.now()}`,
      voucherNo: `PV-${String(new Date(form.date).getFullYear()).slice(-2)}-${String(nextNumber).padStart(4, "0")}`,
      amountWords,
      status: "Pending approval",
    };
    setVouchers((current) => [newVoucher, ...current]);
    setForm(emptyForm);
    setShowComposer(false);
    setView("vouchers");
    setNotice(`${newVoucher.voucherNo} created and sent for approval.`);
  };

  const toggleSelected = (id: string) => setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  const toggleAll = () => setSelected(selected.length === filteredVouchers.length ? [] : filteredVouchers.map((voucher) => voucher.id));
  const exportSelected = () => {
    const records = vouchers.filter((voucher) => selected.includes(voucher.id));
    if (!records.length) return;
    setPrintVouchers(records);
  };
  const approveVoucher = (id: string) => {
    setVouchers((current) => current.map((voucher) => voucher.id === id ? { ...voucher, status: "Approved", approvedBy: voucher.approvedBy || "Finance Admin" } : voucher));
    setActiveVoucher((current) => current && current.id === id ? { ...current, status: "Approved", approvedBy: current.approvedBy || "Finance Admin" } : current);
    setNotice("Voucher approved. It is ready to export for signing.");
  };

  const openCreate = () => {
    setNotice("");
    setForm({ ...emptyForm, date: new Date().toISOString().slice(0, 10) });
    setShowComposer(true);
  };

  const navigate = (nextView: View) => {
    setView(nextView);
    setShowMobileNav(false);
  };

  return (
    <div className="app-shell">
      <aside className={`sidebar ${showMobileNav ? "sidebar-open" : ""}`}>
        <div className="flex items-center justify-between">
          <Logo />
          <button className="mobile-close" onClick={() => setShowMobileNav(false)} aria-label="Close navigation"><X size={20} /></button>
        </div>
        <div className="workspace-switcher">
          <div className="workspace-avatar">LA</div>
          <div className="min-w-0"><div className="truncate text-xs font-bold text-[#1a253b]">Longhorn Associates</div><div className="mt-0.5 text-[10px] text-[#8490a5]">Finance workspace</div></div>
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
        <div className="sidebar-user"><div className="avatar">TM</div><div className="min-w-0 flex-1"><div className="truncate text-xs font-semibold text-[#29344a]">Tezza Mutepeka</div><div className="text-[10px] text-[#8b94a5]">Finance Admin</div></div><MoreHorizontal size={17} className="text-[#929baa]" /></div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <button className="mobile-menu" onClick={() => setShowMobileNav(true)} aria-label="Open navigation"><Menu size={22} /></button>
          <div className="hidden md:block"><div className="text-xs font-medium text-[#9aa3b2]">Wednesday, 09 September 2026</div><div className="mt-1 font-display text-lg font-semibold text-[#1a253b]">Good morning, Tezza <span className="text-[#D71939]">↗</span></div></div>
          <div className="ml-auto flex items-center gap-2 sm:gap-4"><button className="icon-button" aria-label="Notifications"><Bell size={18} /><span className="notification-dot" /></button><div className="topbar-separator" /><div className="hidden text-right sm:block"><div className="text-xs font-semibold text-[#29344a]">Tezza Mutepeka</div><div className="text-[10px] text-[#9aa3b2]">Finance Admin</div></div><div className="avatar">TM</div></div>
        </header>

        <div className="content-wrap">
          {notice && <div className="notice"><Check size={16} /><span>{notice}</span><button onClick={() => setNotice("")}><X size={15} /></button></div>}
          {view === "dashboard" && (
            <>
              <div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line" /> FINANCE CONTROL CENTRE</div><h1>Payment overview</h1><p>A clear view of every voucher moving through Longhorn.</p></div><Button onClick={openCreate} className="primary-action"><Plus size={17} /> New voucher</Button></div>
              <section className="metric-grid">
                <div className="metric-card metric-card-dark"><div className="metric-icon"><Banknote size={17} /></div><div className="metric-label">Total voucher value</div><div className="metric-value">{formatMoney(totalValue)}</div><div className="metric-foot"><ArrowUpRight size={14} /> 12.8% from last month</div><div className="metric-watermark">ZMW</div></div>
                <div className="metric-card"><div className="metric-icon soft-red"><Clock3 size={17} /></div><div className="metric-label">Awaiting approval</div><div className="metric-value text-[#1a253b]">{String(pendingCount).padStart(2, "0")}</div><div className="metric-foot muted-foot">Across 3 departments</div><div className="metric-badge">Needs attention</div></div>
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
              <section className="panel archive-panel"><div className="archive-toolbar"><div className="search-box"><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search voucher, payee or reference..." /></div><div className="filter-row"><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}><option>All statuses</option><option>Pending approval</option><option>Approved</option><option>Draft</option></select><select value={departmentFilter} onChange={(event) => setDepartmentFilter(event.target.value)}><option>All departments</option>{departments.map((department) => <option key={department}>{department}</option>)}</select><button className="filter-button"><Filter size={15} /> <span className="hidden sm:inline">More filters</span></button></div></div><div className="selection-bar"><label className="check-control"><input type="checkbox" checked={filteredVouchers.length > 0 && selected.length === filteredVouchers.length} onChange={toggleAll} /><span><Check size={12} /></span>Select all visible</label><span className="selection-count">{selected.length ? `${selected.length} selected` : `${filteredVouchers.length} records`}</span><Button disabled={!selected.length} onClick={exportSelected} className="export-button"><Download size={15} /> Export selected PDF</Button></div><div className="table-wrap archive-table"><table><thead><tr><th className="check-col" /><th>Voucher no.</th><th>Paid to</th><th>Department</th><th>Payment date</th><th>Amount</th><th>Status</th><th /></tr></thead><tbody>{filteredVouchers.map((voucher) => <tr key={voucher.id}><td className="check-col"><label className="check-control"><input type="checkbox" checked={selected.includes(voucher.id)} onChange={() => toggleSelected(voucher.id)} /><span><Check size={12} /></span></label></td><td><button className="voucher-link" onClick={() => setActiveVoucher(voucher)}>{voucher.voucherNo}</button><div className="table-sub">{voucher.reference || "No reference"}</div></td><td><div className="payee-cell"><div className="payee-icon">{voucher.paidTo.slice(0, 1)}</div><span>{voucher.paidTo}</span></div></td><td className="muted-cell">{voucher.department}</td><td className="muted-cell">{formatDate(voucher.date)}</td><td className="amount-cell">{formatMoney(voucher.amount)}</td><td><StatusBadge status={voucher.status} /></td><td><button className="row-more" onClick={() => setActiveVoucher(voucher)} aria-label={`View ${voucher.voucherNo}`}><MoreHorizontal size={18} /></button></td></tr>)}</tbody></table>{!filteredVouchers.length && <div className="empty-state"><div className="empty-art"><FileText size={27} /></div><h3>No vouchers match these filters</h3><p>Try a different search or create your first record.</p><Button onClick={openCreate} className="secondary-action"><Plus size={16} /> Create voucher</Button></div>}</div></section>
            </>
          )}

          {view === "team" && (
            <>
              <div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line" /> ADMINISTRATION</div><h1>Team &amp; departments</h1><p>Keep ownership and approvals clear across Longhorn.</p></div><Button onClick={() => setNotice("Invite links are available to workspace admins.")} className="secondary-action"><Plus size={17} /> Invite member</Button></div>
              <div className="team-grid"><section className="panel team-summary"><div className="summary-hero"><div className="summary-icon"><ShieldCheck size={22} /></div><div><h2>Admin controls</h2><p>You have full workspace access</p></div><span className="admin-pill">Admin</span></div><div className="team-stat-row"><div><b>12</b><span>Team members</span></div><div><b>{departments.length}</b><span>Departments</span></div><div><b>04</b><span>Approvers</span></div></div><div className="role-note"><PencilLine size={16} /><span><b>Approval flow</b><small>Every voucher is routed to an approver before it can be exported.</small></span></div></section><section className="panel department-panel"><div className="panel-heading"><div><h2>Departments</h2><p>Voucher ownership by team</p></div><button className="icon-button"><Plus size={17} /></button></div>{departments.map((department, index) => <div className="department-row" key={department}><div className={`department-dot dot-${index}`} /><div className="flex-1"><b>{department}</b><small>{index === 0 ? "You · 4 members" : `${index + 2} members · ${index % 2 ? "1 approver" : "2 approvers"}`}</small></div><span>{vouchers.filter((voucher) => voucher.department === department).length} vouchers</span><ChevronRight size={16} className="text-[#adb4c1]" /></div>)}</section></div>
            </>
          )}
        </div>
      </main>

      {showComposer && <div className="modal-backdrop" onMouseDown={() => setShowComposer(false)}><section className="composer" onMouseDown={(event) => event.stopPropagation()}><div className="composer-header"><div><div className="eyebrow"><span className="eyebrow-line" /> NEW RECORD</div><h2>Create payment voucher</h2><p>Capture the details once. Keep the approval trail complete.</p></div><button className="close-button" onClick={() => setShowComposer(false)}><X size={20} /></button></div><form onSubmit={createVoucher} className="composer-form"><div className="form-section-title"><span>01</span><div><b>Payment details</b><small>What is being paid?</small></div></div><div className="form-grid"><label className="field wide"><span>Amount paid <em>*</em></span><div className="amount-input"><select value={form.currency} onChange={(event) => updateField("currency", event.target.value)}><option>ZMW</option><option>USD</option><option>GBP</option></select><Input type="number" min="0" step="0.01" value={form.amount || ""} onChange={(event) => updateField("amount", event.target.value)} placeholder="0.00" /></div></label><label className="field"><span>Payment date <em>*</em></span><div className="input-icon"><CalendarDays size={15} /><Input type="date" value={form.date} onChange={(event) => updateField("date", event.target.value)} /></div></label><label className="field"><span>Amount in words</span><div className="words-preview"><Sparkles size={14} /><span>{amountWords}</span></div></label><label className="field wide"><span>Amount paid to <em>*</em></span><Input value={form.paidTo} onChange={(event) => updateField("paidTo", event.target.value)} placeholder="e.g. Petty Cash or supplier name" /></label><label className="field wide"><span>Being payment for <em>*</em></span><textarea value={form.beingPayment} onChange={(event) => updateField("beingPayment", event.target.value)} placeholder="Describe the purpose of this payment" rows={2} /></label></div><div className="form-section-title divider"><span>02</span><div><b>Payment trail</b><small>Make reconciliation effortless</small></div></div><div className="form-grid"><label className="field"><span>Payment method</span><select value={form.paymentMethod} onChange={(event) => updateField("paymentMethod", event.target.value)}>{paymentMethods.map((method) => <option key={method}>{method}</option>)}</select></label><label className="field"><span>Reference / invoice no.</span><Input value={form.reference} onChange={(event) => updateField("reference", event.target.value)} placeholder="e.g. INV-1029" /></label><label className="field wide"><span>Department</span><select value={form.department} onChange={(event) => updateField("department", event.target.value)}>{departments.map((department) => <option key={department}>{department}</option>)}</select></label></div><div className="form-section-title divider"><span>03</span><div><b>Sign-off owners</b><small>Who prepares and approves the voucher?</small></div></div><div className="form-grid"><label className="field"><span>Prepared by <em>*</em></span><div className="input-icon"><UserRound size={15} /><Input value={form.preparedBy} onChange={(event) => updateField("preparedBy", event.target.value)} placeholder="Full name" /></div></label><label className="field"><span>Approved by</span><div className="input-icon"><ShieldCheck size={15} /><Input value={form.approvedBy} onChange={(event) => updateField("approvedBy", event.target.value)} placeholder="Approver name" /></div></label></div>{notice && <div className="form-error">{notice}</div>}<div className="composer-footer"><span><ShieldCheck size={15} /> Saved securely in this browser</span><div className="flex gap-2"><Button type="button" onClick={() => setShowComposer(false)} className="cancel-button">Cancel</Button><Button type="submit" className="primary-action">Create voucher <ArrowUpRight size={16} /></Button></div></div></form></section></div>}

      {activeVoucher && <div className="modal-backdrop" onMouseDown={() => setActiveVoucher(null)}><section className="preview-modal" onMouseDown={(event) => event.stopPropagation()}><div className="preview-header"><div><div className="eyebrow"><span className="eyebrow-line" /> VOUCHER PREVIEW</div><h2>{activeVoucher.voucherNo}</h2><p>Created {formatDate(activeVoucher.date)} · {activeVoucher.department}</p></div><div className="flex items-center gap-2"><StatusBadge status={activeVoucher.status} /><button className="close-button" onClick={() => setActiveVoucher(null)}><X size={20} /></button></div></div><div className="preview-paper"><VoucherPrint voucher={activeVoucher} /></div><div className="preview-actions"><Button className="cancel-button" onClick={() => setActiveVoucher(null)}>Close</Button>{activeVoucher.status === "Pending approval" && <Button className="approve-button" onClick={() => approveVoucher(activeVoucher.id)}><Check size={16} /> Approve voucher</Button>}<Button className="primary-action" onClick={() => setPrintVouchers([activeVoucher])}><Download size={16} /> Export PDF</Button></div></section></div>}

      {printVouchers.length > 0 && <div className="print-only">{printVouchers.map((voucher) => <VoucherPrint key={voucher.id} voucher={voucher} />)}</div>}
    </div>
  );
};

export default Index;

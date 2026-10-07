import { useMemo } from "react";
import {
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Filter,
  Search,
  ShieldCheck,
  Stamp,
  TriangleAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import CompanyChip from "@/components/CompanyChip";
import type { Company, Voucher, VoucherStatus } from "@/lib/types";

type ApprovalsPanelProps = {
  vouchers: Voucher[];
  companies: Company[];
  branchOptions: Company[];
  companyFilter: string;
  onCompanyFilterChange: (value: string) => void;
  month: string;
  onMonthChange: (value: string) => void;
  monthsWithVouchers: string[];
  search: string;
  onSearchChange: (value: string) => void;
  // No department filter. A voucher's department is its branch, and the branch
  // filter above already narrows to one, so a second control could only ever
  // agree with it or contradict it.
  selected: string[];
  onToggle: (id: string) => void;
  onToggleAll: () => void;
  onClearSelection: () => void;
  allSelected: boolean;
  selectableCount: number;
  selectedCount: number;
  totalValue: number;
  selectedTotal: number;
  monthSettled: boolean;
  canApprove: boolean;
  onApproveAll: () => void;
  onApproveOne: (voucher: Voucher) => void;
  formatMoney: (amount: number, currency?: string) => string;
  formatDate: (date: string) => string;
};

const StatusBadge = ({ status }: { status: VoucherStatus }) => (
  <span className="status-pill status-pending">{status}</span>
);

/** "2026-08" -> "August 2026". */
const monthLabel = (month: string) =>
  new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric" }).format(new Date(`${month}-01T00:00:00`));

const monthValue = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
const shiftMonth = (month: string, by: number) => {
  const [year, index] = month.split("-").map(Number);
  return monthValue(new Date(year, index - 1 + by, 1));
};

const initial = (name: string) =>
  name.split(" ").filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "LH";

/**
 * Monthly sign-off for approvers.
 *
 * Approving a month one voucher at a time is a lot of clicks, so this picks a
 * single month, shows everything still waiting in it, and lets the whole month be
 * approved in one action. Only completed months can be cleared in bulk, since the
 * current month is still collecting vouchers.
 */
const ApprovalsPanel = ({
  vouchers,
  branchOptions,
  companyFilter,
  onCompanyFilterChange,
  month,
  onMonthChange,
  monthsWithVouchers,
  search,
  onSearchChange,
  selected,
  onToggle,
  onToggleAll,
  onClearSelection,
  allSelected,
  selectableCount,
  selectedCount,
  totalValue,
  selectedTotal,
  monthSettled,
  canApprove,
  onApproveAll,
  onApproveOne,
  formatMoney,
  formatDate,
}: ApprovalsPanelProps) => {
  // Group by preparer so the approver can see who is behind each batch.
  const byPreparer = useMemo(() => {
    const groups = new Map<string, { name: string; count: number; value: number }>();
    for (const voucher of vouchers) {
      const key = voucher.preparedBy || "Unknown";
      const entry = groups.get(key) ?? { name: key, count: 0, value: 0 };
      entry.count += 1;
      entry.value += voucher.amount;
      groups.set(key, entry);
    }
    return [...groups.values()].sort((a, b) => b.count - a.count);
  }, [vouchers]);

  const currentMonth = monthValue(new Date());
  const isCurrent = month === currentMonth;
  const nextMonthPossible = monthsWithVouchers.length === 0 || monthsWithVouchers[0] > month;

  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">
            <span className="eyebrow-line" /> MONTHLY SIGN-OFF
          </div>
          <h1>Approve a month</h1>
          <p>Pick one month, review what is waiting, and clear the lot in a single action.</p>
        </div>
      </div>

      {/* ------------------------------------------------------ month picker */}
      <section className="panel month-panel">
        <div className="month-picker">
          <button
            className="month-step"
            onClick={() => onMonthChange(shiftMonth(month, -1))}
            aria-label="Previous month"
          >
            <ChevronLeft size={17} />
          </button>
          <div className="month-current">
            <CalendarDays size={15} />
            <div className="min-w-0">
              <div className="font-display truncate text-[17px] font-semibold text-[#1a253b]">
                {monthLabel(month)}
              </div>
              <div className="text-[10px] text-[#9aa3b2]">
                {vouchers.length === 0
                  ? "Nothing waiting"
                  : `${vouchers.length} waiting · ${formatMoney(totalValue)}`}
              </div>
            </div>
          </div>
          <button
            className="month-step"
            onClick={() => onMonthChange(shiftMonth(month, 1))}
            aria-label="Next month"
            // Never step past the newest month that holds anything.
            disabled={!nextMonthPossible}
          >
            <ChevronRight size={17} />
          </button>
        </div>

        {monthsWithVouchers.length > 0 && (
          <div className="month-chips">
            {monthsWithVouchers.slice(0, 6).map((value) => (
              <button
                key={value}
                className={`month-chip ${value === month ? "month-chip-active" : ""}`}
                onClick={() => onMonthChange(value)}
              >
                {monthLabel(value).replace(" 20", " '")}
              </button>
            ))}
          </div>
        )}
      </section>

      {!monthSettled && (
        <div className="notice notice-warn">
          <TriangleAlert size={16} />
          <span>
            {isCurrent
              ? "This is the current month, which is still collecting vouchers. Approve single vouchers here, or wait until the month has closed to clear the whole lot."
              : "Only closed months can be approved in one action, so nothing is signed off while it is still filling up."}
          </span>
        </div>
      )}

      {/* ---------------------------------------------------------- the list */}
      <section className="panel archive-panel">
        <div className="archive-toolbar">
          <div className="search-box">
            <Search size={17} />
            <input
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder="Search voucher, payee or preparer..."
            />
          </div>
          <div className="filter-row">
            {branchOptions.length > 1 && (
              <select
                value={companyFilter}
                onChange={(event) => onCompanyFilterChange(event.target.value)}
                title="Filter by branch"
                aria-label="Filter by branch"
              >
                <option value="All companies">All companies</option>
                {branchOptions.map((company) => (
                  <option key={company.id} value={company.name}>
                    {company.name}
                  </option>
                ))}
              </select>
            )}
            <span className="filter-button">
              <Filter size={15} /> <span className="hidden sm:inline">Filtered</span>
            </span>
          </div>
        </div>

        {vouchers.length > 0 && (
          <div className="selection-bar">
            <label className="check-control">
              <input type="checkbox" checked={allSelected} onChange={onToggleAll} />
              <span>
                <Check size={12} />
              </span>
              Select all in {monthLabel(month)}
            </label>
            <span className="selection-count">
              {selectedCount ? `${selectedCount} of ${selectableCount} selected` : `${selectableCount} to approve`}
            </span>
            {selectedCount > 0 && (
              <button className="select-all-link" onClick={onClearSelection}>
                Clear selection
              </button>
            )}
            <Button
              disabled={!selectedCount || !monthSettled || !canApprove}
              onClick={onApproveAll}
              className="approve-button"
            >
              <Stamp size={15} /> Approve {selectedCount || ""} at once
            </Button>
          </div>
        )}

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th style={{ width: 38 }} />
                <th>Voucher</th>
                <th>Paid to</th>
                <th>Prepared by</th>
                <th>Branch</th>
                <th>Amount</th>
                <th style={{ width: 118 }} />
              </tr>
            </thead>
            <tbody>
              {vouchers.map((voucher) => (
                <tr key={voucher.id} className={selected.includes(voucher.id) ? "row-selected" : ""}>
                  <td>
                    <label className="check-control">
                      <input
                        type="checkbox"
                        checked={selected.includes(voucher.id)}
                        onChange={() => onToggle(voucher.id)}
                        aria-label={`Select ${voucher.voucherNo}`}
                      />
                      <span>
                        <Check size={12} />
                      </span>
                    </label>
                  </td>
                  <td>
                    <div className="voucher-id">{voucher.voucherNo}</div>
                    <div className="table-sub">{formatDate(voucher.date)}</div>
                  </td>
                  <td>
                    <div className="payee-cell">
                      <div className="payee-icon">{voucher.paidTo.slice(0, 1)}</div>
                      <div className="min-w-0">
                        <div className="truncate">{voucher.paidTo}</div>
                        <div className="table-sub truncate">{voucher.beingPayment}</div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <div className="flex items-center gap-2">
                      <div className="avatar" style={{ width: 25, height: 25, flexBasis: 25, fontSize: 9 }}>
                        {initial(voucher.preparedBy)}
                      </div>
                      <span className="truncate">{voucher.preparedBy}</span>
                    </div>
                  </td>
                  <td>
                    <CompanyChip
                      name={voucher.companyName}
                      code={voucher.companyCode}
                      color={voucher.companyColor}
                      variant="full"
                    />
                  </td>
                  <td className="amount-cell">{formatMoney(voucher.amount, voucher.currency)}</td>
                  <td>
                    {canApprove && (
                      <Button className="approve-button" onClick={() => onApproveOne(voucher)}>
                        <Check size={14} /> Approve
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {!vouchers.length && (
          <div className="empty-state">
            <div className="empty-art">
              <ShieldCheck size={27} />
            </div>
            <h3>Nothing waiting in {monthLabel(month)}</h3>
            <p>
              {monthSettled
                ? "Every voucher in this month has been dealt with."
                : "No vouchers are awaiting approval in this month."}
            </p>
          </div>
        )}
      </section>

      {vouchers.length > 0 && (
        <section className="panel approval-summary">
          <div className="approval-summary-head">
            <div className="summary-icon">
              <Stamp size={19} />
            </div>
            <div>
              <h2>{monthLabel(month)} at a glance</h2>
              <p>{byPreparer.length} preparer{byPreparer.length === 1 ? "" : "s"} waiting on sign-off</p>
            </div>
            <div className="ml-auto text-right">
              <div className="font-display text-[19px] font-semibold text-[#182238]">
                {formatMoney(totalValue)}
              </div>
              <small className="text-[10px] text-[#9aa3b2]">total value</small>
            </div>
          </div>
          <div className="preparer-strip">
            {byPreparer.map((entry) => (
              <div key={entry.name} className="preparer-bubble">
                <div className="avatar" style={{ width: 27, height: 27, flexBasis: 27, fontSize: 9 }}>
                  {initial(entry.name)}
                </div>
                <div className="min-w-0">
                  <div className="truncate text-[11px] font-semibold text-[#29344a]">{entry.name}</div>
                  <small className="text-[10px] text-[#9aa3b2]">
                    {entry.count} voucher{entry.count === 1 ? "" : "s"} · {formatMoney(entry.value)}
                  </small>
                </div>
              </div>
            ))}
          </div>
          {selectedCount > 0 && (
            <div className="selection-summary">
              <span>
                <b>{formatMoney(selectedTotal)}</b> across <b>{selectedCount}</b> selected voucher
                {selectedCount === 1 ? "" : "s"} in {monthLabel(month)}.
              </span>
              <span>{monthSettled ? "Ready to approve" : "Single approval only until the month closes"}</span>
            </div>
          )}
        </section>
      )}
    </>
  );
};

export default ApprovalsPanel;
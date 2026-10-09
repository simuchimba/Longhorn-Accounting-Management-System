import { useState, type ReactNode } from "react";
import {
  Bell,
  ChevronRight,
  CircleHelp,
  FileCheck2,
  FileText,
  LayoutDashboard,
  LogOut,
  Menu,
  Settings2,
  Sparkles,
  Stamp,
  Users,
  X,
} from "lucide-react";
import Logo from "@/components/Logo";
import type { CurrentUser } from "@/lib/types";

export type NavKey = "dashboard" | "approvals" | "pending" | "approved" | "settings" | "admin" | "help";

type AppShellProps = {
  active: NavKey;
  onNavigate: (key: NavKey) => void;
  user: CurrentUser | null;
  counts?: { pending?: number; approved?: number };
  onSignOut: () => void;
  children: ReactNode;
};

/**
 * Spells out what the signed-in person can actually do.
 *
 * For a preparer this is deliberately "My own workspace" rather than the branch:
 * their workspace holds the vouchers they raised, not their colleagues', and
 * saying so in the corner is what stops the two lists being confused.
 */
const workspaceLabel = (user: CurrentUser | null) => {
  if (!user) return "Signing in";
  if (user.role === "approver") return "Approval workspace";
  if (user.role === "admin") return "Admin workspace";
  return "My own workspace";
};

const NavItem = ({
  active,
  icon: Icon,
  label,
  onClick,
  count,
}: {
  active: boolean;
  icon: typeof LayoutDashboard;
  label: string;
  onClick: () => void;
  count?: number;
}) => (
  <button onClick={onClick} className={`nav-item ${active ? "nav-item-active" : ""}`}>
    <Icon size={18} strokeWidth={active ? 2.3 : 1.8} />
    <span>{label}</span>
    {count !== undefined && count > 0 && (
      <span className="ml-auto rounded-full bg-[#fff4f5] px-2 py-0.5 text-[10px] font-bold text-[#D71939]">{count}</span>
    )}
  </button>
);

const getInitials = (name: string) =>
  name.split(" ").filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "LH";

/**
 * The sidebar and top bar that every signed-in page sits inside.
 *
 * The workspace switcher shows the branch the signed-in person works for, so a
 * Longhorn Financial Services preparer can tell at a glance that a voucher is
 * going to the LFS books and not the group-wide ones. It is the branch that is
 * shown, because that is what a voucher belongs to, but what the person can
 * actually see inside it is narrower: approvers and admins read every branch,
 * and each preparer reads only the vouchers they raised themselves.
 */
const AppShell = ({ active, onNavigate, user, counts, onSignOut, children }: AppShellProps) => {
  const [navOpen, setNavOpen] = useState(false);

  const displayName = user?.fullName || "Longhorn user";
  const initials = getInitials(displayName);
  const company = user?.company?.name || "No branch assigned";
  const companyCode = user?.company?.code || "—";
  const tint = user?.company?.color || "#d71939";

  const todayLabel = new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(new Date());
  const hour = new Date().getHours();
  const greeting = hour < 5 || hour >= 17 ? "Good evening" : hour < 12 ? "Good morning" : "Good afternoon";

  const go = (key: NavKey) => {
    setNavOpen(false);
    onNavigate(key);
  };

  return (
    <div className="app-shell">
      <aside className={`sidebar ${navOpen ? "sidebar-open" : ""}`}>
        <div className="flex items-center justify-between">
          <Logo />
          <button className="mobile-close" onClick={() => setNavOpen(false)} aria-label="Close navigation">
            <X size={20} />
          </button>
        </div>

        <div className="workspace-switcher">
          <div className="workspace-avatar" style={{ background: `${tint}14`, color: tint }}>
            {companyCode}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-bold text-[#1a253b]">{company}</div>
            <div className="mt-0.5 text-[10px] text-[#8490a5]">{workspaceLabel(user)}</div>
          </div>
          <ChevronRight className="ml-auto shrink-0 text-[#a3abb9]" size={16} />
        </div>

        <div className="sidebar-label">Workspace</div>
        <nav className="space-y-1">
          <NavItem active={active === "dashboard"} icon={LayoutDashboard} label="Overview" onClick={() => go("dashboard")} />
          {user?.isApprover && (
            <NavItem active={active === "approvals"} icon={Stamp} label="Approve a month" count={counts?.pending} onClick={() => go("approvals")} />
          )}
          <NavItem active={active === "pending"} icon={FileText} label="Pending vouchers" count={counts?.pending} onClick={() => go("pending")} />
          <NavItem active={active === "approved"} icon={FileCheck2} label="Approved vouchers" count={counts?.approved} onClick={() => go("approved")} />
        </nav>

        <div className="sidebar-label mt-8">Manage</div>
        <nav className="space-y-1">
          <NavItem active={active === "settings"} icon={Settings2} label="Settings" onClick={() => go("settings")} />
          {user?.isAdmin && <NavItem active={active === "admin"} icon={Users} label="Admin panel" onClick={() => go("admin")} />}
          <NavItem active={active === "help"} icon={CircleHelp} label="Help centre" onClick={() => go("help")} />
        </nav>

        <div className="mt-auto rounded-2xl bg-[#182238] p-4 text-white shadow-lg shadow-[#182238]/10">
          <div className="mb-3 flex h-8 w-8 items-center justify-center rounded-xl bg-[#D71939]">
            <Sparkles size={16} />
          </div>
          <div className="text-sm font-semibold">Keep every payment accounted for.</div>
          <p className="mt-1 text-[11px] leading-relaxed text-[#b9c2d2]">
            Three branches, one ledger. Every payment stays with the company that made it.
          </p>
        </div>

        <div className="sidebar-user">
          <div className="avatar">{initials}</div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-semibold text-[#29344a]">{displayName}</div>
            <div className="truncate text-[10px] text-[#8b94a5]">
              {user?.role ?? "preparer"} · {companyCode}
            </div>
          </div>
          <button className="row-more" onClick={onSignOut} aria-label="Sign out" title="Sign out">
            <LogOut size={17} />
          </button>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <button className="mobile-menu" onClick={() => setNavOpen(true)} aria-label="Open navigation">
            <Menu size={22} />
          </button>
          <div className="hidden md:block">
            <div className="text-xs font-medium text-[#9aa3b2]">{todayLabel}</div>
            <div className="mt-1 font-display text-lg font-semibold text-[#1a253b]">
              {greeting}, {displayName.split(" ")[0]} <span className="text-[#D71939]">↗</span>
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2 sm:gap-4">
            <button className="icon-button" aria-label="Notifications">
              <Bell size={18} />
              <span className="notification-dot" />
            </button>
            <div className="topbar-separator" />
            <div className="hidden max-w-[180px] text-right sm:block">
              <div className="truncate text-xs font-semibold text-[#29344a]">{displayName}</div>
              <div className="truncate text-[10px] text-[#9aa3b2]">{company}</div>
            </div>
            <div className="avatar">{initials}</div>
          </div>
        </header>

        <div className="content-wrap">{children}</div>
      </main>
    </div>
  );
};

export default AppShell;
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Building2,
  Check,
  KeyRound,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  UserPlus,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import AppShell, { type NavKey } from "@/components/AppShell";
import CompanyChip from "@/components/CompanyChip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useSessionContext } from "@/components/SessionContextProvider";
import { ApiError, createCompany, createUser, fetchAdminOverview, fetchAdminUsers, updateCompany, updateUser } from "@/lib/api";
import type { AdminOverview, AdminUser, Company, UserRole } from "@/lib/types";

const ROLES: Array<{ value: UserRole; label: string; blurb: string }> = [
  { value: "preparer", label: "Preparer", blurb: "Creates vouchers for their own branch and picks an approver." },
  { value: "approver", label: "Approver", blurb: "Sees every branch and approves payments." },
  { value: "admin", label: "Admin", blurb: "Everything an approver can do, plus managing people and branches." },
];

const NONE = "__none__";
const formatMoney = (amount: number) =>
  `ZMW ${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const formatDate = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(value))
    : "Never";

const getInitials = (name: string) =>
  name.split(" ").filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "LH";

const roleLabel = (role: string) => ROLES.find((item) => item.value === role)?.label ?? role;

/**
 * The admin panel.
 *
 * Shows who is in the workspace, which branch they work for and what they may do,
 * and is the only place those things can be changed. Everything on this page goes
 * through `/api/admin/*`, and those routes re-check that the caller is an admin
 * before touching anything, so hiding the link here is convenience rather than
 * the actual guard.
 */
const Admin = () => {
  const navigate = useNavigate();
  const { profile, refreshProfile } = useSessionContext();

  const [users, setUsers] = useState<AdminUser[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  // Separate from `loading`: the splash should only cover the first load. A
  // refetch, or coming back to the tab, must leave the panel on screen.
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const hasLoadedOnceRef = useRef(false);
  const [fatal, setFatal] = useState("");

  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [companyFilter, setCompanyFilter] = useState("all");

  const [savingId, setSavingId] = useState("");
  const [showAddUser, setShowAddUser] = useState(false);
  const [showAddBranch, setShowAddBranch] = useState(false);
  const [passwordFor, setPasswordFor] = useState<AdminUser | null>(null);

  const load = useCallback(async () => {
    if (hasLoadedOnceRef.current) setRefreshing(true);
    else setLoading(true);
    setFatal("");
    try {
      const [usersData, overviewData] = await Promise.all([fetchAdminUsers(), fetchAdminOverview()]);
      setUsers(usersData.users);
      setCompanies(usersData.companies);
      setOverview(overviewData);
      hasLoadedOnceRef.current = true;
    } catch (error) {
      if (error instanceof ApiError && error.status === 403) {
        setFatal("This panel is for workspace admins. Ask an admin if you need access to it.");
      } else {
        setFatal(error instanceof Error ? error.message : "Could not load the admin panel.");
      }
    } finally {
      setRefreshing(false);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const totals = useMemo(() => {
    const active = users.filter((user) => user.isActive);
    return {
      people: active.length,
      preparers: active.filter((user) => user.role === "preparer").length,
      approvers: active.filter((user) => user.role === "approver").length,
      admins: active.filter((user) => user.role === "admin").length,
      unassigned: active.filter((user) => !user.companyId).length,
    };
  }, [users]);

  const visibleUsers = useMemo(() => {
    const term = search.trim().toLowerCase();
    return users.filter((user) => {
      if (roleFilter !== "all" && user.role !== roleFilter) return false;
      if (companyFilter !== "all" && (user.companyId ?? NONE) !== companyFilter) return false;
      if (!term) return true;
      return `${user.fullName} ${user.email} ${user.companyName ?? ""}`.toLowerCase().includes(term);
    });
  }, [companyFilter, roleFilter, search, users]);

  /** Applies a change to one person, rolling the row back if the server refuses. */
  const patchUser = async (id: string, patch: Parameters<typeof updateUser>[1], describe: string) => {
    const before = users;
    setSavingId(id);
    setUsers((current) => current.map((user) => (user.id === id ? { ...user, ...patch } : user)));
    try {
      await updateUser(id, patch);
      toast.success(describe);
      void load();
      if (patch.role !== undefined || patch.companyId !== undefined) void refreshProfile();
    } catch (error) {
      setUsers(before);
      toast.error(error instanceof Error ? error.message : "That change did not save.");
    } finally {
      setSavingId("");
    }
  };

  // "help" lands on the ledger with the help view selected, since the help
  // centre belongs to the ledger rather than to the admin panel.
  const go = (key: NavKey) => navigate(key === "admin" ? "/admin" : `/?view=${key}`);

  const signOut = async () => {
    const { supabase } = await import("@/integrations/supabase/client");
    await supabase.auth.signOut();
    navigate("/login", { replace: true });
  };

  return (
    <AppShell
      active="admin"
      onNavigate={go}
      user={profile}
      onSignOut={signOut}
    >
      <div className="page-heading">
        <div>
          <div className="eyebrow">
            <span className="eyebrow-line" /> WORKSPACE ADMINISTRATION
          </div>
          <h1>Admin panel</h1>
          <p>Manage the branches sharing this ledger, and who works where.</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={showAddBranch ? () => setShowAddBranch(false) : () => setShowAddBranch(true)} className="secondary-action">
            <Building2 size={16} /> {showAddBranch ? "Cancel" : "Add branch"}
          </Button>
          <Button onClick={() => setShowAddUser(true)} className="primary-action">
            <UserPlus size={16} /> Add person
          </Button>
        </div>
      </div>

      {fatal && (
        <div className="notice notice-error">
          <AlertTriangle size={16} />
          <span>{fatal}</span>
          <Button className="notice-action" onClick={load}>
            <RefreshCw size={14} /> Try again
          </Button>
        </div>
      )}

      {loading && (
        <div className="auth-loading" style={{ minHeight: 220 }}>
          <div className="auth-loading-mark">
            <Loader2 size={20} className="animate-spin" />
          </div>
          <span>Loading your workspace...</span>
        </div>
      )}

      {/* A refresh keeps the panel mounted and just marks it busy, so coming back
          to the tab never replaces the content with the splash again. */}
      {!loading && refreshing && (
        <div className="notice" role="status">
          <Loader2 size={16} className="animate-spin" />
          <span>Refreshing...</span>
        </div>
      )}

      {!loading && !fatal && (
        <>
          <section className="metric-grid">
            <div className="metric-card metric-card-dark">
              <div className="metric-icon"><Building2 size={17} /></div>
              <div className="metric-label">Branches</div>
              <div className="metric-value">{String(companies.length).padStart(2, "0")}</div>
              <div className="metric-foot"><ShieldCheck size={14} /> Sharing one ledger</div>
              <div className="metric-watermark">LH</div>
            </div>
            <div className="metric-card">
              <div className="metric-icon soft-red"><Users size={17} /></div>
              <div className="metric-label">Active people</div>
              <div className="metric-value text-[#1a253b]">{String(totals.people).padStart(2, "0")}</div>
              <div className="metric-foot muted-foot">{users.length - totals.people} switched off</div>
            </div>
            <div className="metric-card">
              <div className="metric-icon soft-green"><UserPlus size={17} /></div>
              <div className="metric-label">Preparers · Approvers</div>
              <div className="metric-value text-[#1a253b]">
                {String(totals.preparers).padStart(2, "0")} · {String(totals.approvers).padStart(2, "0")}
              </div>
              <div className="metric-foot muted-foot">{totals.admins} admins</div>
            </div>
            <div className={`metric-card ${totals.unassigned ? "metric-card-red" : ""}`}>
              <div className="metric-icon"><AlertTriangle size={17} /></div>
              <div className="metric-label">No branch yet</div>
              <div className="metric-value">{String(totals.unassigned).padStart(2, "0")}</div>
              <div className="metric-foot">{totals.unassigned ? "Assign them below" : "Everyone is placed"}</div>
            </div>
          </section>

          {totals.unassigned > 0 && (
            <div className="notice notice-warn">
              <AlertTriangle size={16} />
              <span>
                {totals.unassigned === 1 ? "One person has" : `${totals.unassigned} people have`} no branch yet. Until you
                assign one they will not be able to see or create any vouchers.
              </span>
            </div>
          )}

          {/* ------------------------------------------------------- branches */}
          <section className="panel admin-section">
            <div className="panel-heading">
              <div>
                <h2>Branches</h2>
                <p>Each branch keeps its own vouchers. Preparers only ever see their own.</p>
              </div>
              <Building2 size={17} className="text-[#9ca5b5]" />
            </div>

            {showAddBranch && (
              <AddBranchForm
                busy={savingId === "branch"}
                onCancel={() => setShowAddBranch(false)}
                onSubmit={async (input) => {
                  setSavingId("branch");
                  try {
                    await createCompany(input);
                    toast.success(`${input.name} added.`);
                    setShowAddBranch(false);
                    void load();
                  } catch (error) {
                    toast.error(error instanceof Error ? error.message : "Could not add that branch.");
                  } finally {
                    setSavingId("");
                  }
                }}
              />
            )}

            <div className="branch-grid">
              {overview?.branches.map((branch) => (
                <article
                  key={branch.id}
                  className={`branch-card ${branch.isActive ? "" : "branch-card-off"}`}
                  style={{ borderTopColor: branch.color }}
                >
                  <div className="branch-card-head">
                    <CompanyChip name={branch.name} code={branch.code} color={branch.color} variant="code" />
                    <Switch
                      checked={branch.isActive}
                      aria-label={`${branch.isActive ? "Stand down" : "Bring back"} ${branch.name}`}
                      onCheckedChange={(next) => {
                        setSavingId(branch.id);
                        updateCompany(branch.id, { isActive: next })
                          .then(() => {
                            toast.success(next ? `${branch.name} is back in use.` : `${branch.name} stood down.`);
                            void load();
                          })
                          .catch((error) => toast.error(error instanceof Error ? error.message : "Could not save."))
                          .finally(() => setSavingId(""));
                      }}
                    />
                  </div>
                  <h3>{branch.name}</h3>
                  <p>{branch.description || "No description yet."}</p>

                  <div className="branch-people">
                    <span><b>{branch.users.total}</b> people</span>
                    <span><b>{branch.users.preparers}</b> preparers</span>
                    <span><b>{branch.users.approvers}</b> approvers</span>
                  </div>

                  <div className="branch-money">
                    <div><small>Tracked value</small><b>{formatMoney(branch.vouchers.value)}</b></div>
                    <div className="branch-statuses">
                      <span className="status-pill status-pending">{branch.vouchers.pending} pending</span>
                      <span className="status-pill status-approved">{branch.vouchers.approved} approved</span>
                      <span className="status-pill status-draft">{branch.vouchers.draft} draft</span>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </section>

          {/* --------------------------------------------------------- people */}
          <section className="panel admin-section">
            <div className="panel-heading">
              <div>
                <h2>People and access</h2>
                <p>Set each person's role and the branch they work for. Changes apply immediately.</p>
              </div>
              <Users size={17} className="text-[#9ca5b5]" />
            </div>

            <div className="archive-toolbar">
              <div className="search-box">
                <Search size={17} />
                <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name or email..." />
              </div>
              <div className="filter-row">
                <Select value={roleFilter} onValueChange={setRoleFilter}>
                  <SelectTrigger className="admin-select"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All roles</SelectItem>
                    {ROLES.map((role) => <SelectItem key={role.value} value={role.value}>{role.label}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={companyFilter} onValueChange={setCompanyFilter}>
                  <SelectTrigger className="admin-select"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All branches</SelectItem>
                    {companies.map((company) => (
                      <SelectItem key={company.id} value={company.id}>{company.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Person</th>
                    <th style={{ width: 168 }}>Role</th>
                    <th style={{ width: 224 }}>Branch</th>
                    <th style={{ width: 104 }}>Sign-in</th>
                    <th style={{ width: 92 }}>Last seen</th>
                    <th style={{ width: 132 }} />
                  </tr>
                </thead>
                <tbody>
                  {visibleUsers.map((user) => {
                    const company = companies.find((item) => item.id === user.companyId) ?? null;
                    const isSelf = user.id === profile?.id;
                    const busy = savingId === user.id;
                    return (
                      <tr key={user.id} className={busy ? "admin-row-busy" : ""}>
                        <td>
                          <div className="admin-person">
                            <div className="avatar" style={{ background: company?.color || "#8490a5" }}>{getInitials(user.fullName)}</div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="truncate text-[12px] font-semibold text-[#1d2940]">{user.fullName}</span>
                                {isSelf && <span className="admin-you">You</span>}
                              </div>
                              <div className="truncate text-[10px] text-[#9aa3b2]">{user.email}</div>
                              {!user.hasProfile && (
                                <div className="admin-warn-line">No profile row yet</div>
                              )}
                            </div>
                          </div>
                        </td>
                        <td>
                          <Select
                            value={user.role}
                            disabled={busy || !user.hasProfile}
                            onValueChange={(role) =>
                              void patchUser(user.id, { role: role as UserRole }, `${user.fullName} is now a ${roleLabel(role)}.`)
                            }
                          >
                            <SelectTrigger className="admin-select"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {ROLES.map((role) => <SelectItem key={role.value} value={role.value}>{role.label}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </td>
                        <td>
                          <Select
                            value={user.companyId ?? NONE}
                            disabled={busy || !user.hasProfile}
                            onValueChange={(value) =>
                              void patchUser(
                                user.id,
                                { companyId: value === NONE ? null : value },
                                value === NONE
                                  ? `${user.fullName} has no branch assigned.`
                                  : `${user.fullName} now works for ${companies.find((c) => c.id === value)?.name}.`,
                              )
                            }
                          >
                            <SelectTrigger className="admin-select"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value={NONE}>No branch</SelectItem>
                              {companies.map((item) => (
                                <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </td>
                        <td>
                          <div className="flex items-center gap-2">
                            <Switch
                              checked={user.isActive}
                              disabled={busy || isSelf}
                              aria-label={`${user.isActive ? "Switch off" : "Switch on"} ${user.fullName}`}
                              onCheckedChange={(next) =>
                                void patchUser(
                                  user.id,
                                  { isActive: next },
                                  next ? `${user.fullName} can sign in.` : `${user.fullName}'s access is switched off.`,
                                )
                              }
                            />
                            <span className={`status-pill ${user.isActive ? "status-approved" : "status-draft"}`}>
                              {user.isActive ? "Active" : "Off"}
                            </span>
                          </div>
                        </td>
                        <td className="text-[11px] text-[#919baa]">{formatDate(user.lastLoginAt)}</td>
                        <td>
                          <div className="row-actions">
                            <button className="row-more" title="Edit sign-in email or password" onClick={() => setPasswordFor(user)}>
                              <KeyRound size={16} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {!visibleUsers.length && (
                    <tr>
                      <td colSpan={6}>
                        <div className="empty-state">
                          <div className="empty-art"><Search size={24} /></div>
                          <h3>Nobody matches</h3>
                          <p>Try a different search, role or branch filter.</p>
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      <AddUserDialog
        open={showAddUser}
        companies={companies}
        onClose={() => setShowAddUser(false)}
        onAdded={(created) => {
          setUsers((current) => [...current, created].sort((a, b) => a.fullName.localeCompare(b.fullName)));
          toast.success(`${created.fullName} can now sign in as a ${roleLabel(created.role)}.`);
          void load();
        }}
      />

      <EditAccountDialog
        user={passwordFor}
        onClose={() => setPasswordFor(null)}
      />
    </AppShell>
  );
};

/* ------------------------------------------------------------------ add branch */

const AddBranchForm = ({
  busy,
  onCancel,
  onSubmit,
}: {
  busy: boolean;
  onCancel: () => void;
  onSubmit: (input: { name: string; code: string; description: string; color: string }) => void;
}) => {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState("#345d97");

  return (
    <form
      className="admin-form"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit({ name: name.trim(), code: code.trim().toUpperCase(), description: description.trim(), color });
      }}
    >
      <div className="form-section-title">
        <span><Plus size={12} /></span>
        <div><b>New branch</b><small>It gets its own vouchers and its own preparers.</small></div>
      </div>
      <div className="form-grid">
        <label className="field">
          <span>Branch name <em>*</em></span>
          <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Longhorn Advisory" required minLength={3} />
        </label>
        <label className="field">
          <span>Short code <em>*</em></span>
          <Input value={code} onChange={(event) => setCode(event.target.value)} placeholder="e.g. LAD" required maxLength={5} className="uppercase" />
        </label>
        <label className="field wide">
          <span>What it does</span>
          <Input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="One line about this branch" />
        </label>
        <label className="field">
          <span>Colour</span>
          <div className="flex items-center gap-2">
            <input type="color" value={color} onChange={(event) => setColor(event.target.value)} className="admin-color" />
            <Input value={color} onChange={(event) => setColor(event.target.value)} className="font-mono" />
          </div>
        </label>
      </div>
      <div className="admin-form-actions">
        <Button type="button" onClick={onCancel} className="cancel-button" disabled={busy}>Cancel</Button>
        <Button type="submit" className="primary-action" disabled={busy}>
          {busy ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} Add branch
        </Button>
      </div>
    </form>
  );
};

/* -------------------------------------------------------------------- add user */

const AddUserDialog = ({
  open,
  companies,
  onClose,
  onAdded,
}: {
  open: boolean;
  companies: Company[];
  onClose: () => void;
  onAdded: (user: AdminUser) => void;
}) => {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<UserRole>("preparer");
  const [companyId, setCompanyId] = useState(NONE);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const reset = () => {
    setFullName("");
    setEmail("");
    setPassword("");
    setRole("preparer");
    setCompanyId(NONE);
    setError("");
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await createUser({
        fullName: fullName.trim(),
        email: email.trim().toLowerCase(),
        password,
        role,
        companyId: companyId === NONE ? null : companyId,
      });
      reset();
      onAdded(result.user);
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not add that person.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && !busy) { reset(); onClose(); } }}>
      <DialogContent className="admin-dialog">
        <DialogHeader>
          <DialogTitle>Add a person</DialogTitle>
          <DialogDescription>
            Creates their sign-in and puts them on the right branch. They can change their own password afterwards.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="admin-form !p-0">
          <div className="form-grid">
            <label className="field wide">
              <span>Full name <em>*</em></span>
              <Input value={fullName} onChange={(event) => setFullName(event.target.value)} placeholder="e.g. Chanda Mulenga" required />
            </label>
            <label className="field wide">
              <span>Work email <em>*</em></span>
              <Input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@longhorn-associates.com" required />
            </label>
            <label className="field wide">
              <span>Temporary password <em>*</em></span>
              <Input value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 8 characters" required minLength={8} />
              <small className="field-hint">Share this once, in person. They should change it on first sign-in.</small>
            </label>
            <label className="field">
              <span>Role</span>
              <Select value={role} onValueChange={(value) => setRole(value as UserRole)}>
                <SelectTrigger className="admin-select"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ROLES.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </label>
            <label className="field">
              <span>Branch</span>
              <Select value={companyId} onValueChange={setCompanyId}>
                <SelectTrigger className="admin-select"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>No branch yet</SelectItem>
                  {companies.map((company) => (
                    <SelectItem key={company.id} value={company.id}>{company.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
          </div>
          <p className="admin-role-note">{ROLES.find((item) => item.value === role)?.blurb}</p>
          {error && (
            <div className="login-error">
              <AlertTriangle size={15} />
              <span>{error}</span>
            </div>
          )}
          <DialogFooter className="mt-2">
            <Button type="button" onClick={onClose} className="cancel-button" disabled={busy}>Cancel</Button>
            <Button type="submit" className="primary-action" disabled={busy}>
              {busy ? <Loader2 size={16} className="animate-spin" /> : <UserPlus size={16} />} Add person
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

/* -------------------------------------------------------------- reset password */

/**
 * Edits one person's sign-in details.
 *
 * Both fields are optional, so an admin can change an address, reset a password, or
 * both. The email change applies immediately: Supabase's own flow would only send a
 * confirmation link, and on this project's mail setup that link never arrives.
 */
const EditAccountDialog = ({ user, onClose }: { user: AdminUser | null; onClose: () => void }) => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setEmail(user?.email ?? "");
    setPassword("");
    setError("");
  }, [user?.id, user?.email]);

  const trimmedEmail = email.trim();
  const emailChanged = Boolean(user && trimmedEmail && trimmedEmail.toLowerCase() !== user.email.toLowerCase());
  const passwordChanged = password.length > 0;
  const nothingToDo = !emailChanged && !passwordChanged;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!user || nothingToDo) return;
    if (passwordChanged && password.length < 8) {
      setError("A password must be at least 8 characters.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const payload: Parameters<typeof updateUser>[1] = {};
      if (emailChanged) payload.email = trimmedEmail;
      if (passwordChanged) payload.newPassword = password;
      await updateUser(user.id, payload);
      toast.success(
        [
          emailChanged ? `${user.fullName} now signs in as ${trimmedEmail}` : null,
          passwordChanged ? "password reset" : null,
        ]
          .filter(Boolean)
          .join(", ") + ".",
      );
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save those sign-in details.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={user !== null} onOpenChange={(next) => { if (!next && !busy) onClose(); }}>
      <DialogContent className="admin-dialog admin-dialog-sm">
        <DialogHeader>
          <DialogTitle>Sign-in details</DialogTitle>
          <DialogDescription>{user ? `For ${user.fullName}` : ""}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="admin-form !p-0">
          <label className="field">
            <span>Sign-in email</span>
            <Input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="name@longhorn-associates.com"
            />
            {emailChanged && <small className="field-hint">Takes effect immediately. Tell them the new address.</small>}
          </label>
          <label className="field">
            <span>New password</span>
            <Input
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Leave blank to keep the current one"
              autoComplete="new-password"
            />
            <small className="field-hint">At least 8 characters. Share it with them in person.</small>
          </label>
          {error && (
            <div className="login-error">
              <AlertTriangle size={15} />
              <span>{error}</span>
            </div>
          )}
          <DialogFooter>
            <Button type="button" onClick={onClose} className="cancel-button" disabled={busy}>Cancel</Button>
            <Button type="submit" className="primary-action" disabled={busy || nothingToDo}>
              {busy ? <Loader2 size={16} className="animate-spin" /> : <KeyRound size={16} />} Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default Admin;
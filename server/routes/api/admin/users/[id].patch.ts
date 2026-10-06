import { defineHandler } from "nitro";
import { createError, getRouterParam, readBody } from "nitro/h3";
import { getServiceClient, requireAdmin } from "../../../../utils/supabase";

type UpdateUserBody = {
  fullName?: string;
  role?: string;
  companyId?: string | null;
  isActive?: boolean;
  newPassword?: string;
  email?: string;
};

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const ROLES = new Set(["admin", "preparer", "approver"]);

/**
 * Edits one person's role, branch, name, sign-in state or password.
 *
 * Two rules protect the workspace from being locked out of its own admin panel:
 * you cannot change your own role or switch off your own account, and the last
 * active admin cannot be demoted or disabled.
 */
export default defineHandler(async (event) => {
  const admin = await requireAdmin(event);

  const id = String(getRouterParam(event, "id") || "").trim();
  if (!id) throw createError({ statusCode: 400, statusMessage: "Which user? The id is missing." });

  const body = (await readBody<UpdateUserBody>(event)) || {};
  const service = getServiceClient();

  const existing = await service.from("profiles").select("id, full_name, role, company_id").eq("id", id).maybeSingle();
  if (existing.error) throw new Error(existing.error.message);
  if (!existing.data) {
    throw createError({
      statusCode: 404,
      statusMessage: "That account has no profile row yet, so there is nothing to update.",
    });
  }

  const current = existing.data as { id: string; full_name: string | null; role: string | null; company_id: string | null };
  const isSelf = id === admin.id;

  // Counts the other admins who would still be able to sign in after this change.
  const remainingAdmins = async (excludeId: string) => {
    const all = await service.from("profiles").select("id, role").eq("role", "admin");
    if (all.error) throw new Error(all.error.message);
    const others = (all.data ?? []).filter((row) => String(row.id) !== excludeId);
    if (!others.length) return 0;
    const states = await Promise.all(others.map((row) => service.auth.admin.getUserById(String(row.id))));
    return states.filter((result) => {
      const bannedUntil = result.data?.user?.banned_until
        ? new Date(result.data.user.banned_until).getTime()
        : 0;
      return !result.error && bannedUntil <= Date.now();
    }).length;
  };

  const patch: Record<string, unknown> = {};

  if (body.fullName !== undefined) {
    const fullName = String(body.fullName).trim();
    if (!fullName) throw createError({ statusCode: 400, statusMessage: "A name is required." });
    patch.full_name = fullName;
  }

  if (body.role !== undefined) {
    const role = String(body.role);
    if (!ROLES.has(role)) throw createError({ statusCode: 400, statusMessage: "Choose a valid role." });
    if (isSelf && role !== "admin") {
      throw createError({
        statusCode: 400,
        statusMessage: "You cannot change your own role. Ask another admin to do it, so the workspace is never left without one.",
      });
    }
    if (current.role === "admin" && role !== "admin" && (await remainingAdmins(id)) === 0) {
      throw createError({
        statusCode: 400,
        statusMessage: "This is the last active admin. Promote somebody else before changing this role.",
      });
    }
    patch.role = role;
  }

  if (body.companyId !== undefined) {
    const companyId = String(body.companyId || "").trim() || null;
    if (companyId) {
      const company = await service.from("companies").select("id").eq("id", companyId).maybeSingle();
      if (company.error) throw new Error(company.error.message);
      if (!company.data) {
        throw createError({ statusCode: 400, statusMessage: "That branch no longer exists. Pick another one." });
      }
    }
    patch.company_id = companyId;
  }

  if (body.isActive !== undefined) {
    const isActive = Boolean(body.isActive);
    if (!isActive && isSelf) {
      throw createError({
        statusCode: 400,
        statusMessage: "You cannot switch off your own account. Ask another admin to do it.",
      });
    }
    if (!isActive && current.role === "admin" && (await remainingAdmins(id)) === 0) {
      throw createError({
        statusCode: 400,
        statusMessage: "This is the last active admin. Switch on another one first, so nobody loses access.",
      });
    }
    const updated = isActive
      ? await service.auth.admin.updateUserById(id, { ban_duration: "none" })
      : await service.auth.admin.updateUserById(id, { ban_duration: "876000h" });
    if (updated.error) {
      throw createError({ statusCode: 400, statusMessage: updated.error.message });
    }
  }

  // An admin changing someone's address applies it at once. The self-service route
  // exists because Supabase's own email change only sends a confirmation link, which
  // never arrives on this project's mail setup.
  let emailChangedTo: string | null = null;
  if (body.email !== undefined && String(body.email).trim()) {
    const email = String(body.email).trim().toLowerCase();
    if (!EMAIL.test(email)) {
      throw createError({ statusCode: 400, statusMessage: "Enter a valid email address." });
    }
    const authUser = await service.auth.admin.getUserById(id);
    const currentEmail = authUser.data?.user?.email ?? "";
    if (currentEmail.toLowerCase() === email) {
      throw createError({ statusCode: 400, statusMessage: "That is already their sign-in email." });
    }
    const users = await service.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (users.error) throw new Error(users.error.message);
    const taken = (users.data?.users ?? []).some(
      (candidate) => candidate.id !== id && candidate.email?.toLowerCase() === email,
    );
    if (taken) {
      throw createError({ statusCode: 409, statusMessage: "That email already belongs to someone else here." });
    }
    const moved = await service.auth.admin.updateUserById(id, { email, email_confirm: true });
    if (moved.error) throw createError({ statusCode: 400, statusMessage: moved.error.message });
    emailChangedTo = email;
  }

  if (body.newPassword !== undefined && String(body.newPassword).length > 0) {
    const newPassword = String(body.newPassword);
    if (newPassword.length < 8) {
      throw createError({ statusCode: 400, statusMessage: "A password must be at least 8 characters." });
    }
    const updated = await service.auth.admin.updateUserById(id, { password: newPassword });
    if (updated.error) throw createError({ statusCode: 400, statusMessage: updated.error.message });
  }

  if (Object.keys(patch).length) {
    const saved = await service.from("profiles").update(patch).eq("id", id).select("id, full_name, role, company_id").single();
    if (saved.error) {
      throw createError({ statusCode: 400, statusMessage: `Could not save those changes: ${saved.error.message}` });
    }
  }

  // Keep the name mirrored into Auth metadata so it shows up in the client too.
  if (patch.full_name) {
    await service.auth.admin.updateUserById(id, { user_metadata: { full_name: patch.full_name } });
  }

  const company = patch.company_id
    ? (await service.from("companies").select("name, code").eq("id", String(patch.company_id)).maybeSingle()).data
    : null;

  return {
    user: {
      id,
      email: emailChangedTo,
      fullName: String(patch.full_name ?? current.full_name ?? ""),
      role: String(patch.role ?? current.role ?? "preparer"),
      companyId: (patch.company_id ?? current.company_id) as string | null,
      companyName: company?.name ?? null,
      companyCode: company?.code ?? null,
    },
    emailChanged: Boolean(emailChangedTo),
  };
});
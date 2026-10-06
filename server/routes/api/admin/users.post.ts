import { defineHandler } from "nitro";
import { createError, readBody } from "nitro/h3";
import { getServiceClient, requireAdmin } from "../../../utils/supabase";

type CreateUserBody = {
  fullName?: string;
  email?: string;
  password?: string;
  role?: string;
  companyId?: string | null;
};

const ROLES = new Set(["admin", "preparer", "approver"]);

/**
 * Adds a person to the ledger.
 *
 * Two writes are needed: a Supabase Auth account so they can sign in, and a
 * `profiles` row holding their role and branch. The caller has already been
 * checked as an admin by `requireAdmin`.
 */
export default defineHandler(async (event) => {
  const admin = await requireAdmin(event);
  const body = (await readBody<CreateUserBody>(event)) || {};

  const fullName = String(body.fullName || "").trim();
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  const role = String(body.role || "preparer");
  const companyId = String(body.companyId || "").trim() || null;

  if (!fullName) throw createError({ statusCode: 400, statusMessage: "Enter the person's full name." });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw createError({ statusCode: 400, statusMessage: "Enter a valid email address." });
  }
  if (password.length < 8) {
    throw createError({ statusCode: 400, statusMessage: "Set a password of at least 8 characters." });
  }
  if (!ROLES.has(role)) throw createError({ statusCode: 400, statusMessage: "Choose a valid role." });

  const service = getServiceClient();

  if (companyId) {
    const company = await service.from("companies").select("id").eq("id", companyId).maybeSingle();
    if (company.error) throw new Error(company.error.message);
    if (!company.data) {
      throw createError({ statusCode: 400, statusMessage: "That branch no longer exists. Pick another one." });
    }
  }

  const created = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });

  if (created.error) {
    const alreadyExists = /already been registered|already exists/i.test(created.error.message);
    throw createError({
      statusCode: alreadyExists ? 409 : 400,
      statusMessage: alreadyExists
        ? `${email} already has an account. Search for them below and edit their role instead.`
        : created.error.message,
    });
  }

  const userId = created.data.user.id;

  /*
   * Upsert, not insert. This database already has a trigger that creates a
   * profiles row the moment an auth user is created, so a plain INSERT would fail
   * on the primary key for every single person added through the panel. Worse, the
   * rollback below would then delete the account that had just been created, so
   * adding somebody would appear to do nothing at all.
   */
  const profile = await service
    .from("profiles")
    .upsert(
      { id: userId, full_name: fullName, role, company_id: companyId },
      { onConflict: "id" },
    )
    .select("id, full_name, role, company_id")
    .single();

  if (profile.error) {
    /*
     * Only roll the auth user back if the profile row genuinely is not there.
     * Deleting the account on any other error would destroy someone's real account
     * because of a transient problem, which is far worse than an incomplete profile.
     */
    const check = await service
      .from("profiles")
      .select("id, full_name, role, company_id")
      .eq("id", userId)
      .maybeSingle();

    if (!check.data) {
      await service.auth.admin.deleteUser(userId);
      throw createError({
        statusCode: 500,
        statusMessage: `Could not save the profile for ${fullName}: ${profile.error.message} The account was removed again, so nothing was left behind.`,
      });
    }
    // The row exists, so the account is usable. Carry on with what is there.
    if (!check.data.role) {
      await service.from("profiles").update({ role, company_id: companyId }).eq("id", userId);
    }
  }

  const company = companyId
    ? (await service.from("companies").select("name, code").eq("id", companyId).maybeSingle()).data
    : null;

  return {
    user: {
      id: userId,
      email,
      fullName,
      role,
      companyId,
      companyName: company?.name ?? null,
      companyCode: company?.code ?? null,
      isActive: true,
      hasProfile: true,
      createdAt: created.data.user.created_at ?? new Date().toISOString(),
      lastLoginAt: null,
    },
    createdBy: admin.email,
  };
});
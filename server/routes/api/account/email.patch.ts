import { defineHandler } from "nitro";
import { createError, readBody } from "nitro/h3";
import { getServiceClient, getUserClient, readAccessToken, requireCaller } from "../../../utils/supabase";

type ChangeEmailBody = {
  email?: string;
  /** The signed-in person's current password, required to authorise the change. */
  currentPassword?: string;
};

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * Changes the signed-in person's sign-in email.
 *
 * The browser cannot do this itself. `supabase.auth.updateUser({ email })` only
 * sends a confirmation link and leaves the stored address untouched until somebody
 * clicks it. This project sits on Supabase's built-in SMTP, which delivers only to
 * team members, so that link never arrives and the address appears not to change at
 * all. The service-role client applies the change directly instead, with
 * `email_confirm: true` so no further round trip is needed.
 *
 * The current password is required. A session alone is not enough: a hijacked
 * session could otherwise be used to redirect an account and take it over
 * permanently. Proving you know the password first means a stolen session on its own
 * cannot do this.
 */
export default defineHandler(async (event) => {
  const caller = await requireCaller(event);

  const body = (await readBody<ChangeEmailBody>(event)) || {};
  const nextEmail = String(body.email || "").trim().toLowerCase();
  const currentPassword = String(body.currentPassword || "");

  if (!EMAIL.test(nextEmail)) {
    throw createError({ statusCode: 400, statusMessage: "Enter a valid email address." });
  }
  if (nextEmail === caller.email.toLowerCase()) {
    throw createError({ statusCode: 400, statusMessage: "That is already your sign-in email." });
  }
  if (!currentPassword) {
    throw createError({ statusCode: 400, statusMessage: "Enter your current password to confirm the change." });
  }

  // Re-check the password against Supabase Auth before touching anything. The
  // publishable key is enough for this, so the secret key is not involved.
  const anon = getUserClient(readAccessToken(event));
  const signIn = await anon.auth.signInWithPassword({ email: caller.email, password: currentPassword });
  if (signIn.error) {
    throw createError({
      statusCode: 401,
      statusMessage: "That is not your current password. Nothing was changed.",
    });
  }

  const service = getServiceClient();

  // Refuse an address that is already in use, rather than letting it fail with an
  // opaque conflict further down.
  const { data: clash, error: clashError } = await service.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (clashError) throw createError({ statusCode: 500, statusMessage: clashError.message });

  const taken = (clash?.users ?? []).some(
    (candidate) => candidate.id !== caller.id && candidate.email?.toLowerCase() === nextEmail,
  );
  if (taken) {
    throw createError({
      statusCode: 409,
      statusMessage: "That email already belongs to someone else in this workspace.",
    });
  }

  const updated = await service.auth.admin.updateUserById(caller.id, {
    email: nextEmail,
    email_confirm: true,
  });
  if (updated.error) {
    throw createError({ statusCode: 400, statusMessage: updated.error.message });
  }

  // Keep the mirrored copy of the old address out of the user metadata, since it
  // would otherwise linger after the change.
  const stale = updated.data.user?.user_metadata?.old_email;
  if (stale) {
    await service.auth.admin.updateUserById(caller.id, {
      user_metadata: { ...(updated.data.user?.user_metadata ?? {}), old_email: undefined },
    });
  }

  return { email: nextEmail, changedAt: new Date().toISOString() };
});
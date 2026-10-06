// Guards the email-change fix.
//
// The bug: supabase.auth.updateUser({ email }) only sends a confirmation link and
// leaves the stored address untouched until it is clicked. On this project's mail
// setup that link never arrives, so the email silently never changed.
//
// These checks assert the fix does not reintroduce that, and that the change is
// actually authorised rather than applied on the strength of a session alone.
import fs from "node:fs";

const read = (p) => fs.readFileSync(p, "utf8");

const selfRoute = read("server/routes/api/account/email.patch.ts");
const adminRoute = read("server/routes/api/admin/users/[id].patch.ts");
const index = read("src/pages/Index.tsx");
const admin = read("src/pages/Admin.tsx");
const api = read("src/lib/api.ts");

let failed = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}: ${label}${detail ? ` (${detail})` : ""}`);
  if (!ok) failed += 1;
};

console.log("Email change");

// --- the old broken call must be gone entirely -------------------------------
check("settings no longer calls updateUser({ email })", !/updateUser\(\{\s*email/.test(index));

// --- the change must be applied immediately, not via a confirmation link -------
check("self-service route applies the email directly", /updateUserById\(caller\.id,\s*\{[\s\S]{0,80}email:\s*nextEmail/.test(selfRoute));
check("self-service route confirms the new address", /email_confirm:\s*true/.test(selfRoute));
check("self-service route uses the service client", /getServiceClient\(\)/.test(selfRoute));
check("admin route also applies emails immediately", /updateUserById\(id,\s*\{ email, email_confirm: true \}\)/.test(adminRoute));

// --- authorisation ------------------------------------------------------------
check("self-service requires the current password", /if \(!currentPassword\)/.test(selfRoute));
check("current password is verified against Supabase Auth", /signInWithPassword/.test(selfRoute));
check("a wrong password changes nothing", /That is not your current password\. Nothing was changed\./.test(selfRoute));
check("self-service route requires a signed-in caller", /requireCaller\(event\)/.test(selfRoute));
check("self-service route verifies the caller", /isSupabaseConfigured/.test(selfRoute) || /requireCaller/.test(selfRoute));
check("self-service refuses an unchanged address", /already your sign-in email/.test(selfRoute));
check("email format is validated", /EMAIL\.test\(nextEmail\)/.test(selfRoute));
check("an address already in use is refused", /already belongs to someone else/.test(selfRoute));

// --- admin route authorisation ------------------------------------------------
check("admin route requires an admin", /requireAdmin\(event\)/.test(adminRoute));
check("admin route validates the address", /EMAIL\.test\(email\)/.test(adminRoute));
check("admin route refuses duplicates", /already belongs to someone else here/.test(adminRoute));

// --- the UI collects what the route needs ------------------------------------
check("settings form collects the current password", /emailPassword/.test(index));
check("settings validates the password before calling", /if \(!emailPassword\)/.test(index));
check("settings passes both values", /changeOwnEmail\(nextEmail, emailPassword\)/.test(index));
check("settings refreshes the session after the change", /refreshSession\(\)/.test(index));
check("settings clears the password field afterwards", /setEmailPassword\(""\)/.test(index));
check("settings no longer promises a confirmation link", !/Confirmation links sent/.test(index));
check("api client exposes changeOwnEmail", /changeOwnEmail/.test(api));
check("admin panel edits email as well as password", /payload\.email = trimmedEmail/.test(admin) && /newPassword/.test(admin));
check("admin panel leaves the password alone when blank", /password\.length > 0/.test(admin));

// --- nothing else regressed ---------------------------------------------------
// The live vouchers table has no updated_at, so the update payload must not set one.
// Only the code is checked; the explanatory comment mentioning it is fine.
const bulkCode = read("server/routes/api/vouchers/bulk-approve.post.ts")
  .split("\n")
  .filter((line) => !line.trim().startsWith("*") && !line.trim().startsWith("//"))
  .join("\n");
check("bulk approve writes no updated_at column", !/updated_at/.test(bulkCode));

// --- a missing credential must not masquerade as a missing migration ---------
const meRoute = read("server/routes/api/me.get.ts");
const provider = read("src/components/SessionContextProvider.tsx");
check("unconfigured server reports setupRequired, not needsMigration", /needsMigration: false,\s*\n\s*setupRequired: true,/.test(meRoute));
check("provider tracks the two conditions separately", /setNeedsMigration\(data\.needsMigration\)/.test(provider) && /setSetupRequired\(data\.setupRequired\)/.test(provider));
check("provider never folds setupRequired into needsMigration", !/setNeedsMigration\(data\.needsMigration \|\| data\.setupRequired\)/.test(provider));
check("a missing profile is reported distinctly", /no profile row exists for your account/.test(provider));
check("Index shows a credential-specific notice", /NITRO_SUPABASE_URL/.test(index));
check("Index still shows the migration notice when it applies", /multi_company_setup\.sql/.test(index));

// --- adding a person must not clash with the signup trigger ------------------
const addUser = read("server/routes/api/admin/users.post.ts");
check("add-person upserts the profile, not a plain insert", /\.upsert\(/.test(addUser) && /onConflict:\s*"id"/.test(addUser));
check("add-person does not delete the account on a profile conflict", !/insert\(\{ id: userId/.test(addUser));
check(
  "add-person only rolls back when no profile row exists at all",
  /if \(!check\.data\)/.test(addUser) && /deleteUser\(userId\)/.test(addUser),
);
check(
  "a real rollback is explained to the admin",
  /The account was removed again/.test(addUser),
);

// --- the dashboard-revert bug must not come back ------------------------------
const migration = read("database/multi_company_setup.sql");
const roleFix = read("database/fix_role_edits.sql");
check("trigger allows writes with no signed-in user", /if auth\.uid\(\) is null then\s*\n\s*return new;/.test(migration));
check("the shipped fix file carries the same correction", /auth\.uid\(\) is null/.test(roleFix));
check("primary key is held before any early return", /new\.id := old\.id;[\s\S]*?if auth\.uid\(\) is null/.test(migration));

// --- the approver dropdown must offer approvers only ------------------------
const directory = read("server/routes/api/directory.get.ts");
const css = read("src/globals.css");
check("directory lists approvers only, not admins", /\.eq\("role", "approver"\)/.test(directory) && !/\.in\("role", \["approver", "admin"\]\)/.test(directory));
check("composer filters the dropdown to approvers", /approvers\.filter\(\(member\) => member\.role === "approver"\)/.test(index));
check("composer refuses a non-approver nomination", /chosenApprover\.role !== "approver"/.test(index));
check("composer explains when no approvers exist", /No approvers exist yet/.test(index));
check("the database rejects nominating a non-approver", /can_be_nominated_approver\(new\.assigned_approver_id\)/.test(migration));
check("nominatability helper only accepts role approver", /p\.role = 'approver'/.test(migration));

// --- the approver field icon must not sit under the select's text ------------
check("input-icon clears room for a select", /\.input-icon select \{ padding-left: 31px; \}/.test(css));
check("input-icon still clears room for an input", /\.input-icon input \{ padding-left: 31px; \}/.test(css));

console.log(failed ? `\n${failed} check(s) failed` : "\nAll email-change checks passed");
process.exit(failed ? 1 : 0);
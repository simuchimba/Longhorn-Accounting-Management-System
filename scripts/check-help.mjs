// Static checks on the help centre.
//
// The page is behind ProtectedRoute, so it cannot be rendered without real
// credentials. These assert the wiring and the things that commonly break:
// the contact address, the admin link being removed in favour of a route, and
// the responsive rules existing.
import fs from "node:fs";

const read = (p) => fs.readFileSync(p, "utf8");

const help = read("src/pages/Help.tsx");
const index = read("src/pages/Index.tsx");
const shell = read("src/components/AppShell.tsx");
const admin = read("src/pages/Admin.tsx");
const css = read("src/globals.css");

let failed = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}: ${label}${detail ? ` (${detail})` : ""}`);
  if (!ok) failed += 1;
};

console.log("Help centre");

// --- the requested contact --------------------------------------------------
check("shows the administrator address", help.includes("kuunda@longhorn-associates.com"));
check("the address is a single exported constant", /const ADMIN_EMAIL = "kuunda@longhorn-associates\.com"/.test(help));
check("address is a clickable mailto", /href=\{`mailto:\$\{ADMIN_EMAIL\}`\}/.test(help));
check("address can be copied to the clipboard", help.includes("clipboard.writeText(ADMIN_EMAIL)"));

// --- it is a page, not a toast ----------------------------------------------
check("Index renders the help view", /view === "help" && <HelpCentre/.test(index));
check("help is a routable view", index.includes('"help"') && /view: "help"/.test(index));
check("help view survives a page refresh", /allowed: View\[\] = \["pending", "approved", "settings", "help"\]/.test(index));

// --- the sidebar item navigates ---------------------------------------------
check("sidebar help item is a nav item, not a toast", /active=\{active === "help"\}[\s\S]{0,90}go\("help"\)/.test(shell));
check("help is in the NavKey union", /"admin" \| "help"|"help";/.test(shell));
check("AppShell no longer takes an onHelp callback", !/onHelp/.test(shell));
check("Admin no longer passes onHelp", !/onHelp/.test(admin));

// --- helpful content ---------------------------------------------------------
check("lists common questions", /help-topic-list/.test(help) && /Common questions/.test(help));
check("questions expand and collapse", /setOpen\(isOpen \? null : topic\.question\)/.test(help));
check("topics adapt to role", /user\?\.canPrepare/.test(help) && /user\?\.isApprover/.test(help));
check("offers a message form", /help-message/.test(help));
check("message form opens the mail client rather than posting", /window\.location\.href = `mailto:/.test(help));
check("explains nothing is stored", /Nothing is stored/.test(help));
check("has a way back to the ledger", /onBack/.test(help) && /Back to the ledger/.test(help));

// --- styling exists ---------------------------------------------------------
for (const className of [
  "help-contact",
  "help-email-row",
  "help-topic",
  "help-topic-a",
  "help-links",
  "help-link-card",
  "help-message",
]) {
  check(`styles .${className}`, css.includes(`.${className}`));
}
check("contact panel is responsive", /\.help-contact \{ grid-template-columns: 1fr;/.test(css));

console.log(failed ? `\n${failed} check(s) failed` : "\nAll help-centre checks passed");
process.exit(failed ? 1 : 0);
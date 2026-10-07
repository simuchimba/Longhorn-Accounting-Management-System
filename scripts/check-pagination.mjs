// Guards the reader-controlled page size and bulk printing.
//
// Bulk printing was already present but effectively unreachable: the page size
// was hardcoded to 10, so an archive of 780 approved vouchers needed 78 visits
// to gather a selection, and "Select all N vouchers" only appeared once the
// page checkbox had been ticked first. The logic is executed here rather than
// pattern-matched, because the clamping and the print limit are the parts that
// actually fail quietly.
import fs from "node:fs";

import {
  DEFAULT_PAGE_SIZE,
  MAX_PRINT_AT_ONCE,
  PAGE_SIZE_OPTIONS,
  PAGE_SIZE_STORAGE_KEY,
  isPageSize,
  normalisePageSize,
  pageCount,
  pageNumbers,
  pageSlice,
  printBlocker,
  readStoredPageSize,
  storePageSize,
} from "../src/lib/pagination.ts";

const read = (file) => fs.readFileSync(file, "utf8");
const index = read("src/pages/Index.tsx");
const pager = read("src/components/PaginationBar.tsx");
const styles = read("src/globals.css");

let failed = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}: ${label}${detail ? ` (${detail})` : ""}`);
  if (!ok) failed += 1;
};

const rows = (count) => Array.from({ length: count }, (_, index) => index);

console.log("Page size and bulk printing");

// --- the choices on offer ---------------------------------------------------
console.log("\n-- the choices on offer --");
check("offers 50 rows a page", PAGE_SIZE_OPTIONS.includes(50));
check("offers 100 rows a page", PAGE_SIZE_OPTIONS.includes(100));
check("offers 150 rows a page", PAGE_SIZE_OPTIONS.includes(150));
check("offers 200 rows a page", PAGE_SIZE_OPTIONS.includes(200));
check("still offers 10 as the default", PAGE_SIZE_OPTIONS.includes(DEFAULT_PAGE_SIZE));
check("every option is a usable positive size", PAGE_SIZE_OPTIONS.every((size) => size > 0));
check("there is more than one page size to choose from", PAGE_SIZE_OPTIONS.length > 1);

// --- paging maths -----------------------------------------------------------
console.log("\n-- paging maths --");
check("780 rows at 10 a page is 78 pages", pageCount(780, 10) === 78);
check("780 rows at 200 a page is 4 pages", pageCount(780, 200) === 4);
check("an empty list still has one page", pageCount(0, 10) === 1);
check("a negative total is treated as empty", pageCount(-5, 10) === 1);
check("780 rows at 200 fits on 4 pages", pageSlice(rows(780), 4, 200).length === 180);
check("page 1 of 780 at 200 starts at row 1", pageSlice(rows(780), 1, 200)[0] === 0);

// The bug a reader actually hits: sitting on a high page of a small view, then
// choosing a size under which that page no longer exists.
console.log("\n-- a page that no longer exists --");
check("page 40 of a 10-row view clamps to the last page", pageSlice(rows(95), 40, 10).length === 5);
check("the clamped page shows real rows", pageSlice(rows(95), 40, 10)[0] === 90);
check("a page below one clamps to page 1", pageSlice(rows(95), 0, 10)[0] === 0);
check("a negative page clamps to page 1", pageSlice(rows(95), -3, 10)[0] === 0);
check("a reader on page 8 switching to 200 still sees rows", pageSlice(rows(780), 8, 200).length > 0);
check("a zero page size cannot loop forever", pageSlice(rows(10), 1, 0).length > 0);

// --- untrusted stored values ------------------------------------------------
// localStorage is user-editable and survives changes to the option list, so a
// junk value must not reach the slice arithmetic.
console.log("\n-- untrusted stored values --");
for (const junk of [0, -5, 999, null, undefined, "", "abc", {}, [], NaN, 33.3]) {
  const resolved = normalisePageSize(junk);
  // NaN stringifies to null and undefined to nothing, which would print two
  // identical "null" labels and hide which case actually failed.
  const shown = typeof junk === "number" && Number.isNaN(junk) ? "NaN" : JSON.stringify(junk) ?? "undefined";
  check(`${shown} falls back to the default`, resolved === DEFAULT_PAGE_SIZE, `got ${resolved}`);
}
check("a stored size is read back from its string form", normalisePageSize("150") === 150);
check("a real number passes through", normalisePageSize(200) === 200);
check("isPageSize accepts an offered size", isPageSize(50));
check("isPageSize rejects an unoffered size", !isPageSize(75));

// --- the print limit --------------------------------------------------------
console.log("\n-- the print limit --");
check("one voucher may be printed", printBlocker(1) === "");
check("the limit itself may be printed", printBlocker(MAX_PRINT_AT_ONCE) === "");
check("one over the limit is refused", printBlocker(MAX_PRINT_AT_ONCE + 1) !== "");
check("a whole archive is refused", printBlocker(780) !== "");
check("nothing selected is refused", printBlocker(0) !== "");
check("the refusal says how to narrow it", /Narrow the date range/.test(printBlocker(780)));
check("the refusal names the ceiling it will accept", printBlocker(780).includes(String(MAX_PRINT_AT_ONCE)));
check("the refusal explains why, not just that", /stall/i.test(printBlocker(780)));
check("no negative count slips through as allowed", printBlocker(-1) !== "");

// --- remembering the choice -------------------------------------------------
console.log("\n-- remembering the choice --");
const fakeStorage = (initial = {}) => {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, value),
    read: (key) => map.get(key),
  };
};
check("an empty store starts at the default", readStoredPageSize(fakeStorage()) === DEFAULT_PAGE_SIZE);
check("a stored size is restored", readStoredPageSize(fakeStorage({ [PAGE_SIZE_STORAGE_KEY]: "200" })) === 200);
check("a stale stored size falls back", readStoredPageSize(fakeStorage({ [PAGE_SIZE_STORAGE_KEY]: "37" })) === DEFAULT_PAGE_SIZE);
check("storage that throws on read does not crash the page", readStoredPageSize({ getItem() { throw new Error("blocked"); } }) === DEFAULT_PAGE_SIZE);
check("storage that throws on write does not crash the page", (() => {
  storePageSize(50, { setItem() { throw new Error("blocked"); } });
  return true;
})());
const written = fakeStorage();
storePageSize(150, written);
check("a chosen size is written back to storage", written.read(PAGE_SIZE_STORAGE_KEY) === "150");
const writtenJunk = fakeStorage();
storePageSize(999, writtenJunk);
check("an unoffered size is not stored as-is", writtenJunk.read(PAGE_SIZE_STORAGE_KEY) === String(DEFAULT_PAGE_SIZE));

// --- page number strip ------------------------------------------------------
console.log("\n-- the page number strip --");
check("never offers more than five numbers", pageNumbers(1, 100).length <= 5);
check("includes the current page", pageNumbers(7, 100).includes(7));
check("stays inside the range", pageNumbers(1, 100).every((page) => page >= 1 && page <= 100));
check("clamps past the end", pageNumbers(99, 100).every((page) => page >= 1 && page <= 100));
check("the current page survives clamping", pageNumbers(99, 100).includes(99));
check("a single page yields just page 1", JSON.stringify(pageNumbers(1, 1)) === "[1]");

// --- wiring into the archive views -----------------------------------------
console.log("\n-- wiring --");
check("the hardcoded page size is gone", !/PAGE_SIZE = \d/.test(index));
check("the page size comes from state", /const \[pageSize, setPageSize\] = useState/.test(index));
check("it is read from storage on load", /readStoredPageSize\(window\.localStorage\)/.test(index));
check("a chosen size is written to storage", /storePageSize\(value, window\.localStorage\)/.test(index));
check("the pending list pages by the chosen size", /filteredVouchers\.length \/ pageSize/.test(index));
check("the approved list pages by the chosen size", /approvedVouchers\.length \/ pageSize/.test(index));
check("both views slice by the chosen size", (index.match(/\(safe\w*Page - 1\) \* pageSize/g) || []).length === 2);

console.log("\n-- a page that vanishes under a new size --");
check("changing the size returns the pending view to page 1", /setPageSize\(value\);\s*\n\s*setPage\(1\);/.test(index));
check("and the approved view too", /setPage\(1\);\s*\n\s*setApprovedPage\(1\);/.test(index));

console.log("\n-- bulk printing --");
check("both views render the shared pager", (index.match(/<PaginationBar/g) || []).length === 2);
check("the pager is used on the pending list", /<PaginationBar total=\{filteredVouchers\.length\}/.test(index));
check("the pager is used on the approved list", /<PaginationBar total=\{approvedVouchers\.length\}/.test(index));
check("every print goes through the guard", /exportSelected = \(\) => printVoucherSet\(/.test(index) && /exportApproved = \(\) => printVoucherSet\(/.test(index));
check("the guard consults the print limit", /printBlocker\(chosen\.length\)/.test(index));
check("a refused job explains itself instead of printing", /if \(blocked\) \{ setNotice\(blocked\); return; \}/.test(index));
check("the print button shows how many are ticked", /Print selected\{approvedSelected\.length \? ` \(\$\{approvedSelected\.length\}\)` : ""\}/.test(index));
check("selecting every match no longer needs the page checkbox first", !/approvedPageSelected && !everyApprovedSelected/.test(index));
check("the same is true on the pending list", !/pageSelected && !everyFilteredSelected/.test(index));
check("select-all is still offered when the list overflows a page", /!everyApprovedSelected && approvedVouchers\.length > pagedApproved\.length/.test(index));
check("the approved page says it prints", /print them together as one batch/.test(index));
check("the selection shows what will be printed", /ready to print, one sheet each/.test(index));

console.log("\n-- the pager itself --");check("offers every page size", /PAGE_SIZE_OPTIONS\.map/.test(pager));
check("labels the control for a screen reader", /aria-label="Rows shown per page"/.test(pager));
check("appears as soon as there is anything to list", /if \(total <= 0\) return null/.test(pager));
check("hides the page numbers when they would not help", /pages > 7 \? pageNumbers/.test(pager));
check("shows which rows are on screen", /\$\{from\}–\$\{to\} of \$\{total\}/.test(pager));
check("the picker is styled to match the archive", /\.page-size select \{[^}]*border: 1px solid #e4dfd7/.test(styles));
check("the pager wraps on narrow screens", /\.pagination-bar \{ flex-wrap: wrap; \}/.test(styles));
// Seven numbered buttons overrun a 375px screen unless they wrap too. Measured
// at that width with the page buttons inside the controls: they overflowed the
// container by 17px before this rule existed.
check("the numbered buttons wrap too", /\.page-buttons \{ flex-wrap: wrap; \}/.test(styles));
check("the selection bar wraps on narrow screens", /\.selection-bar \{ flex-wrap: wrap; \}/.test(styles));

// --- the sheets actually reach the paper -------------------------------------
// Printing produced completely blank pages, which no other check here could see.
// The stylesheet hid ".app-shell > *:not(.print-only)", assuming the sheets sat
// beside the app shell. AppShell nests its children in .content-wrap inside
// .main-content, so that rule hid .main-content and every sheet inside it:
// measured, each .print-voucher had a height of 0. The sheets are now portalled
// to <body>, which is what the rule assumed, so it is asserted here.
console.log("\n-- the sheets reach the paper --");
check("the sheets are portalled to <body>", /createPortal\([\s\S]{0,400}document\.body/.test(index));
check("the portal wraps the print area", /createPortal\(\s*<div className="print-only">/.test(index));
check("print media hides by position under body", /body > \*:not\(\.print-only\)/.test(styles));
check("print media no longer reaches in from the shell", !/\.app-shell > \*:not\(\.print-only\)/.test(styles));
check("the reason is written down where the rule lives", /\.print-only\).*direct child of <body>/s.test(styles) || /must stay "direct child of body"/.test(styles));
check("the app shell is not the hiding anchor any more", !/\.app-shell\s*>\s*\*/.test(styles.replace(/\/\*[\s\S]*?\*\//g, "")));
check("each sheet breaks to its own page", /page-break-after: always/.test(styles) && /break-after: page/.test(styles));
check("the last sheet does not leave a trailing blank page", /\.print-only \.print-voucher:last-child \{[^}]*break-after: auto/.test(styles));
check("the logo is told to keep its colour when printed", /\.print-only img \{[^}]*print-color-adjust: exact/.test(styles));
check("the sheets stay hidden on screen", /\.print-only \{ display: none; \}/.test(styles));
check("the print is triggered once the sheets are ready", /window\.print\(\)/.test(index));

console.log(failed ? `\n${failed} check(s) failed` : "\nAll page-size and bulk-print checks passed");
process.exit(failed ? 1 : 0);

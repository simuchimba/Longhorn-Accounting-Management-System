/**
 * Bulk voucher import.
 *
 * Reads CSV / TSV and Excel (.xlsx, .xlsm) files and turns them into
 * normalised voucher rows that can be previewed and bulk-created.
 *
 * Three source shapes are supported automatically:
 *
 *  1. Cash book / bank statement  - "Date | Payee | Details | Inflows |
 *     Outflows | Balance | Status", usually with title rows and group
 *     headers above the real header row. Money out becomes a payment
 *     voucher, money in is reported as a receipt.
 *  2. Flat voucher tables - "Date | Amount | Paid To | Being Payment".
 *  3. Files split into several stacked blocks, each with its own header row.
 */

import { strFromU8, unzipSync } from "fflate";

export type ImportField =
  | "date"
  | "paidTo"
  | "beingPayment"
  | "amount"
  | "inflow"
  | "outflow"
  | "balance"
  | "status"
  | "currency"
  | "paymentMethod"
  | "reference"
  | "department"
  | "voucherNo";

export type ImportDirection = "payment" | "receipt" | "unknown";

export type ImportRowError = "" | "date" | "amount" | "payee" | "purpose" | "department";

export type ParsedImportRow = {
  /** Stable client key so React lists can re-order safely. */
  key: string;
  /** 1-based row number in the source sheet, for error messages. */
  sourceRow: number;
  date: string;
  amount: number;
  paidTo: string;
  beingPayment: string;
  currency: string;
  paymentMethod: string;
  reference: string;
  department: string;
  voucherNo: string;
  balance: number | null;
  sourceStatus: string;
  direction: ImportDirection;
  warnings: string[];
  error: ImportRowError;
  /** Rows with no money movement (opening balances, blank tails) are not offered. */
  skipped: boolean;
  skipNote: string;
};

export type ParsedImportSheet = {
  name: string;
  rowCount: number;
  headerRows: number[];
  columns: Partial<Record<ImportField, number>>;
  columnLabels: Partial<Record<ImportField, string>>;
  layout: "statement" | "voucher";
  rows: ParsedImportRow[];
  error: string;
};

export type ParsedImportFile = {
  fileName: string;
  kind: "excel" | "delimited";
  sheets: ParsedImportSheet[];
  warnings: string[];
};

export type ImportSummary = {
  payments: number;
  receipts: number;
  skipped: number;
  problems: number;
  paymentTotal: number;
  receiptTotal: number;
  firstDate: string;
  lastDate: string;
};

export const IMPORT_FILE_ACCEPT =
  ".xlsx,.xlsm,.csv,.tsv,.txt,text/csv,application/csv,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel.sheet.macroEnabled.12";

export const IMPORT_FILE_HINT =
  "Excel (.xlsx, .xlsm) or CSV/TSV. Cash book and bank statement layouts are detected automatically.";

/** Excel formats this reader cannot open, mapped to a friendly description. */
const LEGACY_EXCEL: Record<string, string> = {
  xls: "Excel 97-2003 workbook",
  xlsb: "Excel binary workbook",
  ods: "OpenDocument spreadsheet",
};

/* -------------------------------------------------------------------------- */
/* Cell helpers                                                                */
/* -------------------------------------------------------------------------- */

const cleanText = (value: unknown): string =>
  String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const isNumericCell = (value: unknown): boolean =>
  typeof value === "number" && Number.isFinite(value);

const cellToText = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "number") return String(value);
  return cleanText(value);
};

/** Lower-case and strip everything that is not a letter or digit. */
const normaliseHeader = (value: unknown): string => cellToText(value).toLowerCase().replace(/[^a-z0-9]/g, "");

/* -------------------------------------------------------------------------- */
/* Number parsing                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Accepts numbers and messy human amounts: "1,234.00", "ZMW 1 234", "(250)",
 * "1.234,56", "250-", "–". Returns the signed value, or null when the cell
 * holds nothing numeric.
 */
export const parseNumber = (value: unknown): number | null => {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (value instanceof Date || typeof value === "boolean") return null;

  let text = cleanText(value);
  if (!text) return null;
  // Placeholder dashes such as "-" or an em dash hold no value.
  if (!/\d/.test(text)) return null;

  let negative = false;
  if (/^\(.*\)$/.test(text)) {
    negative = true;
    text = text.slice(1, -1);
  }
  if (/-\s*$/.test(text) && !/\d-\d/.test(text)) {
    negative = true;
    text = text.replace(/-\s*$/, "");
  }
  if (/^\s*-/.test(text)) {
    negative = true;
    text = text.replace(/^\s*-/, "");
  }

  text = text.replace(/[^\d.,]/g, "");
  if (!text) return null;

  const lastComma = text.lastIndexOf(",");
  const lastDot = text.lastIndexOf(".");

  if (lastComma > -1 && lastDot > -1) {
    if (lastComma > lastDot) text = text.replace(/\./g, "").replace(",", ".");
    else text = text.replace(/,/g, "");
  } else if (lastComma > -1) {
    const decimals = text.length - lastComma - 1;
    const looksThousand = /^\d{1,3}(,\d{3})+$/.test(text);
    text = decimals === 2 && !looksThousand ? text.replace(",", ".") : text.replace(/,/g, "");
  }

  const result = Number(text);
  if (!Number.isFinite(result)) return null;
  return negative ? -result : result;
};

/* -------------------------------------------------------------------------- */
/* Date parsing                                                                */
/* -------------------------------------------------------------------------- */

const pad = (value: number): string => String(value).padStart(2, "0");

const toIsoDate = (date: Date): string =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

const MONTH_INDEX: Record<string, number> = {};
["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"].forEach(
  (name, index) => {
    MONTH_INDEX[name] = index + 1;
    MONTH_INDEX[name.slice(0, 3)] = index + 1;
    MONTH_INDEX[name.slice(0, 4)] = index + 1;
  },
);

const monthNumber = (word: string): number => {
  const key = word.toLowerCase().replace(/\./g, "");
  return MONTH_INDEX[key] ?? MONTH_INDEX[key.slice(0, 4)] ?? MONTH_INDEX[key.slice(0, 3)] ?? 0;
};

/** Excel serial day number to a local date. 25569 = 1970-01-01. */
const fromSerial = (serial: number): string => {
  if (!Number.isFinite(serial)) return "";
  // 1990-01-01 .. 2100-01-01
  if (serial < 32874 || serial > 73415) return "";
  return toIsoDate(new Date(Math.round((serial - 25569) * 86400000)));
};

const buildDate = (year: number, month: number, day: number): string => {
  if (!year || !month || !day || month < 1 || month > 12 || day < 1 || day > 31) return "";
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return "";
  return toIsoDate(date);
};

const expandYear = (raw: number): number => {
  if (raw >= 100) return raw;
  return raw < 70 ? 2000 + raw : 1900 + raw;
};

/**
 * Normalises anything a spreadsheet can hold into `YYYY-MM-DD`.
 * Handles real dates, Excel serials, ISO, dd/mm/yyyy, mm/dd/yyyy and
 * "1 September 2026" style values. Returns "" when unrecognised.
 */
export const parseDateValue = (value: unknown): string => {
  if (value === null || value === undefined || value === "") return "";
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? "" : toIsoDate(value);
  if (typeof value === "number") return fromSerial(value);

  const text = cleanText(value);
  if (!text) return "";
  if (/^\d{4,6}(\.\d+)?$/.test(text)) return fromSerial(Number(text));

  const iso = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(text);
  if (iso) return buildDate(+iso[1], +iso[2], +iso[3]);

  const numeric = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/.exec(text);
  if (numeric) {
    const first = +numeric[1];
    const second = +numeric[2];
    const year = expandYear(+numeric[3]);
    // Day-first unless the first part cannot be a day, then month-first.
    if (first > 12 && second <= 12) return buildDate(year, second, first);
    if (second > 12 && first <= 12) return buildDate(year, first, second);
    return buildDate(year, second, first);
  }

  const monthFirst = /^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{2,4})$/.exec(text);
  if (monthFirst) {
    const month = monthNumber(monthFirst[1]);
    if (month) return buildDate(expandYear(+monthFirst[3]), month, +monthFirst[2]);
  }

  const dayFirst = /^(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?([A-Za-z]{3,9})\.?,?\s+(\d{2,4})$/.exec(text);
  if (dayFirst) {
    const month = monthNumber(dayFirst[2]);
    if (month) return buildDate(expandYear(+dayFirst[3]), month, +dayFirst[1]);
  }

  const fallback = new Date(text);
  return Number.isNaN(fallback.getTime()) ? "" : toIsoDate(fallback);
};

/* -------------------------------------------------------------------------- */
/* Header detection                                                            */
/* -------------------------------------------------------------------------- */

/** Header labels that must never be treated as an amount column. */
const IGNORED_HEADERS = ["amountinwords", "amountofwords", "words", "voucherwords", "sum", "sumtotal"];

const FIELD_ALIASES: Record<ImportField, string[]> = {
  date: [
    "date", "voucherdate", "paymentdate", "transactiondate", "postingdate", "valuedate",
    "transdate", "dated", "dateoftransaction", "day", "entrydate", "effectivedate",
  ],
  paidTo: [
    "paidto", "payee", "payee name", "paid", "beneficiary", "beneficiaryname", "recipient",
    "supplier", "vendorname", "vendor", "payto", "accountname", "account", "name",
    "counterparty", "customer", "creditor", "debtor", "employee", "officer", "party", "towards",
  ],
  beingPayment: [
    "beingpayment", "being", "purpose", "purposeofpayment", "description", "descriptionofpayment",
    "details", "detail", "particulars", "narrative", "narration", "memo", "remarks", "reason",
    "expense", "expenditure", "for", "note", "notes", "transaction",
  ],
  amount: ["amount", "amt", "amountpaid", "amountofpayment", "totalamount", "value", "transactionamount"],
  inflow: [
    "inflows", "inflow", "moneyin", "moneyreceived", "receipts", "receipt", "deposits",
    "deposit", "credit", "credits", "creditamount", "inflowamount", "paidin", "received",
  ],
  outflow: [
    "outflows", "outflow", "moneyout", "moneypaid", "payments", "payment", "paidamount",
    "withdrawal", "withdrawals", "debit", "debits", "debitamount", "outflowamount", "paidout",
    "expenses", "disbursement", "disbursements", "moneywithdrawn", "sent",
  ],
  balance: ["balance", "runningbalance", "closingbalance", "openingbalance", "balancecarried", "bal"],
  status: ["status", "transactionstatus", "state", "remark", "paymentstatus"],
  currency: ["currency", "ccy", "curr", "currencycode"],
  paymentMethod: ["paymentmethod", "method", "mode", "modeofpayment", "paymentmode", "channel", "paymentchannel"],
  reference: [
    "reference", "referencenumber", "refno", "reference no", "invoiceno", "invoice", "invoicenumber",
    "invoice no", "receiptno", "receiptnumber", "transactionid", "transactionreference", "txnref",
    "documentno", "docno", "referencecode", "ref",
  ],
  department: ["department", "departmentname", "dept", "costcentre", "costcenter", "division", "unit", "branch"],
  voucherNo: ["voucherno", "vouchernumber", "voucher", "pvno", "pvnumber", "pvn", "documentnumber"],
};

/** Resolution order. Earlier fields win when two columns both look like a match. */
const FIELD_ORDER: ImportField[] = [
  "date", "paidTo", "beingPayment", "amount", "inflow", "outflow",
  "balance", "voucherNo", "reference", "department", "paymentMethod", "currency", "status",
];

const aliasLookup = (field: ImportField): string[] => FIELD_ALIASES[field].map(normaliseHeader);

/** Aliases short enough that substring matching produces false positives. */
const fuzzyAliases = (field: ImportField): string[] =>
  aliasLookup(field).filter((alias) => alias.length >= 4 && !IGNORED_HEADERS.includes(alias));

type ResolvedColumns = {
  columns: Partial<Record<ImportField, number>>;
  labels: Partial<Record<ImportField, string>>;
  score: number;
  isHeader: boolean;
};

const isMoneyField = (field: ImportField) => field === "amount" || field === "inflow" || field === "outflow" || field === "balance";

const resolveColumns = (cells: unknown[]): ResolvedColumns => {
  const columns: Partial<Record<ImportField, number>> = {};
  const labels: Partial<Record<ImportField, string>> = {};
  const used = new Set<number>();

  const entries = cells.map((cell, index) => ({
    index,
    key: normaliseHeader(cell),
    numeric: isNumericCell(cell),
    date: cell instanceof Date,
  }));

  // Text fields should never latch onto a numeric or date cell, otherwise a
  // long run of amounts can masquerade as a header row.
  const usable = (entry: (typeof entries)[number], field: ImportField) =>
    isMoneyField(field) || field === "date" ? true : !entry.numeric && !entry.date;

  for (const [pass, aliasesFor] of [
    [1, aliasLookup],
    [2, fuzzyAliases],
  ] as const) {
    for (const field of FIELD_ORDER) {
      if (columns[field] !== undefined) continue;
      const aliases = aliasesFor(field);
      if (!aliases.length) continue;
      const hit = entries.find((entry) => {
        if (!entry.key || used.has(entry.index) || !usable(entry, field)) return false;
        if (pass === 1) return aliases.includes(entry.key);
        return aliases.some((alias) => entry.key.includes(alias));
      });
      if (hit) {
        columns[field] = hit.index;
        labels[field] = hit.key;
        used.add(hit.index);
      }
    }
  }

  let score = Object.keys(columns).length;
  if (columns.date !== undefined) score += 2;
  if (columns.amount !== undefined || columns.outflow !== undefined || columns.inflow !== undefined) score += 2;
  if (columns.paidTo !== undefined || columns.beingPayment !== undefined) score += 1;

  const hasMoney = columns.amount !== undefined || columns.outflow !== undefined || columns.inflow !== undefined;
  const hasIdentity = columns.paidTo !== undefined || columns.beingPayment !== undefined;
  const isHeader = columns.date !== undefined && hasMoney && hasIdentity && score >= 4;

  return { columns, labels, score, isHeader };
};

/* -------------------------------------------------------------------------- */
/* Delimited text (CSV / TSV)                                                  */
/* -------------------------------------------------------------------------- */

const detectDelimiter = (text: string): string => {
  const sample = text.split(/\r?\n/).filter((line) => line.trim()).slice(0, 12).join("\n");
  const candidates = [",", ";", "\t", "|"];
  let best = ",";
  let bestCount = -1;
  for (const candidate of candidates) {
    let count = 0;
    let inQuotes = false;
    for (let i = 0; i < sample.length; i++) {
      const char = sample[i];
      if (char === '"') {
        if (inQuotes && sample[i + 1] === '"') i++;
        else inQuotes = !inQuotes;
      } else if (char === candidate && !inQuotes) count++;
    }
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }
  return bestCount > 0 ? best : ",";
};

/**
 * RFC 4180 style parser with delimiter sniffing.
 *
 * Blank rows are kept on purpose so that the row numbers reported to the user
 * match the row numbers in the file.
 */
export const parseDelimitedText = (input: string, delimiter?: string): unknown[][] => {
  const text = input.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const sep = delimiter || detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else inQuotes = false;
      } else cell += char;
    } else if (char === '"') inQuotes = true;
    else if (char === sep) {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += char;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  // Trailing newlines only produce empty tails; drop those but keep interior blanks.
  while (rows.length > 1 && rows[rows.length - 1].every((value) => cleanText(value) === "")) rows.pop();
  return rows;
};

/* -------------------------------------------------------------------------- */
/* Sheet parsing                                                               */
/* -------------------------------------------------------------------------- */

const HEADER_SCAN_LIMIT = 60;
const MAX_BLANK_RUN = 12;

const RECEIPT_PATTERN = /receiv|inflow|credit|deposit|money\s*in|paid\s*in|\bin\b/i;
const PAYMENT_PATTERN = /paid|outflow|debit|withdraw|payment|disburse|money\s*out|\bout\b/i;

/**
 * Labels that mark a row as a running total rather than a transaction.
 *
 * Matching is on the whole label (not a prefix) so that real payees such as
 * "Total Zambia" or "Balance Sports Club" are still imported normally.
 */
const SUMMARY_LABELS = new Set([
  "total", "totals", "subtotal", "grandtotal", "totalsin", "totalsout",
  "totalinflows", "totaloutflows", "totalpayments", "totalreceived", "totalpaid",
  "totalpage", "totalsperpage",
  "balancebf", "balancecf", "balancetotal", "closingbalance", "openingbalance",
  "carriedforward", "broughtforward", "carrieddown", "broughtdown",
  "bf", "cf", "cd",
]);

const isSummaryLabel = (value: string): boolean => {
  const label = cleanText(value).toLowerCase().replace(/[^a-z0-9/]/g, "");
  if (!label) return false;
  return SUMMARY_LABELS.has(label) || SUMMARY_LABELS.has(label.replace(/\//g, ""));
};

const moneyAt = (cells: unknown[], index: number | undefined): number | null =>
  index === undefined ? null : parseNumber(cells[index]);

const textAt = (cells: unknown[], index: number | undefined): string =>
  index === undefined ? "" : cleanText(cells[index]);

const buildRow = (
  sheetName: string,
  sourceRow: number,
  cells: unknown[],
  columns: Partial<Record<ImportField, number>>,
): ParsedImportRow | null => {
  const date = parseDateValue(columns.date !== undefined ? cells[columns.date] : undefined);
  const paidTo = textAt(cells, columns.paidTo);
  const beingPayment = textAt(cells, columns.beingPayment);
  const reference = textAt(cells, columns.reference);
  const statusText = textAt(cells, columns.status);

  const flatAmount = moneyAt(cells, columns.amount);
  const inflow = moneyAt(cells, columns.inflow);
  const outflow = moneyAt(cells, columns.outflow);
  const balance = moneyAt(cells, columns.balance);

  if (!date && !paidTo && !beingPayment && flatAmount === null && inflow === null && outflow === null) return null;

  let amount = 0;
  let direction: ImportDirection = "unknown";

  if (outflow !== null && outflow !== 0) {
    amount = Math.abs(outflow);
    direction = "payment";
  } else if (inflow !== null && inflow !== 0) {
    amount = Math.abs(inflow);
    direction = "receipt";
  } else if (flatAmount !== null && flatAmount !== 0) {
    amount = Math.abs(flatAmount);
    if (RECEIPT_PATTERN.test(statusText)) direction = "receipt";
    else if (PAYMENT_PATTERN.test(statusText)) direction = "payment";
    else if (flatAmount < 0) direction = "receipt";
    else direction = columns.inflow !== undefined || columns.outflow === undefined ? "payment" : "unknown";
  }

  const row: ParsedImportRow = {
    key: `${sheetName}:${sourceRow}`,
    sourceRow,
    date,
    amount: Math.round(amount * 100) / 100,
    paidTo,
    beingPayment,
    currency: textAt(cells, columns.currency).toUpperCase(),
    paymentMethod: textAt(cells, columns.paymentMethod),
    reference,
    department: textAt(cells, columns.department),
    voucherNo: textAt(cells, columns.voucherNo),
    balance: balance === null ? null : Math.round(balance * 100) / 100,
    sourceStatus: statusText,
    direction,
    warnings: [],
    error: "",
    skipped: false,
    skipNote: "",
  };

  // Rows without money movement are never transactions: opening balances,
  // blank tails and running-balance-only rows.
  if (amount === 0) {
    row.skipped = true;
    row.skipNote = "No amount on this row";
    if (paidTo || beingPayment) row.skipNote = `No amount on this row (${cleanText(`${paidTo} ${beingPayment}`)})`;
    return row;
  }

  // Running totals carry a real amount but are not payments. The label can sit in
  // any column of the row (often a merged cell off to the side), so every text
  // cell is checked rather than just the payee and purpose columns.
  const summaryCell = cells.find((cell) => typeof cell === "string" && isSummaryLabel(cell));
  if (summaryCell !== undefined) {
    row.skipped = true;
    row.direction = "unknown";
    row.amount = 0;
    row.skipNote = `Total row (${cleanText(summaryCell)}) - not a payment`;
    return row;
  }

  if (!row.date) row.error = "date";
  else if (row.amount <= 0) row.error = "amount";
  else if (!row.paidTo) row.error = "payee";
  else if (!row.beingPayment) row.error = "purpose";
  else if (direction === "unknown") {
    row.warnings.push("Could not tell money in from money out - imported as a payment.");
    row.direction = "payment";
  }

  return row;
};

const parseSheet = (sheetName: string, grid: unknown[][]): ParsedImportSheet => {
  const base: ParsedImportSheet = {
    name: sheetName,
    rowCount: grid.length,
    headerRows: [],
    columns: {},
    columnLabels: {},
    layout: "voucher",
    rows: [],
    error: "",
  };
  if (!grid.length) return { ...base, error: "This sheet is empty." };

  // 1. Find the header row anywhere near the top of the sheet.
  let active: ResolvedColumns | null = null;
  let headerIndex = -1;
  let bestScore = 0;
  const limit = Math.min(grid.length, HEADER_SCAN_LIMIT);
  for (let i = 0; i < limit; i++) {
    const candidate = resolveColumns(grid[i]);
    if (candidate.isHeader && candidate.score > bestScore) {
      bestScore = candidate.score;
      active = candidate;
      headerIndex = i;
    }
  }
  if (!active || headerIndex < 0) {
    return {
      ...base,
      error:
        "No recognisable header row. The sheet needs a date column plus an amount column (amount, outflow, inflow, withdrawals or deposits) and a payee/purpose column.",
    };
  }

  const headerRows = [headerIndex + 1];
  const rows: ParsedImportRow[] = [];
  let blankRun = 0;

  for (let i = headerIndex + 1; i < grid.length; i++) {
    const cells = grid[i];
    const isBlank = cells.every((cell) => cellToText(cell) === "");
    if (isBlank) {
      blankRun++;
      if (blankRun > MAX_BLANK_RUN) break;
      continue;
    }
    blankRun = 0;

    // 2. A second header row means the sheet stacks several blocks.
    const candidate = resolveColumns(cells);
    if (candidate.isHeader && candidate.score >= bestScore - 1 && candidate.score >= 4) {
      active = candidate;
      headerRows.push(i + 1);
      bestScore = Math.max(bestScore, candidate.score);
      continue;
    }

    const row = buildRow(sheetName, i + 1, cells, active.columns);
    if (row) rows.push(row);
  }

  const layout: "statement" | "voucher" =
    active.columns.outflow !== undefined || active.columns.inflow !== undefined || active.columns.balance !== undefined
      ? "statement"
      : "voucher";

  return { ...base, headerRows, columns: active.columns, columnLabels: active.labels, layout, rows };
};

/* -------------------------------------------------------------------------- */
/* File entry points                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Minimal `.xlsx` / `.xlsm` reader.
 *
 * An xlsx file is just a zip archive of XML parts, so this unzips it with
 * `fflate` and walks the few parts that matter with the browser's own
 * `DOMParser`. That keeps the dependency footprint tiny and, unlike a
 * spreadsheet library, it hands back true Excel row and column coordinates so
 * error messages can point at the exact line a preparer sees on screen.
 *
 * Date cells are intentionally left as Excel serial numbers: `parseDateValue`
 * already understands those, and skipping `styles.xml` keeps this simple.
 */
const MAX_XLSX_BYTES = 30 * 1024 * 1024;

/** Thrown when a file is not a standard Excel workbook. */
class InvalidWorkbookError extends Error {}

/**
 * Turns a low level failure into advice that actually matches the cause.
 *
 * The important part is not blaming the file for problems the file did not
 * cause: a stale dev-server chunk or an out-of-date browser tab looks nothing
 * like a corrupt workbook, and telling someone to re-save a perfectly good file
 * sends them down the wrong path.
 */
const explainReadFailure = (name: string, error: unknown): string => {
  if (error instanceof InvalidWorkbookError) {
    return (
      `"${name}" is not a standard Excel workbook. Open it in Excel or LibreOffice and use ` +
      "File > Save As > Excel Workbook (.xlsx), then import that file."
    );
  }
  const message = error instanceof Error ? error.message : String(error);
  if (/dynamically imported module|Failed to fetch|Importing a module script failed|Loading module/i.test(message)) {
    return (
      "The Excel reader could not be loaded, so the file was never read. " +
      "Restart the dev server (stop npm run dev and start it again), then hard-refresh the page with Ctrl+Shift+R, and try once more."
    );
  }
  if (/worksheet XML could not be parsed/i.test(message)) {
    return `"${name}" contains a worksheet that could not be read. Open it in Excel and re-save it, then try again.`;
  }
  return `"${name}" could not be opened (${message}).`;
};

const tags = (doc: Document, name: string): Element[] =>
  Array.from(doc.getElementsByTagNameNS("*", name) as HTMLCollectionOf<Element>);

const firstTag = (element: Element, name: string): Element | undefined =>
  Array.from(element.getElementsByTagNameNS("*", name) as HTMLCollectionOf<Element>)[0];

const parseXml = (xml: string): Document | null => {
  try {
    return new DOMParser().parseFromString(xml, "application/xml");
  } catch {
    return null;
  }
};

/** "C17" -> zero-based column 2, row 16. */
const cellCoordinates = (ref: string): { column: number; row: number } | null => {
  const match = /^([A-Z]+)(\d+)$/.exec(ref.trim());
  if (!match) return null;
  let column = 0;
  for (const char of match[1]) column = column * 26 + (char.charCodeAt(0) - 64);
  return { column: column - 1, row: Number(match[2]) - 1 };
};

/** Concatenates the text runs of a shared string, skipping phonetic guides. */
const inlineText = (element: Element): string => {
  const chunks: string[] = [];
  const walk = (node: Element) => {
    Array.from(node.children).forEach((child) => {
      const local = child.localName;
      if (local === "rPh" || local === "phoneticPr") return;
      if (local === "t") chunks.push(child.textContent ?? "");
      else walk(child);
    });
  };
  walk(element);
  return chunks.join("");
};

const cellValue = (cell: Element, sharedStrings: string[]): unknown => {
  const type = cell.getAttribute("t") ?? "n";
  const valueNode = firstTag(cell, "v");

  if (type === "inlineStr") {
    const inline = firstTag(cell, "is");
    return inline ? inlineText(inline) : null;
  }
  if (type === "s") {
    const index = Number(valueNode?.textContent);
    return Number.isInteger(index) ? (sharedStrings[index] ?? null) : null;
  }
  if (type === "e" || !valueNode) return null;
  if (type === "str") return valueNode.textContent ?? null;
  if (type === "b") return valueNode.textContent === "1";
  if (type === "d") {
    const parsed = new Date(valueNode.textContent ?? "");
    return Number.isNaN(parsed.getTime()) ? valueNode.textContent : parsed;
  }
  const raw = (valueNode.textContent ?? "").trim();
  if (!raw) return null;
  const numeric = Number(raw);
  return Number.isFinite(numeric) ? numeric : raw;
};

const readSheetXml = (xml: string, sharedStrings: string[]): unknown[][] => {
  const doc = parseXml(xml);
  if (!doc) throw new Error("The worksheet XML could not be parsed.");

  const rows: unknown[][] = [];
  let maxColumn = 0;

  tags(doc, "row").forEach((rowNode) => {
    const declared = Number(rowNode.getAttribute("r"));
    const rowIndex = Number.isFinite(declared) && declared > 0 ? declared - 1 : rows.length;
    if (rowIndex < 0) return;
    const row: unknown[] = [];
    let nextColumn = 0;
    Array.from(rowNode.children).forEach((node) => {
      if (node.localName !== "c") return;
      const coords = cellCoordinates(node.getAttribute("r") ?? "");
      const column = coords ? coords.column : nextColumn;
      nextColumn = column + 1;
      row[column] = cellValue(node, sharedStrings);
    });
    rows[rowIndex] = row;
    maxColumn = Math.max(maxColumn, row.length);
  });

  // Fill gaps so every row is a dense, same-width array anchored at row 1.
  const dense: unknown[][] = [];
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index] ?? [];
    dense[index] = Array.from({ length: maxColumn }, (_, column) => row[column] ?? null);
  }
  return dense;
};

const loadExcel = async (file: File): Promise<{ name: string; grid: unknown[][] }[]> => {
  if (file.size > MAX_XLSX_BYTES) {
    throw new Error(`That workbook is ${Math.round(file.size / 1048576)} MB. Please split it into smaller files of under 30 MB.`);
  }

  const entries = unzipSync(new Uint8Array(await file.arrayBuffer()));
  const xml = (path: string): string | null => {
    const entry = entries[path];
    return entry ? strFromU8(entry) : null;
  };

  const workbookXml = xml("xl/workbook.xml");
  const relsXml = xml("xl/_rels/workbook.xml.rels");
  const workbookDoc = workbookXml ? parseXml(workbookXml) : null;
  const relsDoc = relsXml ? parseXml(relsXml) : null;
  if (!workbookDoc || !relsDoc) throw new Error(new InvalidWorkbookError().message);

  const targets = new Map<string, string>();
  tags(relsDoc, "Relationship").forEach((rel) => {
    const id = rel.getAttribute("Id");
    if (!id) return;
    targets.set(id, (rel.getAttribute("Target") ?? "").replace(/^\/?xl\//, "").replace(/^\.\//, ""));
  });

  const sharedStrings: string[] = [];
  const sharedStringsXml = xml("xl/sharedStrings.xml");
  if (sharedStringsXml) {
    const sharedDoc = parseXml(sharedStringsXml);
    if (sharedDoc) tags(sharedDoc, "si").forEach((item) => sharedStrings.push(inlineText(item)));
  }

  const sheets: { name: string; grid: unknown[][] }[] = [];
  tags(workbookDoc, "sheet").forEach((node, index) => {
    const name = node.getAttribute("name") ?? `Sheet${index + 1}`;
    const relationId = node.getAttribute("r:id") ?? node.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id");
    const target = relationId ? targets.get(relationId) : undefined;
    if (!target) return;
    const sheetXml = xml(target.startsWith("xl/") ? target : `xl/${target}`);
    if (!sheetXml) return;
    try {
      sheets.push({ name, grid: readSheetXml(sheetXml, sharedStrings) });
    } catch {
      // A single unreadable sheet must not sink the whole import.
    }
  });

  return sheets.filter((sheet) => sheet.grid.length > 0);
};

/** Reads an .xlsx/.xlsm file or a CSV/TSV file into parsed rows. */
export const parseImportFile = async (file: File): Promise<ParsedImportFile> => {
  const name = file.name || "upload";
  const extension = (name.split(".").pop() ?? "").toLowerCase();

  if (LEGACY_EXCEL[extension]) {
    throw new Error(
      `"${name}" is a ${LEGACY_EXCEL[extension]}, which cannot be read directly in the browser. ` +
        "Open it in Excel or LibreOffice and use File › Save As › Excel Workbook (.xlsx), then import that file.",
    );
  }

  const isExcel = extension === "xlsx" || extension === "xlsm";

  let rawSheets: { name: string; grid: unknown[][] }[];
  try {
    if (isExcel) {
      rawSheets = await loadExcel(file);
    } else {
      const text = await file.text();
      rawSheets = [{ name: name.replace(/\.[^.]+$/, "") || "Sheet1", grid: parseDelimitedText(text) as unknown[][] }];
    }
  } catch (error) {
    if (isExcel) throw new Error(explainReadFailure(name, error));
    throw error;
  }

  const warnings: string[] = [];
  if (!rawSheets.length) throw new Error("The file contains no sheets or rows.");

  const sheets = rawSheets.map((sheet) => parseSheet(sheet.name, sheet.grid));
  const usable = sheets.filter((sheet) => !sheet.error);
  if (!usable.length) {
    throw new Error(
      sheets.find((sheet) => sheet.error)?.error ||
        "Could not read any data from this file. Make sure it has a header row with a date and an amount column.",
    );
  }
  if (usable.length < sheets.length) {
    warnings.push(
      `${sheets.length - usable.length} sheet(s) were skipped because no header row could be recognised. ` +
        "Use the sheet picker to choose a different one.",
    );
  }

  return { fileName: name, kind: isExcel ? "excel" : "delimited", sheets, warnings };
};

export const summariseImport = (rows: ParsedImportRow[]): ImportSummary => {
  const summary: ImportSummary = {
    payments: 0,
    receipts: 0,
    skipped: 0,
    problems: 0,
    paymentTotal: 0,
    receiptTotal: 0,
    firstDate: "",
    lastDate: "",
  };
  rows.forEach((row) => {
    if (row.skipped) {
      summary.skipped++;
      return;
    }
    if (row.error) {
      summary.problems++;
      return;
    }
    if (row.direction === "receipt") {
      summary.receipts++;
      summary.receiptTotal += row.amount;
    } else {
      summary.payments++;
      summary.paymentTotal += row.amount;
    }
    if (row.date) {
      if (!summary.firstDate || row.date < summary.firstDate) summary.firstDate = row.date;
      if (!summary.lastDate || row.date > summary.lastDate) summary.lastDate = row.date;
    }
  });
  summary.paymentTotal = Math.round(summary.paymentTotal * 100) / 100;
  summary.receiptTotal = Math.round(summary.receiptTotal * 100) / 100;
  return summary;
};

export const describeSheetColumns = (sheet: ParsedImportSheet): string => {
  const parts: string[] = [];
  const show = (field: ImportField) => {
    const index = sheet.columns[field];
    if (index === undefined) return;
    parts.push(sheet.columnLabels[field] || FIELD_ALIASES[field][0]);
  };
  show("date");
  show("paidTo");
  show("beingPayment");
  show("amount");
  show("inflow");
  show("outflow");
  show("balance");
  return parts.join(" · ");
};
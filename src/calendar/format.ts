// Dates, money and percentages as the page shows them. Formatters are built once (they're slow to create).

export const DAY = 864e5;

export function startOfDay(d: Date | number): Date { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
export function addDays(d: Date | number, n: number): Date { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
export function startOfWeek(d: Date | number): Date { return addDays(startOfDay(d), -new Date(d).getDay()); }
export function dayKey(ts: Date | number): string { const d = new Date(ts); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; }
export const sameDay = (a: Date | number, b: Date | number): boolean => dayKey(a) === dayKey(b);

const WEEKDAYS = Array.from({ length: 7 }, (_, i) => new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(new Date(2024, 0, 7 + i)));

export const fmt = {
  time: new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }),
  dayLong: new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" }),
  dayShort: new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" }),
  month: new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }),
  monthName: new Intl.DateTimeFormat(undefined, { month: "long" }),
  full: new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }),
  /** Short weekday name, 0 = Sunday. */
  wd: (i: number): string => WEEKDAYS[i],
};

export const when = (ts: number | null | undefined): string => (ts ? fmt.full.format(ts) : "unknown");
export const pct = (p: number | null | undefined): string => (p == null ? "" : `${(p * 100).toFixed(p > 0 && p * 100 < 10 ? 1 : 0)}%`);
const usd = new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" });
export const money = (n: number | null | undefined): string => (n != null && Number.isFinite(n) ? usd.format(n) : "-");
export const signed = (n: number): string => `${n >= 0 ? "+" : "−"}${money(Math.abs(n))}`;
/** CSS class for a gain or loss. */
export const pnlCls = (n: number | null | undefined): string => (n == null ? "" : n > 0 ? "pos" : n < 0 ? "neg" : "");

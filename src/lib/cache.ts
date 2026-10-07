// A small key → value cache that is saved in chrome.storage and can't grow forever.
//
// Event names, game start times, settled results and prices at buy time never change, so they're cached across
// refreshes. Without a bound that cache would keep every market the user ever touched, and since the whole thing
// is read and written on each refresh, it would get slower over time. Each entry remembers the day it was last
// used; entries unused for MAX_IDLE_DAYS are dropped, and the least recently used go first past MAX_ENTRIES.

const DAY = 864e5;
export const MAX_IDLE_DAYS = 45;
export const MAX_ENTRIES = 4000;

/** Stored form: [key, value, last-used day number]. */
export interface StoredCache {
  v: 2;
  e: [string, unknown, number][];
}

export class Cache {
  private map = new Map<string, { v: unknown; d: number }>();
  /** True once anything changed since load, so an unchanged cache isn't written back. */
  dirty = false;
  private readonly today: number;

  constructor(stored?: unknown, now = Date.now()) {
    this.today = Math.floor(now / DAY);
    const s = stored as StoredCache | undefined;
    // Older versions stored a plain object; it's simply rebuilt.
    if (s?.v === 2 && Array.isArray(s.e)) for (const [k, v, d] of s.e) this.map.set(k, { v, d });
    else if (stored) this.dirty = true;
  }

  has(key: string): boolean {
    return this.map.has(key);
  }

  get<T>(key: string): T | undefined {
    const e = this.map.get(key);
    if (!e) return undefined;
    if (e.d !== this.today) { e.d = this.today; this.dirty = true; } // at most one write per entry per day
    return e.v as T;
  }

  set(key: string, value: unknown): void {
    this.map.set(key, { v: value, d: this.today });
    this.dirty = true;
  }

  delete(key: string): void {
    if (this.map.delete(key)) this.dirty = true;
  }

  get size(): number {
    return this.map.size;
  }

  /** Drops idle entries, then the least recently used beyond the cap. */
  prune(maxIdleDays = MAX_IDLE_DAYS, maxEntries = MAX_ENTRIES): void {
    for (const [k, e] of this.map) if (this.today - e.d > maxIdleDays) { this.map.delete(k); this.dirty = true; }
    if (this.map.size <= maxEntries) return;
    const oldest = [...this.map].sort((a, b) => a[1].d - b[1].d).slice(0, this.map.size - maxEntries);
    for (const [k] of oldest) this.map.delete(k);
    this.dirty = true;
  }

  toJSON(): StoredCache {
    return { v: 2, e: [...this.map].map(([k, { v, d }]) => [k, v, d]) };
  }
}

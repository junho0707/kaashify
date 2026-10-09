// One request queue for every call to Kalshi's API (positions, markets, the Market Watcher, alerts), so the
// extension stays under Kalshi's rate limit even when other programs on the same IP use the API too.
//
// - Requests start at most `perSecond` per second, across the whole extension (one service worker).
// - A 429 pauses the whole queue for Retry-After (or exponential backoff with jitter) and retries only that
//   request; after `retries` attempts it throws RateLimitError, which callers treat as "keep the last data".

export class RateLimitError extends Error {
  readonly retryAfterMs: number;
  constructor(retryAfterMs: number) {
    super("Kalshi is rate-limiting requests right now; retrying shortly.");
    this.retryAfterMs = retryAfterMs;
  }
}

export interface ThrottleOptions {
  perSecond: number;
  retries: number;
  /** First backoff when Kalshi sends no Retry-After; doubles each attempt, plus up to the same again as jitter. */
  baseMs: number;
  maxMs: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

/** Retry-After as milliseconds: seconds ("2") or an HTTP date; null when missing or unreadable. */
export function retryAfterMs(value: string | null, now = Date.now()): number | null {
  if (value == null || value.trim() === "") return null;
  const s = Number(value);
  if (Number.isFinite(s)) return Math.max(0, s * 1000);
  const d = Date.parse(value);
  return Number.isFinite(d) ? Math.max(0, d - now) : null;
}

export class Throttle {
  private next = 0;
  private coolUntil = 0;
  private readonly o: Required<ThrottleOptions>;
  /** 429s seen, for the refresh log. */
  limited = 0;

  constructor(opts: ThrottleOptions) {
    this.o = { now: () => Date.now(), sleep: (ms) => new Promise((r) => setTimeout(r, ms)), random: Math.random, ...opts };
  }

  /** Waits for a slot: spaced 1/perSecond apart, and not before a 429 pause ends. */
  private async slot(): Promise<void> {
    const now = this.o.now();
    const start = Math.max(now, this.next, this.coolUntil);
    this.next = start + 1000 / this.o.perSecond;
    if (start > now) await this.o.sleep(start - now);
  }

  /** The time until the queue may send again (0 when it isn't paused). */
  pausedFor(): number {
    return Math.max(0, this.coolUntil - this.o.now());
  }

  async run(send: () => Promise<Response>): Promise<Response> {
    for (let i = 0; ; i++) {
      await this.slot();
      const r = await send();
      if (r.status !== 429) return r;
      this.limited++;
      const base = Math.min(this.o.maxMs, this.o.baseMs * 2 ** i);
      const wait = Math.min(this.o.maxMs, retryAfterMs(r.headers.get("retry-after"), this.o.now()) ?? base + this.o.random() * base);
      this.coolUntil = Math.max(this.coolUntil, this.o.now() + wait);
      if (i >= this.o.retries) throw new RateLimitError(wait);
    }
  }
}

/** The extension's shared queue: a few requests per second. */
export const kalshiQueue = new Throttle({ perSecond: 4, retries: 4, baseMs: 1000, maxMs: 20000 });

interface GapSchedule { fetchedAt: number; items: { state: string; legs: { outcome: string; phase?: string | null; start: number | null }[] }[] }

/**
 * How long a background refresh waits after the last one: about a minute while a position's game is live or
 * about to start, else 5 minutes (prices of games that haven't started barely move).
 */
export function refreshGapMs(s: GapSchedule | null | undefined, now = Date.now()): number {
  if (!s) return 0;
  const hot = s.items.some((it) => (it.state === "alive" || it.state === "pending") && it.legs.some((l) => l.outcome === "pending" &&
    (l.phase === "live" || (l.start != null && l.start - now < 30 * 60e3 && now - l.start < 4 * 3600e3))));
  return hot ? 55e3 : 5 * 60e3;
}

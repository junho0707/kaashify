// Messages from the calendar page to the background for the extra features.

import type { ProRequest } from "../types.ts";

/** Sends a message; a closed or reloaded extension reads as an error result. */
export const send = <T>(msg: ProRequest): Promise<T | { ok: false; error: string }> =>
  chrome.runtime.sendMessage(msg).catch((e: Error) => ({ ok: false as const, error: e.message }));

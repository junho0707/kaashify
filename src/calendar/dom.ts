// Tiny DOM helpers. Everything Kalshi sends is put into HTML through esc().

/** querySelector for elements the page always has (or the caller has just checked). */
export const $ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document): T => root.querySelector(sel) as T;
/** querySelector that may find nothing. */
export const $maybe = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document): T | null => root.querySelector<T>(sel);

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (s: unknown): string => String(s ?? "").replace(/[&<>"']/g, (c) => ESC[c]);

/** Closest ancestor (or self) matching `sel` for an event target, which may not be an element. */
export const closest = <T extends Element = HTMLElement>(target: EventTarget | null, sel: string): T | null =>
  target instanceof Element ? target.closest<T>(sel) : null;

/** Every list is numbered 1, 2, 3… in a small square box (no color coding). */
export const num = (n: number): string => `<span class="num">${n}</span>`;

/** Saves text as a file through a temporary link. */
export function download(name: string, text: string, type: string): void {
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([text], { type })), download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL?.(a.href), 1000); // don't keep the blob alive
}

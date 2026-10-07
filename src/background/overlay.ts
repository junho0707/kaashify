// Injected into the current page with chrome.scripting.executeScript({ func }), so it must be self-contained:
// it runs in the page, not in the extension, and can't use anything imported here.
//
// Toggles the calendar as a floating window (an iframe in a closed shadow root). There's no backdrop, so the page
// stays usable. Move it by the top handle and resize from any edge or corner; position and size are remembered.

export interface OverlayRect { x: number; y: number; w: number; h: number }

export function toggleOverlay(src: string, saved: OverlayRect | null): void {
  const ID = "kaashify-overlay";
  const existing = document.getElementById(ID) as (HTMLElement & { __close?: () => void }) | null;
  if (existing) return existing.__close?.();
  const host = document.createElement("div") as HTMLElement & { __close?: () => void };
  host.id = ID;
  const root = host.attachShadow({ mode: "closed" });
  const MIN_W = 360, MIN_H = 320, E = 8, BAR = 16; // E = resize grab zone, BAR = move handle height
  root.innerHTML = `<style>
    .win { position: fixed; z-index: 2147483647; border-radius: 0; overflow: visible; background: #fff;
      box-shadow: 0 12px 40px rgb(0 0 0 / .35), 0 0 0 1px rgb(0 0 0 / .08); }
    .bar { height: ${BAR}px; border-radius: 0; background: #00dd94; cursor: move; display: grid; place-items: center; }
    .bar::before { content: ""; width: 36px; height: 4px; border-radius: 0; background: rgb(6 43 29 / .45); }
    iframe { display: block; width: 100%; height: calc(100% - ${BAR}px); border: 0; border-radius: 0; color-scheme: normal; }
    .h { position: absolute; z-index: 2; }
    .n, .s { left: ${E}px; right: ${E}px; height: ${E}px; cursor: ns-resize; }
    .e, .w { top: ${E}px; bottom: ${E}px; width: ${E}px; cursor: ew-resize; }
    .n { top: -${E / 2}px; } .s { bottom: -${E / 2}px; } .e { right: -${E / 2}px; } .w { left: -${E / 2}px; }
    .ne, .nw, .se, .sw { width: ${E * 2}px; height: ${E * 2}px; }
    .nw { top: -${E / 2}px; left: -${E / 2}px; cursor: nwse-resize; } .se { bottom: -${E / 2}px; right: -${E / 2}px; cursor: nwse-resize; }
    .ne { top: -${E / 2}px; right: -${E / 2}px; cursor: nesw-resize; } .sw { bottom: -${E / 2}px; left: -${E / 2}px; cursor: nesw-resize; }
    .grip { position: absolute; right: 3px; bottom: 3px; width: 18px; height: 18px; z-index: 3; cursor: nwse-resize; border-radius: 0;
      background: linear-gradient(135deg, transparent 45%, #8b95a5 45% 52%, transparent 52% 64%, #8b95a5 64% 71%, transparent 71% 83%, #8b95a5 83% 90%, transparent 90%); }
    .grip:hover { filter: brightness(.7); }
    .shield { position: fixed; inset: 0; z-index: 2147483647; display: none; }
    .shield.on { display: block; }
  </style><div class="win"><div class="bar" data-d="move" title="Drag to move"></div><iframe allow="clipboard-write"></iframe>
    ${["n", "s", "e", "w", "ne", "nw", "se", "sw"].map((d) => `<div class="h ${d}" data-d="${d}"></div>`).join("")}
    <div class="grip" data-d="se" title="Drag to resize"></div></div><div class="shield"></div>`;
  const win = root.querySelector<HTMLElement>(".win")!, shield = root.querySelector<HTMLElement>(".shield")!;
  const frame = root.querySelector("iframe")!;
  frame.src = src;

  const clampW = (w: number) => Math.max(MIN_W, Math.min(w, innerWidth)), clampH = (h: number) => Math.max(MIN_H, Math.min(h, innerHeight));
  const r = { w: clampW(saved?.w || Math.min(760, innerWidth * 0.96)), h: clampH(saved?.h || Math.min(820, innerHeight * 0.92)), x: 0, y: 0 };
  // Default: docked top-right. Saved positions are pulled back on-screen if the window got smaller.
  r.x = Math.max(0, Math.min(saved?.x ?? innerWidth - r.w - 16, innerWidth - r.w));
  r.y = Math.max(0, Math.min(saved?.y ?? 16, innerHeight - r.h));
  const place = () => Object.assign(win.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` });
  place();

  win.addEventListener("pointerdown", (ev) => {
    const target = ev.target as HTMLElement;
    const d = target.dataset?.d;
    if (!d) return;
    ev.preventDefault();
    const start = { ...r, px: ev.clientX, py: ev.clientY };
    shield.style.cursor = getComputedStyle(target).cursor;
    shield.classList.add("on"); // keeps the iframe from swallowing the drag
    const move = (m: PointerEvent) => {
      const dx = m.clientX - start.px, dy = m.clientY - start.py;
      if (d === "move") {
        r.x = Math.max(0, Math.min(start.x + dx, innerWidth - r.w));
        r.y = Math.max(0, Math.min(start.y + dy, innerHeight - BAR));
      } else {
        if (d.includes("e")) r.w = clampW(start.w + dx);
        if (d.includes("s")) r.h = clampH(start.h + dy);
        if (d.includes("w")) { r.w = clampW(start.w - dx); r.x = start.x + start.w - r.w; }
        if (d.includes("n")) { r.h = clampH(start.h - dy); r.y = start.y + start.h - r.h; }
      }
      place();
    };
    const up = () => {
      shield.classList.remove("on");
      removeEventListener("pointermove", move, true);
      removeEventListener("pointerup", up, true);
      chrome.storage.local.set({ overlaySize: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) } });
    };
    addEventListener("pointermove", move, true);
    addEventListener("pointerup", up, true);
  });

  // Closes via the calendar's own × / Esc (posted from the iframe) or by clicking the toolbar icon again.
  const onMsg = (e: MessageEvent) => { if (e.data === "kcc-close" && e.source === frame.contentWindow) close(); };
  function close() { host.remove(); removeEventListener("message", onMsg); }
  host.__close = close;
  addEventListener("message", onMsg);
  document.documentElement.appendChild(host);
}

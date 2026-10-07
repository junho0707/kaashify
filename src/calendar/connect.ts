// One-time setup: the user's own Kalshi API key, in three plain steps. The key goes straight to the background,
// which imports it as a non-extractable key; this page never stores it.

import type { LastError, RefreshResult } from "../lib/types.ts";
import { $, $maybe, closest, esc } from "./dom.ts";

export const KALSHI_KEYS_URL = "https://kalshi.com/account/profile";

const connectForm = () => `<h2>Set up Kaashify <span class="sub">about 2 minutes, once</span></h2>
  <form id="key-form">
    <div class="step"><span class="num">1</span><div>
      <a class="btn primary" href="${KALSHI_KEYS_URL}" target="_blank" rel="noopener">Open Kalshi API keys ↗</a>
      <p>Log in if asked. Scroll to <b>API Keys</b>, click <b>Create New API Key</b>, name it <b>Kaashify</b> and create it.</p></div></div>
    <div class="step"><span class="num">2</span><div>
      <label><span>Copy the <b>Key ID</b> Kalshi shows you and paste it here</span>
        <input name="keyId" autocomplete="off" spellcheck="false" placeholder="e.g. a1b2c3d4-5e6f-…"></label></div></div>
    <div class="step"><span class="num">3</span><div>
      <label><span>Kalshi also gives you a <b>private key</b> (it downloads as a file). Drop that file here, or paste the text</span>
        <span class="drop" id="drop"><input type="file" name="file" accept=".key,.pem,.txt,text/plain" hidden>
          <span id="drop-label">Drop the key file here or <u>choose it</u></span>
          <textarea name="pem" rows="3" spellcheck="false" placeholder="…or paste: -----BEGIN RSA PRIVATE KEY-----"></textarea></span></label></div></div>
    <div class="actions"><button type="submit" class="primary">Connect</button><span id="key-msg" class="sub"></span></div>
  </form>
  <details class="safe"><summary>Is this safe?</summary>
    <p>Kaashify only <b>reads</b> your positions and trades through Kalshi's official API. It can't place orders or move money.
      Your key never leaves this browser: it's stored in a form that can sign requests to Kalshi but can't be read back out,
      and there's no Kaashify server. You can disconnect in Settings, or delete the key on Kalshi, any time.</p></details>`;

/** The status bar under the header: the connect form, a key error, or a load error. */
export function showStatus(err: Partial<LastError> | null | undefined): void {
  const el = $("#status");
  if (!err) return void (el.hidden = true);
  el.hidden = false;
  if (err.needsKey) { el.className = "status connect"; el.innerHTML = connectForm(); return; }
  el.className = "status err";
  el.innerHTML = err.auth
    ? `${esc(err.message)} <button class="linkbtn" id="rekey">Enter a new key</button>`
    : `Couldn't load positions: ${esc(err.message)}`;
  if (err.debug) el.insertAdjacentHTML("beforeend", ` <button class="copy-debug">Save debug info</button>`);
}

// The private key text and, when someone pastes both at once, the Key ID found next to it.
const PEM_RE = /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]+?-----END [A-Z ]*PRIVATE KEY-----/;
const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;

const field = <T extends HTMLElement = HTMLInputElement>(form: HTMLFormElement, name: string) => $<T>(`[name=${name}]`, form);

function readKeyText(form: HTMLFormElement, text: string, onConnected: () => void): void {
  const pem = PEM_RE.exec(text)?.[0];
  if (pem) field<HTMLTextAreaElement>(form, "pem").value = pem;
  const id = UUID_RE.exec(text.replace(PEM_RE, ""))?.[0];
  const idInput = field(form, "keyId");
  if (id && !idInput.value.trim()) idInput.value = id;
  if (pem) $("#drop-label").textContent = "Key file added ✓";
  // Both parts there: connect right away.
  if (pem && idInput.value.trim()) submitKey(form, onConnected);
}

const friendlyKeyError = (m = "") => /HTTP 401|HTTP 403/.test(m)
  ? "Kalshi didn't accept that key. Check that the Key ID and the key file are from the same key (or make a new one)."
  : m || "Couldn't connect.";

let connecting = false;
async function submitKey(form: HTMLFormElement, onConnected: () => void): Promise<void> {
  if (connecting) return;
  const msg = (t: string) => void ($("#key-msg").textContent = t);
  const f = new FormData(form);
  let pem = String(f.get("pem") || "").trim();
  const file = f.get("file");
  if (!pem && file instanceof File && file.size) pem = await file.text();
  const keyId = String(f.get("keyId") || "").trim();
  if (PEM_RE.test(keyId)) return readKeyText(form, keyId, onConnected); // pasted the key into the wrong box
  if (!keyId) return msg("Paste the Key ID from Kalshi (step 2).");
  if (!pem) return msg("Add the private key file (step 3).");
  connecting = true;
  msg("Checking with Kalshi…");
  const button = $<HTMLButtonElement>("button", form);
  button.disabled = true;
  const r: RefreshResult = await chrome.runtime.sendMessage({ type: "set-key", keyId, pem }).catch((e: Error) => ({ ok: false, error: { message: e.message } }));
  connecting = false;
  button.disabled = false;
  if (!r?.ok) return msg(friendlyKeyError(r?.error?.message));
  msg("Connected ✓");
  onConnected();
}

/** Form submit, file pick, paste and drag-and-drop of the key. Called once. */
export function initConnect(onConnected: () => void): void {
  document.addEventListener("submit", (e) => {
    const form = e.target as HTMLFormElement;
    if (form.id === "key-form") { e.preventDefault(); submitKey(form, onConnected); }
  });
  document.addEventListener("click", (e) => {
    if (closest(e.target, "#drop") && !(e.target as Element).matches("textarea")) $maybe<HTMLInputElement>("#key-form [name=file]")?.click();
  });
  document.addEventListener("change", async (e) => {
    const input = e.target as HTMLInputElement;
    if (input.matches("#key-form [name=file]") && input.files?.[0]) readKeyText(input.form!, await input.files[0].text(), onConnected);
  });
  document.addEventListener("paste", (e) => {
    const form = closest<HTMLFormElement>(e.target, "#key-form");
    const text = e.clipboardData?.getData("text") || "";
    if (form && PEM_RE.test(text)) { e.preventDefault(); readKeyText(form, text, onConnected); }
  });
  document.addEventListener("dragover", (e) => { if (closest(e.target, "#drop")) { e.preventDefault(); $("#drop").classList.add("over"); } });
  document.addEventListener("dragleave", (e) => { if (closest(e.target, "#drop")) $("#drop").classList.remove("over"); });
  document.addEventListener("drop", async (e) => {
    const drop = closest(e.target, "#drop");
    if (!drop) return;
    e.preventDefault();
    drop.classList.remove("over");
    const file = e.dataTransfer?.files?.[0];
    if (file) readKeyText(drop.closest("form")!, await file.text(), onConnected);
  });
}

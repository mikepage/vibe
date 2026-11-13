// vibe's own script for app pages. Apps can't run scripts of their own (lib/runtime.ts
// serves their pages with a CSP that allows only this file), so this is where their pages
// get behaviour: declared with data-vibe-* attributes, carried out by platform code.
// Everything here talks only to the app's own URLs (under /apps/<id>/), never to vibe's API.
//
//   <form data-vibe-autosave>       saves the form while you type (debounced) and on change,
//                                   as a normal POST to its action; then swaps in fresh copies
//                                   of every [data-vibe-live][id] from the page it answers.
//   [data-vibe-status]              "Saving…", "Saved", "Not saved" for the autosave
//                                   (data-saving, data-saved, data-failed to change the words).
//   <button data-vibe-copy="id">    copies the text of #id (after pending saves), then shows
//                                   data-copied for a moment.
//   <output for="id" data-unit="px">  shows #id's value as it changes.
//   <input data-vibe-var="--r" data-unit="px">  sets that CSS variable on the closest
//                                   [data-vibe-scope] as the input changes.
//   <input data-vibe-uncheck="id">  unchecks #id when this input changes.
//   <input type="radio" data-vibe-deselect>  clicking the chosen radio clears it.
//   .vibe-no-js / .vibe-js          hidden when this script runs / doesn't.
(() => {
  const root = document.documentElement;
  if (root.dataset.vibe) return;
  root.dataset.vibe = "1";

  const base = (/^\/apps\/[^/]+\//.exec(location.pathname) || [""])[0];
  const ownUrl = (url) => {
    const u = new URL(url, document.baseURI);
    return base !== "" && u.origin === location.origin && u.pathname.startsWith(base);
  };
  const byId = (id) => (id ? document.getElementById(id) : null);
  const ev = (el, type) => el.dispatchEvent(new Event(type, { bubbles: true }));

  // Autosave.
  const forms = new Map();
  function state(form) {
    let s = forms.get(form);
    if (!s) forms.set(form, (s = { timer: 0, seq: 0, inflight: null, dirty: false }));
    return s;
  }
  function status(form, key) {
    for (const el of document.querySelectorAll("[data-vibe-status]")) {
      if (el.dataset.vibeStatus && el.dataset.vibeStatus !== form.id) continue;
      el.textContent = el.dataset[key] || { saving: "Saving…", saved: "Saved", failed: "Not saved" }[key];
      el.dataset.state = key;
    }
  }
  const body = (form) => new URLSearchParams(new FormData(form));
  function schedule(form, delay) {
    const s = state(form);
    s.dirty = true;
    clearTimeout(s.timer);
    s.timer = setTimeout(() => save(form), delay);
    status(form, "saving");
  }
  async function save(form) {
    const s = state(form);
    clearTimeout(s.timer);
    if (s.inflight) await s.inflight.catch(() => {});
    if (!s.dirty) return;
    if (!ownUrl(form.action)) return status(form, "failed");
    s.dirty = false;
    const seq = ++s.seq;
    s.inflight = (async () => {
      try {
        const res = await fetch(form.action, { method: "POST", body: body(form), credentials: "same-origin" });
        if (!res.ok) throw new Error(String(res.status));
        const html = await res.text();
        // Only the newest save's page, and only if nothing changed since it was sent.
        if (seq !== s.seq || s.dirty) return;
        if ((res.headers.get("content-type") || "").startsWith("text/html")) swap(html);
        status(form, "saved");
      } catch {
        s.dirty = true;
        status(form, "failed");
      }
    })();
    return s.inflight;
  }
  function swap(html) {
    const next = new DOMParser().parseFromString(html, "text/html");
    for (const el of document.querySelectorAll("[data-vibe-live][id]")) {
      if (el.contains(document.activeElement) && document.activeElement !== document.body) continue;
      const fresh = next.getElementById(el.id);
      if (fresh) el.replaceWith(document.importNode(fresh, true));
    }
  }
  const flush = () => Promise.all([...forms.keys()].map((f) => save(f)));
  const autosaveOf = (el) => el.form?.matches?.("[data-vibe-autosave]") ? el.form : null;

  document.addEventListener("input", (e) => {
    const el = e.target;
    const form = autosaveOf(el);
    if (form && el.type !== "radio" && el.type !== "checkbox") schedule(form, Number(form.dataset.vibeAutosave) || 600);
    if (el.id) for (const out of document.querySelectorAll(`output[for~="${CSS.escape(el.id)}"]`)) out.value = el.value + (out.dataset.unit || "");
    if (el.dataset.vibeVar) {
      const scope = el.closest("[data-vibe-scope]") || root;
      scope.style.setProperty(el.dataset.vibeVar, el.value + (el.dataset.unit || ""));
    }
    const off = byId(el.dataset.vibeUncheck);
    if (off && off.checked) {
      off.checked = false;
      ev(off, "change");
    }
  });
  document.addEventListener("change", (e) => {
    const form = autosaveOf(e.target);
    if (form) schedule(form, 0);
  });
  document.addEventListener("submit", (e) => {
    const form = e.target;
    // Only the form's own submit; a button with another formaction posts as usual.
    if (!form.matches("[data-vibe-autosave]") || (e.submitter && e.submitter.formAction !== form.action)) return;
    e.preventDefault();
    state(form).dirty = true;
    save(form);
  });
  // Leaving the page: send what hasn't been saved yet.
  addEventListener("pagehide", () => {
    for (const [form, s] of forms) if (s.dirty && ownUrl(form.action)) navigator.sendBeacon(form.action, body(form));
  });

  // Radios that clear when clicked again.
  let wasChecked = null;
  const remember = (e) => {
    const input = e.target.closest?.("label")?.control ?? e.target;
    wasChecked = input?.matches?.('input[type="radio"][data-vibe-deselect]') && input.checked ? input : null;
  };
  document.addEventListener("pointerdown", remember, true);
  document.addEventListener("keydown", (e) => e.key === " " && remember(e), true);
  document.addEventListener("click", (e) => {
    const input = wasChecked;
    if (!input) return;
    // A click on the label is followed by one on the input; act on that one.
    if (e.target !== input && e.target.closest?.("label")?.control === input) return;
    wasChecked = null;
    if (e.target !== input) return;
    input.checked = false;
    ev(input, "change");
  });

  // Copy.
  document.addEventListener("click", async (e) => {
    const button = e.target.closest?.("[data-vibe-copy]");
    if (!button) return;
    e.preventDefault();
    const source = byId(button.dataset.vibeCopy);
    if (!source) return;
    const text = flush().then(() => {
      const el = byId(button.dataset.vibeCopy) || source;
      return "value" in el && typeof el.value === "string" ? el.value : el.textContent || "";
    });
    try {
      if (typeof ClipboardItem === "function" && navigator.clipboard?.write) {
        await navigator.clipboard.write([new ClipboardItem({ "text/plain": text.then((t) => new Blob([t], { type: "text/plain" })) })]);
      } else {
        await navigator.clipboard.writeText(await text);
      }
      const label = button.textContent;
      button.textContent = button.dataset.copied || "Copied";
      setTimeout(() => (button.textContent = label), 2000);
    } catch {
      // No clipboard access: select the text, so Cmd+C does it.
      const el = byId(button.dataset.vibeCopy) || source;
      el.closest("details")?.setAttribute("open", "");
      if (el.select) el.select();
      else getSelection()?.selectAllChildren(el);
    }
  });
})();

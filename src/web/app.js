// @ts-check
/**
 * What did I shoot? — local UI.
 *
 * Plain modules, no build step and no framework. The DOM is built with `el`
 * rather than innerHTML throughout: most of what is rendered here is a
 * filesystem path or a camera's own idea of its name, and those are exactly the
 * strings that turn markup into a bug.
 */

import { createDeck } from "./deck.js";

const $ = (id) => document.getElementById(id);

/** @param {string} tag @param {Record<string, any>} [props] @param {...any} children */
function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = String(value);
    else if (key.startsWith("on")) node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (value === true) node.setAttribute(key, "");
    else node.setAttribute(key, String(value));
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

const nf = new Intl.NumberFormat();
const num = (n) => nf.format(n ?? 0);

function ago(ms) {
  if (!ms) return "never indexed";
  const minutes = Math.round((Date.now() - ms) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

let toastTimer;
function toast(message, bad = false) {
  const node = $("toast");
  node.textContent = message;
  node.className = bad ? "toast bad" : "toast";
  node.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (node.hidden = true), bad ? 6000 : 3000);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: options.body ? { "content-type": "application/json" } : {},
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `${response.status} ${response.statusText}`);
  return data;
}

// ---------------------------------------------------------------- state ----

const store = {
  /** @type {any} */ state: null,
  /** @type {any} */ range: { kind: "all" },
};

const deck = createDeck({ onExit: () => show("view-home"), onToast: toast });

function show(view) {
  for (const id of ["view-setup", "view-home", "view-deck"]) $(id).hidden = id !== view;
  $("nav-home").hidden = view !== "view-deck";
}

async function refreshState() {
  store.state = await api("/api/state");
  renderSources();
  renderRanges();
  renderSettings();

  if (store.state.config.sources.length === 0) show("view-setup");
  else if ($("view-deck").hidden) show("view-home");
}

// ------------------------------------------------------------ rendering ----

function renderSources() {
  const container = $("sources");
  const sources = store.state.config.sources;

  if (sources.length === 0) {
    container.replaceChildren(el("p", { class: "empty-note", text: "No sources yet." }));
    return;
  }

  const indexed = new Map(store.state.sources.map((entry) => [entry.key, entry]));

  container.replaceChildren(
    ...sources.map((source) => {
      const summary = indexed.get(source.key);
      const stats = summary?.stats;

      return el(
        "div",
        { class: "source" },
        el(
          "div",
          { class: "source-main" },
          el(
            "div",
            { class: "source-title" },
            source.label,
            el("span", { class: "badge", text: source.kind === "lightroom" ? "catalog" : "folder" }),
          ),
          el("div", { class: "source-path", text: source.path }),
          el("div", {
            class: "source-meta",
            text: summary
              ? `${num(summary.files)} files · ${num(summary.withMetadata)} with metadata · ${ago(summary.lastIndexedAt)}` +
                (stats?.errors?.length ? ` · ${num(stats.errors.length)} unreadable` : "")
              : "not indexed yet",
          }),
        ),
        el(
          "div",
          { class: "source-actions" },
          el("button", {
            class: summary ? "ghost" : "primary",
            type: "button",
            text: summary ? "Re-index" : "Index",
            onclick: () => startIndex([source.key], false),
          }),
          el("button", {
            class: "ghost",
            type: "button",
            text: "Remove",
            onclick: () => removeSource(source),
          }),
        ),
      );
    }),
  );

  const { shots, firstDay, lastDay } = store.state.overview;
  $("library-summary").textContent =
    shots > 0
      ? `${num(shots)} photographs indexed, ${formatDay(firstDay)} to ${formatDay(lastDay)}`
      : "Nothing indexed yet";
  $("deck-build").disabled = shots === 0;
}

function formatDay(day) {
  if (!day) return "—";
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${day % 100} ${months[(Math.floor(day / 100) % 100) - 1]} ${Math.floor(day / 10000)}`;
}

function sameRange(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * The presets are built from what is actually in the index, so a library that
 * stops in 2019 does not offer to report on this month.
 */
function renderRanges() {
  const presets = [
    { label: "All time", spec: { kind: "all" } },
    { label: "Last 30 days", spec: { kind: "last", days: 30 } },
    { label: "Last 12 months", spec: { kind: "last", days: 365 } },
  ];

  for (const year of store.state.years.slice(0, 8)) {
    presets.push({ label: String(year.year), spec: { kind: "year", year: year.year }, count: year.shots });
  }
  for (const month of store.state.months.slice(0, 6)) {
    const y = Math.floor(month.ym / 100);
    const m = month.ym % 100;
    presets.push({
      label: `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1]} ${y}`,
      spec: { kind: "month", year: y, month: m },
      count: month.shots,
    });
  }

  $("range-presets").replaceChildren(
    ...presets.map((preset) =>
      el(
        "button",
        {
          class: sameRange(preset.spec, store.range) ? "chip is-current" : "chip",
          type: "button",
          onclick: () => {
            store.range = preset.spec;
            renderRanges();
          },
        },
        preset.label,
        preset.count ? el("span", { class: "chip-count", text: num(preset.count) }) : null,
      ),
    ),
  );

  $("range-current").textContent =
    store.range.kind === "custom"
      ? `${store.range.from} to ${store.range.to}`
      : "";
}

function renderSettings() {
  $("setting-owner").value = store.state.config.ownerName ?? "";
  $("setting-merge").checked = store.state.config.mergeRawJpegPairs;
  $("setting-video").checked = store.state.config.includeVideo;
}

// -------------------------------------------------------------- actions ----

async function startIndex(keys, full) {
  try {
    await api("/api/index", {
      method: "POST",
      body: { ...(keys ? { sources: keys } : {}), mode: full ? "full" : "incremental" },
    });
  } catch (err) {
    toast(err.message, true);
  }
}

async function removeSource(source) {
  if (!confirm(`Remove "${source.label}"? Your photographs are not touched — only the index.`)) return;
  try {
    await api(`/api/sources/${encodeURIComponent(source.key)}`, { method: "DELETE" });
    await refreshState();
    toast("Source removed.");
  } catch (err) {
    toast(err.message, true);
  }
}

async function saveSettings() {
  try {
    await api("/api/config", {
      method: "POST",
      body: {
        ownerName: $("setting-owner").value,
        mergeRawJpegPairs: $("setting-merge").checked,
        includeVideo: $("setting-video").checked,
      },
    });
    await refreshState();
  } catch (err) {
    toast(err.message, true);
  }
}

function rangeQuery(spec) {
  const params = new URLSearchParams({ range: spec.kind });
  if (spec.kind === "year") params.set("year", String(spec.year));
  if (spec.kind === "month") {
    params.set("year", String(spec.year));
    params.set("month", String(spec.month));
  }
  if (spec.kind === "last") params.set("days", String(spec.days));
  if (spec.kind === "custom") {
    params.set("from", spec.from);
    params.set("to", spec.to);
  }
  return params.toString();
}

async function buildDeck() {
  const button = $("deck-build");
  button.disabled = true;
  button.textContent = "Counting…";

  try {
    const { deck: built } = await api(`/api/deck?${rangeQuery(store.range)}`);
    deck.show(built);
    show("view-deck");
    if (built.empty) toast("Nothing was shot in that range.");
  } catch (err) {
    toast(err.message, true);
  } finally {
    button.disabled = false;
    button.textContent = "Show me the deck";
  }
}

// --------------------------------------------------------------- picker ----

const picker = {
  path: "",
  selected: "",
  resolve: null,
};

async function openPicker() {
  const dialog = $("picker");
  picker.selected = "";
  await loadPicker(picker.path);
  dialog.showModal();

  return new Promise((resolve) => {
    picker.resolve = resolve;
  });
}

async function loadPicker(path) {
  try {
    const result = await api(`/api/browse?path=${encodeURIComponent(path ?? "")}`);
    picker.path = result.path;
    $("picker-input").value = result.path;

    $("picker-shortcuts").replaceChildren(
      ...result.shortcuts.map((shortcut) =>
        el("button", {
          class: "chip",
          type: "button",
          text: shortcut.label,
          onclick: () => void loadPicker(shortcut.path),
        }),
      ),
    );

    $("picker-list").replaceChildren(
      ...result.entries.map((entry) =>
        el(
          "li",
          {},
          el(
            "button",
            {
              class: picker.selected === entry.path ? "picker-entry is-current" : "picker-entry",
              type: "button",
              onclick: () => {
                if (entry.isCatalog) {
                  picker.selected = entry.path;
                  $("picker-hint").textContent = entry.path;
                  void loadPicker(picker.path);
                } else {
                  void loadPicker(entry.path);
                }
              },
            },
            el("span", { class: "picker-icon", text: entry.isCatalog ? "🗂" : "📁" }),
            entry.name,
          ),
        ),
      ),
    );

    $("picker-hint").textContent = picker.selected || result.path;
  } catch (err) {
    toast(err.message, true);
  }
}

function closePicker(value) {
  $("picker").close();
  picker.resolve?.(value);
  picker.resolve = null;
}

async function addSource() {
  const chosen = await openPicker();
  if (!chosen) return;

  try {
    await api("/api/sources", { method: "POST", body: { path: chosen } });
    await refreshState();
    const added = store.state.config.sources.at(-1);
    if (added) await startIndex([added.key], false);
  } catch (err) {
    toast(err.message, true);
  }
}

// ----------------------------------------------------------------- jobs ----

function renderJob(job) {
  const banner = $("job-banner");
  if (!job || job.status !== "running") {
    banner.hidden = true;
    return;
  }

  banner.hidden = false;
  $("job-label").textContent = job.label;
  $("job-message").textContent = job.progress.message ?? "";
  const percent = job.progress.total > 0 ? (job.progress.done / job.progress.total) * 100 : 0;
  $("job-fill").style.width = `${Math.max(2, Math.min(100, percent))}%`;
  $("job-cancel").onclick = () => void api(`/api/jobs/${job.id}/cancel`, { method: "POST" });
}

function listenForJobs() {
  const events = new EventSource("/api/events");

  events.addEventListener("message", (event) => {
    const payload = JSON.parse(event.data);
    if (payload.type !== "job") return;

    renderJob(payload.job);
    if (payload.job.status !== "running") {
      void refreshState();
      if (payload.job.status === "error") toast(payload.job.error ?? "Indexing failed.", true);
      else if (payload.job.status === "done") toast(`${payload.job.label} — done.`);
    }
  });

  // A dropped stream is not worth a message; the browser reconnects on its own.
  events.addEventListener("error", () => {});
}

// ---------------------------------------------------------------- wiring ---

$("setup-add").addEventListener("click", () => void addSource());
$("source-add").addEventListener("click", () => void addSource());
$("index-all").addEventListener("click", () => void startIndex(null, false));
$("deck-build").addEventListener("click", () => void buildDeck());
$("nav-home").addEventListener("click", () => show("view-home"));

$("setting-owner").addEventListener("change", () => void saveSettings());
$("setting-merge").addEventListener("change", () => void saveSettings());
$("setting-video").addEventListener("change", () => void saveSettings());

$("range-custom-go").addEventListener("click", () => {
  const from = $("range-from").value;
  const to = $("range-to").value;
  if (!from || !to) {
    toast("Pick both dates.", true);
    return;
  }
  store.range = { kind: "custom", from, to };
  renderRanges();
});

$("picker-go").addEventListener("click", () => void loadPicker($("picker-input").value));
$("picker-up").addEventListener("click", () => {
  const parent = picker.path.replace(/\/[^/]+\/?$/, "");
  void loadPicker(parent || picker.path);
});
$("picker-choose").addEventListener("click", () => closePicker(picker.selected || picker.path));
$("picker").addEventListener("close", () => {
  picker.resolve?.(null);
  picker.resolve = null;
});

$("theme-toggle").addEventListener("click", () => {
  const root = document.documentElement;
  const dark = root.dataset.theme
    ? root.dataset.theme === "dark"
    : window.matchMedia("(prefers-color-scheme: dark)").matches;
  root.dataset.theme = dark ? "light" : "dark";
  localStorage.setItem("wdis-theme", root.dataset.theme);
  deck.repaint();
});

const savedTheme = localStorage.getItem("wdis-theme");
if (savedTheme === "dark" || savedTheme === "light") document.documentElement.dataset.theme = savedTheme;

// The OS switching themes should redraw a deck that is following the OS.
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  if (!document.documentElement.dataset.theme) deck.repaint();
});

document.addEventListener("keydown", (event) => {
  if ($("view-deck").hidden) return;
  deck.onKey(event);
});

listenForJobs();
await refreshState();

// @ts-check
/**
 * Photography Wrapped — local UI.
 *
 * Plain modules, no build step and no framework. The DOM is built with `el`
 * rather than innerHTML throughout: most of what is rendered here is a
 * filesystem path or a camera's own idea of its name, and those are exactly the
 * strings that turn markup into a bug.
 */

import { createDeck } from "./deck.js";
import { colourAt, currentMode, paletteProblems, themeFor } from "./theme.js";
import { colourPicker } from "./picker.js";
import { SCHEMES, schemePalette } from "./schemes.js";

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
  /**
   * Choices belonging to individual slides, by setting id.
   *
   * They live with the request rather than in the config: they change how a
   * deck reads, not what the library is, and two people looking at the same
   * library should be able to disagree about them.
   */
  /** @type {Record<string, string>} */ slideSettings: {},
};

const deck = createDeck({
  palette: () => store.state.config?.palette ?? null,
  backdrop: () => store.state.config?.backdrop ?? null,
  onExit: () => show("view-home"),
  onToast: toast,
  onExclude: (dimension, key, excluded) => void setExcluded(dimension, key, excluded),
  onSetting: (id, value) => {
    store.slideSettings[id] = value;
    void buildDeck(true);
  },
  // Reported by the deck after every paint, because the colours a slide uses
  // are a property of the slide and change as it does.
  onColours: (colours) => {
    slideColours = colours;
    if (!pickingColour) renderColours();
  },
});

function show(view) {
  for (const id of ["view-setup", "view-home", "view-deck"]) $(id).hidden = id !== view;
  $("nav-home").hidden = view !== "view-deck";
}

async function refreshState() {
  store.state = await api("/api/state");
  // Nothing else on the page is worth reading if the server is serving code
  // that no longer exists on disk, so this is checked before anything renders.
  $("stale-banner").hidden = !store.state.sourceChanged;
  renderSources();
  renderRanges();
  renderMilestones();
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
          // A source built by an older version is still perfectly usable; it is
          // just missing whatever that version learned to read. Saying which is
          // the difference between a nag and a reason.
          summary?.gains?.length
            ? el(
                "div",
                { class: "source-stale" },
                el("span", { class: "badge stale", text: "older index" }),
                `Re-index for ${summary.gains.join("; ")}.`,
              )
            : null,
        ),
        el(
          "div",
          { class: "source-actions" },
          el("button", {
            class: summary && !summary.gains?.length ? "ghost" : "primary",
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

/** Mirrors `anchorRangeLabel` on the server, which titles the deck the same way. */
const rangeLabel = (anchor) =>
  anchor.kind === "bought"
    ? anchor.label.replace(/^bought /i, "")
    : anchor.kind === "sold"
      ? anchor.label.replace(/^sold /i, "selling ")
      : anchor.label;

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

  // Saved milestones come first among the dated ranges: "since I got the a9
  // III" is the range someone actually wants, and a year is the fallback.
  for (const anchor of store.state.config.anchors ?? []) {
    presets.push({ label: `Since ${rangeLabel(anchor)}`, spec: { kind: "anchor", id: anchor.id } });
  }

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

/**
 * One switch per part of a name.
 *
 * The example beside each is the vocabulary rather than a rule — nobody can be
 * expected to know that `G` is a grade and `OSS` is not — and the preview under
 * them is the actual answer, in the reader's own lenses.
 */
const NAMING_TOGGLES = [
  { id: "showMake", label: "Maker", example: "Sony, Nikon, Canon" },
  { id: "showMount", label: "Mount", example: "FE, E, RF, Z, XF" },
  { id: "showGrade", label: "Grade", example: "G, GM, L, S, Art" },
  { id: "showAperture", label: "Aperture", example: "F2.8, f/5.6-6.3" },
  { id: "showJargon", label: "Jargon", example: "OSS, USM, ED, DG DN" },
  { id: "showVersion", label: "Version", example: "II, III, G2" },
];

function renderSettings() {
  const config = store.state.config;
  $("setting-owner").value = config.ownerName ?? "";
  $("setting-merge").checked = config.mergeRawJpegPairs;
  $("setting-video").checked = config.includeVideo;
  // Empty rather than "0", so the field reads as a question nobody has answered
  // rather than as an answer of none — and written back with its separators, so
  // what the reader sees after saving is what they would have typed.
  $("setting-deleted").value = config.deletedBefore > 0 ? num(config.deletedBefore) : "";

  const place = config.location;
  $("location-label").value = place?.label ?? "";
  $("location-lat").value = place ? String(place.lat) : "";
  $("location-lon").value = place ? String(place.lon) : "";

  // Naming is a display choice, so changing one rebuilds the deck rather than
  // the index: nothing is re-read, the labels are simply written differently.
  const naming = config.naming ?? {};
  $("naming-toggles").replaceChildren(
    ...NAMING_TOGGLES.map((toggle) =>
      el(
        "label",
        { class: "naming-toggle" },
        el("input", {
          type: "checkbox",
          checked: naming[toggle.id] !== false,
          onchange: (event) => void saveNaming({ [toggle.id]: event.target.checked }),
        }),
        el(
          "span",
          {},
          el("span", { class: "setting-label", text: toggle.label }),
          el("span", { class: "hint", text: toggle.example }),
        ),
      ),
    ),
  );

  // Colours are not here any more: they live beside the slide they change,
  // where the deck rebuilds the list on every paint.
  const examples = store.state.namingExamples ?? [];
  $("naming-preview").replaceChildren(
    ...(examples.length === 0
      ? [el("span", { class: "hint", text: "Index a source and your own gear will show up here." })]
      : [
          el("span", { class: "hint", text: "Your gear, written the way these say:" }),
          ...examples.map((label) => el("span", { class: "naming-example", text: label })),
        ]),
  );
}

/**
 * Which of the two palettes is being edited.
 *
 * Starts on whatever the reader is looking at, because that is the one they
 * came here to change — but it is a separate choice from the page's own theme,
 * so setting the dark colours while sitting in light mode is possible.
 */
let colourMode = currentMode();

/**
 * The colours the slide on screen is drawn in, as the deck last reported them.
 *
 * Null until a slide has been drawn — before that there is nothing to filter
 * by, so everything is offered.
 */
let slideColours = null;

/** True while a picker is open, so the list it lives in is left alone. */
let pickingColour = false;

/** The reader asking for the whole palette rather than this slide's part of it. */
let everyColour = false;

/**
 * Which wells to put beside this slide.
 *
 * Nineteen swatches in a column beside a bar chart is nineteen questions about
 * a chart that answers four of them, so the panel offers the colours the slide
 * is actually drawn in and keeps the rest behind a chip. Matching is by the hex
 * the theme resolves each role to, which is why it survives the reader changing
 * one: the slide is repainted with the new colour before this runs again.
 */
function rolesOnShow(roles, theme) {
  if (everyColour || slideColours === null) return roles;
  // A slide that encodes nothing — the tiles, the map — comes back empty, and
  // the card says so rather than falling back to the whole palette, which would
  // be the panel claiming the slide uses colours it does not.
  return roles.filter((role) => slideColours.has((colourAt(theme, role.id) ?? "").toLowerCase()));
}

/**
 * Building a scheme is a search, so it is built once and remembered.
 *
 * `renderSchemes` asks every scheme for its palette on every paint, to work out
 * which chip is lit. Doing that search six times a frame would be six thousand
 * OKLab distances for a row of buttons.
 */
const SCHEME_CACHE = new Map();
function paletteOf(id) {
  let palette = SCHEME_CACHE.get(id);
  if (!palette) {
    palette = schemePalette(id);
    SCHEME_CACHE.set(id, palette);
  }
  return palette;
}

const sameSide = (a, b) => {
  const left = Object.entries(a ?? {}).sort();
  const right = Object.entries(b ?? {}).sort();
  return JSON.stringify(left) === JSON.stringify(right);
};

/**
 * Which scheme the deck is wearing, if any.
 *
 * Nothing is lit once a single well has been moved, and that is the honest
 * answer: the deck is no longer that scheme, it is the reader's. Picking the
 * chip again puts it back.
 */
function currentScheme() {
  const palette = store.state.config?.palette ?? { light: {}, dark: {} };
  for (const scheme of SCHEMES) {
    const candidate = paletteOf(scheme.id);
    if (sameSide(candidate.light, palette.light) && sameSide(candidate.dark, palette.dark)) {
      return scheme.id;
    }
  }
  return null;
}

/** What a slide is drawn on. The names are the reader's, the ids are the config's. */
const BACKDROPS = [
  { id: "flat", name: "Flat" },
  { id: "blobs", name: "Blobs" },
  { id: "rings", name: "Rings" },
  { id: "grain", name: "Grain" },
];

function renderBackdrops() {
  const current = store.state.config?.backdrop?.kind ?? "flat";

  $("backdrop-chips").replaceChildren(
    ...BACKDROPS.map((entry) =>
      el(
        "button",
        {
          type: "button",
          class: entry.id === current ? "chip is-current" : "chip",
          "aria-pressed": String(entry.id === current),
          onclick: () => void saveBackdrop({ kind: entry.id }),
        },
        el("span", { text: entry.name }),
      ),
    ),
  );

  // Nothing to shuffle about a flat colour.
  $("backdrop-shuffle").hidden = current === "flat";
}

async function saveBackdrop(patch) {
  const backdrop = { ...(store.state.config?.backdrop ?? { kind: "flat", seed: 1 }), ...patch };
  try {
    await api("/api/config", { method: "POST", body: { backdrop } });
    await refreshState();
    deck.repaint();
    renderBackdrops();
  } catch (err) {
    toast(err.message, true);
  }
}

function renderSchemes() {
  const current = currentScheme();

  $("scheme-chips").replaceChildren(
    ...SCHEMES.map((scheme) =>
      el(
        "button",
        {
          type: "button",
          class: scheme.id === current ? "chip is-current" : "chip",
          title: scheme.note ?? scheme.name,
          "aria-pressed": String(scheme.id === current),
          onclick: () => void applyScheme(scheme.id),
        },
        el("span", { text: scheme.name }),
      ),
    ),
  );
}

async function applyScheme(id) {
  closeColourPicker(false);
  try {
    // Both sides at once: a scheme is a character, and half of one is a deck
    // that changes personality when the reader turns the lights off.
    await api("/api/config", { method: "POST", body: { palette: paletteOf(id) } });
    await refreshState();
    deck.repaint();
    renderColours();
    renderSchemes();
  } catch (err) {
    toast(err.message, true);
  }
}

function renderColours() {
  renderSchemes();
  renderBackdrops();
  const all = store.state.paletteRoles ?? [];
  const override = store.state.config.palette?.[colourMode] ?? {};
  const theme = themeFor(colourMode, override);

  for (const mode of ["light", "dark"]) {
    $(`colour-${mode}`).setAttribute("aria-pressed", String(mode === colourMode));
  }
  $("colour-all").setAttribute("aria-pressed", String(everyColour));
  $("colour-all").className = everyColour ? "chip colour-all is-current" : "chip colour-all";
  $("colour-reset").disabled = Object.keys(override).length === 0;

  const problems = paletteProblems(theme);
  const trouble = new Map();
  for (const problem of problems) trouble.set(problem.role, problem.severity);

  /**
   * Two lists, in two cards, because they answer two questions.
   *
   * The paper and the writing on it are the same on every slide, so they belong
   * with the deck and stay put. What a chart *encodes* with follows the slide.
   * One list held both, and on the slides with the most colours in them the
   * background ended up scrolled off the top of a card nobody realised scrolled
   * — which is exactly the complaint that produced this split.
   */
  const wells = (roles) =>
    roles.map((role) => {
      const hex = colourAt(theme, role.id) ?? "#000000";
      const value = el("span", { class: "hint", text: role.id in override ? `${hex} · yours` : hex });

      const swatch = el("button", {
        type: "button",
        class: "colour-chip",
        "aria-label": `${role.label} — ${hex}`,
        "aria-expanded": String(livePicker?.role === role.id),
        onclick: () => openColourPicker(role, hex),
      });
      swatch.style.background = hex;

      const well = el(
        "div",
        { class: trouble.get(role.id) === "warn" ? "colour-well is-trouble" : "colour-well" },
        swatch,
        el(
          "span",
          {},
          el("span", { class: "setting-label", text: role.label }),
          value,
          role.note ? el("span", { class: "hint", text: role.note }) : null,
        ),
      );

      // The picker is not rebuilt with the list around it — it is the thing
      // being used, and replacing it mid-drag would drop the slider under the
      // pointer. Reopening it here is only for the one rebuild that happens
      // when the list is drawn while a picker is already up.
      if (livePicker?.role === role.id) {
        return el("div", { class: "colour-slot" }, well, livePicker.picker.node);
      }
      return well;
    });

  const page = all.filter((role) => role.group === "page");
  const data = all.filter((role) => role.group === "data");
  const here = rolesOnShow(data, theme);

  // Page roles are few and always relevant, so they are never filtered away —
  // the background is on every slide by definition.
  $("page-wells").replaceChildren(...wells(page));
  $("colour-wells").replaceChildren(
    ...(here.length > 0
      ? wells(here)
      : [el("span", { class: "hint", text: "Nothing here takes a colour of its own." })]),
  );

  // Named, never blocked. It is the reader's deck, and a palette that trips a
  // gate is often a deliberate choice about a chart only they will read — but
  // "these two are the same colour to one man in twelve" is not something
  // anyone can see by looking, so it has to be said.
  $("colour-problems").hidden = problems.length === 0;
  // Named where it happened. Four lines all reading "2.1:1 against the light
  // background" are four lines nobody can act on.
  const named = new Map(all.map((role) => [role.id, role.label]));
  $("colour-problems").replaceChildren(
    ...problems.map((problem) =>
      el("span", {
        class: problem.severity === "warn" ? "colour-problem" : "hint",
        text: named.has(problem.role) ? `${named.get(problem.role)}: ${problem.text}` : problem.text,
      }),
    ),
  );
}

/**
 * The picker on screen, if there is one, and the palette it opened over.
 *
 * One at a time: a second picker under a second swatch would be two live
 * previews of the same deck, and the reader could not tell which slider was
 * doing what.
 */
let livePicker = null;

function openColourPicker(role, hex) {
  if (livePicker?.role === role.id) {
    closeColourPicker(true);
    return;
  }
  closeColourPicker(true);

  const picker = colourPicker(hex, {
    label: role.label,
    onInput: (next) => previewColour(role.id, next),
    onDone: (kept) => {
      const held = livePicker;
      livePicker = null;
      pickingColour = false;
      if (kept === null) {
        // Nothing to keep: put the palette back exactly as it was found, rather
        // than to this colour's default. Previewing wrote an entry that was not
        // there before, and a role marked "yours" for a colour the reader never
        // chose is a lie the reset button then has to explain.
        store.state.config.palette[colourMode] = held?.before ?? {};
        deck.repaint();
        renderColours();
        return;
      }
      void saveColour(role.id, kept);
    },
  });

  livePicker = { role: role.id, picker, before: { ...(store.state.config.palette?.[colourMode] ?? {}) } };
  pickingColour = true;
  renderColours();
  picker.focus();
}

function closeColourPicker(keep) {
  livePicker?.picker.close(keep);
}

/**
 * One repaint a frame, however fast the slider is dragged.
 *
 * A slider fires an event per pixel and a repaint redraws every mark on the
 * slide — eleven hundred of them on the wall of days. Without this the browser
 * is drawing frames nobody will ever see, and the one the reader is waiting for
 * is behind them.
 */
let repaintQueued = false;
function queueRepaint() {
  if (repaintQueued) return;
  repaintQueued = true;
  requestAnimationFrame(() => {
    repaintQueued = false;
    deck.repaint();
  });
}

/** The colour as it is being dragged: shown everywhere, saved nowhere. */
function previewColour(role, hex) {
  const palette = store.state.config.palette ?? { light: {}, dark: {} };
  palette[colourMode] = { ...palette[colourMode], [role]: hex };
  store.state.config.palette = palette;
  // The repaint comes back through `onColours`, which is what rebuilds the
  // list — so there is no second call to make here, and while a picker is open
  // that rebuild is the one thing that must not happen.
  queueRepaint();
}

async function saveColour(role, hex) {
  previewColour(role, hex);
  await savePalette(store.state.config.palette[colourMode]);
}

async function resetColours() {
  await savePalette({});
  renderSchemes();
}

async function savePalette(side) {
  try {
    await api("/api/config", { method: "POST", body: { palette: { [colourMode]: side } } });
    await refreshState();
    deck.repaint();
  } catch (err) {
    toast(err.message, true);
  }
}

async function saveNaming(patch) {
  try {
    await api("/api/config", { method: "POST", body: patch });
    await refreshState();
    if (!$("view-deck").hidden) await buildDeck(true);
  } catch (err) {
    toast(err.message, true);
  }
}

const isoDay = (day) =>
  day
    ? `${Math.floor(day / 10000)}-${String(Math.floor(day / 100) % 100).padStart(2, "0")}-${String(day % 100).padStart(2, "0")}`
    : "";

/**
 * The milestones section, folded away until it is wanted.
 *
 * Most people never set one, and an empty list with a date field under it is a
 * screenful of nothing on the page they came to build a deck from. Adding one
 * stays a single click either way: the button is in the panel head rather than
 * at the foot of the list, so it is visible whether or not the section is.
 */
function showMilestones(open) {
  $("milestones").hidden = !open;
  $("milestones-toggle").textContent = open ? "Hide" : "Show";
  $("milestones-toggle").setAttribute("aria-expanded", open ? "true" : "false");
}

function renderMilestones() {
  const config = store.state.config;
  $("setting-start").value = isoDay(config.startDay);

  const anchors = config.anchors ?? [];
  // The count belongs on the button when the list behind it is folded away —
  // "Show" alone gives no reason to.
  const toggle = $("milestones-toggle");
  const saved = anchors.length > 0 ? ` (${num(anchors.length)})` : "";
  toggle.textContent = `${$("milestones").hidden ? "Show" : "Hide"}${saved}`;
  $("anchors").replaceChildren(
    ...(anchors.length === 0
      ? [
          el("p", {
            class: "empty-note",
            text: "No milestones yet. The day a camera arrived is the usual one.",
          }),
        ]
      : anchors.map((anchor) =>
          el(
            "div",
            { class: "anchor" },
            el(
              "div",
              {},
              el("div", { class: "anchor-label", text: anchor.label }),
              el(
                "div",
                { class: "hint" },
                formatDay(anchor.day),
                // What it points at, rather than what it is called: the label
                // is editable, so it can stop mentioning the gear at any time.
                anchor.gear ? el("span", { class: "anchor-tag", text: anchor.gear.dimension }) : null,
              ),
            ),
            el(
              "div",
              { class: "anchor-actions" },
              el("button", {
                class: "ghost",
                type: "button",
                text: "Use as range",
                onclick: () => {
                  store.range = { kind: "anchor", id: anchor.id };
                  renderRanges();
                  void buildDeck();
                },
              }),
              el("button", {
                class: "ghost",
                type: "button",
                text: "Start here",
                title: "Ignore everything before this date, everywhere",
                onclick: () => void saveStartDay(isoDay(anchor.day)),
              }),
              el("button", {
                class: "ghost",
                type: "button",
                text: "Remove",
                onclick: () => void removeAnchor(anchor),
              }),
            ),
          ),
        )),
  );
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

/**
 * The library settings, saved the moment one of them moves.
 *
 * `saved` is the count of deleted photographs as it stood before the request,
 * because the one setting here whose effect is not visible on this page is that
 * one — a checkbox shows its own state and a name appears on the title slide,
 * but a number that changes the deck two screens away needs saying back. The
 * same argument as `saveLocation`: seeing it repeated is how you know it took.
 */
async function saveSettings() {
  const before = store.state.config.deletedBefore ?? 0;

  try {
    await api("/api/config", {
      method: "POST",
      body: {
        ownerName: $("setting-owner").value,
        mergeRawJpegPairs: $("setting-merge").checked,
        includeVideo: $("setting-video").checked,
        deletedBefore: $("setting-deleted").value,
      },
    });
    await refreshState();

    const after = store.state.config.deletedBefore ?? 0;
    if (after !== before) {
      toast(
        after === 0
          ? "Deleted photographs cleared."
          : `${num(after)} deleted photographs saved — in the total, and rejects on culling.`,
      );
    }
  } catch (err) {
    toast(err.message, true);
  }
}

/**
 * Where the reader is, for the daylight shading.
 *
 * Saved like any other setting, and the deck is rebuilt if one is open, since
 * sunrise decides what "after dark" counts as on the clock slide.
 */
async function saveLocation(location) {
  try {
    await api("/api/config", { method: "POST", body: { location } });
    await refreshState();
    if (!$("view-deck").hidden) await buildDeck(true);

    // Says back what was stored, name included: the server puts a city to a
    // pair of coordinates, and seeing it appear is how you know it took.
    const saved = store.state.config.location;
    toast(
      saved
        ? `Saved: ${saved.label || "your position"} (${saved.lat.toFixed(2)}, ${saved.lon.toFixed(2)})`
        : "Location cleared.",
    );
  } catch (err) {
    toast(err.message, true);
  }
}

/**
 * The device's own position, which is the answer for almost everybody.
 *
 * The page is served over loopback, which browsers treat as a secure context,
 * so this works without a certificate. A refusal is a refusal — the fields
 * beside the button are there for anyone who would rather type it.
 */
function useDeviceLocation() {
  const button = $("location-here");
  if (!navigator.geolocation) {
    toast("This browser will not share a location. Type one instead.", true);
    return;
  }

  button.disabled = true;
  button.textContent = "Asking…";
  navigator.geolocation.getCurrentPosition(
    (position) => {
      button.disabled = false;
      button.textContent = "Use my location";
      const { latitude, longitude } = position.coords;
      $("location-lat").value = latitude.toFixed(3);
      $("location-lon").value = longitude.toFixed(3);
      void saveLocation({
        lat: Number(latitude.toFixed(3)),
        lon: Number(longitude.toFixed(3)),
        label: $("location-label").value.trim(),
      });
    },
    (err) => {
      button.disabled = false;
      button.textContent = "Use my location";
      toast(`No location from the browser: ${err.message}`, true);
    },
    { timeout: 10000, maximumAge: 600000 },
  );
}

async function saveStartDay(value) {
  try {
    await api("/api/config", { method: "POST", body: { startDay: value === "" ? null : value } });
    await refreshState();
    toast(value === "" ? "Start date cleared." : `Library starts ${value}.`);
    if (!$("view-deck").hidden) await buildDeck(true);
  } catch (err) {
    toast(err.message, true);
  }
}

// ----------------------------------------------------------- milestones ---

/**
 * The five things a milestone can be.
 *
 * A teleconverter has no category of its own: nobody thinks of buying one as a
 * different *kind* of event, they think of it as its own purchase — so it is a
 * group inside the lens list rather than a sixth chip.
 */
const MILESTONE_KINDS = [
  { label: "Bought a camera", kind: "bought", groups: ["cameras"] },
  { label: "Sold a camera", kind: "sold", groups: ["cameras"] },
  { label: "Bought a lens", kind: "bought", groups: ["lenses", "teleconverters"] },
  { label: "Sold a lens", kind: "sold", groups: ["lenses", "teleconverters"] },
  { label: "A trip", kind: "trip", groups: [] },
  { label: "A photoshoot", kind: "shoot", groups: [] },
  { label: "Something else", kind: "custom", groups: [] },
];

/** The kinds that ask for nothing but a date and a name. */
const NO_GEAR = ["custom", "trip", "shoot"];

const GEAR_GROUPS = { cameras: "Cameras", lenses: "Lenses", teleconverters: "Teleconverters" };

const milestone = {
  choice: MILESTONE_KINDS[0],
  /** @type {any} Every camera, lens and converter there is. Null until it lands. */
  catalog: null,
  /** @type {any} */ gear: null,
  search: "",
  /** Both stop following the gear once they have been typed in by hand. */
  edited: false,
  dated: false,
};

/** Mirrors `draftAnchorLabel` on the server, which is the fallback for an empty one. */
const draftLabel = (kind, label) =>
  kind === "bought" ? `Bought the ${label}` : kind === "sold" ? `Sold the ${label}` : "";

async function openMilestone() {
  milestone.choice = MILESTONE_KINDS[0];
  milestone.gear = null;
  milestone.search = "";
  milestone.edited = false;
  milestone.dated = false;

  for (const id of ["milestone-search", "milestone-label", "milestone-day", "milestone-until"]) {
    $(id).value = "";
  }
  $("milestone").showModal();
  $("milestone-search").focus();
  renderMilestone();

  // Fetched per opening rather than cached: gear appears when a source is
  // indexed, and a list that is one re-index out of date is a list missing the
  // camera somebody just came here to record buying.
  try {
    milestone.catalog = await api("/api/gear");
  } catch (err) {
    milestone.catalog = { cameras: [], lenses: [], teleconverters: [] };
    toast(err.message, true);
  }
  renderMilestone();
}

function renderMilestone() {
  $("milestone-kinds").replaceChildren(
    ...MILESTONE_KINDS.map((choice) =>
      el("button", {
        class: choice === milestone.choice ? "chip is-current" : "chip",
        type: "button",
        text: choice.label,
        onclick: () => {
          if (choice === milestone.choice) return;
          milestone.choice = choice;
          milestone.gear = null;
          if (!milestone.edited) $("milestone-label").value = "";
          renderMilestone();
        },
      }),
    ),
  );

  const groups = milestone.choice.groups;
  $("milestone-gear").hidden = groups.length === 0;
  // Only a trip has an end. A photoshoot is a day by definition, and offering
  // it an end date would be inviting somebody to record a two-week photoshoot
  // that the deck would then have to decide what to do with.
  $("milestone-until-field").hidden = milestone.choice.kind !== "trip";
  if (groups.length > 0) renderGearList(groups);
  renderMilestoneHint();
}

/**
 * The gear list.
 *
 * One row per thing, and no duplicates by construction: the server groups by
 * the same key the whole index groups by, so a body written three ways across
 * three sources arrives here once.
 */
function renderGearList(groups) {
  const needle = milestone.search.trim().toLowerCase();
  const rows = [];

  for (const group of groups) {
    const items = (milestone.catalog?.[group] ?? []).filter(
      (item) => needle === "" || item.label.toLowerCase().includes(needle),
    );
    if (items.length === 0) continue;

    // A heading earns its line only when there is more than one group to tell
    // apart: a list of nothing but cameras does not need to say "Cameras".
    if (groups.length > 1) rows.push(el("li", { class: "gear-group", text: GEAR_GROUPS[group] }));

    for (const item of items) {
      const chosen = milestone.gear?.dimension === item.dimension && milestone.gear?.key === item.key;
      const already = alreadyRecorded(item);

      rows.push(
        el(
          "li",
          {},
          el(
            "button",
            {
              class: chosen ? "picker-entry is-current" : "picker-entry",
              type: "button",
              onclick: () => chooseGear(item),
            },
            el(
              "span",
              { class: "gear-name" },
              el("span", { text: item.label }),
              item.note ? el("span", { class: "gear-note", text: item.note }) : null,
            ),
            el("span", {
              class: already ? "gear-meta is-recorded" : "gear-meta",
              text: already ? "already recorded" : `${num(item.shots)} frames`,
            }),
          ),
        ),
      );
    }
  }

  if (rows.length === 0) {
    rows.push(
      el("li", {
        class: "gear-group",
        text:
          milestone.catalog === null
            ? "Reading your gear…"
            : needle === ""
              ? "Nothing indexed yet — add a source first."
              : "Nothing here matches.",
      }),
    );
  }

  $("milestone-list").replaceChildren(...rows);
}

/** Whether this exact thing already has this exact milestone against it. */
function alreadyRecorded(item) {
  return (store.state.config.anchors ?? []).some(
    (anchor) =>
      anchor.kind === milestone.choice.kind &&
      anchor.gear?.dimension === item.dimension &&
      anchor.gear?.key === item.key,
  );
}

function chooseGear(item) {
  milestone.gear = item;
  if (!milestone.edited) $("milestone-label").value = draftLabel(milestone.choice.kind, item.label);

  // The first frame on a body is a decent guess at the day it arrived, and the
  // last one at the day it left. A guess in the field beats an empty field, and
  // it stops being offered the moment a date is typed.
  const guess = milestone.choice.kind === "sold" ? item.lastDay : item.firstDay;
  if (!milestone.dated && guess) $("milestone-day").value = isoDay(guess);

  renderMilestone();
}

function renderMilestoneHint() {
  const item = milestone.gear;
  if (!item) {
    $("milestone-hint").textContent =
      {
        custom: "A date and a phrase — anything worth measuring from.",
        trip: "Where you went, and how long for. The deck counts what came out of it.",
        shoot: "One day, and what you shot. The deck counts the frames from it.",
      }[milestone.choice.kind] ?? "Pick what this is about.";
    return;
  }

  const sold = milestone.choice.kind === "sold";
  const guess = sold ? item.lastDay : item.firstDay;
  $("milestone-hint").textContent = guess
    ? `${sold ? "Last" : "First"} frame on it: ${formatDay(guess)}`
    : "";
}

async function saveMilestone() {
  const kind = milestone.choice.kind;
  const day = $("milestone-day").value;
  const until = $("milestone-until").value;
  const label = $("milestone-label").value.trim();

  if (!NO_GEAR.includes(kind) && !milestone.gear) {
    toast("Pick the camera, lens or converter this is about.", true);
    return;
  }
  if (day === "") {
    toast("A milestone needs a date.", true);
    return;
  }
  if (NO_GEAR.includes(kind) && label === "") {
    toast("A milestone needs a name.", true);
    return;
  }
  if (kind === "trip" && until !== "" && until < day) {
    toast("A trip cannot end before it starts.", true);
    return;
  }

  const gear = milestone.gear ? { dimension: milestone.gear.dimension, key: milestone.gear.key } : null;

  try {
    await api("/api/anchors", {
      method: "POST",
      body: { kind, day, label, gear, until: kind === "trip" && until !== "" ? until : null },
    });
    $("milestone").close();
    await refreshState();
  } catch (err) {
    toast(err.message, true);
  }
}

async function removeAnchor(anchor) {
  try {
    await api(`/api/anchors/${encodeURIComponent(anchor.id)}`, { method: "DELETE" });
    if (store.range.kind === "anchor" && store.range.id === anchor.id) store.range = { kind: "all" };
    await refreshState();
  } catch (err) {
    toast(err.message, true);
  }
}

/**
 * Hiding a camera changes every count on every slide, so the deck is rebuilt
 * from the server rather than filtered in the browser — and it comes back to
 * the same slide, because this is something people do several times in a row.
 */
async function setExcluded(dimension, key, excluded) {
  try {
    await api("/api/exclude", { method: "POST", body: { dimension, key, excluded } });
    await refreshState();
    await buildDeck(true);
  } catch (err) {
    toast(err.message, true);
  }
}

function rangeQuery(spec) {
  const params = new URLSearchParams({ range: spec.kind });
  if (spec.kind === "anchor") params.set("id", spec.id);
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

async function buildDeck(keepPosition = false) {
  const button = $("deck-build");
  button.disabled = true;
  button.textContent = "Counting…";

  try {
    const query = new URLSearchParams(rangeQuery(store.range));
    for (const [id, value] of Object.entries(store.slideSettings)) query.set(id, value);

    const { deck: built } = await api(`/api/deck?${query.toString()}`);
    deck.show(built, { keepPosition });
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
$("setting-deleted").addEventListener("change", () => void saveSettings());

for (const mode of ["light", "dark"]) {
  $(`colour-${mode}`).addEventListener("click", () => {
    // Anything that changes what the list is showing closes the picker first:
    // a slider left open over a well that is about to be a different role is a
    // slider that would edit the wrong colour.
    closeColourPicker(true);
    colourMode = mode;
    renderColours();
  });
}
$("colour-reset").addEventListener("click", () => {
  closeColourPicker(false);
  void resetColours();
});
$("colour-all").addEventListener("click", () => {
  closeColourPicker(true);
  everyColour = !everyColour;
  renderColours();
});

$("location-here").addEventListener("click", useDeviceLocation);
$("location-clear").addEventListener("click", () => void saveLocation(null));
$("location-save").addEventListener("click", () => {
  const lat = Number($("location-lat").value);
  const lon = Number($("location-lon").value);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    toast("A latitude and a longitude, both.", true);
    return;
  }
  void saveLocation({ lat, lon, label: $("location-label").value.trim() });
});


$("setting-start").addEventListener("change", (event) => void saveStartDay(event.target.value));
$("setting-start-clear").addEventListener("click", () => void saveStartDay(""));

$("milestones-toggle").addEventListener("click", () => {
  showMilestones($("milestones").hidden);
  renderMilestones();
});
$("anchor-open").addEventListener("click", () => {
  // Opening the modal from a folded section and leaving it folded would hide
  // the thing that was just added.
  showMilestones(true);
  renderMilestones();
  void openMilestone();
});
// A `method="dialog"` form closes on Enter, which in a modal full of text
// fields would throw the milestone away mid-sentence. Enter saves it instead;
// only the Close button still closes.
$("milestone-form").addEventListener("submit", (event) => {
  if (event.submitter?.value === "cancel") return;
  event.preventDefault();
  void saveMilestone();
});
$("milestone-save").addEventListener("click", () => void saveMilestone());
$("milestone-search").addEventListener("input", (event) => {
  milestone.search = event.target.value;
  renderMilestone();
});
// Typed in by hand once, and it stops being rewritten from under the cursor.
$("milestone-label").addEventListener("input", () => (milestone.edited = true));
$("milestone-day").addEventListener("input", () => (milestone.dated = true));

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

$("backdrop-shuffle").addEventListener("click", () => {
  // A new arrangement is a new number, never a new random call at draw time:
  // the deck on screen, the contact sheet and the exported PNG all have to be
  // the same picture, and only a seed in the config can promise that.
  const seed = store.state.config?.backdrop?.seed ?? 1;
  void saveBackdrop({ seed: (seed + 1 + Math.floor(Math.random() * 97)) % 100000 });
});

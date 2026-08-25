// @ts-check
import { renderSlide } from "./chart.js";
import { currentTheme } from "./theme.js";
import { FORMATS, formatById } from "./formats.js";
import {
  exportDeckPdf,
  exportDeckZip,
  exportSlideImage,
  fileNameFor,
  imageTypeById,
  IMAGE_TYPES,
} from "./export.js";

/**
 * The deck itself: one slide on screen, keyboard to move, a shape to post it
 * in, and a table for every number the picture is showing.
 *
 * The table is not a fallback for a failed render. Several of the palette's
 * colours sit below 3:1 against the page, so the rule is that a value carried
 * by colour is always reachable as text — and it goes further than the chart
 * does: where a chart folds a tail into "12 others", the table lists all twelve
 * and lets each one be switched off.
 */

const $ = (id) => document.getElementById(id);
const FORMAT_KEY = "wdis-format";
/** PNG or JPEG. Remembered the same way the slide shape is. */
const IMAGE_KEY = "wdis-image-type";

export function createDeck({
  onExit,
  onToast,
  onExclude,
  onSetting,
  onColours,
  onPickColour,
  palette,
  backdrop,
  cardStyle,
  type,
}) {
  /**
   * The reader's colours, asked for rather than held.
   *
   * A deck outlives any one config: a colour changes, the state is refreshed,
   * and a palette captured when the deck was created would go on drawing the
   * old one until the page was reloaded. So this is a getter, called at every
   * paint, and `repaint()` is all a colour change has to do.
   */
  const themeNow = () =>
    currentTheme(palette?.() ?? null, backdrop?.() ?? null, cardStyle?.() ?? null, type?.() ?? null);
  let deck = { title: "", rangeLabel: "", slides: [] };
  let index = 0;
  let tableOpen = false;
  let format = formatById(localStorage.getItem(FORMAT_KEY) ?? "");
  let imageType = imageTypeById(localStorage.getItem(IMAGE_KEY) ?? "");

  const stage = $("stage");
  const dots = $("deck-dots");
  const table = $("deck-table");
  const sheet = $("sheet");
  let sheetOpen = false;

  const slide = () => deck.slides[index];

  function render() {
    const current = slide();
    if (!current) return;

    // The sheet takes the whole body: the one-slide window, the data and the
    // settings beside it are all chrome around a single slide, and none of them
    // belong in a screenshot of the deck.
    stage.hidden = sheetOpen;
    sheet.hidden = !sheetOpen;
    $("deck-rail").hidden = sheetOpen;
    $("deck-sheet-toggle").setAttribute("aria-pressed", String(sheetOpen));
    if (sheetOpen) {
      table.hidden = true;
      $("deck-side").hidden = true;
      renderFormats();
      renderImageTypes();
      renderSheet();
      return;
    }

    $("deck-side").hidden = false;
    // One column, two things that want it: the rail steps aside for the table
    // rather than the table landing on top of the slide.
    $("deck-rail").hidden = tableOpen;
    stage.dataset.orientation = format.width >= format.height ? "landscape" : "portrait";
    // The window is the shape of the slide and no larger: changing the aspect
    // moves everything around it rather than leaving a letterboxed gap.
    stage.style.setProperty("--slide-aspect", `${format.width} / ${format.height}`);
    const drawn = renderSlide(current, themeNow(), format);
    stage.replaceChildren(drawn);
    onColours?.(coloursIn(drawn));

    /**
     * The slides, by name, down the left.
     *
     * They were twenty-one unlabelled dots under the frame, which said where
     * you were and never what was there — so finding the culling slide meant
     * walking the deck. A list is also what the panel on the other side is
     * inspecting, and a tool with an inspector on the right and nothing on the
     * left is a tool with its work floating in space.
     */
    dots.replaceChildren(
      ...deck.slides.map((entry, i) => {
        const row = document.createElement("button");
        row.type = "button";
        row.role = "tab";
        row.className = i === index ? "slide-row is-current" : "slide-row";
        row.title = entry.title;
        row.setAttribute("aria-selected", String(i === index));
        row.append(
          Object.assign(document.createElement("span"), { className: "slide-row-n", textContent: String(i + 1) }),
          Object.assign(document.createElement("span"), { className: "slide-row-name", textContent: entry.title }),
        );
        row.addEventListener("click", () => go(i));
        return row;
      }),
    );
    $("deck-count").textContent = `${index + 1} / ${deck.slides.length}`;

    renderFormats();
    renderImageTypes();
    renderSettings();
    renderTable();
  }

  /**
   * Every colour the slide on screen is actually drawn in.
   *
   * The picker beside a slide offers that slide's own colours, and this is how
   * it knows which they are. The palette is written onto the elements as
   * attributes — export rasterises the serialised SVG through an `<img>`, so it
   * has to be — which makes the drawing its own record of what it used. Reading
   * it back beats a table of which slide uses which role: that would be a
   * second source of truth, and wrong within a month of the next slide.
   */
  function coloursIn(root, found = new Set()) {
    // The backdrop is decoration drawn from the same palette, and walking into
    // it would put a well in "Colours here" for a colour the *chart* does not
    // use — that card answers what this slide encodes with, and the answer must
    // not change because somebody turned some shapes on.
    if (root.hasAttribute?.("data-backdrop")) return found;

    for (const name of ["fill", "stroke"]) {
      const value = root.getAttribute(name);
      if (value && value.startsWith("#")) found.add(value.toLowerCase());
    }
    for (const child of root.children ?? []) coloursIn(child, found);
    return found;
  }

  /**
   * The choices belonging to the slide on screen, beside it.
   *
   * A setting that changes one slide does not belong in a panel of library-wide
   * settings two screens away — and it cannot be applied in the browser either,
   * because the numbers behind it come from the database. Changing one rebuilds
   * the deck and comes back to the same slide.
   */
  function renderSettings() {
    const panel = $("slide-settings");
    const current = slide();
    const settings = current?.settings ?? [];

    // The card goes away when the slide offers nothing; Style stays, because it
    // is about the deck rather than about whichever slide is on screen.
    $("deck-settings").hidden = settings.length === 0;

    panel.replaceChildren(
      ...settings.flatMap((setting) => {
        const heading = document.createElement("span");
        heading.className = "chips-label";
        heading.textContent = setting.label;

        const list = document.createElement("div");
        list.className = "setting-options";

        for (const option of setting.options) {
          const button = document.createElement("button");
          button.type = "button";
          button.className = option.value === setting.value ? "chip is-current" : "chip";

          const label = document.createElement("span");
          label.textContent = option.label;
          button.append(label);

          if (option.note) {
            const note = document.createElement("span");
            note.className = "chip-count";
            note.textContent = option.note;
            button.append(note);
          }

          button.addEventListener("click", () => {
            if (option.value === setting.value) return;
            list.querySelectorAll("button").forEach((other) => (other.disabled = true));
            onSetting(setting.id, option.value);
          });
          list.append(button);
        }

        // A choice a row of chips cannot make: the hours themselves. Shown
        // under the options, and only while the option that wants them is on.
        const parts = [heading, list];
        if (setting.hours && setting.hours.shownWhen === setting.value) {
          parts.push(hourPickers(setting.hours));
        }
        return parts;
      }),
    );
  }

  /** Two clocks, side by side, that rebuild the deck when either moves. */
  function hourPickers(hours) {
    const row = document.createElement("div");
    row.className = "setting-hours";

    for (const [id, value, label] of [
      [hours.fromId, hours.from, "from"],
      [hours.toId, hours.to, "to"],
    ]) {
      const field = document.createElement("label");
      field.className = "setting-hour";

      const name = document.createElement("span");
      name.textContent = label;

      const input = document.createElement("input");
      input.type = "time";
      const whole = Math.floor(value);
      const minutes = Math.round((value - whole) * 60);
      input.value = `${String(whole % 24).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
      input.addEventListener("change", () => {
        const [h, m] = input.value.split(":").map(Number);
        if (!Number.isFinite(h)) return;
        onSetting(id, String(h + (Number.isFinite(m) ? m : 0) / 60));
      });

      field.append(name, input);
      row.append(field);
    }

    return row;
  }

  /**
   * How many columns put the whole deck on screen at once.
   *
   * The sheet exists to be screenshotted in one go, so a layout that runs off
   * the bottom of the window has failed at its only job. Every column count is
   * tried and the first one that fits vertically wins; when none does — twenty
   * story-shaped slides on a short laptop screen — the widest is used and the
   * sheet scrolls, which is still one page rather than twenty.
   */
  function sheetColumns(count, width, height) {
    const gap = 10;
    const aspect = format.width / format.height;

    for (let columns = 1; columns <= count; columns++) {
      const rows = Math.ceil(count / columns);
      const cell = (width - gap * (columns - 1)) / columns;
      if (rows * (cell / aspect + gap) <= height) return columns;
    }
    return count;
  }

  /** Every slide at once, at the shape currently chosen. */
  function renderSheet() {
    const theme = themeNow();
    // The body is the grid's own width; the height is what is left below the
    // bar, less a little so the sheet does not sit flush against the edge.
    const width = sheet.clientWidth || sheet.parentElement?.clientWidth || 1200;
    const height = Math.max(320, window.innerHeight - sheet.getBoundingClientRect().top - 24);

    sheet.style.gridTemplateColumns = `repeat(${sheetColumns(deck.slides.length, width, height)}, 1fr)`;
    sheet.replaceChildren(
      ...deck.slides.map((entry, i) => {
        const cell = document.createElement("figure");
        cell.title = entry.title;
        cell.append(renderSlide(entry, theme, format));
        // Clicking one is how you get from the sheet to the slide it came from.
        cell.addEventListener("click", () => {
          sheetOpen = false;
          go(i);
        });
        return cell;
      }),
    );
  }

  /**
   * PNG or JPEG, once for both buttons.
   *
   * One choice rather than four export buttons: a reader who wants JPEGs wants
   * them for the slide and for the deck, and "Slide (PNG) · Slide (JPEG) ·
   * Deck (PNGs) · Deck (JPEGs)" is a toolbar nobody can read. The buttons say
   * which one is on, so the chips are never the only thing that does.
   */
  function renderImageTypes() {
    $("deck-image-types").replaceChildren(
      ...IMAGE_TYPES.map((option) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = option.id === imageType.id ? "chip is-current" : "chip";
        button.textContent = option.label;
        button.title =
          option.id === "png" ? "Lossless, larger files" : "Smaller files, and what most uploads want";
        button.addEventListener("click", () => {
          imageType = option;
          localStorage.setItem(IMAGE_KEY, option.id);
          render();
        });
        return button;
      }),
    );
    $("deck-png").textContent = `Slide (${imageType.label})`;
    $("deck-zip").textContent = `Deck (${imageType.label}s)`;
  }

  function renderFormats() {
    $("deck-formats").replaceChildren(
      ...FORMATS.map((option) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = option.id === format.id ? "chip is-current" : "chip";
        button.textContent = option.label;
        button.title = `${option.note} — ${option.width}×${option.height}`;
        button.addEventListener("click", () => {
          format = option;
          localStorage.setItem(FORMAT_KEY, option.id);
          render();
        });
        return button;
      }),
    );
  }

  /**
   * The numbers behind the slide: every row, not only the drawn ones, with a
   * checkbox wherever a row is a piece of gear that can be left out.
   */
  function renderTable() {
    const current = slide();
    table.hidden = !tableOpen;
    $("deck-table-toggle").setAttribute("aria-pressed", String(tableOpen));
    if (!tableOpen || !current) return;

    const keys = current.table.rowKeys ?? [];
    const excludable = keys.some(Boolean);

    const element = document.createElement("table");
    const head = document.createElement("thead");
    const headRow = document.createElement("tr");

    if (excludable) {
      const th = document.createElement("th");
      th.className = "tick";
      th.textContent = "In deck";
      headRow.append(th);
    }
    for (const column of current.table.columns) {
      const th = document.createElement("th");
      th.textContent = column;
      headRow.append(th);
    }
    head.append(headRow);

    const body = document.createElement("tbody");
    current.table.rows.forEach((row, rowIndex) => {
      const tr = document.createElement("tr");
      const key = keys[rowIndex] ?? null;
      if (key?.excluded) tr.className = "is-excluded";

      if (excludable) {
        const td = document.createElement("td");
        td.className = "tick";
        if (key) {
          const box = document.createElement("input");
          box.type = "checkbox";
          box.checked = !key.excluded;
          box.title = key.excluded
            ? `Count ${row[0]} again, everywhere`
            : `Leave ${row[0]} out of every count`;
          box.addEventListener("change", () => {
            box.disabled = true;
            onExclude(key.dimension, key.key, !box.checked);
          });
          td.append(box);
        }
        tr.append(td);
      }

      row.forEach((cell, i) => {
        const td = document.createElement("td");
        td.textContent = String(cell);
        // Numbers align on their digits; labels stay left.
        if (i > 0 && typeof cell === "number") td.className = "numeric";
        tr.append(td);
      });
      body.append(tr);
    });

    element.append(head, body);
    table.replaceChildren(element);
  }

  function go(next) {
    if (deck.slides.length === 0) return;
    sheetOpen = false;
    index = Math.max(0, Math.min(next, deck.slides.length - 1));
    render();
  }

  function onKey(event) {
    if (event.defaultPrevented) return;
    const tag = document.activeElement?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;

    // In the sheet the arrows mean "back to one slide", not "move by one":
    // there is no current slide on screen to move away from.
    if (sheetOpen && ["ArrowRight", "ArrowLeft", "PageDown", "PageUp", " ", "Escape"].includes(event.key)) {
      sheetOpen = false;
      render();
      event.preventDefault();
      return;
    }

    switch (event.key) {
      case "ArrowRight":
      case "PageDown":
      case " ":
        go(index + 1);
        event.preventDefault();
        break;
      case "ArrowLeft":
      case "PageUp":
        go(index - 1);
        event.preventDefault();
        break;
      case "Home":
        go(0);
        break;
      case "End":
        go(deck.slides.length - 1);
        break;
      case "t":
      case "T":
        // The data belongs to one slide, so asking for it leaves the sheet.
        tableOpen = !tableOpen;
        sheetOpen = false;
        render();
        break;
      case "a":
      case "A":
        sheetOpen = !sheetOpen;
        render();
        break;
      case "f":
      case "F":
        toggleFullscreen();
        break;
      case "Escape":
        if (!document.fullscreenElement) onExit();
        break;
      default:
        break;
    }
  }

  function toggleFullscreen() {
    const view = $("view-deck");
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void view.requestFullscreen?.().catch(() => onToast("Full screen was refused.", true));
    }
  }

  async function savePng() {
    const current = slide();
    if (!current) return;
    try {
      await exportSlideImage(
        stage.firstElementChild,
        fileNameFor(deck, imageType.extension, `${current.title} ${format.label}`),
        format,
        imageType,
      );
      onToast(`Slide saved at ${format.width}×${format.height}.`);
    } catch (err) {
      onToast(err.message, true);
    }
  }

  /**
   * The whole deck, as one document or as one image per slide.
   *
   * Both go through the same renderer rather than through what is on screen, so
   * a saved deck is the deck at full size in the shape and theme chosen — not a
   * screenshot of a preview.
   */
  async function saveDeck(kind) {
    const button = $(kind === "pdf" ? "deck-pdf" : "deck-zip");
    const label = button.textContent;
    button.disabled = true;

    try {
      const theme = themeNow();
      const render = (entry) => renderSlide(entry, theme, format);
      const progress = (done, total) => {
        button.textContent = done < total ? `${done + 1}/${total}…` : "Saving…";
      };

      if (kind === "pdf") {
        await exportDeckPdf(deck.slides, render, fileNameFor(deck, "pdf", format.label), progress, format);
      } else {
        await exportDeckZip(
          deck.slides,
          render,
          fileNameFor(deck, "zip", format.label),
          progress,
          format,
          imageType,
        );
      }
      onToast(`${deck.slides.length} slides saved.`);
    } catch (err) {
      onToast(err.message, true);
    } finally {
      button.disabled = false;
      button.textContent = label;
    }
  }

  /**
   * The colour under a click, so the panel can say which well it is.
   *
   * Reading it off the drawing rather than from a table of what each slide uses
   * — the same rule `coloursIn` follows, and for the same reason: the palette
   * is written on as attributes, so the drawing is the only source of truth
   * that cannot go stale. Walking *up* from the target is what makes a click on
   * a star, a bar or a word all land on something with a colour.
   */
  function colourUnder(node) {
    for (let at = node; at && at !== stage; at = at.parentNode) {
      // Decoration is not data. The shapes under a slide answer no question,
      // and a well for them would claim the chart encodes with them.
      if (at.hasAttribute?.("data-backdrop")) return null;
      for (const name of ["fill", "stroke"]) {
        const value = at.getAttribute?.(name);
        if (value && value.startsWith("#")) return value.toLowerCase();
      }
    }
    return null;
  }

  /**
   * Clicking a mark selects its colour. It used to advance the deck.
   *
   * Both are reasonable and they cannot both have the click, so it goes to the
   * one this screen is for: the slide has a palette beside it, and the question
   * "which of these twenty swatches is *that*?" was being answered by guessing.
   * Advancing keeps four affordances — the arrows either side, ← and →, space,
   * and the dots underneath — while selecting had none, and a viewer that is
   * also an editor should behave like the editor when they disagree.
   */
  stage.addEventListener("click", (event) => {
    if (event.target instanceof Element && event.target.closest("a")) return;
    const hex = colourUnder(event.target);
    if (hex) onPickColour?.(hex);
  });

  $("deck-prev").addEventListener("click", () => go(index - 1));
  $("deck-next").addEventListener("click", () => go(index + 1));
  $("deck-png").addEventListener("click", () => void savePng());
  $("deck-pdf").addEventListener("click", () => void saveDeck("pdf"));
  $("deck-zip").addEventListener("click", () => void saveDeck("zip"));
  $("deck-full").addEventListener("click", toggleFullscreen);
  $("deck-table-toggle").addEventListener("click", () => {
    tableOpen = !tableOpen;
    sheetOpen = false;
    render();
  });
  $("deck-sheet-toggle").addEventListener("click", () => {
    sheetOpen = !sheetOpen;
    render();
  });

  // The column count is worked out against the window, so it has to be worked
  // out again when the window changes.
  window.addEventListener("resize", () => {
    if (sheetOpen && deck.slides.length > 0) renderSheet();
  });

  return {
    /**
     * `keepPosition` is for a rebuild after hiding a camera: the numbers
     * changed, the deck did not, and being thrown back to slide one every time
     * a box is ticked would make the tables unusable.
     */
    show(next, { keepPosition = false } = {}) {
      const previousId = slide()?.id;
      deck = next;
      index = keepPosition ? Math.max(0, deck.slides.findIndex((s) => s.id === previousId)) : 0;
      // A fresh deck opens on its first slide; a rebuild after a setting change
      // stays wherever the reader was, sheet included.
      if (!keepPosition) sheetOpen = false;
      $("deck-name").textContent = deck.title;
      $("deck-range").textContent = deck.rangeLabel;
      render();
      if (!keepPosition) stage.focus({ preventScroll: true });
    },
    /** Re-draws in the current theme without moving the deck. */
    repaint() {
      if (deck.slides.length > 0) render();
    },
    onKey,
    /** The slide on screen, for the panel that edits its words. */
    current() {
      return slide() ?? null;
    },
    get length() {
      return deck.slides.length;
    },
  };
}

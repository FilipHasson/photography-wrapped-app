// @ts-check
import { renderSlide } from "./chart.js";
import { currentTheme } from "./theme.js";
import { FORMATS, formatById } from "./formats.js";
import { exportDeckPdf, exportDeckZip, exportSlidePng, fileNameFor } from "./export.js";

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

export function createDeck({ onExit, onToast, onExclude, onSetting }) {
  let deck = { title: "", rangeLabel: "", slides: [] };
  let index = 0;
  let tableOpen = false;
  let format = formatById(localStorage.getItem(FORMAT_KEY) ?? "");

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
    $("deck-nav").hidden = sheetOpen;
    $("deck-sheet-toggle").setAttribute("aria-pressed", String(sheetOpen));
    if (sheetOpen) {
      table.hidden = true;
      $("deck-settings").hidden = true;
      renderFormats();
      renderSheet();
      return;
    }

    stage.dataset.orientation = format.width >= format.height ? "landscape" : "portrait";
    // The window is the shape of the slide and no larger: changing the aspect
    // moves everything around it rather than leaving a letterboxed gap.
    stage.style.setProperty("--slide-aspect", `${format.width} / ${format.height}`);
    stage.replaceChildren(
      renderSlide(current, currentTheme(), format),
    );

    dots.replaceChildren(
      ...deck.slides.map((entry, i) => {
        const dot = document.createElement("button");
        dot.type = "button";
        dot.className = i === index ? "dot is-current" : "dot";
        dot.title = entry.title;
        dot.setAttribute("aria-label", `Slide ${i + 1}: ${entry.title}`);
        dot.addEventListener("click", () => go(i));
        return dot;
      }),
    );

    renderFormats();
    renderSettings();
    renderTable();
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
    const panel = $("deck-settings");
    const current = slide();
    const settings = current?.settings ?? [];

    panel.hidden = settings.length === 0;
    if (panel.hidden) {
      panel.replaceChildren();
      return;
    }

    panel.replaceChildren(
      ...settings.flatMap((setting) => {
        const heading = document.createElement("h3");
        heading.className = "setting-label";
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
    const theme = currentTheme();
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
      await exportSlidePng(
        stage.firstElementChild,
        fileNameFor(deck, "png", `${current.title} ${format.label}`),
        format,
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
      const theme = currentTheme();
      const render = (entry) => renderSlide(entry, theme, format);
      const progress = (done, total) => {
        button.textContent = done < total ? `${done + 1}/${total}…` : "Saving…";
      };

      if (kind === "pdf") {
        await exportDeckPdf(deck.slides, render, fileNameFor(deck, "pdf", format.label), progress, format);
      } else {
        await exportDeckZip(deck.slides, render, fileNameFor(deck, "zip", format.label), progress, format);
      }
      onToast(`${deck.slides.length} slides saved.`);
    } catch (err) {
      onToast(err.message, true);
    } finally {
      button.disabled = false;
      button.textContent = label;
    }
  }

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

  // Clicking the slide advances, which is what everyone expects of a deck.
  stage.addEventListener("click", (event) => {
    if (event.target instanceof Element && event.target.closest("a")) return;
    go(index + 1);
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
    get length() {
      return deck.slides.length;
    },
  };
}

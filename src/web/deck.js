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

export function createDeck({ onExit, onToast, onExclude }) {
  let deck = { title: "", rangeLabel: "", slides: [] };
  let index = 0;
  let tableOpen = false;
  let format = formatById(localStorage.getItem(FORMAT_KEY) ?? "");

  const stage = $("stage");
  const dots = $("deck-dots");
  const table = $("deck-table");

  const slide = () => deck.slides[index];

  function render() {
    const current = slide();
    if (!current) return;

    stage.dataset.orientation = format.width >= format.height ? "landscape" : "portrait";
    stage.replaceChildren(
      renderSlide(current, currentTheme(), `${index + 1} / ${deck.slides.length}`, format),
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
    renderTable();
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
    index = Math.max(0, Math.min(next, deck.slides.length - 1));
    render();
  }

  function onKey(event) {
    if (event.defaultPrevented) return;
    const tag = document.activeElement?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;

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
        tableOpen = !tableOpen;
        renderTable();
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
      const render = (entry, i) => renderSlide(entry, theme, `${i + 1} / ${deck.slides.length}`, format);
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
    renderTable();
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

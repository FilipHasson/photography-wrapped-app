// @ts-check
import { renderSlide } from "./chart.js";
import { currentTheme } from "./theme.js";
import { exportDeckPdf, exportSlidePng, fileNameFor } from "./export.js";

/**
 * The deck itself: one slide on screen, keyboard to move, and a table view for
 * every number the picture is showing.
 *
 * The table is not a fallback for a failed render — several of the palette's
 * colours sit below 3:1 against the page, so the rule is that a value carried
 * by colour is always reachable as text too. `t` is the shortcut; the button
 * says "Numbers".
 */

const $ = (id) => document.getElementById(id);

export function createDeck({ onExit, onToast }) {
  let deck = { title: "", rangeLabel: "", slides: [] };
  let index = 0;
  let tableOpen = false;

  const stage = $("stage");
  const dots = $("deck-dots");
  const table = $("deck-table");

  function slide() {
    return deck.slides[index];
  }

  function render() {
    const current = slide();
    if (!current) return;

    stage.replaceChildren(
      renderSlide(current, currentTheme(), `${index + 1} / ${deck.slides.length}`),
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

    renderTable();
  }

  function renderTable() {
    const current = slide();
    table.hidden = !tableOpen;
    $("deck-table-toggle").setAttribute("aria-pressed", String(tableOpen));
    if (!tableOpen || !current) return;

    const element = document.createElement("table");
    const head = document.createElement("thead");
    const headRow = document.createElement("tr");
    for (const column of current.table.columns) {
      const th = document.createElement("th");
      th.textContent = column;
      headRow.append(th);
    }
    head.append(headRow);

    const body = document.createElement("tbody");
    for (const row of current.table.rows) {
      const tr = document.createElement("tr");
      row.forEach((cell, i) => {
        const td = document.createElement("td");
        td.textContent = String(cell);
        // Numbers align on their digits; labels stay left.
        if (i > 0 && typeof cell === "number") td.className = "numeric";
        tr.append(td);
      });
      body.append(tr);
    }

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
      await exportSlidePng(stage.firstElementChild, fileNameFor(deck, "png", current.title));
      onToast("Slide saved.");
    } catch (err) {
      onToast(err.message, true);
    }
  }

  async function savePdf() {
    const button = $("deck-pdf");
    const label = button.textContent;
    button.disabled = true;

    try {
      const theme = currentTheme();
      await exportDeckPdf(
        deck.slides,
        (entry, i) => renderSlide(entry, theme, `${i + 1} / ${deck.slides.length}`),
        fileNameFor(deck, "pdf"),
        (done, total) => {
          button.textContent = done < total ? `Rendering ${done + 1}/${total}…` : "Saving…";
        },
      );
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
  $("deck-pdf").addEventListener("click", () => void savePdf());
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
    show(next) {
      deck = next;
      index = 0;
      $("deck-name").textContent = deck.title;
      $("deck-range").textContent = deck.rangeLabel;
      render();
      stage.focus({ preventScroll: true });
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

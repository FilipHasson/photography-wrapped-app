// @ts-check
import { drawBackdrop } from "./backdrop.js";
import { DEFAULT_FORMAT, metrics } from "./formats.js";
import { seriesColour } from "./theme.js";

/**
 * Drawing a slide.
 *
 * Every slide is one SVG with no external anything: colours are attributes, not
 * CSS variables, and the only font is the system sans. That is what makes
 * export work — a serialised SVG rendered into a canvas has no page around it,
 * so anything inherited would silently disappear.
 *
 * The same code draws 16:9, 9:16, 4:5, 4:3 and 1:1. Nothing is hard-coded to a
 * canvas size: type comes from the format's metrics, every chart is handed a
 * plot rectangle, and the two charts that genuinely need a different shape in a
 * narrow frame — ranked bars and the calendar — switch layout rather than
 * squeeze.
 *
 * Chart conventions, held to across every kind here:
 *
 *  - one series, one colour; a highlight carries emphasis, never a value ramp
 *  - marks are thin (bars capped at 24px), gridlines are hairlines, and a 2px
 *    gap in the surface colour does the separating rather than a stroke
 *  - values are labelled selectively — the extreme, the leader, the axis — and
 *    every value is in the slide's table view regardless
 *  - each mark carries a `<title>`, so hovering says what it is
 *  - nothing is placed before it is measured; a clipped label is worse than none
 */

const NS = "http://www.w3.org/2000/svg";
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

// ------------------------------------------------------------- elements ----

export function el(tag, attrs = {}, ...children) {
  const node = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    node.setAttribute(key, String(value));
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child);
  }
  return node;
}

function text(value, x, y, options = {}) {
  const { size = 24, weight = 400, fill = "#000", anchor = "start", ...rest } = options;
  const node = el("text", {
    x,
    y,
    // Rounded: derived sizes otherwise come out as 30.172959999999993px, which
    // is noise in the exported file and in every diff of it.
    "font-size": Math.round(size * 100) / 100,
    "font-weight": weight,
    fill,
    "text-anchor": anchor,
    "font-family": FONT,
    ...rest,
  });
  node.textContent = value;
  return node;
}

/** Adds a native tooltip to a mark, which survives into the exported file. */
function titled(node, label) {
  const title = el("title");
  title.textContent = label;
  node.append(title);
  return node;
}

// -------------------------------------------------------------- measuring --

const measurer = document.createElement("canvas").getContext("2d");

/**
 * Text width, measured rather than guessed.
 *
 * Labels here are camera and lens names of wildly different lengths, and a
 * label that overflows its bar or collides with the next one is worse than no
 * label at all — so nothing is placed until it has been measured.
 */
export function measure(value, size = 24, weight = 400) {
  if (!measurer) return value.length * size * 0.5;
  measurer.font = `${weight} ${size}px ${FONT}`;
  return measurer.measureText(value).width;
}

/** Shortens to fit, with an ellipsis, or returns the original when it fits. */
function ellipsize(value, maxWidth, size, weight = 400) {
  if (measure(value, size, weight) <= maxWidth) return value;
  let cut = value;
  while (cut.length > 1 && measure(`${cut}…`, size, weight) > maxWidth) {
    cut = cut.slice(0, -1);
  }
  return `${cut.trimEnd()}…`;
}

/** Greedy word wrap, up to `maxLines`; the last line is ellipsized if needed. */
function wrap(value, maxWidth, size, maxLines = 2, weight = 400) {
  const words = String(value).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";

  for (const word of words) {
    const candidate = line === "" ? word : `${line} ${word}`;
    if (measure(candidate, size, weight) <= maxWidth || line === "") {
      line = candidate;
    } else {
      lines.push(line);
      line = word;
      if (lines.length === maxLines) break;
    }
  }
  if (lines.length < maxLines && line !== "") lines.push(line);

  if (lines.length === maxLines) {
    const consumed = lines.join(" ");
    if (consumed.length < value.length) {
      lines[maxLines - 1] = ellipsize(`${lines[maxLines - 1]} …`, maxWidth, size, weight);
    }
  }
  return lines;
}

// ---------------------------------------------------------------- scales ---

/** A round number at or above `value`, so the axis tops out somewhere sane. */
function niceCeiling(value) {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) {
    if (value <= magnitude * step) return magnitude * step;
  }
  return magnitude * 10;
}

const nf = new Intl.NumberFormat("en-US");
const fmt = (n) => nf.format(Math.round(n));

// ----------------------------------------------------------------- frame ---

/**
 * The parts every slide shares: eyebrow, headline, subtitle, note, page
 * number. Returns the root and whatever space is left for the chart.
 *
 * The note is laid out *before* the plot rather than after, because it is the
 * one block whose height is unknown until its text has been wrapped — and a
 * chart that assumed two lines and got four is a chart drawn over its own
 * caveats.
 */
function frame(slide, theme, L) {
  const root = el("svg", {
    xmlns: NS,
    viewBox: `0 0 ${L.width} ${L.height}`,
    width: L.width,
    height: L.height,
    "font-family": FONT,
    role: "img",
    "aria-label": `${slide.title}. ${slide.headline}`,
  });

  root.append(el("rect", { x: 0, y: 0, width: L.width, height: L.height, fill: theme.surface }));
  drawBackdrop(root, slide, theme, L);

  const inner = L.width - L.pad * 2;
  const eyebrowY = L.pad + L.eyebrow * 0.5;
  root.append(
    text(slide.title.toUpperCase(), L.pad, eyebrowY, {
      size: L.eyebrow,
      weight: 600,
      fill: theme.muted,
      "letter-spacing": Math.max(1, L.eyebrow * 0.09),
    }),
  );

  // One step down for a long headline, and only one: past that it wraps.
  const headlineSize = slide.headline.length > 44 ? L.headlineSmall : L.headline;
  const lines = wrap(slide.headline, inner, headlineSize, L.headlineLines, 600);
  const lineHeight = headlineSize * 1.16;
  const headlineTop = eyebrowY + L.eyebrow * 1.9 + headlineSize * 0.82;

  lines.forEach((line, i) => {
    root.append(
      text(line, L.pad, headlineTop + i * lineHeight, {
        size: headlineSize,
        weight: 600,
        fill: theme.ink,
      }),
    );
  });

  let y = headlineTop + (lines.length - 1) * lineHeight;
  if (slide.subtitle) {
    // Clearance is measured off the headline, not the subtitle: the descenders
    // that would be sat on belong to the bigger of the two.
    y += headlineSize * 0.45 + L.subtitle * 1.1;
    root.append(
      text(ellipsize(slide.subtitle, inner, L.subtitle), L.pad, y, {
        size: L.subtitle,
        fill: theme.ink2,
      }),
    );
  }

  const footerY = L.height - L.pad * 0.7;
  let noteTop = footerY;

  if (slide.note) {
    const noteLines = wrap(slide.note, inner, L.note, L.noteLines);
    noteTop = footerY - (noteLines.length - 1) * L.note * 1.35;
    noteLines.forEach((line, i) => {
      root.append(text(line, L.pad, noteTop + i * L.note * 1.35, { size: L.note, fill: theme.muted }));
    });
  }

  const top = y + L.subtitle * 1.4;
  // A slide with nothing to footnote gives the space to the chart rather than
  // leaving a band of nothing where the note would have been.
  const bottom = slide.note ? noteTop - L.note * 1.8 : footerY;
  return {
    root,
    plot: { x: L.pad, y: top, w: inner, h: Math.max(120, bottom - top) },
  };
}

// ------------------------------------------------------------- the marks ---

// ------------------------------------------------------------- colour ------

const hex = (colour) => {
  const value = colour.replace("#", "");
  const full = value.length === 3 ? value.replace(/./g, (c) => c + c) : value;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
};

/** Blends two colours, `t` of the way from the first to the second. */
function mix(from, to, t) {
  const a = hex(from);
  const b = hex(to);
  const channel = (i) => Math.round(a[i] + (b[i] - a[i]) * Math.max(0, Math.min(1, t)));
  return `#${[0, 1, 2].map((i) => channel(i).toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Shades for the parts of one bar — a lens, then the same lens behind each
 * teleconverter it was used with.
 *
 * Stepping towards the surface rather than to another hue is what keeps it
 * reading as one lens: the segments are the same thing at different reach, not
 * different things.
 */
function shadeOf(index, count, theme) {
  if (index === 0 || count < 2) return theme.series[0];
  return mix(theme.series[0], theme.surface, (index / count) * 0.72);
}

/**
 * How much daylight there was, 0 at night and 1 in the middle of the day.
 *
 * A stylised day rather than a computed one: real sunrise moves with latitude
 * and season, and a slide that implied otherwise would be claiming something
 * this tool does not know. The legend says as much.
 */
function daylight(hour, sunrise, sunset) {
  // Twilight either side, so the ring turns rather than switches.
  const dawn = 1.5;
  if (hour >= sunrise + dawn && hour <= sunset - dawn) return 1;
  if (hour <= sunrise - dawn || hour >= sunset + dawn) return 0;
  return hour < sunrise + dawn
    ? (hour - (sunrise - dawn)) / (dawn * 2)
    : ((sunset + dawn) - hour) / (dawn * 2);
}

const hourColour = (hour, theme, sunrise, sunset) =>
  mix(theme.night, theme.day, daylight(hour, sunrise, sunset));

/** A bar: rounded at the data end, square where it leaves the baseline. */
function bar(root, x, y, width, height, fill, label, opacity = 1) {
  const radius = Math.min(4, height / 2, width / 2);
  root.append(titled(el("rect", { x, y, width, height, rx: radius, fill, opacity }), label));
  if (width > radius) {
    root.append(el("rect", { x, y, width: radius, height, fill, opacity }));
  }
}

/** A column: the same rule, rotated. */
function column(root, x, baseline, width, height, fill, label, opacity = 1) {
  const radius = Math.min(4, width / 2, height / 2);
  root.append(
    titled(el("rect", { x, y: baseline - height, width, height, rx: radius, fill, opacity }), label),
  );
  if (height > radius) {
    root.append(el("rect", { x, y: baseline - radius, width, height: radius, fill, opacity }));
  }
}

// ----------------------------------------------------------------- kinds ---

/**
 * Ranked horizontal bars: cameras, lenses, pairings.
 *
 * Wide frames put the name, the bar and the number on one line. Narrow ones
 * cannot — a lens name runs to thirty characters and 1080px has no room for it
 * beside a bar — so there the label sits above its own bar rather than being
 * cut down to "NIKKOR Z 24-7…".
 */
function drawBars(root, plot, slide, theme, L) {
  const items = slide.items;
  if (items.length === 0) return;
  const max = Math.max(...items.map((item) => item.value), 1);

  const legendH = slide.legend?.length ? L.axis * 2.6 : 0;
  const area = { ...plot, h: plot.h - legendH };
  if (legendH > 0) drawShadeLegend(root, plot, slide.legend, theme, L);

  // The reader's answer first, where they have given one: this is a chart whose
  // best orientation depends on the names in it and the screen it is read on,
  // and neither is knowable from here.
  if (slide.orientation === "columns") {
    drawBarsAsColumns(root, area, items, max, theme, L);
    return;
  }

  // Two or three bars across a tall frame is a lot of nothing. Standing them up
  // turns the same numbers into something with presence, which is the reason a
  // two-camera count belongs on a story at all.
  if (slide.orientation !== "rows" && items.length <= 3 && L.tall) {
    drawBarsAsColumns(root, area, items, max, theme, L);
    return;
  }

  // A longer list buys its rows out of the type size rather than out of the
  // gaps: the reader asked for twenty lenses, so twenty have to fit, and the
  // alternative to smaller labels is labels sitting on top of each other.
  const dense = compress(items.length, area.h, L);

  if (L.narrow) {
    drawBarsStacked(root, area, items, max, theme, dense);
    return;
  }

  return drawBarRows(root, area, items, max, theme, dense);
}

/**
 * Type stepped down to fit a list, never below what stays readable.
 *
 * Each row needs a little more than its own label height; below about 70% the
 * text stops being legible on a phone, which is where these are read, so a list
 * long enough to need more than that keeps the floor and takes the space it
 * needs from the row height instead.
 */
function compress(rows, height, L) {
  // What one row costs, in multiples of its own label: a name and a bar under
  // it where the frame is narrow, a name beside one where it is not.
  const perRow = L.label * (L.narrow ? 2.6 : 1.55);
  if (rows * perRow <= height) return L;

  // Never below 8px, which is where a label stops being a label — the row cap
  // in stats/aggregate.ts is what keeps a list from ever needing to go there.
  const scale = Math.max(8 / L.label, height / (rows * perRow));
  return {
    ...L,
    label: L.label * scale,
    value: L.value * scale,
    tiny: L.tiny * scale,
  };
}

/** One bar per row, name on the left, number on the right. */
function drawBarRows(root, area, items, max, theme, L) {
  const rowHeight = Math.min(area.h / items.length, L.label * 4);
  const top0 = area.y + Math.max(0, (area.h - rowHeight * items.length) / 2);
  const thickness = Math.min(24, Math.max(6, rowHeight - L.label * 0.9));
  const valueWidth = Math.max(...items.map((item) => measure(item.valueLabel, L.value, 600))) + 20;
  const labelWidth = Math.min(area.w * 0.36, 460);
  const trackX = area.x + labelWidth + 24;
  const trackW = Math.max(40, area.w - labelWidth - valueWidth - 48);

  items.forEach((item, i) => {
    const mid = top0 + i * rowHeight + rowHeight / 2;
    const width = Math.max(2, (item.value / max) * trackW);

    root.append(
      text(ellipsize(item.label, labelWidth, L.label, i === 0 ? 600 : 400), area.x, mid + L.label * 0.34, {
        size: L.label,
        weight: i === 0 ? 600 : 400,
        fill: i === 0 ? theme.ink : theme.ink2,
      }),
    );
    segmentedBar(root, trackX, mid - thickness / 2, width, thickness, item, theme);
    root.append(
      text(item.valueLabel, area.x + area.w, mid + L.value * 0.34, {
        size: L.value,
        fill: theme.ink2,
        weight: i === 0 ? 600 : 400,
        anchor: "end",
      }),
    );
  });
}

/**
 * One bar, in as many shades as it has parts.
 *
 * A lens used bare and behind two converters is one bar in three shades rather
 * than three bars: the reader is being told how much that lens was used, and
 * then how it was used.
 */
function segmentedBar(root, x, y, width, height, item, theme) {
  const fill = item.muted ? theme.axis : theme.series[0];
  const parts = item.segments ?? [];

  if (item.muted || parts.length < 2 || item.value <= 0) {
    bar(root, x, y, width, height, fill, `${item.label}: ${fmt(item.value)}`);
    return;
  }

  let offset = 0;
  parts.forEach((part, index) => {
    const share = (part.value / item.value) * width;
    if (share <= 0) return;
    const last = index === parts.length - 1;
    const shade = shadeOf(index, parts.length, theme);
    // Every piece but the last is square-ended and holds back 2px of surface,
    // so the bar reads as one bar with divisions rather than a row of small
    // ones. The last keeps the rounded data end.
    const drawn = Math.max(1, share - (last ? 0 : 2));
    const label = `${item.label} ${part.label}: ${fmt(part.value)}`;

    if (last) {
      bar(root, x + offset, y, drawn, height, shade, label);
    } else {
      root.append(titled(el("rect", { x: x + offset, y, width: drawn, height, fill: shade }), label));
    }
    offset += share;
  });
}

/** The same, stood up: the parts stack from the baseline. */
function segmentedColumn(root, x, baseline, width, height, item, theme) {
  const fill = item.muted ? theme.axis : theme.series[0];
  const parts = item.segments ?? [];

  if (item.muted || parts.length < 2 || item.value <= 0) {
    column(root, x, baseline, width, height, fill, `${item.label}: ${fmt(item.value)}`);
    return;
  }

  let bottom = baseline;
  parts.forEach((part, index) => {
    const share = (part.value / item.value) * height;
    if (share <= 0) return;
    const last = index === parts.length - 1;
    const shade = shadeOf(index, parts.length, theme);
    const drawn = Math.max(1, share - (last ? 0 : 2));
    const label = `${item.label} ${part.label}: ${fmt(part.value)}`;

    if (last) {
      column(root, x, bottom, width, drawn, shade, label);
    } else {
      root.append(
        titled(el("rect", { x, y: bottom - drawn, width, height: drawn, fill: shade }), label),
      );
    }
    bottom -= share;
  });
}

/** Names the shades inside a segmented bar. */
function drawShadeLegend(root, plot, labels, theme, L) {
  drawKeyLegend(
    root,
    { x: plot.x, y: plot.y + plot.h - L.axis },
    labels.map((label, index) => ({ label, colour: shadeOf(index, labels.length, theme) })),
    theme,
    L,
    plot.w,
  );
}

/**
 * A row of swatches with names beside them, from a given point.
 *
 * Wraps upward when `width` is given and the row will not fit inside it.
 * Upward because the caller has put this on the last line it has — the note
 * lives below it — and four labels carrying day counts ("Longest quiet spell ·
 * 1,301 days") run off the side of a 9:16 frame, which is the shape these are
 * read in. Text has no box, so no bounds check could ever have caught it.
 */
function legendPitch(label, L) {
  return L.axis + measure(label, L.axis) + L.axis * 1.6;
}

/**
 * The swatches grouped into the lines they will occupy.
 *
 * Separate from the drawing because the caller has to reserve the height
 * *before* the legend is drawn — a legend that wrapped onto a second line
 * without anyone knowing would simply sit on top of the chart.
 */
function legendLines(items, L, width) {
  const lines = [[]];
  let used = 0;

  for (const item of items) {
    const step = legendPitch(item.label, L);
    if (used > 0 && used + step > width) {
      lines.push([]);
      used = 0;
    }
    lines[lines.length - 1].push(item);
    used += step;
  }

  return lines;
}

/** What one legend line costs, top to top. */
const LEGEND_LINE = 1.7;

function drawKeyLegend(root, at, items, theme, L, width = Infinity) {
  const lines = legendLines(items, L, width);

  lines.forEach((line, index) => {
    const y = at.y - (lines.length - 1 - index) * L.axis * LEGEND_LINE;
    let x = at.x;

    for (const item of line) {
      root.append(
        el("rect", {
          x,
          y: y - L.axis * 0.75,
          width: L.axis * 0.7,
          height: L.axis * 0.7,
          rx: 3,
          fill: item.colour,
        }),
      );
      root.append(text(item.label, x + L.axis, y, { size: L.axis, fill: theme.ink2 }));
      x += legendPitch(item.label, L);
    }
  });
}

/**
 * Two or three bars, stood up.
 *
 * Ranked bars lie down because names are long; with only a couple of them there
 * is room for the name *under* a column, and a column half a slide tall says
 * "this is the one" in a way a 24px bar never will.
 */
/**
 * Milestones on a chart whose x axis is time.
 *
 * A hairline and a word: a mark is context, and the moment it competes with the
 * data it annotates it has failed. Dashed, and in `ink2` rather than the axis
 * colour, because it has to cross the bars it is explaining — a pale rule
 * disappears the instant a column is drawn over it, in one theme or the other.
 *
 * Labels are placed left to right and only where the space beside the last one
 * is free, the same rule the column labels follow. Every mark inside the chart
 * gets its rule; a cluster of purchases in one month names as many as fit and
 * leaves the rest to the hover title.
 *
 * `xOf` returns null for a day the chart is not drawing.
 */
function drawMarks(root, area, marks, xOf, theme, L, reserve = 0) {
  if (!marks || marks.length === 0) return;

  const size = Math.max(9, Math.min(L.tiny, area.h * 0.12));
  const top = area.y + size * 1.35;
  // Whatever else already lives on this line — an axis ceiling sits at the top
  // right of a bar chart, and a mark name ran straight through it.
  const edge = area.x + area.w - reserve;
  let free = -Infinity;

  for (const mark of [...marks].sort((a, b) => a.day - b.day)) {
    const from = xOf(mark.day);
    const to = mark.until === undefined ? null : xOf(mark.until);

    // A span reaching into the chart from before it begins is a span the chart
    // is partly about — milestones are chosen by overlapping the range, not by
    // sitting inside it — so its left edge is pinned to the frame rather than
    // the whole mark being dropped for having no honest place to start.
    const x = from === null && to !== null && Number.isFinite(to) ? area.x : from;
    if (x === null || !Number.isFinite(x) || x < area.x - 1 || x > area.x + area.w + 1) continue;

    /**
     * A trip is a fortnight, and a hairline through the middle of one says the
     * wrong thing — so a mark with an end date gets a band between its two days
     * rather than a rule at one of them.
     *
     * Still `ink2` and still faint: a mark is context, and the moment it
     * competes with the data it annotates it has failed. A band is a lot more
     * ink than a hairline, so it is fainter to compensate, and it keeps the two
     * rules at its edges — a wash with no edges reads as a smudge rather than
     * as "from here to here".
     */
    const wide = to !== null && Number.isFinite(to) && to > x + 1;
    const right = wide ? Math.min(to, area.x + area.w) : x;

    if (wide) {
      root.append(
        titled(
          el("rect", {
            x,
            y: top,
            width: right - x,
            height: area.y + area.h - top,
            fill: theme.ink2,
            opacity: 0.09,
          }),
          mark.full,
        ),
      );
    }

    for (const at of wide ? [x, right] : [x]) {
      root.append(
        titled(
          el("line", {
            x1: at,
            y1: top,
            x2: at,
            y2: area.y + area.h,
            stroke: theme.ink2,
            "stroke-dasharray": "3 4",
            opacity: 0.5,
          }),
          mark.full,
        ),
      );
    }

    // A square rather than a circle, so the frame check can see where it is.
    root.append(
      el("rect", { x: x - 1.5, y: top - 1.5, width: 3, height: 3, fill: theme.ink2, opacity: 0.7 }),
    );

    if (x < free) continue;
    const width = measure(mark.label, size);
    if (x + size * 0.4 + width > edge) continue;
    free = x + size * 0.4 + width + size;

    root.append(text(mark.label, x + size * 0.4, area.y + size, { size, fill: theme.ink2 }));
  }
}

/**
 * Where a day sits along a run of months, as a fractional row.
 *
 * Only months holding photographs are drawn, so a day can fall in a month that
 * is not there at all — which is exactly the interesting case, a camera bought
 * and then not used for a fortnight. It lands on the boundary between the two
 * months either side of it rather than being dropped. Null means the day is
 * outside the run entirely, where there is no honest place to put it.
 */
function monthRow(months, day) {
  const ym = Math.floor(day / 100);
  const exact = months.indexOf(ym);
  if (exact >= 0) {
    const span = daysInMonth(Math.floor(ym / 100), ym % 100);
    return exact + Math.min(1, Math.max(0, ((day % 100) - 1) / span));
  }

  const after = months.findIndex((month) => month > ym);
  return after > 0 ? after : null;
}

/**
 * The same position, pinned to the ends of the run rather than dropped off it.
 *
 * `monthRow` answers null for a day outside the months drawn, which is right
 * for a purchase — there is no honest row for it — and wrong for the end of a
 * span. Milestones are chosen by *overlapping* the range, so a trip can begin
 * before the first month here and end after the last, and refusing to place
 * either end would throw away a band that is genuinely most of the chart.
 */
function monthEdge(months, day) {
  if (months.length === 0) return null;
  const ym = Math.floor(day / 100);
  if (ym < months[0]) return 0;
  if (ym > months[months.length - 1]) return months.length;
  return monthRow(months, day);
}

/** The same position, along an axis of bands rather than rows. */
function monthAxis(months, x0, band) {
  return (day) => {
    const row = monthRow(months, day);
    return row === null ? null : x0 + band * row;
  };
}

function drawBarsAsColumns(root, plot, items, max, theme, L) {
  const band = plot.w / items.length;
  const thickness = Math.min(band * 0.5, plot.w * 0.22);

  // Type sized off the band it has to sit inside. This layout was written for
  // the two or three bars a tall frame stands up on its own; asked for ten by a
  // reader who wants columns, a lens name set for three of them runs straight
  // into its neighbour, and no bounds check would ever see it.
  const labelSize = Math.max(9, Math.min(L.label, band / 7));
  const valueSize = Math.max(10, Math.min(L.subtitle * 1.15, band / 4.5));
  const shareSize = Math.max(8, Math.min(L.value, band / 6.5));
  const room = band - Math.max(10, labelSize);

  const baseline = plot.y + plot.h - labelSize * 3.2 - shareSize * 1.4;
  const height = Math.max(60, baseline - plot.y - valueSize * 1.8);

  items.forEach((item, i) => {
    const cx = plot.x + band * (i + 0.5);
    const barHeight = item.value > 0 ? Math.max(3, (item.value / max) * height) : 0;

    segmentedColumn(root, cx - thickness / 2, baseline, thickness, barHeight, item, theme);

    root.append(
      text(ellipsize(fmt(item.value), room, valueSize, 600), cx, baseline - barHeight - valueSize * 0.5, {
        size: valueSize,
        weight: 600,
        fill: theme.ink,
        anchor: "middle",
      }),
    );

    // Every line cut to the band, not just the last: a greedy wrap will put a
    // word on a line whether or not the word fits, and `200-600mm` is one word.
    const weight = i === 0 ? 600 : 400;
    const lines = wrap(item.label, room, labelSize, 2, weight);
    lines.forEach((line, row) => {
      root.append(
        text(ellipsize(line, room, labelSize, weight), cx, baseline + labelSize * (1.5 + row * 1.15), {
          size: labelSize,
          weight,
          fill: i === 0 ? theme.ink : theme.ink2,
          anchor: "middle",
        }),
      );
    });

    // The share, which the value label carries after its separator.
    const share = item.valueLabel.split("·").pop();
    if (share) {
      root.append(
        text(share.trim(), cx, baseline + labelSize * (1.5 + lines.length * 1.15) + shareSize * 0.4, {
          size: shareSize,
          fill: theme.muted,
          anchor: "middle",
        }),
      );
    }
  });

  root.append(
    el("line", { x1: plot.x, y1: baseline, x2: plot.x + plot.w, y2: baseline, stroke: theme.axis }),
  );
}

function drawBarsStacked(root, plot, items, max, theme, L) {
  // Rows take the space they are given. A five-camera slide in a 1920px-tall
  // frame used to draw five thin bars in the top tenth of it and leave the rest
  // blank; the cap only exists to stop two items becoming two enormous ones.
  const rowHeight = Math.min(plot.h / items.length, L.label * 6);
  const top0 = plot.y + Math.max(0, (plot.h - rowHeight * items.length) / 2);
  // The bar takes whatever the label leaves. A long list gets thin bars rather
  // than bars growing into the next row name.
  const thickness = Math.min(28, Math.max(4, rowHeight - L.label * 1.9));

  items.forEach((item, i) => {
    const top = top0 + i * rowHeight;
    const fill = item.muted ? theme.axis : theme.series[0];
    const valueWidth = measure(item.valueLabel, L.value, 600) + 16;

    root.append(
      text(ellipsize(item.label, plot.w - valueWidth, L.label, i === 0 ? 600 : 400), plot.x, top + L.label, {
        size: L.label,
        weight: i === 0 ? 600 : 400,
        fill: i === 0 ? theme.ink : theme.ink2,
      }),
    );
    root.append(
      text(item.valueLabel, plot.x + plot.w, top + L.label, {
        size: L.value,
        fill: theme.ink2,
        weight: i === 0 ? 600 : 400,
        anchor: "end",
      }),
    );
    // Segments here too. This is the layout a 9:16 deck uses, so drawing a
    // plain bar meant the teleconverter shading never appeared in the format
    // the deck is built for.
    segmentedBar(
      root,
      plot.x,
      top + L.label * 1.35,
      Math.max(2, (item.value / max) * plot.w),
      thickness,
      item,
      theme,
    );
  });
}

/** Vertical histogram: focal length, aperture, ISO, shutter, ratings. */
/**
 * The same distribution, lying down.
 *
 * A histogram wants to stand up — a scale of shutter speeds reads left to right
 * and its shape is a skyline. But a scale with long labels, or twenty buckets
 * on a story, reads better as rows, and which is true of a given library on a
 * given screen is not knowable from here. So it is a setting, and this is the
 * other half of it.
 *
 * The bucket labels take a margin of their own rather than being written under
 * each bar, which is the whole reason to turn a histogram on its side: `1/8000`
 * and `f/5.6-6.3` fit beside a row and collide under a column.
 */
function drawColumnsAsRows(root, plot, slide, theme, L) {
  const items = slide.items;
  const max = Math.max(...items.map((item) => item.value), 1);
  const ceiling = niceCeiling(max);

  const headH = L.axis * 2;
  const top = plot.y + headH;
  const height = plot.h - headH;
  const rowH = height / items.length;

  const labelSize = Math.max(9, Math.min(L.label, rowH / 1.25));
  const gutter = Math.min(
    plot.w * 0.28,
    Math.max(...items.map((item) => measure(item.label, labelSize, 600))) + labelSize * 0.8,
  );

  const x0 = plot.x + gutter;
  const width = Math.max(40, plot.w - gutter - measure(fmt(ceiling), L.axis) - L.tiny * 2);
  const thickness = Math.max(2, Math.min(rowH - Math.max(2, rowH * 0.2), L.value * 1.6));

  // Two hairlines to read a length against, labelled once above them.
  for (const fraction of [0.5, 1]) {
    const x = x0 + width * fraction;
    root.append(el("line", { x1: x, y1: top, x2: x, y2: top + height, stroke: theme.grid }));
    root.append(
      text(fmt(ceiling * fraction), x, plot.y + L.axis, { size: L.axis, fill: theme.muted, anchor: "middle" }),
    );
  }

  items.forEach((item, i) => {
    const y = top + i * rowH;
    const highlighted = i === slide.highlight;
    const barW = item.value > 0 ? Math.max(2, (item.value / ceiling) * width) : 0;
    // One series, one colour; the favourite holds full strength and the rest
    // step back, so emphasis never doubles as a value scale.
    const opacity = slide.highlight >= 0 && !highlighted ? 0.45 : 1;

    if (barW > 0) {
      bar(
        root,
        x0,
        y + (rowH - thickness) / 2,
        barW,
        thickness,
        theme.series[0],
        `${item.label}: ${fmt(item.value)}`,
        opacity,
      );
    }

    root.append(
      text(item.label, x0 - labelSize * 0.5, y + rowH / 2 + labelSize * 0.35, {
        size: labelSize,
        weight: highlighted ? 600 : 400,
        fill: highlighted ? theme.ink : theme.muted,
        anchor: "end",
      }),
    );

    if (highlighted) {
      root.append(
        text(fmt(item.value), x0 + barW + L.tiny * 0.6, y + rowH / 2 + L.value * 0.35, {
          size: Math.min(L.value, rowH * 0.8),
          weight: 600,
          fill: theme.ink,
        }),
      );
    }
  });

  root.append(el("line", { x1: x0, y1: top, x2: x0, y2: top + height, stroke: theme.axis }));
  root.append(
    text(slide.axisLabel, plot.x, plot.y + L.axis, { size: L.axis, fill: theme.muted }),
  );
}

function drawColumns(root, plot, slide, theme, L) {
  const items = slide.items;
  if (items.length === 0) return;
  if (slide.orientation === "rows") return drawColumnsAsRows(root, plot, slide, theme, L);

  const max = Math.max(...items.map((item) => item.value), 1);
  const ceiling = niceCeiling(max);
  const band = plot.w / items.length;
  const thickness = Math.min(24, Math.max(5, band - 14));
  const baseline = plot.y + plot.h - L.axis * 3;
  const height = Math.max(40, baseline - plot.y - L.value * 2);

  // Two hairlines are enough to read a histogram against.
  for (const fraction of [0.5, 1]) {
    const y = baseline - height * fraction;
    root.append(el("line", { x1: plot.x, y1: y, x2: plot.x + plot.w, y2: y, stroke: theme.grid }));
    root.append(
      text(fmt(ceiling * fraction), plot.x + plot.w, y - L.axis * 0.5, {
        size: L.axis,
        fill: theme.muted,
        anchor: "end",
      }),
    );
  }

  /**
   * Which labels get drawn.
   *
   * A stride alone is not enough: the highlighted column is always labelled, and
   * at the long end of a focal-length axis the labels are wider than the ones at
   * the short end, so a stride that fits at 24mm collides at 600mm. Labels are
   * placed in priority order and only where the space is actually free.
   */
  const taken = [];
  const fits = (centre, width) => {
    const left = centre - width / 2;
    const right = centre + width / 2;
    if (left < plot.x - 4 || right > plot.x + plot.w + 4) return false;
    return taken.every((box) => right + 8 < box.left || left - 8 > box.right);
  };
  const claim = (centre, width) => taken.push({ left: centre - width / 2, right: centre + width / 2 });

  const centreOf = (i) => plot.x + band * (i + 0.5);
  const stride = Math.max(
    1,
    Math.ceil((Math.max(...items.map((item) => measure(item.label, L.axis))) + 12) / band),
  );

  // The favourite first, then the stride, then whatever else still fits.
  const order = [
    ...(slide.highlight >= 0 ? [slide.highlight] : []),
    ...items.map((_, i) => i).filter((i) => i % stride === 0),
    ...items.map((_, i) => i),
  ];
  const labelled = new Set();
  for (const i of order) {
    const item = items[i];
    if (!item || labelled.has(i)) continue;
    const width = measure(item.label, L.axis);
    if (!fits(centreOf(i), width)) continue;
    claim(centreOf(i), width);
    labelled.add(i);
  }

  items.forEach((item, i) => {
    const cx = centreOf(i);
    const barHeight = item.value > 0 ? Math.max(2, (item.value / ceiling) * height) : 0;
    const highlighted = i === slide.highlight;
    // One series, one colour; the favourite holds full strength and the rest
    // step back, so emphasis never doubles as a value scale.
    const opacity = slide.highlight >= 0 && !highlighted ? 0.45 : 1;

    if (barHeight > 0) {
      column(
        root,
        cx - thickness / 2,
        baseline,
        thickness,
        barHeight,
        theme.series[0],
        `${item.label}: ${fmt(item.value)}`,
        opacity,
      );
    }

    if (highlighted) {
      root.append(
        text(fmt(item.value), cx, baseline - barHeight - L.value * 0.6, {
          size: L.value,
          weight: 600,
          fill: theme.ink,
          anchor: "middle",
        }),
      );
    }

    if (labelled.has(i)) {
      root.append(
        text(item.label, cx, baseline + L.axis * 1.6, {
          size: L.axis,
          fill: highlighted ? theme.ink2 : theme.muted,
          anchor: "middle",
          weight: highlighted ? 600 : 400,
        }),
      );
    }
  });

  root.append(
    el("line", { x1: plot.x, y1: baseline, x2: plot.x + plot.w, y2: baseline, stroke: theme.axis }),
  );
  root.append(
    text(slide.axisLabel, plot.x + plot.w, baseline + L.axis * 3, {
      size: L.axis,
      fill: theme.muted,
      anchor: "end",
    }),
  );
}

/**
 * The same judgements, stacked one per row.
 *
 * Five cards side by side is five slivers on anything but a wide screen: the
 * labels truncate, the numbers are capped by a fifth of the width, and the
 * block ends up floating in a slide it cannot fill because every size it has
 * is bound by how narrow the card is. A scale of five reads down a page at
 * least as well as across one — it is how every photo tool in the world lists
 * ratings — and stacking is also the only thing that gives the glyph room:
 * five stars across a fifth of a slide are specks, and five stars across a
 * whole one are stars.
 */
function drawVerdictRows(root, plot, slide, theme, L) {
  const n = slide.cards.length;
  const gap = Math.max(8, L.value * 0.5);

  // The pile nobody judged is the biggest number here and the least
  // interesting, so its row is shorter than the others rather than equal.
  const REST = 0.72;
  const unit = (plot.h - gap * n) / (n + REST);
  const rowH = unit;
  const restH = unit * REST;

  const widest = Math.max(
    ...slide.cards.map((card) => (card.glyph.kind === "stars" ? card.glyph.count : 1)),
  );
  const span = widest + (widest - 1) * STAR_GAP;

  const px = (value) => Math.round(value);
  const pad = px(L.value * 0.8);
  // A third of the width for the glyphs, or half the row's height per star —
  // whichever runs out first.
  const glyph = px(Math.min(rowH * 0.52, (plot.w * 0.34) / span));
  const valueSize = px(Math.min(L.tileValue * 0.75, rowH * 0.46));
  const labelSize = px(Math.min(L.value, rowH * 0.28));
  const noteSize = px(Math.min(L.axis, rowH * 0.24));

  const glyphW = glyph * span;
  const valueW = Math.max(...slide.cards.map((card) => measure(card.value, valueSize, 600)));

  const valueRight = plot.x + pad + glyphW + pad + valueW;
  const textX = valueRight + pad;
  const textW = Math.max(40, plot.x + plot.w - pad - textX);

  slide.cards.forEach((card, i) => {
    const y = plot.y + i * (rowH + gap);
    const mid = y + rowH / 2;
    const colour = card.glyph.kind === "thumb" && !card.glyph.up ? theme.series[7] : theme.series[0];

    root.append(
      titled(
        el("rect", {
          x: plot.x,
          y,
          width: plot.w,
          height: rowH,
          rx: 14,
          fill: theme.plane,
          stroke: theme.grid,
        }),
        `${card.label}: ${card.value} — ${card.note}`,
      ),
    );

    // Left-aligned, not centred in the column: the row of stars is then a bar
    // whose length is the rating, and one star no longer floats in the middle
    // of a space five of them are about to fill.
    if (card.glyph.kind === "stars") {
      const count = card.glyph.count;
      const width = glyph * (count + (count - 1) * STAR_GAP);
      starRow(root, plot.x + pad + width / 2, mid - glyph / 2, glyph, count, colour);
    } else {
      thumb(root, plot.x + pad, mid - glyph / 2, glyph, card.glyph.up, colour);
    }

    root.append(
      text(card.value, valueRight, mid + valueSize * 0.36, {
        size: valueSize,
        weight: 600,
        fill: colour,
        anchor: "end",
      }),
    );
    root.append(
      text(ellipsize(card.label, textW, labelSize, 600), textX, mid - noteSize * 0.55, {
        size: labelSize,
        weight: 600,
        fill: theme.ink,
      }),
    );
    root.append(
      text(ellipsize(card.note, textW, noteSize), textX, mid - noteSize * 0.55 + noteSize * 1.5, {
        size: noteSize,
        fill: theme.muted,
      }),
    );
  });

  // The undecided, underneath, in neutral ink: no judgement was ever made.
  const restY = plot.y + n * (rowH + gap);
  const restMid = restY + restH / 2;
  const restValue = px(Math.min(valueSize, restH * 0.5));
  const restLabel = px(Math.min(labelSize, restH * 0.3));
  const restNote = px(Math.min(noteSize, restH * 0.26));

  root.append(
    titled(
      el("rect", {
        x: plot.x,
        y: restY,
        width: plot.w,
        height: restH,
        rx: 14,
        fill: theme.plane,
        stroke: theme.grid,
      }),
      `${slide.rest.label}: ${slide.rest.value} — ${slide.rest.note}`,
    ),
  );
  root.append(
    text(slide.rest.value, valueRight, restMid + restValue * 0.36, {
      size: restValue,
      weight: 600,
      fill: theme.ink,
      anchor: "end",
    }),
  );
  root.append(
    text(ellipsize(slide.rest.label, textW, restLabel, 600), textX, restMid - restNote * 0.55, {
      size: restLabel,
      weight: 600,
      fill: theme.ink2,
    }),
  );
  root.append(
    text(ellipsize(slide.rest.note, textW, restNote), textX, restMid - restNote * 0.55 + restNote * 1.5, {
      size: restNote,
      fill: theme.muted,
    }),
  );
}

/**
 * One five-pointed star, drawn rather than typed.
 *
 * The export serialises this SVG and rasterises it through an `<img>`, where a
 * `★` renders in whatever font that path happens to find and an emoji star may
 * not render at all. A polygon in slide coordinates always arrives.
 *
 * A `<polygon>` and not a `<path>` so the frame check can read it: `points` is
 * a flat list of x,y pairs, which is exactly what that test knows how to parse,
 * and a `d` string is not.
 */
function star(root, x, y, size, fill) {
  const r = size / 2;
  const cx = x + r;
  const cy = y + r;
  // The inner radius a pentagram makes on its own. Larger and it is a flower,
  // smaller and it is a throwing blade.
  const inner = r * 0.382;

  const points = [];
  for (let i = 0; i < 10; i++) {
    const radius = i % 2 === 0 ? r : inner;
    const angle = -Math.PI / 2 + (i * Math.PI) / 5;
    points.push(`${(cx + radius * Math.cos(angle)).toFixed(2)},${(cy + radius * Math.sin(angle)).toFixed(2)}`);
  }

  root.append(el("polygon", { points: points.join(" "), fill }));
}

/** `count` stars in a row, centred on `cx`, as one hoverable thing. */
function starRow(root, cx, y, size, count, fill, label) {
  const gap = size * STAR_GAP;
  const width = count * size + (count - 1) * gap;
  const row = el("g", {});

  for (let i = 0; i < count; i++) star(row, cx - width / 2 + i * (size + gap), y, size, fill);
  root.append(label ? titled(row, label) : row);
}

/** The space between two stars, as a fraction of one. Also sizes the row. */
const STAR_GAP = 0.16;

/**
 * A thumb, up or down.
 *
 * Drawn in slide coordinates rather than as a transformed group, on purpose:
 * `test/render.test.ts` checks every x and y it can see against the frame, and
 * a transform would hide the real position from it. Turning the thumb over is a
 * flip of the unit v axis, which is exactly how the two gestures differ.
 */
function thumb(root, x, y, size, up, fill, label) {
  const s = size / 24;
  const px = (u) => x + u * s;
  const py = (v) => y + (up ? v : 24 - v) * s;

  const block = (u0, v0, u1, v1, r) => {
    const top = Math.min(py(v0), py(v1));
    return el("rect", {
      x: px(u0),
      y: top,
      width: (u1 - u0) * s,
      height: Math.abs(py(v1) - py(v0)),
      rx: r * s,
      fill,
    });
  };

  const hand = el("g", {});
  // The cuff, the fist, and the thumb itself. Three shapes rather than one
  // outline: a flat icon reads at 40px, and an outline does not.
  hand.append(block(1.5, 10.5, 6.2, 22.5, 1.3));
  hand.append(block(7.6, 10.5, 21.2, 22.5, 2.4));
  hand.append(
    el("path", {
      d:
        `M${px(9.6)} ${py(13)}` +
        `L${px(10.3)} ${py(6.4)}` +
        `C${px(10.5)} ${py(3.2)} ${px(14.6)} ${py(3.2)} ${px(14.6)} ${py(6.6)}` +
        `L${px(14.6)} ${py(13)}Z`,
      fill,
    }),
  );

  root.append(label ? titled(hand, label) : hand);
}

/**
 * Two judgements and the pile nobody judged.
 *
 * Culling is not a distribution: nobody needs to measure a pick against an
 * axis, they need to see which way the library went. So the two verdicts are
 * cards with the gesture that made them, and the frames that never got a verdict
 * sit underneath in a card of their own — the biggest number of the three, and
 * the one that would have flattened a chart into a single spike.
 */
function drawVerdict(root, plot, slide, theme, L) {
  // Two judgements are a pair and belong side by side. More than two is a
  // scale, and a scale stacks — see `drawVerdictRows`.
  if (slide.cards.length > 2) return drawVerdictRows(root, plot, slide, theme, L);

  const gap = Math.max(12, L.value * 0.7);
  const cardW = (plot.w - gap * (slide.cards.length - 1)) / slide.cards.length;

  /**
   * How many glyphs the widest card holds, which sets the size of every glyph.
   *
   * One star has to be one size across the whole row or the cards stop being a
   * scale, and the cards have to be one height or they stop being a row. Both
   * fall out of sizing the glyph against the busiest card. A thumb is one
   * glyph, so this leaves the two-card slide exactly as it was.
   */
  const widest = Math.max(
    ...slide.cards.map((card) => (card.glyph.kind === "stars" ? card.glyph.count : 1)),
  );
  const span = widest + (widest - 1) * STAR_GAP;

  /**
   * The cards are sized to their contents, then grown or shrunk once to use the
   * height they have been given, then set in the middle of it.
   *
   * Both halves of that matter. A card stretched to fill a story is mostly
   * nothing and reads as a mistake; a card designed for a story is a stamp on a
   * 16:9 frame. So the type is designed against the card's *width*, scaled by
   * whatever the height allows, and capped again on width afterwards so a tall
   * slide cannot inflate a number past the card holding it.
   */
  const design = (scale) => {
    // Whole pixels: type is crisper for it, and a font size carrying sixteen
    // decimal places is a measurement nobody can reason about.
    const px = (value) => Math.round(value);
    const glyph = px(
      Math.min(cardW * 0.26 * scale, cardW * 0.4, (cardW - L.tiny * 2) / span),
    );
    const valueSize = px(Math.min(Math.min(L.tileValue, cardW * 0.26) * scale, cardW * 0.32));
    const labelSize = px(Math.min(L.value * scale, L.value * 1.6));
    const noteSize = px(Math.min(L.axis * scale, L.axis * 1.5));
    const padY = px(Math.max(L.value, glyph * 0.45) * scale);
    // The pile nobody judged is the biggest of the three numbers and the least
    // interesting, so it is set below the verdicts rather than above them.
    const restValue = px(Math.min(valueSize * 0.8, cardW * 0.3));
    const restLabel = px(Math.min(labelSize, restValue * 0.42));
    const restNote = px(Math.min(noteSize, restValue * 0.34));

    const cardH = glyph + valueSize * 0.95 + labelSize * 1.6 + noteSize * 1.6 + padY * 2;
    const restH =
      Math.max(restValue * 1.15, restLabel * 1.5 + restNote * 1.5) + L.value * 1.1 * scale;

    return {
      glyph, valueSize, labelSize, noteSize, padY,
      restValue, restLabel, restNote,
      cardH, restH, total: cardH + gap + restH,
    };
  };

  // Grown at most to a card that is half the slide: past that the numbers stop
  // being a fact and start being a poster.
  let box = design(Math.min(plot.h / design(1).total, 1.8));
  // The width caps can leave the block shorter than asked for, never taller —
  // but a second pass costs nothing and guarantees it fits whatever the shape.
  if (box.total > plot.h) box = design((plot.h / box.total) * Math.min(plot.h / design(1).total, 1.8));

  const { glyph, valueSize, labelSize, noteSize, padY, restValue, restLabel, restNote, cardH, restH } = box;
  const top = plot.y + Math.max(0, (plot.h - (cardH + gap + restH)) / 2);

  /**
   * Blue for a keeper and red for a reject — the same two the streak wall uses
   * for a day out and a day of silence. Never the only thing saying which is
   * which: each card carries the gesture and the word as well.
   *
   * Stars take the one colour at full strength on every card. The obvious idea
   * is the heat ramp stepping up with the rating, and it does not survive
   * contact with a glyph: `ramp[0]` is a near-white wash meant for filling a
   * calendar square, and a one-star glyph drawn in it would be invisible on the
   * card behind it. The count is the scale here — five stars already read as
   * more than one — so the colour has nothing left to say.
   */
  const paint = (glyph) =>
    glyph.kind === "thumb" && !glyph.up ? theme.series[7] : theme.series[0];

  slide.cards.forEach((card, i) => {
    const x = plot.x + i * (cardW + gap);
    const cx = x + cardW / 2;
    const colour = paint(card.glyph);

    root.append(
      titled(
        el("rect", {
          x,
          y: top,
          width: cardW,
          height: cardH,
          rx: 14,
          fill: theme.plane,
          stroke: theme.grid,
        }),
        `${card.label}: ${card.value} — ${card.note}`,
      ),
    );

    if (card.glyph.kind === "thumb") {
      thumb(root, cx - glyph / 2, top + padY, glyph, card.glyph.up, colour, `${card.label}: ${card.value}`);
    } else {
      starRow(root, cx, top + padY, glyph, card.glyph.count, colour, `${card.label}: ${card.value}`);
    }

    const valueY = top + padY + glyph + valueSize * 0.95;
    root.append(
      text(card.value, cx, valueY, { size: valueSize, weight: 600, fill: colour, anchor: "middle" }),
    );
    root.append(
      text(ellipsize(card.label, cardW - L.value, labelSize), cx, valueY + labelSize * 1.6, {
        size: labelSize,
        weight: 600,
        fill: theme.ink,
        anchor: "middle",
      }),
    );
    root.append(
      text(
        ellipsize(card.note, cardW - L.value, noteSize),
        cx,
        valueY + labelSize * 1.6 + noteSize * 1.6,
        { size: noteSize, fill: theme.muted, anchor: "middle" },
      ),
    );
  });

  // The undecided, underneath. Neutral ink rather than either verdict colour,
  // because that is exactly what these are: no judgement was ever made.
  const restY = top + cardH + gap;
  const restMid = restY + restH / 2;
  const numberW = measure(slide.rest.value, restValue, 600);
  const textX = plot.x + L.value * 1.6 + numberW;
  const textW = Math.max(40, plot.x + plot.w - L.value - textX);

  root.append(
    titled(
      el("rect", {
        x: plot.x,
        y: restY,
        width: plot.w,
        height: restH,
        rx: 14,
        fill: theme.plane,
        stroke: theme.grid,
      }),
      `${slide.rest.label}: ${slide.rest.value} — ${slide.rest.note}`,
    ),
  );

  root.append(
    text(slide.rest.value, plot.x + L.value * 0.8, restMid + restValue * 0.36, {
      size: restValue,
      weight: 600,
      fill: theme.ink,
    }),
  );
  root.append(
    text(ellipsize(slide.rest.label, textW, restLabel), textX, restMid - restNote * 0.55, {
      size: restLabel,
      weight: 600,
      fill: theme.ink2,
    }),
  );
  root.append(
    text(ellipsize(slide.rest.note, textW, restNote), textX, restMid - restNote * 0.55 + restNote * 1.5, {
      size: restNote,
      fill: theme.muted,
    }),
  );
}

/**
 * The wall as a calendar: a block per month, days under their weekdays.
 *
 * The packed wall is the most days per pixel and the least like anything anyone
 * has on a fridge. Here a week runs left to right and the weeks stack down, so
 * a column is a weekday all the way through the range — which is the only
 * layout where "I never shoot on a Tuesday" is a thing you can see rather than
 * a thing you have to be told.
 *
 * Monday first, like every other weekday axis in the deck. The blocks are all
 * six weeks tall whether the month needs six or four, because a grid of blocks
 * that each chose their own height would not line up, and lining up is the
 * entire point.
 */
function drawMonthBlocks(root, plot, slide, theme, L) {
  const counts = new Map(slide.days.map((entry) => [entry.day, entry.shots]));
  const marks = slide.marks ?? [];

  // Every month the range touches, first to last, including any it holds no
  // photographs in — a month you did not pick the camera up is the point.
  const months = [];
  {
    const first = toDate(slide.from);
    const last = toDate(slide.to);
    let year = first.getUTCFullYear();
    let month = first.getUTCMonth();
    while (year < last.getUTCFullYear() || (year === last.getUTCFullYear() && month <= last.getUTCMonth())) {
      months.push({ year, month });
      month += 1;
      if (month > 11) { month = 0; year += 1; }
    }
  }

  const legendH = stripLegendHeight(slide, theme, L, plot.w);
  const usable = plot.h - legendH;

  /**
   * How many blocks across, chosen by trying every count and keeping the one
   * that makes the day squares biggest — the same trick the calendar and the
   * packed wall use, for the same reason.
   */
  const arrange = () => {
    let best = { columns: 1, rows: months.length, cell: 0, labelH: 0 };
    for (let columns = 1; columns <= months.length; columns++) {
      const rows = Math.ceil(months.length / columns);
      const blockW = plot.w / columns;
      const blockH = usable / rows;
      const labelH = Math.min(L.tiny * 1.6, blockH * 0.2);
      // A block is seven days across and six weeks down, with a gutter of one
      // day's width between it and the next.
      const cell = Math.min(blockW / 7.8, (blockH - labelH) / 6.5);
      if (cell > best.cell) best = { columns, rows, cell, labelH };
    }
    return best;
  };

  const { columns, rows, cell, labelH } = arrange();
  const size = Math.max(1, cell - (cell > 5 ? 1.5 : 0.4));
  const blockW = 7 * cell;
  const blockH = 6 * cell + labelH;
  const gapX = (plot.w - columns * blockW) / Math.max(1, columns);
  const gapY = Math.max(0, (usable - rows * blockH) / Math.max(1, rows));

  const originOf = (index) => ({
    x: plot.x + (index % columns) * (blockW + gapX) + gapX / 2,
    y: plot.y + Math.floor(index / columns) * (blockH + gapY) + gapY / 2,
  });

  const within = (span, key) => span && key >= span.from && key <= span.to;
  const inside = (span, key) => span && key > span.from && key < span.to;

  /** Where a day sits, or null when it is not in a month being drawn. */
  const locate = (day) => {
    const date = toDate(day);
    const index = months.findIndex(
      (m) => m.year === date.getUTCFullYear() && m.month === date.getUTCMonth(),
    );
    if (index < 0) return null;

    const origin = originOf(index);
    const lead = (new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)).getUTCDay() + 6) % 7;
    const offset = lead + date.getUTCDate() - 1;
    return {
      x: origin.x + (offset % 7) * cell,
      y: origin.y + labelH + Math.floor(offset / 7) * cell,
      band: index,
    };
  };

  months.forEach((month, index) => {
    const origin = originOf(index);
    const days = new Date(Date.UTC(month.year, month.month + 1, 0)).getUTCDate();
    const lead = (new Date(Date.UTC(month.year, month.month, 1)).getUTCDay() + 6) % 7;

    root.append(
      text(
        `${MONTH_SHORT[month.month]}${month.month === 0 || index === 0 ? ` ${month.year}` : ""}`,
        origin.x,
        origin.y + labelH * 0.8,
        { size: Math.max(8, Math.min(L.tiny, labelH * 0.9)), fill: theme.muted },
      ),
    );

    for (let d = 1; d <= days; d++) {
      const key = month.year * 10000 + (month.month + 1) * 100 + d;
      const offset = lead + d - 1;
      const x = origin.x + (offset % 7) * cell;
      const y = origin.y + labelH + Math.floor(offset / 7) * cell;

      if (key < slide.from || key > slide.to) {
        // In the month but outside the range — drawn hollow, the same as the
        // part-weeks at either end of the packed wall, so a range that starts
        // on the 12th does not look like a fortnight nobody shot.
        root.append(
          el("rect", {
            x, y, width: size, height: size,
            rx: Math.min(2, size / 3),
            fill: theme.surface,
            stroke: theme.blank,
          }),
        );
        continue;
      }

      const value = counts.get(key) ?? 0;
      let fill = theme.blank;
      let what = "nothing";
      if (value === 0 && inside(slide.gap, key)) {
        fill = theme.series[7];
        what = "the longest quiet spell";
      } else if (value > 0 && within(slide.streak, key)) {
        fill = mix(theme.series[0], theme.surface, 0.45);
        what = `${fmt(value)} — the longest run`;
      } else if (value > 0) {
        fill = theme.series[0];
        what = fmt(value);
      }

      root.append(
        titled(
          el("rect", { x, y, width: size, height: size, rx: Math.min(2, size / 3), fill }),
          `${d} ${MONTH_SHORT[month.month]} ${month.year} — ${what}`,
        ),
      );
    }
  });

  // Milestones are a ring on the day and nothing more here: the strip above each
  // block already carries the month's own name, and a label written over that
  // would cost the reader the thing that makes this layout findable. The hover
  // still says what happened, as it does on a four-pixel square anywhere else.
  for (const mark of marks) {
    const at = locate(mark.day);
    if (!at) continue;
    root.append(
      titled(
        el("rect", {
          x: at.x,
          y: at.y,
          width: size,
          height: size,
          rx: Math.min(2, size / 3),
          fill: "none",
          stroke: theme.ink,
          "stroke-width": Math.max(1, Math.min(2, size * 0.18)),
        }),
        mark.full,
      ),
    );
  }

  stripLegend(root, plot, slide, theme, L);
}

/**
 * Every day in the range as a square, a week to a column.
 *
 * The calendar answers "when"; this answers "how steadily". A day is a day
 * whether it held four frames or four hundred — the question here is whether
 * the camera came out at all — so the fill is presence, not volume, and the two
 * spans worth naming carry their own colours: the longest run and the longest
 * silence.
 *
 * Multi-year libraries would be four hundred columns of two pixels, so the
 * weeks wrap into as many stacked bands as make the squares biggest, the same
 * trick the month grid uses. Every day in the period is drawn either way.
 */
function drawStrip(root, plot, slide, theme, L) {
  if (slide.layout === "months") return drawMonthBlocks(root, plot, slide, theme, L);

  const counts = new Map(slide.days.map((entry) => [entry.day, entry.shots]));
  const years = slide.years ?? [];

  const legendH = stripLegendHeight(slide, theme, L, plot.w);
  const usable = plot.h - legendH;

  // One row of weeks per year lines the years up under each other; packed wraps
  // the whole range into as many rows as make the squares biggest, which is
  // what fills the slide. Packed is the default for that reason.
  const rows =
    slide.layout === "years" && years.length > 1
      ? years.map((year) => ({ label: year.label, from: year.from, to: year.to }))
      : [{ label: "", from: slide.from, to: slide.to }];

  const weeksIn = (row) => {
    const first = toDate(row.from);
    const days = Math.round((toDate(row.to).getTime() - first.getTime()) / 86400000) + 1;
    return Math.ceil((((first.getUTCDay() + 6) % 7) + days) / 7);
  };

  // Packed picks its own number of bands; a row per year is one band each.
  const layout = rows.length > 1 ? { bands: rows.length, perBand: 1 } : packing(weeksIn(rows[0]), usable);

  function packing(weeks, height) {
    let best = { bands: 1, perBand: weeks, cell: 0 };
    for (let bands = 1; bands <= Math.min(10, weeks); bands++) {
      const perBand = Math.ceil(weeks / bands);
      const perRow = height / bands;
      const cell = Math.min(plot.w / perBand, (perRow - perRow * 0.26) / 7);
      if (cell > best.cell) best = { bands, perBand, cell };
    }
    return best;
  }

  const marks = slide.marks ?? [];
  const widest = rows.length > 1 ? Math.max(...rows.map(weeksIn), 1) : layout.perBand;
  const perRow = usable / (rows.length > 1 ? rows.length : layout.bands);
  // The strip above each band carries the year labels and the milestones; a
  // wall with neither gives the space back to the squares.
  const labelH =
    rows.some((row) => row.label !== "") || years.length > 1 || marks.length > 0
      ? Math.min(L.tiny * 1.7, perRow * 0.18)
      : 0;
  const gap = Math.min(L.tiny * 0.9, perRow * 0.08);

  const cell = Math.max(2, Math.min(plot.w / widest, (perRow - labelH - gap) / 7));
  const size = Math.max(1, cell - (cell > 5 ? 1.5 : 0.4));
  const bandH = 7 * cell + labelH + gap;
  const totalBands = rows.length > 1 ? rows.length : layout.bands;

  const top0 = plot.y + Math.max(0, (usable - totalBands * bandH) / 2);
  const left0 = plot.x + Math.max(0, (plot.w - widest * cell) / 2);
  const topOf = (band) => top0 + band * bandH + labelH;

  const within = (span, key) => span && key >= span.from && key <= span.to;
  // A quiet spell is bounded by the two days either side of it, and those two
  // are days the camera did come out — the silence is what lies between them.
  const inside = (span, key) => span && key > span.from && key < span.to;

  /** One square: the day, or a hollow box where the range has not started. */
  const square = (x, y, key, date, inRange) => {
    if (!inRange) {
      // Drawn rather than skipped, so a part-week at either end reads as "not
      // in this range" instead of as a year that came out ragged.
      root.append(
        el("rect", {
          x,
          y,
          width: size,
          height: size,
          rx: Math.min(2, size / 3),
          fill: theme.surface,
          stroke: theme.blank,
        }),
      );
      return;
    }

    const value = counts.get(key) ?? 0;
    let fill = theme.blank;
    let what = "nothing";
    if (value === 0 && inside(slide.gap, key)) {
      fill = theme.series[7];
      what = "the longest quiet spell";
    } else if (value > 0 && within(slide.streak, key)) {
      fill = mix(theme.series[0], theme.surface, 0.45);
      what = `${fmt(value)} — the longest run`;
    } else if (value > 0) {
      fill = theme.series[0];
      what = fmt(value);
    }

    root.append(
      titled(
        el("rect", { x, y, width: size, height: size, rx: Math.min(2, size / 3), fill }),
        `${date.getUTCDate()} ${MONTH_SHORT[date.getUTCMonth()]} ${date.getUTCFullYear()} — ${what}`,
      ),
    );
  };

  /**
   * A milestone on the wall: the day itself ringed, and named above its column
   * where the label strip is not already spoken for.
   *
   * The ring is drawn on the square rather than around it — a day here can be
   * four pixels across, and an outline that grew by two would swallow its
   * neighbours. Whatever the size, the hover title says what happened.
   */
  const markDays = (locate, claimed) => {
    const labelSize = Math.min(L.tiny, Math.max(9, labelH * 0.85));

    for (const mark of marks) {
      const at = locate(mark.day);
      if (!at) continue;

      root.append(
        titled(
          el("rect", {
            x: at.x,
            y: at.y,
            width: size,
            height: size,
            rx: Math.min(2, size / 3),
            fill: "none",
            stroke: theme.ink,
            "stroke-width": Math.max(1, Math.min(2, size * 0.18)),
          }),
          mark.full,
        ),
      );

      if (labelH === 0) continue;
      const edge = claimed.get(at.band) ?? -Infinity;
      if (at.x < edge) continue;
      claimed.set(at.band, at.x + measure(mark.label, labelSize) + labelSize * 0.8);

      root.append(
        text(mark.label, at.x, topOf(at.band) - gap * 0.6, { size: labelSize, fill: theme.ink2 }),
      );
    }
  };

  if (rows.length > 1) {
    rows.forEach((row, index) => {
      const first = toDate(row.from);
      const lead = (first.getUTCDay() + 6) % 7;
      const top = topOf(index);

      root.append(
        text(row.label, left0, top - gap * 0.6, {
          size: Math.min(L.tiny, labelH * 0.85),
          fill: theme.muted,
        }),
      );

      for (let i = 0; i < weeksIn(row) * 7; i++) {
        const date = new Date(first.getTime() + (i - lead) * 86400000);
        const key = toKey(date);
        square(left0 + Math.floor(i / 7) * cell, top + (i % 7) * cell, key, date, key >= row.from && key <= row.to);
      }
    });

    // A row per year: the milestone's own year is the row it lands in.
    markDays((day) => {
      const index = rows.findIndex((row) => day >= row.from && day <= row.to);
      const row = rows[index];
      if (!row) return null;

      const first = toDate(row.from);
      const offset =
        Math.round((toDate(day).getTime() - first.getTime()) / 86400000) + ((first.getUTCDay() + 6) % 7);
      return {
        x: left0 + Math.floor(offset / 7) * cell,
        y: topOf(index) + (offset % 7) * cell,
        band: index,
      };
    }, new Map(rows.map((_, index) => [index, left0 + measure(rows[index]?.label ?? "", Math.min(L.tiny, Math.max(9, labelH * 0.85))) + L.tiny])));
  } else {
    const first = toDate(slide.from);
    const lead = (first.getUTCDay() + 6) % 7;
    const { perBand } = layout;

    for (let i = 0; i < layout.bands * perBand * 7; i++) {
      const week = Math.floor(i / 7);
      const band = Math.floor(week / perBand);
      if (band >= layout.bands) break;

      const date = new Date(first.getTime() + (i - lead) * 86400000);
      const key = toKey(date);
      square(
        left0 + (week - band * perBand) * cell,
        topOf(band) + (i % 7) * cell,
        key,
        date,
        key >= slide.from && key <= slide.to,
      );
    }

    // Where each year begins, written above the wall at the week it starts.
    // The years are labels here rather than rows — the same information, at the
    // size the packed layout buys.
    //
    // Years claim their space first and milestones fill what is left: on a wall
    // of six years, knowing which year you are looking at comes before knowing
    // which week a lens arrived.
    const claimed = new Map();
    for (const year of years) {
      const offset = Math.round((toDate(year.from).getTime() - first.getTime()) / 86400000) + lead;
      const week = Math.floor(offset / 7);
      const band = Math.floor(week / perBand);
      if (band >= layout.bands) continue;

      const size2 = Math.min(L.tiny, Math.max(9, labelH * 0.85));
      const x = left0 + (week - band * perBand) * cell;
      const edge = claimed.get(band) ?? -Infinity;
      if (x < edge) continue;
      claimed.set(band, x + measure(year.label, size2) + size2 * 0.8);

      root.append(text(year.label, x, topOf(band) - gap * 0.6, { size: size2, fill: theme.muted }));
    }

    markDays((day) => {
      const offset = Math.round((toDate(day).getTime() - first.getTime()) / 86400000) + lead;
      if (offset < 0) return null;
      const week = Math.floor(offset / 7);
      const band = Math.floor(week / perBand);
      if (band >= layout.bands) return null;
      return { x: left0 + (week - band * perBand) * cell, y: topOf(band) + (offset % 7) * cell, band };
    }, claimed);
  }

  stripLegend(root, plot, slide, theme, L);
}

/**
 * What the four fills on a wall of days mean.
 *
 * One function because there are two walls now — packed and a block per month —
 * and a legend that disagreed with itself between two layouts of the same slide
 * would be worse than no legend at all.
 */
function stripKey(slide, theme) {
  return [
    { label: "You shot", colour: theme.series[0] },
    {
      label: slide.streak ? `Longest run · ${fmt(slide.streak.days)} days` : "Longest run",
      colour: mix(theme.series[0], theme.surface, 0.45),
    },
    {
      label: slide.gap ? `Longest quiet spell · ${fmt(slide.gap.days)} days` : "Longest quiet spell",
      colour: theme.series[7],
    },
    { label: "Nothing", colour: theme.blank },
  ];
}

/**
 * The room to leave for it.
 *
 * Four labels carrying day counts wrap onto a second line on a 9:16 frame, and
 * a wall that reserved one line's worth would then be drawn underneath them.
 */
function stripLegendHeight(slide, theme, L, width) {
  const lines = legendLines(stripKey(slide, theme), L, width).length;
  return L.axis * (2.8 + LEGEND_LINE * (lines - 1));
}

function stripLegend(root, plot, slide, theme, L) {
  drawKeyLegend(root, { x: plot.x, y: plot.y + plot.h - L.axis }, stripKey(slide, theme), theme, L, plot.w);
}

/** Twenty-four spokes: a day, read as a clock face. */
function drawClock(root, plot, slide, theme, L) {
  // The window the reader chose: real sunrise and sunset where they shoot, or
  // a fixed pair of hours.
  const sunrise = Number.isFinite(slide.sunrise) ? slide.sunrise : 6;
  const sunset = Number.isFinite(slide.sunset) ? slide.sunset : 18;
  const cx = plot.x + plot.w / 2;
  const cy = plot.y + plot.h / 2;
  // No fixed ceiling: the circle is as big as the shorter side allows, which is
  // the difference between a clock face and a coin in the middle of a story.
  const outer = Math.max(80, Math.min(plot.h / 2 - L.axis * 2.6, plot.w / 2 - L.axis * 2.6));
  const inner = outer * 0.34;
  const max = Math.max(...slide.hours, 1);
  const peak = slide.hours.indexOf(max);
  const thickness = Math.min(16, ((inner * 2 * Math.PI) / 24) * 0.75);

  for (const radius of [inner, outer]) {
    root.append(el("circle", { cx, cy, r: radius, fill: "none", stroke: theme.grid }));
  }

  slide.hours.forEach((value, hour) => {
    // Midnight at the top, noon at the bottom, like a watch face.
    const angle = (hour / 24) * Math.PI * 2 - Math.PI / 2;
    const length = (value / max) * (outer - inner);

    root.append(
      titled(
        el("line", {
          x1: cx + Math.cos(angle) * inner,
          y1: cy + Math.sin(angle) * inner,
          x2: cx + Math.cos(angle) * (inner + length),
          y2: cy + Math.sin(angle) * (inner + length),
          // Cool at midnight, warm at midday: the spoke says when as well as
          // how many, which is the whole point of a clock face.
          stroke: hourColour(hour, theme, sunrise, sunset),
          "stroke-width": thickness,
          "stroke-linecap": "round",
          opacity: hour === peak ? 1 : 0.82,
        }),
        `${String(hour).padStart(2, "0")}:00 — ${fmt(value)}`,
      ),
    );

    if (hour % 3 === 0) {
      const labelRadius = outer + L.axis * 1.4;
      root.append(
        text(
          String(hour).padStart(2, "0"),
          cx + Math.cos(angle) * labelRadius,
          cy + Math.sin(angle) * labelRadius + L.axis * 0.35,
          {
            size: L.axis,
            fill: hour === peak ? theme.ink2 : theme.muted,
            anchor: "middle",
            weight: hour === peak ? 600 : 400,
          },
        ),
      );
    }
  });

  root.append(
    text(fmt(max), cx, cy, { size: L.subtitle * 1.15, weight: 600, fill: theme.ink, anchor: "middle" }),
  );
  root.append(
    text("busiest hour", cx, cy + L.tiny * 1.7, { size: L.tiny, fill: theme.muted, anchor: "middle" }),
  );

  drawClockLegend(root, plot, cy + outer + L.axis * 2.6, theme, L, sunrise, sunset);
}

/** The scale for the colour, since colour is carrying the time of day. */
function drawClockLegend(root, plot, y, theme, L, sunrise, sunset) {
  const width = Math.min(plot.w * 0.6, 420);
  const x = plot.x + (plot.w - width) / 2;
  const height = L.tiny * 0.9;
  if (y + height + L.tiny * 2 > plot.y + plot.h) return;

  // Twenty-four steps rather than a gradient: a gradient would need a def, and
  // a def does not survive being rasterised as an isolated image everywhere.
  for (let hour = 0; hour < 24; hour++) {
    root.append(
      el("rect", {
        x: x + (hour / 24) * width,
        y,
        width: width / 24 + 0.5,
        height,
        fill: hourColour(hour, theme, sunrise, sunset),
      }),
    );
  }

  const label = (value, at, anchor) =>
    root.append(text(value, at, y + height + L.tiny * 1.4, { size: L.tiny, fill: theme.muted, anchor }));
  label("midnight", x, "start");
  label("midday", x + width / 2, "middle");
  label("midnight", x + width, "end");
}

const WEEKDAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/**
 * The week lying down, a day per row.
 *
 * Seven full day names down a margin instead of `Mon` `Tue` `Wed` under seven
 * columns — which is the trade: a row spells the day out and a column has to
 * abbreviate it. On a story the rows also stop seven columns being seven
 * slivers.
 */
function drawWeekAsRows(root, plot, slide, theme, L) {
  const names = slide.labels?.length === 7 ? slide.labels : WEEKDAY_NAMES;
  const weekend = new Set(slide.weekend ?? []);

  const max = Math.max(...slide.days, 1);
  const busiest = slide.days.indexOf(max);
  const legendH = weekend.size > 0 ? L.axis * 2.6 : 0;

  const height = plot.h - legendH;
  const rowH = height / 7;
  const labelSize = Math.max(9, Math.min(L.label, rowH / 1.5));
  const gutter = Math.max(...names.map((name) => measure(name, labelSize, 600))) + labelSize * 0.8;

  const x0 = plot.x + gutter;
  const valueW = measure(fmt(max), L.value) + L.tiny;
  const width = Math.max(40, plot.w - gutter - valueW);
  const thickness = Math.max(3, Math.min(rowH - Math.max(3, rowH * 0.25), L.value * 1.8));

  slide.days.forEach((value, day) => {
    const y = plot.y + day * rowH;
    const barW = value > 0 ? Math.max(2, (value / max) * width) : 0;
    const colour = weekend.has(day) ? theme.series[1] : theme.series[0];

    if (barW > 0) {
      bar(
        root,
        x0,
        y + (rowH - thickness) / 2,
        barW,
        thickness,
        colour,
        `${names[day]}: ${fmt(value)}`,
        day === busiest ? 1 : 0.5,
      );
    }

    root.append(
      text(names[day], x0 - labelSize * 0.5, y + rowH / 2 + labelSize * 0.35, {
        size: labelSize,
        weight: day === busiest ? 600 : 400,
        fill: day === busiest ? theme.ink2 : theme.muted,
        anchor: "end",
      }),
    );
    root.append(
      text(fmt(value), x0 + barW + L.tiny * 0.6, y + rowH / 2 + L.value * 0.35, {
        size: Math.min(L.value, rowH * 0.6),
        weight: day === busiest ? 600 : 400,
        fill: day === busiest ? theme.ink : theme.muted,
      }),
    );
  });

  root.append(el("line", { x1: x0, y1: plot.y, x2: x0, y2: plot.y + height, stroke: theme.axis }));

  if (weekend.size > 0) {
    drawKeyLegend(
      root,
      { x: plot.x, y: plot.y + plot.h - L.axis },
      [
        { label: "The working week", colour: theme.series[0] },
        { label: "The weekend", colour: theme.series[1] },
      ],
      theme,
      L,
      plot.w,
    );
  }
}

/** Seven columns, Monday first. */
function drawWeek(root, plot, slide, theme, L) {
  if (slide.orientation === "rows") return drawWeekAsRows(root, plot, slide, theme, L);

  const names = slide.labels?.length === 7 ? slide.labels : WEEKDAY_NAMES;
  const weekend = new Set(slide.weekend ?? []);

  const max = Math.max(...slide.days, 1);
  const band = plot.w / 7;
  const thickness = Math.min(24, band * 0.45);
  // Two colours mean two things, so they are named under the chart.
  const legendH = weekend.size > 0 ? L.axis * 2.6 : 0;
  const baseline = plot.y + plot.h - L.label * 2 - legendH;
  const height = Math.max(40, baseline - plot.y - L.value * 2);
  const busiest = slide.days.indexOf(max);

  slide.days.forEach((value, day) => {
    const cx = plot.x + band * (day + 0.5);
    const barHeight = value > 0 ? Math.max(2, (value / max) * height) : 0;
    const colour = weekend.has(day) ? theme.series[1] : theme.series[0];

    if (barHeight > 0) {
      column(
        root,
        cx - thickness / 2,
        baseline,
        thickness,
        barHeight,
        colour,
        `${names[day]}: ${fmt(value)}`,
        day === busiest ? 1 : 0.5,
      );
    }
    root.append(
      text(fmt(value), cx, baseline - barHeight - L.value * 0.6, {
        size: L.value,
        weight: day === busiest ? 600 : 400,
        fill: day === busiest ? theme.ink : theme.muted,
        anchor: "middle",
      }),
    );
    root.append(
      text(names[day].slice(0, 3), cx, baseline + L.label * 1.4, {
        size: L.label * 0.85,
        fill: day === busiest ? theme.ink2 : theme.muted,
        anchor: "middle",
        weight: day === busiest ? 600 : 400,
      }),
    );
  });

  root.append(
    el("line", { x1: plot.x, y1: baseline, x2: plot.x + plot.w, y2: baseline, stroke: theme.axis }),
  );

  if (weekend.size > 0) {
    drawKeyLegend(
      root,
      { x: plot.x, y: plot.y + plot.h - L.axis },
      [
        { label: "The working week", colour: theme.series[0] },
        { label: "The weekend", colour: theme.series[1] },
      ],
      theme,
      L,
      plot.w,
    );
  }
}

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function rampStep(value, max) {
  const fraction = value / max;
  if (fraction <= 0.05) return 0;
  if (fraction <= 0.2) return 1;
  if (fraction <= 0.45) return 2;
  if (fraction <= 0.75) return 3;
  return 4;
}

const toDate = (day) =>
  new Date(Date.UTC(Math.floor(day / 10000), (Math.floor(day / 100) % 100) - 1, day % 100));

const toKey = (date) =>
  date.getUTCFullYear() * 10000 + (date.getUTCMonth() + 1) * 100 + date.getUTCDate();
/**
 * A calendar, drawn as a grid of months.
 *
 * The obvious layout — one long strip of weeks, GitHub-style — is what this
 * used to be, and it wasted a portrait frame: fifty-three columns of seven
 * squares is a shape that only fits a wide screen, and turning it on its side
 * gave a 190px-wide ribbon down the middle of a 1080px slide.
 *
 * Months tile instead. The grid is chosen by trying every column count and
 * keeping whichever gives the biggest day square, so the same code fills a
 * story, a square and a 16:9 slide without being told which it is drawing.
 *
 * Ranges longer than about a year never reach here — `stats/slides.ts` sends
 * those to the monthly columns instead — so a block per month is always a
 * sensible number of blocks.
 */
function drawCalendar(root, plot, slide, theme, L) {
  const counts = new Map(slide.days.map((entry) => [entry.day, entry.shots]));
  const max = Math.max(...slide.days.map((entry) => entry.shots), 1);

  const months = monthsBetween(slide.from, slide.to);
  const legendH = L.tiny * 3.4;
  const area = { x: plot.x, y: plot.y, w: plot.w, h: Math.max(80, plot.h - legendH) };
  const grid = fitMonthGrid(months.length, area, L);

  // Blocks are packed to the height they actually use and the whole grid is
  // centred in what is left. Spacing them by the height they were *allotted*
  // strands a single month at the top of a story with 400px of nothing under it.
  const blockContentH = grid.header + 6 * (grid.cell + grid.gap);
  const top = area.y + Math.max(0, (area.h - grid.rows * blockContentH) / 2);

  months.forEach((month, i) => {
    const x = area.x + (i % grid.columns) * grid.blockW;
    const y = top + Math.floor(i / grid.columns) * blockContentH;
    // The year is written on the first block and on each January, which is
    // where it changes — on every block it would be noise.
    drawMonthBlock(root, { x, y, ...grid }, { ...month, first: i === 0 }, counts, max, theme, L);
  });

  drawRampLegend(root, area.x, top + grid.rows * blockContentH + L.tiny * 0.8, max, theme, L);
}

/** Every month the range touches, oldest first. */
function monthsBetween(from, to) {
  const months = [];
  let year = Math.floor(from / 10000);
  let month = Math.floor(from / 100) % 100;
  const lastYear = Math.floor(to / 10000);
  const lastMonth = Math.floor(to / 100) % 100;

  while (year < lastYear || (year === lastYear && month <= lastMonth)) {
    months.push({ year, month });
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
    if (months.length > 24) break;
  }
  return months;
}

/**
 * Picks the column count that makes the day squares biggest.
 *
 * Trying them all is cheaper than reasoning about it, and it means a new format
 * needs no thought here: 12 months land as 3x4 in a story, 6x2 in 16:9.
 */
function fitMonthGrid(count, area, L) {
  const gap = 2;
  const header = L.axis * 1.5 + L.tiny * 1.6;
  let best = { columns: 1, rows: count, blockW: area.w, blockH: area.h / count, cell: 0, header, gap };

  for (let columns = 1; columns <= Math.min(6, count); columns++) {
    const rows = Math.ceil(count / columns);
    const blockW = area.w / columns;
    const blockH = area.h / rows;
    const cell = Math.min(
      (blockW - L.tiny) / 7 - gap,
      (blockH - header) / 6 - gap,
    );
    if (cell > best.cell) best = { columns, rows, blockW, blockH, cell, header, gap };
  }

  return best;
}

const WEEKDAY_INITIALS = ["M", "T", "W", "T", "F", "S", "S"];

function drawMonthBlock(root, box, month, counts, max, theme, L) {
  const { cell, gap, header } = box;
  const width = 7 * (cell + gap) - gap;

  root.append(
    text(
      `${MONTH_SHORT[month.month - 1]}${month.month === 1 || month.first ? ` ${month.year}` : ""}`,
      box.x,
      box.y + L.axis,
      { size: L.axis, weight: 600, fill: theme.ink2 },
    ),
  );

  if (cell >= 12) {
    WEEKDAY_INITIALS.forEach((initial, i) => {
      root.append(
        text(initial, box.x + i * (cell + gap) + cell / 2, box.y + L.axis * 1.5 + L.tiny, {
          size: L.tiny * 0.95,
          fill: theme.muted,
          anchor: "middle",
        }),
      );
    });
  }

  const top = box.y + header;
  const days = daysInMonth(month.year, month.month);
  // Monday first, so the weekend sits together at the end of each row.
  const offset = (new Date(Date.UTC(month.year, month.month - 1, 1)).getUTCDay() + 6) % 7;

  for (let day = 1; day <= days; day++) {
    const index = offset + day - 1;
    const value = counts.get(month.year * 10000 + month.month * 100 + day) ?? 0;

    root.append(
      titled(
        el("rect", {
          x: box.x + (index % 7) * (cell + gap),
          y: top + Math.floor(index / 7) * (cell + gap),
          width: cell,
          height: cell,
          rx: Math.min(3, cell / 5),
          fill: value === 0 ? theme.rampEmpty : theme.ramp[rampStep(value, max)],
        }),
        `${day} ${MONTH_SHORT[month.month - 1]} ${month.year} — ${fmt(value)}`,
      ),
    );
  }

  return width;
}

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** The scale, spelled out, wherever colour is carrying magnitude. */
function drawRampLegend(root, x, y, max, theme, L) {
  const swatch = L.tiny * 1.2;
  root.append(text("fewer", x, y + swatch * 0.85, { size: L.tiny, fill: theme.muted }));

  const start = x + measure("fewer", L.tiny) + 10;
  theme.ramp.forEach((colour, i) => {
    root.append(
      el("rect", {
        x: start + i * (swatch + 4),
        y,
        width: swatch,
        height: swatch,
        rx: 3,
        fill: colour,
      }),
    );
  });

  root.append(
    text(`more (up to ${fmt(max)} in a day)`, start + theme.ramp.length * (swatch + 4) + 8, y + swatch * 0.85, {
      size: L.tiny,
      fill: theme.muted,
    }),
  );
}
/**
 * Months down the page, a bar each.
 *
 * The long view of a library is dozens of months — ninety-odd for one reaching
 * back to 2018 — and as columns that is a picket fence with a label every
 * twelfth post, the years colliding at the foot of it. Turned on its side, each
 * month gets a row of its own, the years read down the margin with room to
 * spare, and a milestone has a strip of the slide to say what it was rather
 * than an eighteen-pixel slot shared with its neighbours.
 */
/**
 * The same months standing up, a column each.
 *
 * The shape a time series is normally drawn in, and the right one wherever
 * the range is short enough that a column is more than a few pixels wide.
 * Past that it becomes a picket fence with a label every twelfth post, which
 * is why the rows are the default — but on a 16:9 frame with two years in it
 * this is plainly the better read.
 */
function drawMonthColumns(root, plot, slide, theme, L) {
  const months = slide.months;
  if (months.length === 0) return;

  const max = Math.max(...months.map((entry) => entry.shots), 1);
  const ceiling = niceCeiling(max);
  const band = plot.w / months.length;
  const thickness = Math.min(24, Math.max(3, band - 6));
  const baseline = plot.y + plot.h - L.axis * 2.4;
  const markH = slide.marks?.length ? L.tiny * 1.9 : 0;
  const height = Math.max(40, baseline - plot.y - L.axis * 2 - markH);

  const gridY = baseline - height;
  root.append(el("line", { x1: plot.x, y1: gridY, x2: plot.x + plot.w, y2: gridY, stroke: theme.grid }));
  root.append(
    text(fmt(ceiling), plot.x + plot.w, gridY - L.axis * 0.5, {
      size: L.axis,
      fill: theme.muted,
      anchor: "end",
    }),
  );

  let lastYear = -1;
  let freeLabel = -Infinity;
  months.forEach((entry, i) => {
    const cx = plot.x + band * (i + 0.5);
    const barHeight = entry.shots > 0 ? Math.max(2, (entry.shots / ceiling) * height) : 0;
    const year = Math.floor(entry.ym / 100);

    if (barHeight > 0) {
      column(
        root,
        cx - thickness / 2,
        baseline,
        thickness,
        barHeight,
        theme.series[0],
        `${MONTH_SHORT[(entry.ym % 100) - 1]} ${year} — ${fmt(entry.shots)}`,
      );
    }

    // Only months holding photographs are bands, so two years can be one band
    // apart — a single frame in 2019 and another in 2020 wrote their labels on
    // top of each other, whichever way round the chart was drawn.
    if (year !== lastYear && cx - measure(String(year), L.axis) / 2 >= freeLabel) {
      lastYear = year;
      freeLabel = cx + measure(String(year), L.axis) / 2 + L.tiny;
      root.append(
        text(String(year), cx, baseline + L.axis * 1.6, {
          size: L.axis,
          fill: theme.muted,
          anchor: "middle",
        }),
      );
    }
  });

  root.append(
    el("line", { x1: plot.x, y1: baseline, x2: plot.x + plot.w, y2: baseline, stroke: theme.axis }),
  );

  drawMarks(
    root,
    { x: plot.x, y: gridY - markH, w: plot.w, h: height + markH },
    slide.marks,
    monthAxis(
      months.map((entry) => entry.ym),
      plot.x,
      band,
    ),
    theme,
    L,
    measure(fmt(ceiling), L.axis) + L.tiny,
  );
}

function drawMonths(root, plot, slide, theme, L) {
  const months = slide.months;
  if (months.length === 0) return;
  if (slide.orientation === "columns") return drawMonthColumns(root, plot, slide, theme, L);

  const max = Math.max(...months.map((entry) => entry.shots), 1);
  const ceiling = niceCeiling(max);
  const marks = slide.marks ?? [];

  const headH = L.axis * 2;
  const top = plot.y + headH;
  const rowH = (plot.h - headH) / months.length;

  // Type sized off the row it has to sit in, so ninety months and fifteen are
  // both legible rather than one of them being the size the other was drawn for.
  const labelSize = Math.max(9, Math.min(L.tiny, rowH / 1.2));
  const gutter = measure("2026", labelSize) + labelSize * 0.7;

  // A strip down the right for the milestone names, taken out of the bars
  // before they are drawn rather than written over them afterwards.
  const markSize = Math.max(9, Math.min(L.tiny, plot.h * 0.035));
  const markW =
    marks.length > 0
      ? Math.min(plot.w * 0.34, Math.max(...marks.map((mark) => measure(mark.label, markSize))) + markSize)
      : 0;

  const x0 = plot.x + gutter;
  const width = Math.max(40, plot.w - gutter - markW);
  const thickness = Math.max(1.5, Math.min(rowH - Math.max(1, rowH * 0.2), L.value * 1.4));

  // Two hairlines to read a length against, labelled once at the top.
  for (const fraction of [0.5, 1]) {
    const x = x0 + width * fraction;
    root.append(el("line", { x1: x, y1: top, x2: x, y2: top + rowH * months.length, stroke: theme.grid }));
    root.append(
      text(fmt(ceiling * fraction), x, plot.y + L.axis, { size: L.axis, fill: theme.muted, anchor: "middle" }),
    );
  }

  let lastYear = -1;
  const years = [];
  const names = [];

  months.forEach((entry, i) => {
    const y = top + i * rowH;
    const year = Math.floor(entry.ym / 100);
    const month = entry.ym % 100;
    const barW = entry.shots > 0 ? Math.max(2, (entry.shots / ceiling) * width) : 0;

    if (barW > 0) {
      bar(
        root,
        x0,
        y + (rowH - thickness) / 2,
        barW,
        thickness,
        theme.series[0],
        `${MONTH_SHORT[month - 1]} ${year} — ${fmt(entry.shots)}`,
      );
    }

    const turned = year !== lastYear;
    if (turned) lastYear = year;
    (turned ? years : names).push({ y: y + rowH / 2, label: turned ? String(year) : MONTH_SHORT[month - 1] });
  });

  /**
   * The margin, filled in priority order.
   *
   * Only months that hold photographs are rows here, so two years can be
   * neighbours — a library with one frame in 2019 and one in 2020 puts those
   * labels a row apart. The years go down first because they are what orients
   * the reader, and the month names take whatever gaps are left.
   */
  const placed = [];
  const claim = (y) => {
    if (placed.some((at) => Math.abs(at - y) < labelSize * 1.05)) return false;
    placed.push(y);
    return true;
  };

  for (const [entries, weight, fill] of [
    [years, 600, theme.ink2],
    [labelSize >= 10 ? names : [], 400, theme.muted],
  ]) {
    for (const entry of entries) {
      if (!claim(entry.y)) continue;
      root.append(
        text(entry.label, x0 - labelSize * 0.5, entry.y + labelSize * 0.35, {
          size: labelSize,
          weight,
          fill,
          anchor: "end",
        }),
      );
    }
  }

  root.append(el("line", { x1: x0, y1: top, x2: x0, y2: top + rowH * months.length, stroke: theme.axis }));

  /**
   * Milestones read across a row rather than down a column here, so the rule is
   * horizontal and the name sits at the end of it in its own strip — and a span
   * is the band between its two rows, exactly as it is on a time axis.
   *
   * Six weeks drawn as a single rule is the whole reason: this layout's unit is
   * the month, so a trip that crosses one is a trip whose mark says the wrong
   * thing. `monthRow` places a day *within* its month, so a fortnight that never
   * leaves one gets a band across part of a row rather than being rounded away —
   * which is the honest answer, and the same one the time axis gives.
   */
  const run = months.map((entry) => entry.ym);
  let free = -Infinity;
  for (const mark of [...marks].sort((a, b) => a.day - b.day)) {
    const row = monthEdge(run, mark.day);
    if (row === null) continue;
    const y = top + rowH * row;

    const end = mark.until === undefined ? null : monthEdge(run, mark.until);
    const wide = end !== null && end > row + 0.02;
    const bottom = wide ? top + rowH * end : y;

    if (wide) {
      root.append(
        titled(
          el("rect", { x: x0, y, width, height: bottom - y, fill: theme.ink2, opacity: 0.09 }),
          mark.full,
        ),
      );
    }

    for (const at of wide ? [y, bottom] : [y]) {
      root.append(
        titled(
          el("line", {
            x1: x0,
            y1: at,
            x2: x0 + width,
            y2: at,
            stroke: theme.ink2,
            "stroke-dasharray": "3 4",
            opacity: 0.5,
          }),
          mark.full,
        ),
      );
    }
    root.append(
      el("rect", { x: x0 + width - 1.5, y: y - 1.5, width: 3, height: 3, fill: theme.ink2, opacity: 0.7 }),
    );

    if (markW === 0 || y < free) continue;
    free = y + markSize * 1.2;
    root.append(
      text(ellipsize(mark.label, markW - markSize * 0.6, markSize), x0 + width + markSize * 0.5, y + markSize * 0.35, {
        size: markSize,
        fill: theme.ink2,
      }),
    );
  }
}

/**
 * The pooled tail is grey rather than a hue of its own: it is not an entity,
 * and spending a slot on it would push a real lens out. Everything else takes
 * its colour from the palette, which generates past its eighth slot.
 */
function stackColour(series, index, theme) {
  return series.label === "Everything else" ? theme.axis : seriesColour(index, theme);
}

/** Flows legend entries across as many rows as they need. */
function layoutLegend(items, width, L) {
  const entries = [];
  let x = 0;
  let row = 0;

  items.forEach((item) => {
    const label = ellipsize(item.label, width * (L.narrow ? 0.8 : 0.4), L.axis);
    const entryWidth = L.axis + measure(label, L.axis) + L.axis * 1.6;
    if (x > 0 && x + entryWidth > width) {
      row++;
      x = 0;
    }
    entries.push({ colour: item.colour, label, x, row });
    x += entryWidth;
  });

  return { entries, rows: row + 1 };
}

/** Stacked columns: which lens was on the camera, month by month. */
function drawStack(root, plot, slide, theme, L) {
  const { months, series } = slide;
  if (months.length === 0 || series.length === 0) return;

  const totals = months.map((_, i) => series.reduce((sum, s) => sum + (s.values[i] ?? 0), 0));
  const ceiling = niceCeiling(Math.max(...totals, 1));

  const band = plot.w / months.length;
  const thickness = Math.min(24, Math.max(4, band - 8));
  // The legend is laid out first: it is the part that must not be squeezed. A
  // converted lens is a shade of its own colour rather than a colour of its
  // own, so it takes one entry at the end however many lenses have one.
  const converted = series.some((s) => (s.converted ?? []).some((n) => n > 0));
  const entries = [
    ...series.map((s, index) => ({ label: s.label, colour: stackColour(s, index, theme) })),
    ...(converted
      ? [{ label: "with a teleconverter", colour: mix(theme.series[0], theme.surface, 0.55) }]
      : []),
  ];

  // Twenty-five lenses need a legend of their own size: past eight series the
  // colours alone cannot be told apart, so the names are the chart's spine and
  // dropping them is not an option — they get smaller instead.
  let legendL = L;
  let legend = layoutLegend(entries, plot.w, legendL);
  for (const scale of [0.85, 0.72, 0.6]) {
    if (legend.rows * legendL.axis * 1.9 <= plot.h * 0.3) break;
    legendL = { ...L, axis: L.axis * scale };
    legend = layoutLegend(entries, plot.w, legendL);
  }
  const legendH = legend.rows * legendL.axis * 1.9;
  const baseline = plot.y + plot.h - legendH - L.axis * 3;
  // Room above the columns for the milestone labels, taken from the chart
  // rather than found afterwards: a label squeezed into whatever was left is
  // the bug the keepers card was written to stop repeating.
  const markH = slide.marks?.length ? L.tiny * 1.9 : 0;
  const height = Math.max(40, baseline - plot.y - markH);
  const stride = Math.max(1, Math.ceil(months.length / (L.narrow ? 6 : 12)));

  months.forEach((ym, i) => {
    const cx = plot.x + band * (i + 0.5);
    let top = baseline;

    series.forEach((s, index) => {
      const value = s.values[i] ?? 0;
      if (value <= 0) return;
      const segment = (value / ceiling) * height;
      top -= segment;

      const colour = stackColour(s, index, theme);
      const when = `${MONTH_SHORT[(ym % 100) - 1]} ${Math.floor(ym / 100)}`;
      const drawn = Math.max(1, segment - 2);

      // A 2px gap in the surface colour is what separates the segments.
      root.append(
        titled(
          el("rect", { x: cx - thickness / 2, y: top, width: thickness, height: drawn, fill: colour }),
          `${when} · ${s.label}: ${fmt(value)}`,
        ),
      );

      // Frames shot through a converter sit at the top of their own lens
      // segment, in a lighter step of the same colour — the same idea as the
      // lens slide, kept to one shade because a month column is 20px wide.
      const converted = s.converted?.[i] ?? 0;
      if (converted > 0) {
        const part = Math.min(drawn, (converted / value) * drawn);
        if (part >= 1) {
          root.append(
            titled(
              el("rect", {
                x: cx - thickness / 2,
                y: top,
                width: thickness,
                height: part,
                fill: mix(colour, theme.surface, 0.55),
              }),
              `${when} · ${s.label} with a converter: ${fmt(converted)}`,
            ),
          );
        }
      }
    });

    if (i % stride === 0) {
      root.append(
        text(MONTH_SHORT[(ym % 100) - 1], cx, baseline + L.axis * 1.4, {
          size: L.tiny,
          fill: theme.muted,
          anchor: "middle",
        }),
      );
      root.append(
        text(String(Math.floor(ym / 100)), cx, baseline + L.axis * 2.5, {
          size: L.tiny,
          fill: theme.muted,
          anchor: "middle",
        }),
      );
    }
  });

  root.append(
    el("line", { x1: plot.x, y1: baseline, x2: plot.x + plot.w, y2: baseline, stroke: theme.axis }),
  );

  // Drawn over the columns rather than under them: a series appearing in March
  // is only explained by the mark if the mark is still visible in March.
  drawMarks(
    root,
    { x: plot.x, y: baseline - height - markH, w: plot.w, h: height + markH },
    slide.marks,
    monthAxis(months, plot.x, band),
    theme,
    L,
  );

  // A legend is not optional once there is more than one series.
  const legendTop = plot.y + plot.h - legendH + legendL.axis;
  legend.entries.forEach((entry) => {
    const y = legendTop + entry.row * legendL.axis * 1.9;
    root.append(
      el("rect", {
        x: plot.x + entry.x,
        y: y - legendL.axis * 0.75,
        width: legendL.axis * 0.7,
        height: legendL.axis * 0.7,
        rx: 3,
        fill: entry.colour,
      }),
    );
    root.append(
      text(entry.label, plot.x + entry.x + legendL.axis, y, { size: legendL.axis, fill: theme.ink2 }),
    );
  });
}

/**
 * Latitude and longitude, plotted flat, framed on the photographs.
 *
 * A world map is the wrong frame for almost every library: draw one and a
 * year of shooting within fifty miles of home is four dots in the middle of an
 * empty rectangle. So the box is fitted to the data — padded, squared off to
 * the shape of the slide, and never smaller than a couple of degrees so a
 * single afternoon does not zoom to street level and imply a precision the
 * rounding does not have.
 *
 * The graticule is what keeps it honest: no coastline is drawn, because none is
 * known, so the grid and its labels are the only claim about where this is.
 */
function drawMap(root, plot, slide, theme, L) {
  const labelBand = L.tiny * 2.6;
  const box = { x: plot.x, y: plot.y, w: plot.w, h: Math.max(120, plot.h - labelBand) };
  const view = fitBounds(slide.points, box.w / box.h);

  const project = (lat, lon) => ({
    x: box.x + ((lon - view.west) / (view.east - view.west)) * box.w,
    y: box.y + ((view.north - lat) / (view.north - view.south)) * box.h,
  });

  root.append(el("rect", { x: box.x, y: box.y, width: box.w, height: box.h, fill: theme.plane, rx: 8 }));

  const step = graticuleStep(Math.max(view.east - view.west, view.north - view.south));
  for (let lon = Math.ceil(view.west / step) * step; lon <= view.east; lon += step) {
    const { x } = project(0, lon);
    root.append(el("line", { x1: x, y1: box.y, x2: x, y2: box.y + box.h, stroke: theme.grid }));
    root.append(
      text(formatLon(lon), x, box.y + box.h + L.tiny * 1.6, {
        size: L.tiny,
        fill: theme.muted,
        anchor: "middle",
      }),
    );
  }
  for (let lat = Math.ceil(view.south / step) * step; lat <= view.north; lat += step) {
    const { y } = project(lat, 0);
    root.append(el("line", { x1: box.x, y1: y, x2: box.x + box.w, y2: y, stroke: theme.grid }));
    root.append(
      text(formatLat(lat), box.x + 8, y - 6, { size: L.tiny, fill: theme.muted }),
    );
  }

  const max = Math.max(...slide.points.map((point) => point.shots), 1);
  const biggest = Math.min(box.w, box.h) * 0.09;

  for (const point of slide.points) {
    const { x, y } = project(point.lat, point.lon);
    root.append(
      titled(
        el("circle", {
          cx: x,
          cy: y,
          // Area, not radius, carries the count — a radius scale would make ten
          // frames look like a hundred.
          r: Math.max(5, Math.sqrt(point.shots / max) * biggest),
          fill: theme.series[0],
          "fill-opacity": 0.7,
          // The surface ring keeps overlapping dots legible.
          stroke: theme.surface,
          "stroke-width": 2,
        }),
        `${formatLat(point.lat)}, ${formatLon(point.lon)} — ${fmt(point.shots)}`,
      ),
    );
  }
}

/**
 * A window on the world that holds every point, shaped like the slide.
 *
 * Padding is proportional so a tight cluster and a continent both sit inside
 * their frame with room to breathe, and the minimum span stops a single
 * location filling the slide at a zoom the data cannot support.
 */
function fitBounds(points, aspect) {
  const lats = points.map((point) => point.lat);
  const lons = points.map((point) => point.lon);

  let south = Math.min(...lats);
  let north = Math.max(...lats);
  let west = Math.min(...lons);
  let east = Math.max(...lons);

  const MIN_SPAN = 2;
  const padLat = Math.max((north - south) * 0.18, MIN_SPAN / 2);
  const padLon = Math.max((east - west) * 0.18, MIN_SPAN / 2);
  south -= padLat;
  north += padLat;
  west -= padLon;
  east += padLon;

  // Grow the short side until the window is the shape of the slide, so the
  // degrees stay square and nothing is stretched.
  const height = north - south;
  const width = east - west;
  if (width / height < aspect) {
    const wanted = height * aspect;
    const middle = (east + west) / 2;
    west = middle - wanted / 2;
    east = middle + wanted / 2;
  } else {
    const wanted = width / aspect;
    const middle = (north + south) / 2;
    south = middle - wanted / 2;
    north = middle + wanted / 2;
  }

  return { south, north, west, east };
}

/** Grid spacing that puts three or four lines across the window. */
function graticuleStep(span) {
  for (const step of [90, 45, 30, 15, 10, 5, 2, 1, 0.5, 0.2, 0.1]) {
    if (span / step >= 3) return step;
  }
  return 0.05;
}

const trimDegrees = (value) => (Math.abs(value) < 10 ? value.toFixed(1) : String(Math.round(value)));

const formatLat = (lat) => `${trimDegrees(Math.abs(lat))}°${lat >= 0 ? "N" : "S"}`;
const formatLon = (lon) => `${trimDegrees(Math.abs(lon))}°${lon >= 0 ? "E" : "W"}`;

/**
 * How many tiles fit across, and how tall each row gets.
 *
 * A wide frame puts up to four across, which keeps them on one row and leaves
 * height for the note under each value; a narrow one manages two. Row height is
 * capped so four tiles in a 1920px-tall frame sit together as a block rather
 * than drifting six hundred pixels apart.
 */
function tileLayout(count, plot, L) {
  const columns = L.narrow ? Math.min(2, count) : Math.min(4, count);
  const rows = Math.ceil(count / columns);
  const rowH = Math.min(plot.h / rows, L.tileValue * (L.tall ? 5 : 3.4));
  return { columns, rows, cellW: plot.w / columns, rowH, height: rowH * rows };
}

/**
 * A grid of stat tiles.
 *
 * Every size here is derived from the row height rather than fixed, because the
 * row height is whatever the slide has left over — and a tile laid out for more
 * space than it got is exactly how a value ends up sitting on the label
 * underneath it.
 */
function drawTiles(root, plot, slide, theme, L) {
  const tiles = slide.tiles.slice(0, 6);
  if (tiles.length === 0) return;

  const { columns, rows, cellW, rowH, height } = tileLayout(tiles.length, plot, L);
  const top = plot.y + Math.max(0, (plot.h - height) / 2);

  // Sizes come from the room each tile actually got, so a story fills with big
  // figures and a 16:9 slide keeps the smaller ones it has space for.
  const labelSize = Math.min(L.tileLabel * 1.2, rowH * 0.17);
  const valueSize = Math.min(L.tileValue * (L.tall ? 1.9 : 1.15), rowH * 0.42, cellW * 0.26);
  const noteSize = Math.min(L.note * 1.2, rowH * 0.15);
  // The note is drawn only when all three fit with room to breathe.
  const showNote = rowH >= labelSize * 1.6 + valueSize * 1.3 + noteSize * 2.4;

  tiles.forEach((tile, i) => {
    const x = plot.x + (i % columns) * cellW;
    const y = top + Math.floor(i / columns) * rowH;
    const width = cellW - L.tiny;

    root.append(
      text(ellipsize(tile.label.toUpperCase(), width, labelSize, 600), x, y + labelSize, {
        size: labelSize,
        weight: 600,
        fill: theme.muted,
        "letter-spacing": 0.6,
      }),
    );

    const valueY = y + labelSize * 1.6 + valueSize * 0.86;
    const fitted = measure(tile.value, valueSize, 600) > width ? valueSize * 0.68 : valueSize;
    root.append(
      text(ellipsize(tile.value, width, fitted, 600), x, valueY, {
        size: fitted,
        weight: 600,
        fill: theme.ink,
      }),
    );

    if (showNote && tile.note) {
      root.append(
        text(ellipsize(tile.note, width, noteSize), x, valueY + noteSize * 1.9, {
          size: noteSize,
          fill: theme.ink2,
        }),
      );
    }
  });
}

/**
 * One enormous number, with the supporting tiles below a rule.
 *
 * The rule is not decoration: it is the line the tiles are laid out beneath, in
 * the space that is actually left, rather than in the space the hero number
 * hoped to leave them.
 */
function drawHero(root, plot, slide, theme, L) {
  const heroSize = Math.min(
    L.hero,
    plot.h * 0.42,
    // Big numbers get wide; the frame wins over the drama.
    (plot.w / Math.max(3, slide.value.length)) * 1.75,
  );

  let y = plot.y + heroSize * 0.8;
  root.append(text(slide.value, plot.x, y, { size: heroSize, weight: 600, fill: theme.series[0] }));

  if (slide.caption) {
    // Same rule as the headline: clearance scales with the bigger of the two.
    y += Math.max(L.subtitle * 1.5, heroSize * 0.3);
    root.append(
      text(ellipsize(slide.caption, plot.w, L.subtitle), plot.x, y, {
        size: L.subtitle,
        fill: theme.ink2,
      }),
    );
  }

  const tiles = slide.tiles ?? [];
  if (tiles.length === 0) return;

  const available = plot.y + plot.h - (y + L.subtitle * 1.6);
  // Below this there is no honest way to draw a tile, so none are drawn.
  if (available < L.tileValue * 1.6) return;

  // The tiles sit at the foot of the slide and the rule sits on top of them,
  // so a tall frame reads as a headline and a footer rather than as two things
  // separated by an accident of arithmetic.
  const block = tileLayout(tiles.length, { w: plot.w, h: available }, L);
  const blockTop = plot.y + plot.h - block.height;

  root.append(
    el("line", {
      x1: plot.x,
      y1: blockTop - L.tiny * 1.8,
      x2: plot.x + plot.w,
      y2: blockTop - L.tiny * 1.8,
      stroke: theme.grid,
    }),
  );
  drawTiles(root, { x: plot.x, y: blockTop, w: plot.w, h: block.height }, slide, theme, L);
}

/**
 * A year per row, three cards across: photographs, cameras, lenses.
 *
 * Deliberately not a chart. Three series of three points is nine numbers, and
 * nine numbers read faster as nine numbers than as a grouped bar chart of them
 * — the comparison a reader actually makes here is "this year against last",
 * which rows of cards support and a legend does not.
 */
function drawYears(root, plot, slide, theme, L) {
  const years = slide.years.slice(0, 8);
  if (years.length === 0) return;

  const gap = L.tiny * 0.9;
  const rowGap = L.tiny * (L.tall ? 1.2 : 0.9);
  const rowHeight = Math.min((plot.h + rowGap) / years.length - rowGap, L.tileValue * 3.2);
  const top = plot.y + Math.max(0, (plot.h - (rowHeight + rowGap) * years.length + rowGap) / 2);

  const yearWidth = Math.min(plot.w * 0.22, measure("2023–24", L.subtitle, 600) + L.tiny * 2);
  const cardsX = plot.x + yearWidth;
  const cardWidth = (plot.w - yearWidth - gap * 2) / 3;

  const labelSize = Math.min(L.tileLabel, rowHeight * 0.2);
  const valueSize = Math.min(L.tileValue * 1.2, rowHeight * 0.46, cardWidth * 0.34);

  years.forEach((year, i) => {
    const y = top + i * (rowHeight + rowGap);

    // The year itself, set against the cards rather than inside one.
    root.append(
      text(year.label, plot.x, y + rowHeight / 2 + L.subtitle * 0.36, {
        size: L.subtitle,
        weight: 600,
        fill: theme.ink,
      }),
    );
    if (year.partial) {
      root.append(
        text("so far", plot.x, y + rowHeight / 2 + L.subtitle * 0.36 + L.tiny * 1.5, {
          size: L.tiny,
          fill: theme.muted,
        }),
      );
    }

    const cards = [
      { label: "photographs", value: year.shots },
      { label: year.cameras === 1 ? "camera" : "cameras", value: year.cameras },
      { label: year.lenses === 1 ? "lens" : "lenses", value: year.lenses },
    ];

    cards.forEach((card, index) => {
      const x = cardsX + index * (cardWidth + gap);

      root.append(
        titled(
          el("rect", {
            x,
            y,
            width: cardWidth,
            height: rowHeight,
            rx: Math.min(10, rowHeight / 6),
            fill: theme.plane,
            // The first column is the count everything else is a detail of, so
            // it carries the series colour and the others stay quiet.
            stroke: index === 0 ? theme.series[0] : theme.grid,
            "stroke-width": index === 0 ? 2 : 1,
          }),
          `${year.label}: ${fmt(card.value)} ${card.label}`,
        ),
      );

      const centre = x + cardWidth / 2;
      const fitted =
        measure(fmt(card.value), valueSize, 600) > cardWidth - L.tiny * 2 ? valueSize * 0.7 : valueSize;

      root.append(
        text(fmt(card.value), centre, y + rowHeight * 0.58, {
          size: fitted,
          weight: 600,
          fill: index === 0 ? theme.series[0] : theme.ink,
          anchor: "middle",
        }),
      );
      root.append(
        text(ellipsize(card.label, cardWidth - L.tiny, labelSize), centre, y + rowHeight * 0.82, {
          size: labelSize,
          fill: theme.muted,
          anchor: "middle",
        }),
      );
    });
  });
}

/** Rows of label, meta and value — gear debuts and anything else list-shaped. */
function drawList(root, plot, slide, theme, L) {
  const rowHeight = Math.max(
    L.label * 2.2,
    Math.min(L.label * (L.tall ? 6 : 4.5), plot.h / Math.max(slide.items.length, 1)),
  );
  const fit = Math.max(1, Math.floor(plot.h / rowHeight));
  const items = slide.items.slice(0, fit);
  const valueWidth = Math.max(...items.map((item) => measure(item.value, L.value))) + L.tiny;

  items.forEach((item, i) => {
    const y = plot.y + i * rowHeight;
    root.append(el("line", { x1: plot.x, y1: y, x2: plot.x + plot.w, y2: y, stroke: theme.grid }));
    root.append(
      text(ellipsize(item.label, plot.w - valueWidth - L.tiny, L.label, 600), plot.x, y + L.label * 1.3, {
        size: L.label,
        weight: 600,
        fill: theme.ink,
      }),
    );
    root.append(
      text(
        ellipsize(item.meta, plot.w - valueWidth - L.tiny, L.tiny),
        plot.x,
        y + L.label * 1.3 + L.tiny * 1.6,
        { size: L.tiny, fill: theme.muted },
      ),
    );
    root.append(
      text(item.value, plot.x + plot.w, y + L.label * 1.4, {
        size: L.value,
        fill: theme.ink2,
        anchor: "end",
      }),
    );
  });
}

const RENDERERS = {
  hero: drawHero,
  bars: drawBars,
  columns: drawColumns,
  strip: drawStrip,
  years: drawYears,
  clock: drawClock,
  week: drawWeek,
  calendar: drawCalendar,
  months: drawMonths,
  stack: drawStack,
  map: drawMap,
  tiles: drawTiles,
  verdict: drawVerdict,
  list: drawList,
};

/**
 * Renders one slide, at whatever shape `format` asks for.
 *
 * There is deliberately no "3 of 19" in the corner: on screen the dots under
 * the deck say where you are, and in something posted one slide at a time the
 * number refers to a deck nobody else has seen.
 */
export function renderSlide(slide, theme, format = DEFAULT_FORMAT) {
  const L = metrics(format);
  const { root, plot } = frame(slide, theme, L);
  const draw = RENDERERS[slide.kind];
  if (draw) draw(root, plot, slide, theme, L);
  return root;
}

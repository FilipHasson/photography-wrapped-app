// @ts-check
/**
 * Drawing a slide.
 *
 * Every slide is one 1600×900 SVG with no external anything: colours are
 * attributes, not CSS variables, and the only font is the system sans. That is
 * what makes export work — a serialised SVG rendered into a canvas has no page
 * around it, so anything inherited would silently disappear.
 *
 * Chart conventions, held to across every kind here:
 *
 *  - one series, one colour; a highlight carries emphasis, never a value ramp
 *  - marks are thin (bars capped at 24px), gridlines are hairlines, and a 2px
 *    gap in the surface colour does the separating rather than a stroke
 *  - values are labelled selectively — the extreme, the leader, the axis — and
 *    every value is in the slide's table view regardless
 *  - each mark carries a `<title>`, so hovering says what it is
 */

const NS = "http://www.w3.org/2000/svg";

export const WIDTH = 1600;
export const HEIGHT = 900;
const PAD = 96;

/** Plot area, below the headline block and above the note. */
const PLOT = { x: PAD, y: 300, w: WIDTH - PAD * 2, h: 470 };

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
    "font-size": size,
    "font-weight": weight,
    fill,
    "text-anchor": anchor,
    "font-family": FONT,
    ...rest,
  });
  node.textContent = value;
  return node;
}

const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

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
    const last = lines[maxLines - 1];
    const consumed = lines.join(" ");
    if (consumed.length < value.length) {
      lines[maxLines - 1] = ellipsize(`${last} …`, maxWidth, size, weight);
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
 * number. Returns the root and the space left for the chart.
 */
function frame(slide, theme, position) {
  const root = el("svg", {
    xmlns: NS,
    viewBox: `0 0 ${WIDTH} ${HEIGHT}`,
    width: WIDTH,
    height: HEIGHT,
    "font-family": FONT,
    role: "img",
    "aria-label": `${slide.title}. ${slide.headline}`,
  });

  root.append(el("rect", { x: 0, y: 0, width: WIDTH, height: HEIGHT, fill: theme.surface }));

  root.append(
    text(slide.title.toUpperCase(), PAD, 96, {
      size: 20,
      weight: 600,
      fill: theme.muted,
      "letter-spacing": 2,
    }),
  );

  const headlineSize = slide.headline.length > 46 ? 50 : 62;
  const headlineLines = wrap(slide.headline, WIDTH - PAD * 2, headlineSize, 2, 600);
  headlineLines.forEach((line, i) => {
    root.append(text(line, PAD, 170 + i * (headlineSize + 10), { size: headlineSize, weight: 600, fill: theme.ink }));
  });

  let y = 170 + headlineLines.length * (headlineSize + 10) + 6;
  if (slide.subtitle) {
    root.append(text(ellipsize(slide.subtitle, WIDTH - PAD * 2, 26), PAD, y, { size: 26, fill: theme.ink2 }));
    y += 34;
  }

  if (slide.note) {
    wrap(slide.note, WIDTH - PAD * 2 - 120, 20, 3).forEach((line, i) => {
      root.append(text(line, PAD, HEIGHT - 96 + i * 26, { size: 20, fill: theme.muted }));
    });
  }

  if (position) {
    root.append(
      text(position, WIDTH - PAD, HEIGHT - 96, { size: 20, fill: theme.muted, anchor: "end" }),
    );
  }

  const top = Math.max(PLOT.y, y + 24);
  return { root, plot: { x: PAD, y: top, w: WIDTH - PAD * 2, h: HEIGHT - 150 - top } };
}

// ----------------------------------------------------------------- kinds ---

/** Ranked horizontal bars: cameras, lenses, pairings. */
function drawBars(root, plot, slide, theme) {
  const items = slide.items.slice(0, 9);
  const max = Math.max(...items.map((item) => item.value), 1);

  const rowHeight = Math.min(56, plot.h / items.length);
  const thickness = Math.min(24, rowHeight - 16);
  const labelWidth = 460;
  const valueWidth = 190;
  const trackX = plot.x + labelWidth + 24;
  const trackW = plot.w - labelWidth - valueWidth - 48;

  items.forEach((item, i) => {
    const y = plot.y + i * rowHeight;
    const mid = y + rowHeight / 2;
    const width = Math.max(2, (item.value / max) * trackW);
    const fill = item.muted ? theme.axis : theme.series[0];

    root.append(
      text(ellipsize(item.label, labelWidth, 24, i === 0 ? 600 : 400), plot.x, mid + 8, {
        size: 24,
        weight: i === 0 ? 600 : 400,
        fill: i === 0 ? theme.ink : theme.ink2,
      }),
    );

    root.append(
      titled(
        el("rect", {
          x: trackX,
          y: mid - thickness / 2,
          width,
          height: thickness,
          // Square where it leaves the baseline, rounded at the data end.
          rx: Math.min(4, thickness / 2),
          fill,
        }),
        `${item.label}: ${fmt(item.value)}`,
      ),
    );
    // The rounded corner is wanted only at the tip; this patches the root back
    // to square without a second shape language.
    root.append(
      el("rect", { x: trackX, y: mid - thickness / 2, width: Math.min(4, width), height: thickness, fill }),
    );

    root.append(
      text(item.valueLabel, trackX + trackW + 24, mid + 8, {
        size: 22,
        fill: theme.ink2,
        weight: i === 0 ? 600 : 400,
      }),
    );
  });
}

/** Vertical histogram: focal length, aperture, ISO, shutter, ratings. */
function drawColumns(root, plot, slide, theme) {
  const items = slide.items;
  if (items.length === 0) return;

  const max = Math.max(...items.map((item) => item.value), 1);
  const ceiling = niceCeiling(max);
  const band = plot.w / items.length;
  const thickness = Math.min(24, Math.max(6, band - 14));
  const baseline = plot.y + plot.h - 56;
  const height = plot.h - 90;

  // Two hairlines are enough to read a histogram against.
  for (const fraction of [0.5, 1]) {
    const y = baseline - height * fraction;
    root.append(
      el("line", { x1: plot.x, y1: y, x2: plot.x + plot.w, y2: y, stroke: theme.grid, "stroke-width": 1 }),
    );
    root.append(
      text(fmt(ceiling * fraction), plot.x + plot.w, y - 8, {
        size: 18,
        fill: theme.muted,
        anchor: "end",
      }),
    );
  }

  // Enough room for every label, or every other one, or every fourth.
  const widest = Math.max(...items.map((item) => measure(item.label, 18)));
  const stride = widest + 12 <= band ? 1 : widest + 12 <= band * 2 ? 2 : Math.ceil((widest + 12) / band);

  items.forEach((item, i) => {
    const cx = plot.x + band * (i + 0.5);
    const barHeight = Math.max(item.value > 0 ? 2 : 0, (item.value / ceiling) * height);
    const highlighted = i === slide.highlight;

    if (barHeight > 0) {
      root.append(
        titled(
          el("rect", {
            x: cx - thickness / 2,
            y: baseline - barHeight,
            width: thickness,
            height: barHeight,
            rx: Math.min(4, thickness / 2),
            fill: theme.series[0],
            // One series, one colour; the favourite is emphasised by holding
            // full strength while the rest step back.
            opacity: slide.highlight >= 0 && !highlighted ? 0.45 : 1,
          }),
          `${item.label}: ${fmt(item.value)}`,
        ),
      );
      root.append(
        el("rect", {
          x: cx - thickness / 2,
          y: baseline - Math.min(4, barHeight),
          width: thickness,
          height: Math.min(4, barHeight),
          fill: theme.series[0],
          opacity: slide.highlight >= 0 && !highlighted ? 0.45 : 1,
        }),
      );
    }

    if (highlighted) {
      root.append(
        text(fmt(item.value), cx, baseline - barHeight - 14, {
          size: 22,
          weight: 600,
          fill: theme.ink,
          anchor: "middle",
        }),
      );
    }

    if (i % stride === 0 || highlighted) {
      root.append(
        text(item.label, cx, baseline + 30, {
          size: 18,
          fill: highlighted ? theme.ink2 : theme.muted,
          anchor: "middle",
          weight: highlighted ? 600 : 400,
        }),
      );
    }
  });

  root.append(
    el("line", {
      x1: plot.x,
      y1: baseline,
      x2: plot.x + plot.w,
      y2: baseline,
      stroke: theme.axis,
      "stroke-width": 1,
    }),
  );
  root.append(
    text(slide.axisLabel, plot.x + plot.w, baseline + 54, { size: 18, fill: theme.muted, anchor: "end" }),
  );
}

/** Twenty-four spokes: a day, read as a clock face. */
function drawClock(root, plot, slide, theme) {
  const cx = plot.x + plot.w / 2;
  const cy = plot.y + plot.h / 2;
  const outer = Math.min(plot.h / 2 - 10, 210);
  const inner = 74;
  const max = Math.max(...slide.hours, 1);
  const peak = slide.hours.indexOf(max);

  for (const radius of [inner, outer]) {
    root.append(el("circle", { cx, cy, r: radius, fill: "none", stroke: theme.grid, "stroke-width": 1 }));
  }

  slide.hours.forEach((value, hour) => {
    // Midnight at the top, noon at the bottom, like a watch face.
    const angle = (hour / 24) * Math.PI * 2 - Math.PI / 2;
    const length = (value / max) * (outer - inner);
    const x1 = cx + Math.cos(angle) * inner;
    const y1 = cy + Math.sin(angle) * inner;
    const x2 = cx + Math.cos(angle) * (inner + length);
    const y2 = cy + Math.sin(angle) * (inner + length);

    root.append(
      titled(
        el("line", {
          x1,
          y1,
          x2,
          y2,
          stroke: theme.series[0],
          "stroke-width": 14,
          "stroke-linecap": "round",
          opacity: hour === peak ? 1 : 0.55,
        }),
        `${String(hour).padStart(2, "0")}:00 — ${fmt(value)}`,
      ),
    );

    if (hour % 3 === 0) {
      const lx = cx + Math.cos(angle) * (outer + 30);
      const ly = cy + Math.sin(angle) * (outer + 30);
      root.append(
        text(`${String(hour).padStart(2, "0")}`, lx, ly + 6, {
          size: 18,
          fill: hour === peak ? theme.ink2 : theme.muted,
          anchor: "middle",
          weight: hour === peak ? 600 : 400,
        }),
      );
    }
  });

  root.append(text(fmt(max), cx, cy - 4, { size: 30, weight: 600, fill: theme.ink, anchor: "middle" }));
  root.append(text("busiest hour", cx, cy + 24, { size: 16, fill: theme.muted, anchor: "middle" }));
}

/** Seven columns, Monday first. */
function drawWeek(root, plot, slide, theme) {
  const names = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  const max = Math.max(...slide.days, 1);
  const band = plot.w / 7;
  const thickness = Math.min(24, band - 40);
  const baseline = plot.y + plot.h - 50;
  const height = plot.h - 90;
  const busiest = slide.days.indexOf(max);

  slide.days.forEach((value, day) => {
    const cx = plot.x + band * (day + 0.5);
    const barHeight = Math.max(value > 0 ? 2 : 0, (value / max) * height);

    root.append(
      titled(
        el("rect", {
          x: cx - thickness / 2,
          y: baseline - barHeight,
          width: thickness,
          height: barHeight,
          rx: 4,
          fill: theme.series[0],
          opacity: day === busiest ? 1 : 0.5,
        }),
        `${names[day]}: ${fmt(value)}`,
      ),
    );
    root.append(
      text(fmt(value), cx, baseline - barHeight - 14, {
        size: 20,
        weight: day === busiest ? 600 : 400,
        fill: day === busiest ? theme.ink : theme.muted,
        anchor: "middle",
      }),
    );
    root.append(
      text(names[day].slice(0, 3), cx, baseline + 30, {
        size: 20,
        fill: day === busiest ? theme.ink2 : theme.muted,
        anchor: "middle",
        weight: day === busiest ? 600 : 400,
      }),
    );
  });

  root.append(
    el("line", { x1: plot.x, y1: baseline, x2: plot.x + plot.w, y2: baseline, stroke: theme.axis }),
  );
}

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** One square per day, weeks running left to right. */
function drawCalendar(root, plot, slide, theme) {
  const counts = new Map(slide.days.map((entry) => [entry.day, entry.shots]));
  const max = Math.max(...slide.days.map((entry) => entry.shots), 1);

  const start = toDate(slide.from);
  const end = toDate(slide.to);
  const totalDays = Math.round((end - start) / 86400000) + 1;
  // Back up to the Monday on or before the first day, so columns are weeks.
  const offset = (start.getUTCDay() + 6) % 7;
  const columns = Math.ceil((totalDays + offset) / 7);

  const cell = Math.min(22, Math.floor((plot.w - 60) / columns) - 3, Math.floor((plot.h - 90) / 7) - 3);
  const gap = 3;
  const gridW = columns * (cell + gap);
  const x0 = plot.x + Math.max(0, (plot.w - gridW) / 2) + 30;
  const y0 = plot.y + 24;

  let lastMonth = -1;
  for (let index = 0; index < totalDays; index++) {
    const date = new Date(start.getTime() + index * 86400000);
    const column = Math.floor((index + offset) / 7);
    const row = (index + offset) % 7;
    const key = toKey(date);
    const value = counts.get(key) ?? 0;

    const x = x0 + column * (cell + gap);
    const y = y0 + row * (cell + gap);

    root.append(
      titled(
        el("rect", {
          x,
          y,
          width: cell,
          height: cell,
          rx: 3,
          fill: value === 0 ? theme.rampEmpty : theme.ramp[rampStep(value, max)],
        }),
        `${date.getUTCDate()} ${MONTH_SHORT[date.getUTCMonth()]} ${date.getUTCFullYear()} — ${fmt(value)}`,
      ),
    );

    if (row === 0 && date.getUTCMonth() !== lastMonth) {
      lastMonth = date.getUTCMonth();
      root.append(
        text(MONTH_SHORT[lastMonth], x, y0 - 12, { size: 16, fill: theme.muted }),
      );
    }
  }

  ["Mon", "Wed", "Fri", "Sun"].forEach((name, i) => {
    root.append(
      text(name, x0 - 12, y0 + [0, 2, 4, 6][i] * (cell + gap) + cell - 4, {
        size: 14,
        fill: theme.muted,
        anchor: "end",
      }),
    );
  });

  // Scale legend, since colour is carrying magnitude here.
  const legendY = y0 + 7 * (cell + gap) + 34;
  root.append(text("fewer", x0, legendY + 12, { size: 16, fill: theme.muted }));
  theme.ramp.forEach((colour, i) => {
    root.append(el("rect", { x: x0 + 62 + i * 22, y: legendY, width: 18, height: 18, rx: 3, fill: colour }));
  });
  root.append(text(`more (up to ${fmt(max)})`, x0 + 62 + theme.ramp.length * 22 + 10, legendY + 12, {
    size: 16,
    fill: theme.muted,
  }));
}

function rampStep(value, max) {
  const fraction = value / max;
  if (fraction <= 0.05) return 0;
  if (fraction <= 0.2) return 1;
  if (fraction <= 0.45) return 2;
  if (fraction <= 0.75) return 3;
  return 4;
}

function toDate(day) {
  return new Date(Date.UTC(Math.floor(day / 10000), (Math.floor(day / 100) % 100) - 1, day % 100));
}

function toKey(date) {
  return date.getUTCFullYear() * 10000 + (date.getUTCMonth() + 1) * 100 + date.getUTCDate();
}

/** Monthly columns, for ranges too long to read a day at a time. */
function drawMonths(root, plot, slide, theme) {
  const months = slide.months;
  if (months.length === 0) return;

  const max = Math.max(...months.map((entry) => entry.shots), 1);
  const ceiling = niceCeiling(max);
  const band = plot.w / months.length;
  const thickness = Math.min(24, Math.max(3, band - 6));
  const baseline = plot.y + plot.h - 50;
  const height = plot.h - 80;

  const y = baseline - height;
  root.append(el("line", { x1: plot.x, y1: y, x2: plot.x + plot.w, y2: y, stroke: theme.grid }));
  root.append(text(fmt(ceiling), plot.x + plot.w, y - 8, { size: 18, fill: theme.muted, anchor: "end" }));

  let lastYear = -1;
  months.forEach((entry, i) => {
    const cx = plot.x + band * (i + 0.5);
    const barHeight = Math.max(entry.shots > 0 ? 2 : 0, (entry.shots / ceiling) * height);
    const year = Math.floor(entry.ym / 100);

    root.append(
      titled(
        el("rect", {
          x: cx - thickness / 2,
          y: baseline - barHeight,
          width: thickness,
          height: barHeight,
          rx: Math.min(4, thickness / 2),
          fill: theme.series[0],
        }),
        `${MONTH_SHORT[(entry.ym % 100) - 1]} ${year} — ${fmt(entry.shots)}`,
      ),
    );

    if (year !== lastYear && band > 14) {
      lastYear = year;
      root.append(text(String(year), cx, baseline + 30, { size: 18, fill: theme.muted, anchor: "middle" }));
    }
  });

  root.append(
    el("line", { x1: plot.x, y1: baseline, x2: plot.x + plot.w, y2: baseline, stroke: theme.axis }),
  );
}

/**
 * The pooled tail is grey rather than a sixth hue: it is not an entity, and
 * spending a categorical slot on it would push a real lens out.
 */
function stackColour(series, index, theme) {
  return series.label === "Everything else" ? theme.axis : theme.series[index % theme.series.length];
}

/** Stacked columns: which lens was on the camera, month by month. */
function drawStack(root, plot, slide, theme) {
  const { months, series } = slide;
  const totals = months.map((_, i) => series.reduce((sum, s) => sum + (s.values[i] ?? 0), 0));
  const ceiling = niceCeiling(Math.max(...totals, 1));

  const band = plot.w / months.length;
  const thickness = Math.min(24, Math.max(4, band - 8));
  const legendHeight = 40;
  const baseline = plot.y + plot.h - 50 - legendHeight;
  const height = plot.h - 70 - legendHeight;

  months.forEach((ym, i) => {
    const cx = plot.x + band * (i + 0.5);
    let top = baseline;

    series.forEach((s, index) => {
      const value = s.values[i] ?? 0;
      if (value <= 0) return;
      const segment = (value / ceiling) * height;
      // A 2px gap in the surface colour is what separates the segments.
      const drawn = Math.max(1, segment - 2);
      top -= segment;

      root.append(
        titled(
          el("rect", {
            x: cx - thickness / 2,
            y: top,
            width: thickness,
            height: drawn,
            fill: stackColour(s, index, theme),
          }),
          `${MONTH_SHORT[(ym % 100) - 1]} ${Math.floor(ym / 100)} · ${s.label}: ${fmt(value)}`,
        ),
      );
    });

    if (i % Math.ceil(months.length / 12) === 0) {
      root.append(
        text(`${MONTH_SHORT[(ym % 100) - 1]}`, cx, baseline + 26, {
          size: 16,
          fill: theme.muted,
          anchor: "middle",
        }),
      );
      root.append(
        text(`${Math.floor(ym / 100)}`, cx, baseline + 46, {
          size: 14,
          fill: theme.muted,
          anchor: "middle",
        }),
      );
    }
  });

  root.append(
    el("line", { x1: plot.x, y1: baseline, x2: plot.x + plot.w, y2: baseline, stroke: theme.axis }),
  );

  // A legend is not optional once there is more than one series.
  let x = plot.x;
  const legendY = plot.y + plot.h - 6;
  series.forEach((s, index) => {
    const colour = stackColour(s, index, theme);
    const label = ellipsize(s.label, 260, 18);
    root.append(el("rect", { x, y: legendY - 12, width: 12, height: 12, rx: 3, fill: colour }));
    root.append(text(label, x + 20, legendY, { size: 18, fill: theme.ink2 }));
    x += 20 + measure(label, 18) + 34;
  });
}

/** Latitude and longitude, plotted flat. No coastline is claimed. */
function drawMap(root, plot, slide, theme) {
  const box = { x: plot.x, y: plot.y, w: plot.w, h: Math.min(plot.h - 30, plot.w / 2) };
  const project = (lat, lon) => ({
    x: box.x + ((lon + 180) / 360) * box.w,
    y: box.y + ((90 - lat) / 180) * box.h,
  });

  root.append(el("rect", { x: box.x, y: box.y, width: box.w, height: box.h, fill: theme.plane, rx: 8 }));

  for (let lon = -180; lon <= 180; lon += 30) {
    const { x } = project(0, lon);
    root.append(el("line", { x1: x, y1: box.y, x2: x, y2: box.y + box.h, stroke: theme.grid }));
  }
  for (let lat = -60; lat <= 60; lat += 30) {
    const { y } = project(lat, 0);
    root.append(el("line", { x1: box.x, y1: y, x2: box.x + box.w, y2: y, stroke: theme.grid }));
  }
  // The equator gets one step more presence than the rest of the graticule.
  const equator = project(0, 0).y;
  root.append(el("line", { x1: box.x, y1: equator, x2: box.x + box.w, y2: equator, stroke: theme.axis }));

  const max = Math.max(...slide.points.map((point) => point.shots), 1);
  for (const point of slide.points) {
    const { x, y } = project(point.lat, point.lon);
    const radius = 4 + Math.sqrt(point.shots / max) * 14;
    root.append(
      titled(
        el("circle", {
          cx: x,
          cy: y,
          r: radius,
          fill: theme.series[0],
          "fill-opacity": 0.75,
          // The surface ring keeps overlapping dots legible.
          stroke: theme.surface,
          "stroke-width": 2,
        }),
        `${point.lat.toFixed(1)}, ${point.lon.toFixed(1)} — ${fmt(point.shots)}`,
      ),
    );
  }

  root.append(text("180°W", box.x, box.y + box.h + 24, { size: 16, fill: theme.muted }));
  root.append(text("0°", box.x + box.w / 2, box.y + box.h + 24, { size: 16, fill: theme.muted, anchor: "middle" }));
  root.append(text("180°E", box.x + box.w, box.y + box.h + 24, { size: 16, fill: theme.muted, anchor: "end" }));
}

/** A grid of stat tiles — the form for numbers that are not a distribution. */
function drawTiles(root, plot, slide, theme) {
  const tiles = slide.tiles.slice(0, 6);
  if (tiles.length === 0) return;

  const columns = tiles.length <= 2 ? tiles.length : tiles.length <= 4 ? 2 : 3;
  const rows = Math.ceil(tiles.length / columns);
  const cellW = plot.w / columns;
  const cellH = Math.min(plot.h / rows, 190);

  tiles.forEach((tile, i) => {
    const x = plot.x + (i % columns) * cellW;
    const y = plot.y + Math.floor(i / columns) * cellH;

    root.append(text(tile.label.toUpperCase(), x, y + 22, { size: 17, weight: 600, fill: theme.muted }));

    const size = measure(tile.value, 46, 600) > cellW - 40 ? 30 : 46;
    root.append(
      text(ellipsize(tile.value, cellW - 32, size, 600), x, y + 78, { size, weight: 600, fill: theme.ink }),
    );

    if (tile.note) {
      root.append(text(ellipsize(tile.note, cellW - 32, 20), x, y + 110, { size: 20, fill: theme.ink2 }));
    }
  });
}

/** One enormous number. */
function drawHero(root, plot, slide, theme) {
  const size = slide.value.length > 7 ? 150 : 210;
  root.append(text(slide.value, plot.x, plot.y + 150, { size, weight: 600, fill: theme.series[0] }));

  if (slide.caption) {
    root.append(
      text(ellipsize(slide.caption, plot.w, 30), plot.x, plot.y + 200, { size: 30, fill: theme.ink2 }),
    );
  }

  if (slide.tiles?.length) {
    drawTiles(root, { ...plot, y: plot.y + 250, h: plot.h - 250 }, slide, theme);
  }
}

/** Rows of label, meta and value — gear debuts and anything else list-shaped. */
function drawList(root, plot, slide, theme) {
  const items = slide.items.slice(0, 7);
  const rowHeight = Math.min(64, plot.h / Math.max(items.length, 1));

  items.forEach((item, i) => {
    const y = plot.y + i * rowHeight;
    root.append(
      el("line", { x1: plot.x, y1: y, x2: plot.x + plot.w, y2: y, stroke: theme.grid }),
    );
    root.append(
      text(ellipsize(item.label, plot.w - 420, 26, 600), plot.x, y + 34, {
        size: 26,
        weight: 600,
        fill: theme.ink,
      }),
    );
    root.append(text(item.meta, plot.x, y + 58, { size: 18, fill: theme.muted }));
    root.append(
      text(item.value, plot.x + plot.w, y + 40, { size: 22, fill: theme.ink2, anchor: "end" }),
    );
  });
}

const RENDERERS = {
  hero: drawHero,
  bars: drawBars,
  columns: drawColumns,
  clock: drawClock,
  week: drawWeek,
  calendar: drawCalendar,
  months: drawMonths,
  stack: drawStack,
  map: drawMap,
  tiles: drawTiles,
  list: drawList,
};

/**
 * Renders one slide. `position` is the "3 / 14" marker, and is left off when a
 * slide is being drawn on its own.
 */
export function renderSlide(slide, theme, position = "") {
  const { root, plot } = frame(slide, theme, position);
  const draw = RENDERERS[slide.kind];
  if (draw) draw(root, plot, slide, theme);
  return root;
}

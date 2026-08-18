// @ts-check
import { DEFAULT_FORMAT } from "./formats.js";

/**
 * Getting a slide out of the browser.
 *
 * A slide is already an SVG with every colour written on as an attribute, so
 * rasterising it is just: serialise, load as an image, draw to a canvas. That
 * is also why the SVG carries no stylesheet — an image loads in isolation, and
 * anything inherited from the page would vanish at exactly the moment it
 * mattered.
 *
 * The PDF is written by hand. It holds one JPEG per page and nothing else, so
 * the whole format needed here is a handful of objects and a cross-reference
 * table — small enough to be worth writing rather than taking a dependency for.
 */

/** Rasterising at 2× keeps text crisp on a projector and in print. */
const SCALE = 2;

function serialize(svg, format) {
  const clone = /** @type {SVGElement} */ (svg.cloneNode(true));
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  // Firefox rasterises an SVG image at 0x0 unless it carries explicit
  // dimensions, whatever its viewBox says.
  clone.setAttribute("width", String(format.width));
  clone.setAttribute("height", String(format.height));
  return new XMLSerializer().serializeToString(clone);
}

/** Draws one slide onto a canvas at `SCALE`, resolving when the paint is done. */
async function rasterize(svg, format) {
  const source = serialize(svg, format);
  const blob = new Blob([source], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  try {
    const image = new Image();
    image.width = format.width;
    image.height = format.height;
    await new Promise((resolve, reject) => {
      image.onload = () => resolve(undefined);
      image.onerror = () => reject(new Error("The slide could not be rendered to an image."));
      image.src = url;
    });

    const canvas = document.createElement("canvas");
    canvas.width = format.width * SCALE;
    canvas.height = format.height * SCALE;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("This browser would not give us a canvas to draw on.");

    // The SVG paints its own background, but a transparent PNG would still
    // show through wherever it does not — so the ground is painted first.
    context.fillStyle = getComputedStyle(document.body).getPropertyValue("--surface").trim() || "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  // Revoking immediately can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export async function exportSlidePng(svg, filename, format = DEFAULT_FORMAT) {
  const canvas = await rasterize(svg, format);
  const blob = await new Promise((resolve) => canvas.toBlob((result) => resolve(result), "image/png"));
  if (!blob) throw new Error("The slide could not be turned into a PNG.");
  download(blob, filename);
}

// ----------------------------------------------------------------- PDF -----

/**
 * Page size in points. The long edge is fixed and the short one follows the
 * format, so a 9:16 deck exports as tall pages rather than as 16:9 pages with a
 * slide floating in the middle of them.
 */
const PAGE_LONG = 960;

function pageSize(format) {
  const long = Math.max(format.width, format.height);
  const short = Math.round((PAGE_LONG * Math.min(format.width, format.height)) / long);
  return format.width >= format.height
    ? { w: PAGE_LONG, h: short }
    : { w: short, h: PAGE_LONG };
}

const encoder = new TextEncoder();

function toBytes(value) {
  return typeof value === "string" ? encoder.encode(value) : value;
}

function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Writes a PDF whose pages are JPEGs. Exported for the test that checks the
 * cross-reference offsets, which is the one part of the format that fails
 * silently — a viewer either opens the file or shrugs.
 *
 * Every object's byte offset has to be recorded for the cross-reference table,
 * which is why this appends to a list of chunks and tracks the length as it
 * goes rather than building one string.
 */
export function buildPdf(images, format = DEFAULT_FORMAT) {
  const page = pageSize(format);
  const chunks = [];
  let length = 0;
  const offsets = [0];

  const push = (value) => {
    const bytes = toBytes(value);
    chunks.push(bytes);
    length += bytes.length;
  };

  const object = (id, body, stream) => {
    offsets[id] = length;
    push(`${id} 0 obj\n${body}\n`);
    if (stream) {
      push("stream\n");
      push(stream);
      push("\nendstream\n");
    }
    push("endobj\n");
  };

  const pageCount = images.length;
  // 1: catalog, 2: page tree, then three objects per page.
  const pageId = (i) => 3 + i * 3;
  const contentId = (i) => 4 + i * 3;
  const imageId = (i) => 5 + i * 3;

  push("%PDF-1.4\n");
  // A comment of high bytes marks the file as binary for anything sniffing it.
  push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));

  object(1, "<< /Type /Catalog /Pages 2 0 R >>");
  object(
    2,
    `<< /Type /Pages /Count ${pageCount} /Kids [${images.map((_, i) => `${pageId(i)} 0 R`).join(" ")}] >>`,
  );

  images.forEach((image, i) => {
    object(
      pageId(i),
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${page.w} ${page.h}] ` +
        `/Resources << /XObject << /Im0 ${imageId(i)} 0 R >> >> /Contents ${contentId(i)} 0 R >>`,
    );

    // Scale the unit image square up to the full page.
    const content = `q ${page.w} 0 0 ${page.h} 0 0 cm /Im0 Do Q`;
    object(contentId(i), `<< /Length ${content.length} >>`, content);

    object(
      imageId(i),
      `<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.bytes.length} >>`,
      image.bytes,
    );
  });

  const xrefStart = length;
  const objectCount = 3 + pageCount * 3;
  let xref = `xref\n0 ${objectCount}\n0000000000 65535 f \n`;
  for (let id = 1; id < objectCount; id++) {
    xref += `${String(offsets[id] ?? 0).padStart(10, "0")} 00000 n \n`;
  }
  push(xref);
  push(`trailer\n<< /Size ${objectCount} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`);

  return new Blob(chunks, { type: "application/pdf" });
}

/**
 * Exports the whole deck as a PDF.
 *
 * `render` is called per slide rather than taking live nodes, so the export
 * never depends on what happens to be on screen.
 */
export async function exportDeckPdf(slides, render, filename, onProgress, format = DEFAULT_FORMAT) {
  const images = [];

  for (const [index, slide] of slides.entries()) {
    onProgress?.(index, slides.length);
    const canvas = await rasterize(render(slide, index), format);
    // JPEG rather than PNG: these are photographic-looking flat-colour pages
    // either way, and a 20-slide PNG deck runs to tens of megabytes.
    const dataUrl = canvas.toDataURL("image/jpeg", 0.9);
    images.push({
      width: canvas.width,
      height: canvas.height,
      bytes: base64ToBytes(dataUrl.slice(dataUrl.indexOf(",") + 1)),
    });
  }

  onProgress?.(slides.length, slides.length);
  download(buildPdf(images, format), filename);
}

/** `filip-2025.pdf` — a name that says what it is without needing renaming. */
export function fileNameFor(deck, extension, slideTitle = "") {
  const clean = (value) =>
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");

  const parts = [clean(deck.title || "photography"), clean(deck.rangeLabel)];
  if (slideTitle) parts.push(clean(slideTitle));
  return `${parts.filter(Boolean).join("-") || "deck"}.${extension}`;
}

import { test, describe, before } from "node:test";
import assert from "node:assert/strict";

/**
 * The PDF is written by hand, and the part of it that fails silently is the
 * cross-reference table: get one byte offset wrong and a viewer shows a blank
 * document rather than an error. So the offsets are checked here against the
 * bytes they claim to point at.
 */

let buildPdf: (images: Array<{ width: number; height: number; bytes: Uint8Array }>) => Blob;
let buildZip: (files: Array<{ name: string; bytes: Uint8Array }>, now?: Date) => Blob;
let fileNameFor: (deck: { title: string; rangeLabel: string }, ext: string, slide?: string) => string;

/** Stands in for a rasterised slide; the writer never looks inside. */
const fakeJpeg = (seed: number) => ({
  width: 3200,
  height: 1800,
  bytes: new Uint8Array([0xff, 0xd8, 0xff, seed, 0x00, 0x11, 0x22, 0xff, 0xd9]),
});

before(async () => {
  // Only `chart.js` is imported by the module under test, and only for two
  // constants — but it touches the DOM as it loads.
  (globalThis as Record<string, unknown>).document = {
    createElement: () => ({ getContext: () => ({ measureText: () => ({ width: 0 }) }) }),
    createElementNS: () => ({ setAttribute() {}, append() {} }),
  };

  // @ts-expect-error — untyped module, imported for its behaviour.
  ({ buildPdf, buildZip, fileNameFor } = await import("../src/web/export.js"));
});

describe("the PDF writer", () => {
  test("writes a file a reader will recognise", async () => {
    const text = await new Response(buildPdf([fakeJpeg(1), fakeJpeg(2)])).text();
    assert.ok(text.startsWith("%PDF-1.4"), "missing the header");
    assert.ok(text.trimEnd().endsWith("%%EOF"), "missing the trailer");
    assert.equal((text.match(/\/Type \/Page\b/g) ?? []).length, 2);
    assert.ok(text.includes("/Filter /DCTDecode"), "the pages should be JPEGs");
  });

  test("every cross-reference offset lands on its object", async () => {
    const bytes = new Uint8Array(await new Response(buildPdf([fakeJpeg(1), fakeJpeg(2), fakeJpeg(3)])).arrayBuffer());
    const text = new TextDecoder("latin1").decode(bytes);

    const startxref = Number(text.slice(text.lastIndexOf("startxref") + 9).trim().split(/\s/)[0]);
    assert.ok(Number.isFinite(startxref), "no startxref");
    assert.ok(text.slice(startxref).startsWith("xref"), "startxref does not point at the table");

    const table = text.slice(startxref).split("\n");
    const count = Number(table[1]?.split(" ")[1]);
    assert.equal(count, 3 + 3 * 3, "one object per page part, plus catalog and page tree");

    // Entry 0 is the free-list head; the rest must each land on "<id> 0 obj".
    for (let id = 1; id < count; id++) {
      // Two header lines, then the free-list entry, then one row per object.
      const offset = Number(table[id + 2]?.slice(0, 10));
      assert.ok(Number.isFinite(offset), `entry ${id} is not a number`);
      assert.ok(
        text.slice(offset).startsWith(`${id} 0 obj`),
        `entry ${id} points at "${text.slice(offset, offset + 12)}"`,
      );
    }
  });

  test("the image bytes survive unmangled", async () => {
    const image = fakeJpeg(0x42);
    const bytes = new Uint8Array(await new Response(buildPdf([image])).arrayBuffer());

    // The stream is written raw, so the exact sequence has to appear once.
    const haystack = new TextDecoder("latin1").decode(bytes);
    const needle = new TextDecoder("latin1").decode(image.bytes);
    assert.equal(haystack.split(needle).length - 1, 1);
  });

  test("names the file after the deck", () => {
    assert.equal(fileNameFor({ title: "Filip's 2025", rangeLabel: "2025" }, "pdf"), "filip-s-2025-2025.pdf");
    assert.equal(
      fileNameFor({ title: "Everything, so far", rangeLabel: "All time" }, "png", "Lenses"),
      "everything-so-far-all-time-lenses.png",
    );
  });
});

describe("the ZIP writer", () => {
  const file = (name: string, body: string) => ({ name, bytes: new TextEncoder().encode(body) });

  test("writes an archive a reader will recognise", async () => {
    const bytes = new Uint8Array(
      await new Response(buildZip([file("01-cameras.png", "one"), file("02-lenses.png", "two")])).arrayBuffer(),
    );
    const text = new TextDecoder("latin1").decode(bytes);

    // Local header, central directory, end of central directory.
    assert.equal(text.slice(0, 4), "PK");
    assert.ok(text.includes("PK"), "no central directory");
    assert.ok(text.includes("PK"), "no end record");
    assert.ok(text.includes("01-cameras.png") && text.includes("02-lenses.png"));
  });

  test("the offsets in the directory point at the files", async () => {
    const files = [file("01-a.png", "aaaa"), file("02-b.png", "bbbbbb"), file("03-c.png", "c")];
    const bytes = new Uint8Array(await new Response(buildZip(files)).arrayBuffer());
    const view = new DataView(bytes.buffer);
    const text = new TextDecoder("latin1").decode(bytes);

    const endAt = text.lastIndexOf("PK");
    assert.equal(view.getUint16(endAt + 10, true), files.length, "wrong entry count");

    // Walk the central directory and check each local header it points at.
    let at = view.getUint32(endAt + 16, true);
    for (const expected of files) {
      assert.equal(view.getUint32(at, true), 0x02014b50, "not a directory entry");
      const nameLength = view.getUint16(at + 28, true);
      const offset = view.getUint32(at + 42, true);

      assert.equal(view.getUint32(offset, true), 0x04034b50, "offset misses the local header");
      const localName = text.slice(offset + 30, offset + 30 + nameLength);
      assert.equal(localName, expected.name);

      const size = view.getUint32(offset + 22, true);
      assert.equal(size, expected.bytes.length, `${expected.name} has the wrong size`);
      at += 46 + nameLength;
    }
  });

  test("the bytes come back out unchanged", async () => {
    const body = "the exact bytes of a PNG would go here";
    const bytes = new Uint8Array(await new Response(buildZip([file("01-x.png", body)])).arrayBuffer());
    assert.equal(new TextDecoder("latin1").decode(bytes).split(body).length - 1, 1);
  });
});

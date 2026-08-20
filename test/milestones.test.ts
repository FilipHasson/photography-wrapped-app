import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  anchorRangeLabel,
  coerceAnchor,
  defaultConfig,
  draftAnchorLabel,
  loadConfig,
  makeAnchor,
  saveConfig,
} from "../src/core/config.ts";

/**
 * Milestones point at gear rather than describing it, and the pointer is the
 * same key the index groups by. Two things have to stay true for that to be
 * safe: a config written before categories existed still loads, and a category
 * with nothing behind it never survives as one.
 */

let home = "";
let previousHome: string | undefined;

before(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), "wdis-config-"));
  previousHome = process.env.WHAT_DID_I_SHOOT_HOME;
  process.env.WHAT_DID_I_SHOOT_HOME = home;
});

after(async () => {
  if (previousHome === undefined) delete process.env.WHAT_DID_I_SHOOT_HOME;
  else process.env.WHAT_DID_I_SHOOT_HOME = previousHome;
  await fs.rm(home, { recursive: true, force: true });
});

describe("reading a milestone back", () => {
  test("one written before categories existed is still a milestone", () => {
    const anchor = coerceAnchor({ id: "a9", label: "Bought the a9 III", day: 20231115 });
    assert.equal(anchor?.kind, "custom");
    assert.equal(anchor?.label, "Bought the a9 III");
    assert.equal(anchor?.gear, undefined);
  });

  test("a category carries the gear it is about", () => {
    const anchor = coerceAnchor({
      label: "Sold the 1.4x",
      day: 20240301,
      kind: "sold",
      gear: { dimension: "teleconverter", key: "1.4x" },
    });
    assert.equal(anchor?.kind, "sold");
    assert.deepEqual(anchor?.gear, { dimension: "teleconverter", key: "1.4x" });
  });

  test("a category with nothing behind it is not a category", () => {
    const anchor = coerceAnchor({ label: "Bought something", day: 20240301, kind: "bought" });
    assert.equal(anchor?.kind, "custom");
    assert.equal(anchor?.gear, undefined);
  });

  test("gear the shape does not recognise is dropped, and the date survives", () => {
    const anchor = coerceAnchor({
      label: "Bought a tripod",
      day: 20240301,
      kind: "bought",
      gear: { dimension: "tripod", key: "rrs" },
    });
    assert.equal(anchor?.kind, "custom");
    assert.equal(anchor?.day, 20240301);
  });

  test("no label and no date, no milestone", () => {
    assert.equal(coerceAnchor({ label: "", day: 20240301 }), null);
    assert.equal(coerceAnchor({ label: "Something", day: 20241332 }), null);
    assert.equal(coerceAnchor("Bought the a9 III"), null);
  });
});

describe("making one", () => {
  test("the id survives a rename, and two of a name do not collide", () => {
    const first = makeAnchor("Bought the a9 III", 20231115, []);
    const second = makeAnchor("Bought the a9 III", 20240210, [first.id]);
    assert.equal(first.id, "bought-the-a9-iii");
    assert.notEqual(second.id, first.id);
  });

  test("gear only rides along with a category that wants it", () => {
    const gear = { dimension: "camera" as const, key: "ilce9m3" };
    assert.deepEqual(makeAnchor("Bought it", 20231115, [], { kind: "bought", gear }).gear, gear);
    assert.equal(makeAnchor("Moved to Lisbon", 20231115, [], { kind: "custom", gear }).gear, undefined);
  });

  test("the draft label says what happened", () => {
    assert.equal(draftAnchorLabel("bought", "a9 III"), "Bought the a9 III");
    assert.equal(draftAnchorLabel("sold", "1.4x teleconverter"), "Sold the 1.4x teleconverter");
    assert.equal(draftAnchorLabel("custom", "Moved to Lisbon"), "Moved to Lisbon");
  });

  test("a range built from one reads as a sentence", () => {
    const bought = makeAnchor("Bought the a9 III", 20240917, [], {
      kind: "bought",
      gear: { dimension: "camera", key: "ilce9m3" },
    });
    const sold = makeAnchor("Sold the 70-200", 20240612, [], {
      kind: "sold",
      gear: { dimension: "lens", key: "z70200mmf28vrs" },
    });

    assert.equal(`Since ${anchorRangeLabel(bought)}`, "Since the a9 III");
    assert.equal(`Since ${anchorRangeLabel(sold)}`, "Since selling the 70-200");

    // A label the reader has rewritten is theirs, and is printed as written.
    assert.equal(anchorRangeLabel({ ...bought, label: "The a9 arrived" }), "The a9 arrived");
    assert.equal(anchorRangeLabel(makeAnchor("Moved to Lisbon", 20220401, [])), "Moved to Lisbon");
  });
});

describe("a config full of them", () => {
  test("survives a round trip, categories and all", async () => {
    const config = defaultConfig();
    config.anchors = [
      makeAnchor("Sold the 70-200", 20240612, [], {
        kind: "sold",
        gear: { dimension: "lens", key: "z70200mmf28vrs" },
      }),
      makeAnchor("Moved to Lisbon", 20220401, []),
    ];

    await saveConfig(config);
    const read = await loadConfig();

    // Sorted by day, whatever order they were added in.
    assert.deepEqual(
      read.anchors.map((a) => [a.day, a.kind]),
      [
        [20220401, "custom"],
        [20240612, "sold"],
      ],
    );
    assert.deepEqual(read.anchors[1]?.gear, { dimension: "lens", key: "z70200mmf28vrs" });
  });

  test("a hand-edited file with two milestones of one name keeps both", async () => {
    await fs.writeFile(
      path.join(home, "config.json"),
      JSON.stringify({
        anchors: [
          { label: "Bought a body", day: 20200101 },
          { label: "Bought a body", day: 20230101 },
        ],
      }),
      "utf8",
    );

    const read = await loadConfig();
    assert.equal(read.anchors.length, 2);
    assert.notEqual(read.anchors[0]?.id, read.anchors[1]?.id);
  });
});

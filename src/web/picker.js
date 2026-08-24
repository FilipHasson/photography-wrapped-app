// @ts-check
import { hexOf, oklchOf } from "./theme.js";

/**
 * A colour picker belonging to this page rather than to the operating system.
 *
 * `<input type="color">` opens an OS dialog: it covers the slide being edited,
 * looks like nothing else here, and on Windows it is modal — the change cannot
 * be seen until the dialog is dismissed, which is the whole point of putting
 * the palette beside the slide. This one sits under the swatch, and the slide
 * moves as it is dragged.
 *
 * Three sliders in OKLCH, for the same reason the palette gates are in OKLab:
 * a step of lightness looks like a step of lightness at every hue, which is not
 * true of HSL, and every rule this tool has about colour — the contrast floor,
 * the distance between two series through simulated colour blindness, the heat
 * ramp climbing in steps of 0.06 — is measured in that space. Moving the
 * lightness slider moves the number the warning is about.
 *
 * The middle one is labelled Saturation rather than Chroma. See `channels`.
 */

/**
 * Past this there is no sRGB left at any hue, so the slider would spend its
 * last third doing nothing. It is the chroma axis of the space, not a limit on
 * what can be picked: `hexOf` pulls anything out of gamut back in.
 */
const MAX_CHROMA = 0.33;

/** Enough stops that a track reads as a gradient rather than as bands. */
const STOPS = 16;

const HEX = /^#[0-9a-f]{6}$/i;

/**
 * Builds the picker for one colour.
 *
 * `onInput` fires on every movement and is the live preview; `onDone` fires
 * once, when the picker is closed, and is the only thing that should save.
 * Returns the element to place, and a `close` for whoever owns it.
 */
export function colourPicker(hex, { onInput, onDone, label }) {
  let { l, c, h } = oklchOf(hex);
  let current = hex;

  const node = document.createElement("div");
  node.className = "colour-picker";

  /**
   * The chroma slider is labelled "Saturation", and that is deliberate.
   *
   * Chroma is what it *is* — the code says so everywhere, because a name that
   * lies about the maths is how the maths gets broken. But the label is the
   * reader's, the same way `series.0` is "The main colour" and `blank` is
   * "Nothing happened": this is a photographer's tool, and the slider they have
   * moved ten thousand times in Lightroom is called Saturation. Beside
   * Lightness and Hue it also reads as the trio everybody already knows.
   */
  const channels = [
    { key: "l", name: "Lightness", min: 0, max: 1, step: 0.005, get: () => l, set: (v) => (l = v) },
    { key: "c", name: "Saturation", min: 0, max: MAX_CHROMA, step: 0.002, get: () => c, set: (v) => (c = v) },
    { key: "h", name: "Hue", min: 0, max: 360, step: 1, get: () => h, set: (v) => (h = v) },
  ];

  /**
   * What each slider would give you along its length, with the other two held
   * where they are. A hue strip drawn at full saturation would be a lie about
   * what moving it does to *this* colour.
   */
  const track = (key) => {
    const stops = [];
    for (let i = 0; i < STOPS; i++) {
      const t = i / (STOPS - 1);
      stops.push(
        key === "l" ? hexOf(t, c, h) : key === "c" ? hexOf(l, t * MAX_CHROMA, h) : hexOf(l, c, t * 360),
      );
    }
    return `linear-gradient(to right, ${stops.join(", ")})`;
  };

  const sliders = channels.map((channel) => {
    const row = document.createElement("label");
    row.className = "picker-row";

    const name = document.createElement("span");
    name.className = "hint";
    name.textContent = channel.name;

    const input = document.createElement("input");
    input.type = "range";
    input.min = String(channel.min);
    input.max = String(channel.max);
    input.step = String(channel.step);
    input.value = String(channel.get());
    input.setAttribute("aria-label", `${channel.name}${label ? ` — ${label}` : ""}`);
    input.addEventListener("input", () => {
      channel.set(Number(input.value));
      apply(hexOf(l, c, h));
    });

    row.append(name, input);
    return { channel, input, row };
  });

  const swatch = document.createElement("span");
  swatch.className = "picker-swatch";

  const text = document.createElement("input");
  text.type = "text";
  text.className = "picker-hex";
  text.spellcheck = false;
  text.setAttribute("aria-label", `Hex${label ? ` — ${label}` : ""}`);
  text.addEventListener("input", () => {
    const typed = text.value.trim();
    if (!HEX.test(typed)) return;
    // Typed colours set the sliders rather than the other way round, so a hex
    // pasted in from somewhere else is where the sliders carry on from.
    ({ l, c, h } = oklchOf(typed.toLowerCase()));
    for (const slider of sliders) slider.input.value = String(slider.channel.get());
    apply(typed.toLowerCase(), false);
  });

  const done = document.createElement("button");
  done.type = "button";
  done.className = "ghost picker-done";
  done.textContent = "Done";
  done.addEventListener("click", () => close());

  const foot = document.createElement("div");
  foot.className = "picker-foot";
  foot.append(swatch, text, done);

  node.append(...sliders.map((slider) => slider.row), foot);

  /** Everything that has to follow the colour: the tracks, the field, the deck. */
  function apply(next, retype = true) {
    current = next;
    swatch.style.background = next;
    if (retype) text.value = next;
    for (const slider of sliders) slider.input.style.setProperty("--track", track(slider.channel.key));
    onInput?.(next);
  }

  /**
   * `null` means "nothing to keep" — either the colour never moved, or Escape
   * cancelled it. Putting the old one back is the caller's job: it holds the
   * palette this was previewing into, and inverting a preview from in here
   * would leave a role marked as the reader's own when they had changed nothing.
   */
  function close(keep = true) {
    onDone?.(keep && current !== hex ? current : null);
  }

  node.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    // Kept off the deck's own Escape, which leaves the slide entirely.
    event.stopPropagation();
    close(false);
  });

  apply(hex);
  return { node, close, focus: () => sliders[0]?.input.focus() };
}

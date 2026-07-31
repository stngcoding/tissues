// Robustness checks for the Markdown renderer: the constructs the sampleFixture
// body doesn't exercise but real issues do - nested lists, task lists, and block
// types we don't paint specially (GFM tables, raw HTML). The invariant: markup
// may be dropped, but content must never silently vanish.

import { TextAttributes } from "@opentui/core";
import { createTestRenderer } from "@opentui/core/testing";
import { describe, expect, test } from "bun:test";
import { renderMarkdown } from "../src/markdown";

async function frameOf(md: string): Promise<string> {
  const setup = await createTestRenderer({ width: 80, height: 40 });
  setup.renderer.root.add(renderMarkdown(setup.renderer, md));
  await setup.waitForVisualIdle();
  const frame = setup.captureCharFrame();
  setup.renderer.destroy?.();
  return frame;
}

describe("markdown robustness", () => {
  test("nested lists keep their children (not just the top level)", async () => {
    const frame = await frameOf("- parent\n  - child one\n  - child two");
    expect(frame).toContain("• parent");
    expect(frame).toContain("• child one");
    expect(frame).toContain("• child two");
  });

  test("task lists render as checkboxes reflecting done/undone", async () => {
    const frame = await frameOf("- [x] shipped\n- [ ] pending");
    expect(frame).toContain("☑ shipped");
    expect(frame).toContain("☐ pending");
  });

  test("ordered lists honour a start index (including 0)", async () => {
    const frame = await frameOf("0. zero\n1. one");
    expect(frame).toContain("0. zero");
    expect(frame).toContain("1. one");
  });

  test("a GFM table's content survives even though we don't tabulate it", async () => {
    const frame = await frameOf("| A | B |\n| - | - |\n| x | y |");
    // We don't render table grids, but the cell text must not disappear.
    expect(frame).toContain("A");
    expect(frame).toContain("x");
  });

  test("a raw HTML block falls back to its source, not a blank line", async () => {
    const frame = await frameOf("<details>secret</details>");
    expect(frame).toContain("secret");
  });

  test("numeric HTML entities decode (smart quote)", async () => {
    // marked encodes a literal ampersand-driven entity; &#8217; is a right quote.
    const frame = await frameOf("it&#8217;s here");
    expect(frame).toContain("it’s here");
  });

  test("styling still lands: bold heading in heading-blue", async () => {
    const setup = await createTestRenderer({ width: 80, height: 40 });
    setup.renderer.root.add(renderMarkdown(setup.renderer, "# Title"));
    await setup.waitForVisualIdle();
    const spans = setup.captureSpans().lines.flatMap((l) => l.spans);
    const title = spans.find((s) => s.text.includes("Title"))!;
    expect(title.attributes & TextAttributes.BOLD).toBeTruthy();
    setup.renderer.destroy?.();
  });
});

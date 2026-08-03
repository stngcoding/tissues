// End-to-end tests: the real app (model + view + host) driven by synthetic
// keystrokes against a FakeGateway, rendered through OpenTUI's headless test
// renderer. Each test mirrors an acceptance criterion from the sliced tickets
// (#8, #10, #13, #14, #15, #16, #11, #17, #18). We assert on the actual
// character frame the user would see.

import { TextAttributes } from "@opentui/core";
import { afterEach, describe, expect, test } from "bun:test";
import { FakeGateway, sampleFixture } from "../src/fake-gateway";
import { mountApp } from "./testkit";

// Find the first rendered span whose text contains `needle`, so tests can assert
// on its actual color/attributes (the styling captureCharFrame throws away).
function findSpan(app: Awaited<ReturnType<typeof mountApp>>, needle: string) {
  for (const line of app.captureSpans().lines) {
    for (const span of line.spans) {
      if (span.text.includes(needle)) return span;
    }
  }
  return null;
}
const rgb = (c: { r: number; g: number; b: number }) => [c.r, c.g, c.b].map((x) => Math.round(x * 255)).join(",");

let active: { destroy: () => Promise<void> } | null = null;

afterEach(async () => {
  await active?.destroy();
  active = null;
});

async function mount(gateway: FakeGateway, opts = {}) {
  const app = await mountApp(gateway, opts);
  active = app;
  return app;
}

describe("#8 / #10 walking skeleton: list open issues", () => {
  test("boots straight into the latest open issues", async () => {
    const app = await mount(new FakeGateway(sampleFixture()));
    const frame = app.captureCharFrame();
    expect(frame).toContain("#42");
    expect(frame).toContain("#41");
    expect(frame).toContain("#40");
    expect(frame).toContain("OPEN");
    // The closed issue is not in the open set.
    expect(frame).not.toContain("#30");
  });

  test("the list header reflects the repo and open count", async () => {
    const app = await mount(new FakeGateway(sampleFixture()));
    expect(app.captureCharFrame()).toContain("OPEN (3)");
  });
});

describe("#13 open/closed toggle", () => {
  test("`o` flips the list to the closed set", async () => {
    const app = await mount(new FakeGateway(sampleFixture()));
    app.mockInput.pressKey("o");
    await app.waitForVisualIdle();
    const frame = app.captureCharFrame();
    expect(frame).toContain("CLOSED");
    expect(frame).toContain("#30");
    expect(frame).not.toContain("#42");
  });
});

describe("#14 detail pane: read body", () => {
  test("Enter loads the selected issue's body into the detail pane", async () => {
    const app = await mount(new FakeGateway(sampleFixture()));
    app.mockInput.pressEnter();
    await app.waitForVisualIdle();
    const frame = app.captureCharFrame();
    // Detail header + body text that lives only in the detail pane.
    expect(frame).toContain("Detect the repo");
  });

  test("body renders as real Markdown: heading, bold, list, boxed code block", async () => {
    const app = await mount(new FakeGateway(sampleFixture()));
    app.mockInput.pressEnter();
    await app.waitForVisualIdle();
    const frame = app.captureCharFrame();

    // Markdown markers are gone - not shown as literal plain text.
    expect(frame).not.toContain("## Goal");
    expect(frame).not.toContain("**before**");
    expect(frame).not.toContain("```");
    // List bullets and the fenced-code language label render.
    expect(frame).toContain("• step one");
    expect(frame).toContain("const x = 1;");

    // Heading is bold + heading-blue; bold text is bold; code is code-orange.
    const heading = findSpan(app, "Goal");
    expect(heading).not.toBeNull();
    expect(rgb(heading!.fg)).toBe("121,192,255");
    expect(heading!.attributes & TextAttributes.BOLD).toBeTruthy();

    expect(findSpan(app, "before")!.attributes & TextAttributes.BOLD).toBeTruthy();
    expect(rgb(findSpan(app, "const x = 1;")!.fg)).toBe("255,166,87");
  });
});

describe("#15 comments inline", () => {
  test("comment authors and bodies render below the issue body", async () => {
    const app = await mount(new FakeGateway(sampleFixture()));
    app.mockInput.pressEnter();
    await app.waitForVisualIdle();
    const frame = app.captureCharFrame();
    expect(frame).toContain("comments (2)");
    expect(frame).toContain("octocat"); // second comment's author
    expect(frame).toContain("Second comment");
  });

  test("an issue with no comments still opens cleanly", async () => {
    const app = await mount(new FakeGateway(sampleFixture()));
    app.mockInput.pressKey("j"); // move to #41 (0 comments)
    await app.waitForVisualIdle();
    app.mockInput.pressEnter();
    await app.waitForVisualIdle();
    const frame = app.captureCharFrame();
    expect(frame).toContain("comments (0)");
    expect(frame).toContain("latest open issues"); // #41 body text
  });
});

describe("#16 focus + jump navigation", () => {
  test("Tab cycles focus repos -> list -> detail", async () => {
    const app = await mount(new FakeGateway(sampleFixture()));
    app.mockInput.pressEnter();
    await app.waitForVisualIdle();
    // Enter already focuses detail; Tab then wraps through repos and back to list.
    expect(app.handle.getState().focus).toBe("detail");
    app.mockInput.pressTab();
    await app.waitForVisualIdle();
    expect(app.handle.getState().focus).toBe("repos");
    app.mockInput.pressTab();
    await app.waitForVisualIdle();
    expect(app.handle.getState().focus).toBe("list");
  });

  test("j/k move the selection; g/G jump to ends", async () => {
    const app = await mount(new FakeGateway(sampleFixture()));
    app.mockInput.pressKey("j");
    await app.waitForVisualIdle();
    expect(app.handle.getState().selectedIndex).toBe(1);
    app.mockInput.pressKey("G", { shift: true });
    await app.waitForVisualIdle();
    expect(app.handle.getState().selectedIndex).toBe(2);
    app.mockInput.pressKey("g");
    await app.waitForVisualIdle();
    expect(app.handle.getState().selectedIndex).toBe(0);
  });
});

describe("add repo + scrollable repo pane", () => {
  test("the repo pane shows the current repo above the issue list on boot", async () => {
    const app = await mount(new FakeGateway(sampleFixture()));
    const frame = app.captureCharFrame();
    expect(frame).toContain("Repos (1)");
    // Grouped by path: the owner is a header, the repo name sits under it.
    expect(frame).toContain("stngcoding/");
    expect(frame).toContain("tissues");
  });

  test("`a` then typing owner/repo adds it and makes it active", async () => {
    const app = await mount(new FakeGateway(sampleFixture()));
    app.mockInput.pressKey("a");
    await app.waitForVisualIdle();
    expect(app.captureCharFrame()).toContain("Add repo");
    for (const c of "octo/demo") app.mockInput.pressKey(c);
    app.mockInput.pressEnter();
    await app.waitForVisualIdle();
    const frame = app.captureCharFrame();
    expect(frame).toContain("Repos (2)");
    expect(frame).toContain("octo/"); // new owner group header
    expect(frame).toContain("demo");
  });

  test("`d` on the repo pane removes the highlighted repo", async () => {
    const app = await mount(new FakeGateway(sampleFixture()));
    // Add a second repo, then focus the repo pane and delete the highlighted one.
    app.mockInput.pressKey("a");
    await app.waitForVisualIdle();
    for (const c of "octo/demo") app.mockInput.pressKey(c);
    app.mockInput.pressEnter();
    await app.waitForVisualIdle();
    expect(app.captureCharFrame()).toContain("Repos (2)");

    app.mockInput.pressTab(); // list -> detail
    app.mockInput.pressTab(); // detail -> repos
    await app.waitForVisualIdle();
    app.mockInput.pressKey("d");
    await app.waitForVisualIdle();

    const frame = app.captureCharFrame();
    expect(frame).toContain("Repos (1)");
    expect(frame).not.toContain("demo"); // the octo/demo group is gone
  });
});

describe("#11 help overlay", () => {
  test("`?` opens the keybindings overlay, Esc closes it", async () => {
    const app = await mount(new FakeGateway(sampleFixture()));
    app.mockInput.pressKey("?");
    await app.waitForVisualIdle();
    expect(app.captureCharFrame()).toContain("Keybindings");
    app.mockInput.pressEscape();
    await app.waitForVisualIdle();
    expect(app.captureCharFrame()).not.toContain("Keybindings");
  });
});

describe("#17 close / reopen confirm flow", () => {
  test("`c` then Enter closes the issue and confirms via a toast", async () => {
    const gw = new FakeGateway(sampleFixture());
    const app = await mount(gw);
    app.mockInput.pressKey("c");
    await app.waitForVisualIdle();
    expect(app.captureCharFrame()).toContain("Close issue?");

    app.mockInput.pressEnter();
    await app.waitForVisualIdle();
    // The mutation ran and the list refreshed to the (now smaller) open set.
    expect(gw.calls.some((c) => c.method === "closeIssue" && c.arg === 42)).toBe(true);
    const frame = app.captureCharFrame();
    expect(frame).toContain("#42 closed");
    expect(frame).not.toContain("#42  Startup");
  });

  test("`c` then Esc cancels: no mutation", async () => {
    const gw = new FakeGateway(sampleFixture());
    const app = await mount(gw);
    app.mockInput.pressKey("c");
    await app.waitForVisualIdle();
    app.mockInput.pressEscape();
    await app.waitForVisualIdle();
    expect(gw.calls.some((c) => c.method === "closeIssue")).toBe(false);
    expect(app.captureCharFrame()).not.toContain("Close issue?");
  });

  test("`r` reopens a closed issue", async () => {
    const gw = new FakeGateway(sampleFixture());
    const app = await mount(gw);
    app.mockInput.pressKey("o"); // switch to closed set
    await app.waitForVisualIdle();
    app.mockInput.pressKey("r");
    await app.waitForVisualIdle();
    expect(app.captureCharFrame()).toContain("Reopen issue?");
    app.mockInput.pressEnter();
    await app.waitForVisualIdle();
    expect(gw.calls.some((c) => c.method === "reopenIssue" && c.arg === 30)).toBe(true);
    expect(app.captureCharFrame()).toContain("#30 reopened");
  });

  test("mutating the issue you're reading refreshes the detail pane (no stale badge)", async () => {
    const gw = new FakeGateway(sampleFixture());
    const app = await mount(gw);
    app.mockInput.pressKey("o"); // closed set
    await app.waitForVisualIdle();
    app.mockInput.pressEnter(); // open #30 - shows the completed badge
    await app.waitForVisualIdle();
    expect(app.captureCharFrame()).toContain("✓ completed");

    app.mockInput.pressKey("r"); // reopen it while reading
    await app.waitForVisualIdle();
    app.mockInput.pressEnter(); // confirm
    await app.waitForVisualIdle();

    // The pane re-fetched #30: it's open now, so the completed badge is gone
    // even though the title/comment-count (the old memo key) never changed.
    const frame = app.captureCharFrame();
    expect(frame).toContain("#30");
    expect(frame).not.toContain("✓ completed");
  });
});

describe("#18 resilience: empty + error states", () => {
  test("an empty open set shows an explicit message, not a blank pane", async () => {
    const app = await mount(new FakeGateway({ open: [], closed: [] }));
    expect(app.captureCharFrame()).toContain("No open issues.");
  });

  test("a list failure surfaces the error instead of crashing", async () => {
    const app = await mount(new FakeGateway({ listError: "rate limit exceeded" }));
    // The message wraps inside the narrow list pane, so assert on the stable prefix.
    expect(app.captureCharFrame()).toContain("Failed to load issues");
  });

  test("a detail failure surfaces in the detail pane; the app stays usable", async () => {
    const fx = sampleFixture();
    const gw = new FakeGateway({ open: fx.open, closed: fx.closed, getError: "not found" });
    const app = await mount(gw);
    app.mockInput.pressEnter();
    await app.waitForVisualIdle();
    expect(app.captureCharFrame()).toContain("not found");
    // Still responsive: help overlay opens.
    app.mockInput.pressKey("?");
    await app.waitForVisualIdle();
    expect(app.captureCharFrame()).toContain("Keybindings");
  });
});

describe("#8 quit", () => {
  test("`q` triggers the quit handler", async () => {
    const app = await mount(new FakeGateway(sampleFixture()));
    expect(app.didQuit()).toBe(false);
    app.mockInput.pressKey("q");
    expect(app.didQuit()).toBe(true);
  });
});

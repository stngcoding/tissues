// End-to-end tests: the real app (model + view + host) driven by synthetic
// keystrokes against a FakeGateway, rendered through OpenTUI's headless test
// renderer. Each test mirrors an acceptance criterion from the sliced tickets
// (#8, #10, #13, #14, #15, #16, #11, #17, #18). We assert on the actual
// character frame the user would see.

import { afterEach, describe, expect, test } from "bun:test";
import { FakeGateway, sampleFixture } from "../src/fake-gateway";
import { mountApp } from "./testkit";

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
  test("Tab moves focus to the detail pane", async () => {
    const app = await mount(new FakeGateway(sampleFixture()));
    app.mockInput.pressEnter();
    await app.waitForVisualIdle();
    // Enter already focuses detail; Tab flips back to the list.
    expect(app.handle.getState().focus).toBe("detail");
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

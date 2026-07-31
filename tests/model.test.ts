import { describe, expect, test } from "bun:test";
import type { IssueDetail, IssueSummary } from "../src/domain";
import { initialState, toViewModel, update, type AppState } from "../src/model";

const openIssues: IssueSummary[] = [
  { number: 42, title: "Alpha", state: "open" },
  { number: 41, title: "Beta", state: "open" },
  { number: 40, title: "Gamma", state: "open" },
];

function loaded(): AppState {
  const s = initialState("stngcoding/tissues");
  return update(s, { type: "ISSUES_LOADED", state: "open", issues: openIssues }).state;
}

describe("list behavior", () => {
  test("starts loading, then ready after ISSUES_LOADED", () => {
    const s0 = initialState("o/r");
    expect(s0.list.status).toBe("loading");
    const s1 = update(s0, { type: "ISSUES_LOADED", state: "open", issues: openIssues }).state;
    expect(s1.list.status).toBe("ready");
  });

  test("MOVE clamps at both ends", () => {
    let s = loaded();
    s = update(s, { type: "MOVE", delta: -1 }).state; // already at top
    expect(s.selectedIndex).toBe(0);
    s = update(s, { type: "MOVE", delta: 1 }).state;
    s = update(s, { type: "MOVE", delta: 1 }).state;
    s = update(s, { type: "MOVE", delta: 1 }).state; // past bottom
    expect(s.selectedIndex).toBe(2);
  });

  test("JUMP to top/bottom", () => {
    let s = loaded();
    s = update(s, { type: "JUMP", to: "bottom" }).state;
    expect(s.selectedIndex).toBe(2);
    s = update(s, { type: "JUMP", to: "top" }).state;
    expect(s.selectedIndex).toBe(0);
  });

  test("MOVE does nothing when detail is focused (native scroll instead)", () => {
    let s = loaded();
    s = update(s, { type: "TOGGLE_FOCUS" }).state;
    const before = s.selectedIndex;
    s = update(s, { type: "MOVE", delta: 1 }).state;
    expect(s.selectedIndex).toBe(before);
  });
});

describe("open/closed toggle", () => {
  test("o emits a LIST effect for the other set and flips header", () => {
    const s = loaded();
    const step = update(s, { type: "TOGGLE_LIST_STATE" });
    expect(step.state.listState).toBe("closed");
    expect(step.effects).toEqual([{ type: "LIST", state: "closed" }]);
    expect(toViewModel(step.state).listHeader).toContain("CLOSED");
  });
});

describe("open a detail", () => {
  test("Enter emits GET_ISSUE for the selected issue and focuses detail", () => {
    const s = loaded();
    const step = update(s, { type: "OPEN_SELECTED" });
    expect(step.effects).toEqual([{ type: "GET_ISSUE", number: 42 }]);
    expect(step.state.focus).toBe("detail");
    expect(step.state.detail.status).toBe("loading");
  });
});

describe("confirm flow", () => {
  const detail: IssueDetail = {
    number: 42,
    title: "Alpha",
    state: "open",
    stateReason: null,
    author: "me",
    createdAt: new Date().toISOString(),
    body: "body",
    comments: [],
    commentCount: 0,
  };

  test("c on an open issue opens the confirm overlay with reason completed", () => {
    const s = loaded();
    const step = update(s, { type: "REQUEST_CLOSE" });
    expect(step.state.overlay.kind).toBe("confirm");
    const vm = toViewModel(step.state);
    expect(vm.overlay.kind).toBe("confirm");
    if (vm.overlay.kind === "confirm") expect(vm.overlay.reasonLine).toBe("Reason: completed");
  });

  test("Esc cancels with no effect", () => {
    let s = update(loaded(), { type: "REQUEST_CLOSE" }).state;
    const step = update(s, { type: "CANCEL" });
    expect(step.effects).toEqual([]);
    expect(step.state.overlay.kind).toBe("none");
  });

  test("Enter confirms and emits a CLOSE effect", () => {
    const s = update(loaded(), { type: "REQUEST_CLOSE" }).state;
    const step = update(s, { type: "CONFIRM" });
    expect(step.effects).toEqual([{ type: "CLOSE", number: 42 }]);
    expect(step.state.overlay.kind).toBe("none");
  });

  test("MUTATION_DONE shows a toast and re-lists", () => {
    const s = loaded();
    const step = update(s, { type: "MUTATION_DONE", action: "close", number: 42 });
    expect(step.state.toast).toEqual({ text: "#42 closed", tone: "success" });
    expect(step.effects).toEqual([{ type: "LIST", state: "open" }]);
  });

  test("MUTATION_FAILED shows an error-toned toast (never a success check)", () => {
    const step = update(loaded(), { type: "MUTATION_FAILED", message: "Close failed: nope" });
    expect(step.state.toast).toEqual({ text: "Close failed: nope", tone: "error" });
    expect(step.effects).toEqual([]);
  });

  test("r is ignored on an open issue (nothing to reopen)", () => {
    const s = loaded();
    const step = update(s, { type: "REQUEST_REOPEN" });
    expect(step.state.overlay.kind).toBe("none");
  });

  void detail;
});

describe("help overlay", () => {
  test("? toggles help on and off", () => {
    let s = loaded();
    s = update(s, { type: "TOGGLE_HELP" }).state;
    expect(s.overlay.kind).toBe("help");
    s = update(s, { type: "TOGGLE_HELP" }).state;
    expect(s.overlay.kind).toBe("none");
  });
});

describe("view model", () => {
  test("rows carry a single selected marker and truncated titles", () => {
    const vm = toViewModel(loaded());
    expect(vm.rows.filter((r) => r.selected).length).toBe(1);
    expect(vm.rows[0]!.text).toContain("#42");
  });

  test("empty list yields an explicit message", () => {
    const s = update(initialState("o/r"), { type: "ISSUES_LOADED", state: "open", issues: [] }).state;
    const vm = toViewModel(s);
    expect(vm.listMessage).toBe("No open issues.");
  });

  test("list error surfaces the message", () => {
    const s = update(initialState("o/r"), {
      type: "ISSUES_FAILED",
      state: "open",
      message: "boom",
    }).state;
    expect(toViewModel(s).listMessage).toBe("boom");
  });
});

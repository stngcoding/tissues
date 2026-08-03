import { describe, expect, test } from "bun:test";
import type { IssueDetail, IssueSummary } from "../src/domain";
import { initialState, parseRepo, toViewModel, update, type AppState } from "../src/model";

const openIssues: IssueSummary[] = [
  { number: 42, title: "Alpha", state: "open" },
  { number: 41, title: "Beta", state: "open" },
  { number: 40, title: "Gamma", state: "open" },
];

const REPO = "stngcoding/tissues";

function loaded(): AppState {
  const s = initialState(REPO);
  return update(s, { type: "ISSUES_LOADED", repo: REPO, state: "open", issues: openIssues }).state;
}

describe("list behavior", () => {
  test("starts loading, then ready after ISSUES_LOADED", () => {
    const s0 = initialState("o/r");
    expect(s0.list.status).toBe("loading");
    const s1 = update(s0, { type: "ISSUES_LOADED", repo: "o/r", state: "open", issues: openIssues }).state;
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
    expect(step.effects).toEqual([{ type: "LIST", repo: REPO, state: "closed" }]);
    expect(toViewModel(step.state).listHeader).toContain("CLOSED");
  });
});

describe("reload (Shift+R)", () => {
  test("re-lists the current set, keeping selection", () => {
    let s = update(loaded(), { type: "MOVE", delta: 1 }).state; // select index 1
    const step = update(s, { type: "RELOAD" });
    expect(step.state.list.status).toBe("loading");
    expect(step.state.selectedIndex).toBe(1);
    expect(step.effects).toEqual([{ type: "LIST", repo: REPO, state: "open" }]);
  });
});

describe("go to issue (s)", () => {
  test("s opens the prompt; digits build the query", () => {
    let s = update(loaded(), { type: "REQUEST_GOTO" }).state;
    expect(s.overlay).toEqual({ kind: "goto", query: "" });
    s = update(s, { type: "GOTO_APPEND", char: "4" }).state;
    s = update(s, { type: "GOTO_APPEND", char: "1" }).state;
    s = update(s, { type: "GOTO_BACKSPACE" }).state;
    s = update(s, { type: "GOTO_APPEND", char: "0" }).state;
    expect(s.overlay).toEqual({ kind: "goto", query: "40" });
  });

  test("submit loads that issue by number and focuses detail", () => {
    let s = update(loaded(), { type: "REQUEST_GOTO" }).state;
    s = update(s, { type: "GOTO_APPEND", char: "4" }).state;
    s = update(s, { type: "GOTO_APPEND", char: "0" }).state;
    const step = update(s, { type: "GOTO_SUBMIT" });
    expect(step.effects).toEqual([{ type: "GET_ISSUE", repo: REPO, number: 40 }]);
    expect(step.state.detail).toMatchObject({ status: "loading", number: 40 });
    expect(step.state.focus).toBe("detail");
    expect(step.state.selectedIndex).toBe(2); // #40 is in the list, so it highlights
    expect(step.state.overlay.kind).toBe("none");
  });

  test("submit works for a number not in the current list", () => {
    let s = update(loaded(), { type: "REQUEST_GOTO" }).state;
    s = update(s, { type: "GOTO_APPEND", char: "9" }).state;
    s = update(s, { type: "GOTO_APPEND", char: "9" }).state;
    const step = update(s, { type: "GOTO_SUBMIT" });
    expect(step.effects).toEqual([{ type: "GET_ISSUE", repo: REPO, number: 99 }]);
    expect(step.state.detail).toMatchObject({ status: "loading", number: 99 });
  });

  test("empty submit just closes the prompt", () => {
    let s = update(loaded(), { type: "REQUEST_GOTO" }).state;
    const step = update(s, { type: "GOTO_SUBMIT" });
    expect(step.effects).toEqual([]);
    expect(step.state.overlay.kind).toBe("none");
  });
});

describe("detail tracks selection", () => {
  test("list load previews the top issue without waiting for Enter", () => {
    const s0 = initialState(REPO);
    const step = update(s0, { type: "ISSUES_LOADED", repo: REPO, state: "open", issues: openIssues });
    expect(step.effects).toEqual([{ type: "GET_ISSUE", repo: REPO, number: 42 }]);
    expect(step.state.detail).toMatchObject({ status: "loading", number: 42 });
    expect(step.state.focus).toBe("list"); // stays in the list to keep browsing
  });

  test("MOVE loads the newly selected issue's detail live", () => {
    const step = update(loaded(), { type: "MOVE", delta: 1 });
    expect(step.effects).toEqual([{ type: "GET_ISSUE", repo: REPO, number: 41 }]);
    expect(step.state.detail).toMatchObject({ status: "loading", number: 41 });
    expect(step.state.focus).toBe("list");
  });

  test("JUMP loads the jumped-to issue's detail live", () => {
    const step = update(loaded(), { type: "JUMP", to: "bottom" });
    expect(step.effects).toEqual([{ type: "GET_ISSUE", repo: REPO, number: 40 }]);
    expect(step.state.detail).toMatchObject({ status: "loading", number: 40 });
  });

  test("Enter focuses the detail pane; no re-fetch when already previewed", () => {
    const s = loaded(); // detail already tracking #42
    const step = update(s, { type: "OPEN_SELECTED" });
    expect(step.effects).toEqual([]);
    expect(step.state.focus).toBe("detail");
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
    expect(step.effects).toEqual([{ type: "CLOSE", repo: REPO, number: 42 }]);
    expect(step.state.overlay.kind).toBe("none");
  });

  test("MUTATION_DONE shows a toast and re-lists", () => {
    const s = loaded();
    const step = update(s, { type: "MUTATION_DONE", repo: REPO, action: "close", number: 42 });
    expect(step.state.toast).toEqual({ text: "#42 closed", tone: "success" });
    // Re-lists, and refetches the detail since the pane is previewing #42.
    expect(step.effects).toEqual([
      { type: "LIST", repo: REPO, state: "open" },
      { type: "GET_ISSUE", repo: REPO, number: 42 },
    ]);
  });

  test("MUTATION_FAILED shows an error-toned toast (never a success check)", () => {
    const step = update(loaded(), { type: "MUTATION_FAILED", repo: REPO, message: "Close failed: nope" });
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
    const s = update(initialState("o/r"), { type: "ISSUES_LOADED", repo: "o/r", state: "open", issues: [] }).state;
    const vm = toViewModel(s);
    expect(vm.listMessage).toBe("No open issues.");
  });

  test("list error surfaces the message", () => {
    const s = update(initialState("o/r"), {
      type: "ISSUES_FAILED",
      repo: "o/r",
      state: "open",
      message: "boom",
    }).state;
    expect(toViewModel(s).listMessage).toBe("boom");
  });
});

describe("repo list", () => {
  test("starts with the single detected repo, active and highlighted", () => {
    const vm = toViewModel(loaded());
    const repoName = REPO.split("/")[1]!;
    expect(vm.repoGroups).toEqual([
      { owner: "stngcoding", repos: [{ text: repoName, full: REPO, selected: true, active: true }] },
    ]);
    expect(vm.repoHeader).toBe("Repos (1)");
  });

  test("Tab cycles repos -> list -> detail -> repos", () => {
    let s = loaded();
    expect(s.focus).toBe("list");
    s = update(s, { type: "TOGGLE_FOCUS" }).state;
    expect(s.focus).toBe("detail");
    s = update(s, { type: "TOGGLE_FOCUS" }).state;
    expect(s.focus).toBe("repos");
    s = update(s, { type: "TOGGLE_FOCUS" }).state;
    expect(s.focus).toBe("list");
  });

  test("j/k move the repo highlight only while the repo pane is focused", () => {
    // Add a second repo so there is somewhere to move.
    let s = update(loaded(), { type: "REQUEST_ADDREPO" }).state;
    for (const c of "octo/cat") s = update(s, { type: "ADDREPO_APPEND", char: c }).state;
    s = update(s, { type: "ADDREPO_SUBMIT" }).state; // switches to octo/cat, focus -> list
    s = update(s, { type: "TOGGLE_FOCUS" }).state; // list -> detail
    s = update(s, { type: "TOGGLE_FOCUS" }).state; // detail -> repos
    expect(s.focus).toBe("repos");
    // Repos are sorted by owner: octo/cat (index 0) sits before stngcoding/tissues.
    expect(s.selectedRepoIndex).toBe(0);
    s = update(s, { type: "MOVE", delta: 1 }).state;
    expect(s.selectedRepoIndex).toBe(1);
    s = update(s, { type: "MOVE", delta: 1 }).state; // clamps at bottom
    expect(s.selectedRepoIndex).toBe(1);
  });

  test("Enter on a different repo switches active repo and re-lists it", () => {
    // Two repos, highlight the first (non-active) one, then Enter.
    let s = update(loaded(), { type: "REQUEST_ADDREPO" }).state;
    for (const c of "octo/cat") s = update(s, { type: "ADDREPO_APPEND", char: c }).state;
    s = update(s, { type: "ADDREPO_SUBMIT" }).state; // active = octo/cat
    s = update(s, { type: "TOGGLE_FOCUS" }).state;
    s = update(s, { type: "TOGGLE_FOCUS" }).state; // focus repos
    s = update(s, { type: "MOVE", delta: 1 }).state; // highlight REPO (sorts after octo/cat)
    const step = update(s, { type: "OPEN_SELECTED" });
    expect(step.state.repo).toBe(REPO);
    expect(step.state.list.status).toBe("loading");
    expect(step.state.focus).toBe("list");
    expect(step.effects).toEqual([{ type: "LIST", repo: REPO, state: "open" }]);
  });

  test("Enter on the already-active repo just drops focus into its issue list", () => {
    let s = update(loaded(), { type: "TOGGLE_FOCUS" }).state; // detail
    s = update(s, { type: "TOGGLE_FOCUS" }).state; // repos (only one, already active)
    const step = update(s, { type: "OPEN_SELECTED" });
    expect(step.state.repo).toBe(REPO);
    expect(step.state.focus).toBe("list");
    expect(step.effects).toEqual([]);
  });
});

describe("add repo (a)", () => {
  test("a opens the prompt; chars build an owner/repo query", () => {
    let s = update(loaded(), { type: "REQUEST_ADDREPO" }).state;
    expect(s.overlay).toEqual({ kind: "addrepo", query: "" });
    for (const c of "octo/ca") s = update(s, { type: "ADDREPO_APPEND", char: c }).state;
    s = update(s, { type: "ADDREPO_APPEND", char: "x" }).state; // typo
    s = update(s, { type: "ADDREPO_BACKSPACE" }).state; // corrected
    s = update(s, { type: "ADDREPO_APPEND", char: "t" }).state;
    expect(s.overlay).toEqual({ kind: "addrepo", query: "octo/cat" });
  });

  test("submitting a new repo appends it, makes it active, and lists it", () => {
    let s = update(loaded(), { type: "REQUEST_ADDREPO" }).state;
    for (const c of "octo/cat") s = update(s, { type: "ADDREPO_APPEND", char: c }).state;
    const step = update(s, { type: "ADDREPO_SUBMIT" });
    expect(step.state.repos).toEqual(["octo/cat", REPO]); // sorted by owner
    expect(step.state.repo).toBe("octo/cat");
    expect(step.state.selectedRepoIndex).toBe(0);
    expect(step.state.overlay.kind).toBe("none");
    expect(step.effects).toEqual([{ type: "LIST", repo: "octo/cat", state: "open" }]);
  });

  test("a malformed entry (no slash) is rejected and just closes the prompt", () => {
    let s = update(loaded(), { type: "REQUEST_ADDREPO" }).state;
    for (const c of "nope") s = update(s, { type: "ADDREPO_APPEND", char: c }).state;
    const step = update(s, { type: "ADDREPO_SUBMIT" });
    expect(step.state.repos).toEqual([REPO]);
    expect(step.state.overlay.kind).toBe("none");
    expect(step.effects).toEqual([]);
  });

  test("re-adding a known repo doesn't duplicate it; switches if not active", () => {
    // Add octo/cat (active), then add REPO again -> should switch back, no dup.
    let s = update(loaded(), { type: "REQUEST_ADDREPO" }).state;
    for (const c of "octo/cat") s = update(s, { type: "ADDREPO_APPEND", char: c }).state;
    s = update(s, { type: "ADDREPO_SUBMIT" }).state;
    s = update(s, { type: "REQUEST_ADDREPO" }).state;
    for (const c of REPO) s = update(s, { type: "ADDREPO_APPEND", char: c }).state;
    const step = update(s, { type: "ADDREPO_SUBMIT" });
    expect(step.state.repos).toEqual(["octo/cat", REPO]); // sorted by owner
    expect(step.state.repo).toBe(REPO);
    expect(step.effects).toEqual([{ type: "LIST", repo: REPO, state: "open" }]);
  });

  test("a stale result from the previous repo is ignored after switching", () => {
    let s = update(loaded(), { type: "REQUEST_ADDREPO" }).state;
    for (const c of "octo/cat") s = update(s, { type: "ADDREPO_APPEND", char: c }).state;
    s = update(s, { type: "ADDREPO_SUBMIT" }).state; // now active = octo/cat, loading
    // A late listing from the OLD repo arrives - must not populate the list.
    const step = update(s, { type: "ISSUES_LOADED", repo: REPO, state: "open", issues: openIssues });
    expect(step.state.list.status).toBe("loading");
  });

  test("a mutation that resolves after switching repos is dropped (no wrong-repo toast/relist)", () => {
    // Switch to octo/cat, then a close from the OLD repo lands late.
    let s = update(loaded(), { type: "REQUEST_ADDREPO" }).state;
    for (const c of "octo/cat") s = update(s, { type: "ADDREPO_APPEND", char: c }).state;
    s = update(s, { type: "ADDREPO_SUBMIT" }).state; // active = octo/cat
    const step = update(s, { type: "MUTATION_DONE", repo: REPO, action: "close", number: 42 });
    expect(step.state.toast).toBeNull(); // no "#42 closed" over octo/cat
    expect(step.effects).toEqual([]); // no relist/refetch of the wrong repo
  });
});

describe("delete repo (d)", () => {
  // Two repos, focus on the repo pane, highlighting the row that equals `repo`.
  // Sorted order is [octo/cat (active), stngcoding/tissues].
  function twoReposFocused(repo: string) {
    let s = update(loaded(), { type: "REQUEST_ADDREPO" }).state;
    for (const c of "octo/cat") s = update(s, { type: "ADDREPO_APPEND", char: c }).state;
    s = update(s, { type: "ADDREPO_SUBMIT" }).state; // active octo/cat
    s = update(s, { type: "TOGGLE_FOCUS" }).state; // list -> detail
    s = update(s, { type: "TOGGLE_FOCUS" }).state; // detail -> repos
    const target = s.repos.indexOf(repo);
    while (s.selectedRepoIndex < target) s = update(s, { type: "MOVE", delta: 1 }).state;
    while (s.selectedRepoIndex > target) s = update(s, { type: "MOVE", delta: -1 }).state;
    return s;
  }

  test("removing a non-active repo drops it and leaves the active list untouched", () => {
    const s = twoReposFocused(REPO); // highlight REPO (not active; octo/cat is)
    const step = update(s, { type: "DELETE_REPO" });
    expect(step.state.repos).toEqual(["octo/cat"]);
    expect(step.state.repo).toBe("octo/cat"); // still active
    expect(step.effects).toEqual([]); // no re-list; active list unchanged
  });

  test("removing the active repo switches to the neighbour and re-lists it", () => {
    const s = twoReposFocused("octo/cat"); // highlight octo/cat (the active one)
    const step = update(s, { type: "DELETE_REPO" });
    expect(step.state.repos).toEqual([REPO]);
    expect(step.state.repo).toBe(REPO); // switched to survivor
    expect(step.state.list.status).toBe("loading");
    expect(step.effects).toEqual([{ type: "LIST", repo: REPO, state: "open" }]);
  });

  test("d does nothing unless the repo pane is focused", () => {
    let s = update(loaded(), { type: "REQUEST_ADDREPO" }).state;
    for (const c of "octo/cat") s = update(s, { type: "ADDREPO_APPEND", char: c }).state;
    s = update(s, { type: "ADDREPO_SUBMIT" }).state; // focus is "list"
    const step = update(s, { type: "DELETE_REPO" });
    expect(step.state.repos).toEqual(["octo/cat", REPO]); // sorted, unchanged
  });

  test("the last remaining repo can't be deleted", () => {
    let s = update(loaded(), { type: "TOGGLE_FOCUS" }).state; // detail
    s = update(s, { type: "TOGGLE_FOCUS" }).state; // repos
    const step = update(s, { type: "DELETE_REPO" });
    expect(step.state.repos).toEqual([REPO]);
    expect(step.effects).toEqual([]);
  });
});

describe("parseRepo (URL / paste normalisation)", () => {
  test.each([
    ["octo/cat", "octo/cat"],
    ["  octo/cat  ", "octo/cat"],
    ["octo/cat/", "octo/cat"],
    ["https://github.com/octo/cat", "octo/cat"],
    ["https://github.com/octo/cat.git", "octo/cat"],
    ["https://github.com/octo/cat/issues/3", "octo/cat"],
    ["github.com/octo/cat", "octo/cat"],
    ["git@github.com:octo/cat.git", "octo/cat"],
  ])("%s -> %s", (input, expected) => {
    expect(parseRepo(input)).toBe(expected);
  });

  test.each(["", "nope", "/", "octo/", "/cat", "http://github.com/octo"])("%s -> null", (input) => {
    expect(parseRepo(input)).toBeNull();
  });

  test("pasting a full URL adds the repo (chunk arrives in one append)", () => {
    let s = update(loaded(), { type: "REQUEST_ADDREPO" }).state;
    s = update(s, { type: "ADDREPO_APPEND", char: "https://github.com/octo/cat" }).state;
    const step = update(s, { type: "ADDREPO_SUBMIT" });
    expect(step.state.repos).toContain("octo/cat");
    expect(step.state.repo).toBe("octo/cat");
  });

  test("a URL for a repo already tracked doesn't duplicate it", () => {
    // Add via URL, then add the same repo via its bare slug: still one row.
    let s = update(loaded(), { type: "REQUEST_ADDREPO" }).state;
    s = update(s, { type: "ADDREPO_APPEND", char: "https://github.com/octo/cat" }).state;
    s = update(s, { type: "ADDREPO_SUBMIT" }).state;
    s = update(s, { type: "REQUEST_ADDREPO" }).state;
    s = update(s, { type: "ADDREPO_APPEND", char: "OCTO/CAT" }).state; // different case
    const step = update(s, { type: "ADDREPO_SUBMIT" });
    expect(step.state.repos.filter((r) => r.toLowerCase() === "octo/cat")).toHaveLength(1);
  });
});

describe("group repos by path (owner)", () => {
  test("repos cluster under one header per owner, sorted", () => {
    // Add three repos across two owners in a jumbled order.
    let s = loaded();
    for (const r of ["zeta/one", "octo/cat", "octo/ant"]) {
      s = update(s, { type: "REQUEST_ADDREPO" }).state;
      s = update(s, { type: "ADDREPO_APPEND", char: r }).state;
      s = update(s, { type: "ADDREPO_SUBMIT" }).state;
    }
    const groups = toViewModel(s).repoGroups;
    // Owners sorted; octo's repos sorted within the group.
    expect(groups.map((g) => g.owner)).toEqual(["octo", "stngcoding", "zeta"]);
    const octo = groups[0]!;
    expect(octo.repos.map((r) => r.text)).toEqual(["ant", "cat"]);
    expect(octo.repos.every((r) => r.full.startsWith("octo/"))).toBe(true);
  });
});

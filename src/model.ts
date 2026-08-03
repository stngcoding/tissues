// The pure app model: (state, event) -> { state, viewModel, effects }.
// It owns ALL behavior (selection, open/closed toggle, focus, confirm flow,
// loading/error). It performs no I/O; instead it emits `effects` (data
// requests) that the host runs against the GitHubGateway, feeding results back
// in as more events. The `viewModel` is a plain-data projection the render
// layer paints verbatim.

import type { IssueDetail, IssueState, IssueSummary } from "./domain";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export type Focus = "repos" | "list" | "detail";

type ListData =
  | { status: "loading" }
  | { status: "ready"; issues: IssueSummary[] }
  | { status: "error"; message: string };

type DetailData =
  | { status: "empty" }
  | { status: "loading"; number: number }
  | { status: "ready"; issue: IssueDetail }
  | { status: "error"; number: number; message: string };

export type Overlay =
  | { kind: "none" }
  | { kind: "help" }
  | { kind: "goto"; query: string } // "s": type an issue number, Enter to open it
  | { kind: "addrepo"; query: string } // "a": type "owner/repo", Enter to add + switch
  | { kind: "confirm"; action: "close" | "reopen"; number: number; title: string };

// A transient status line. `tone` drives its color + icon so a failed mutation
// never renders with a success checkmark.
export interface Toast {
  text: string;
  tone: "success" | "error";
}

export interface AppState {
  repos: string[]; // known repos, "owner/repo" each; the top-pane list
  selectedRepoIndex: number; // which repo row is highlighted
  repo: string; // the ACTIVE repo whose issues are loaded ("owner/repo")
  listState: IssueState;
  list: ListData;
  selectedIndex: number;
  focus: Focus;
  detail: DetailData;
  overlay: Overlay;
  toast: Toast | null;
}

export function initialState(repo: string): AppState {
  return {
    repos: [repo],
    selectedRepoIndex: 0,
    repo,
    listState: "open",
    list: { status: "loading" },
    selectedIndex: 0,
    focus: "list",
    detail: { status: "empty" },
    overlay: { kind: "none" },
    toast: null,
  };
}

// ---------------------------------------------------------------------------
// Events (semantic - the host translates raw keypresses into these)
// ---------------------------------------------------------------------------

export type Event =
  // input
  | { type: "MOVE"; delta: number } // list selection, when list focused
  | { type: "JUMP"; to: "top" | "bottom" } // g / G, when list focused
  | { type: "OPEN_SELECTED" } // Enter
  | { type: "TOGGLE_FOCUS" } // Tab
  | { type: "TOGGLE_LIST_STATE" } // o
  | { type: "RELOAD" } // Shift+R: re-fetch the current list
  | { type: "REQUEST_CLOSE" } // c
  | { type: "REQUEST_REOPEN" } // r
  | { type: "REQUEST_GOTO" } // s: open the go-to-issue prompt
  | { type: "GOTO_APPEND"; char: string } // digit typed in the go-to prompt
  | { type: "GOTO_BACKSPACE" } // Backspace in the go-to prompt
  | { type: "GOTO_SUBMIT" } // Enter in the go-to prompt
  | { type: "REQUEST_ADDREPO" } // a: open the add-repo prompt
  | { type: "ADDREPO_APPEND"; char: string } // char typed in the add-repo prompt
  | { type: "ADDREPO_BACKSPACE" } // Backspace in the add-repo prompt
  | { type: "ADDREPO_SUBMIT" } // Enter in the add-repo prompt
  | { type: "DELETE_REPO" } // d: remove the highlighted repo from the pane
  | { type: "CONFIRM" } // Enter in overlay
  | { type: "CANCEL" } // Esc
  | { type: "TOGGLE_HELP" } // ?
  // effect results (fed back by the host) - each carries the repo it came from
  // so a result for a repo we've since switched away from is dropped as stale.
  | { type: "ISSUES_LOADED"; repo: string; state: IssueState; issues: IssueSummary[] }
  | { type: "ISSUES_FAILED"; repo: string; state: IssueState; message: string }
  | { type: "ISSUE_LOADED"; repo: string; issue: IssueDetail }
  | { type: "ISSUE_FAILED"; repo: string; number: number; message: string }
  | { type: "MUTATION_DONE"; repo: string; action: "close" | "reopen"; number: number }
  | { type: "MUTATION_FAILED"; repo: string; message: string };

// ---------------------------------------------------------------------------
// Effects (data requests the host fulfils via the gateway)
// ---------------------------------------------------------------------------

export type Effect =
  | { type: "LIST"; repo: string; state: IssueState }
  | { type: "GET_ISSUE"; repo: string; number: number }
  | { type: "CLOSE"; repo: string; number: number }
  | { type: "REOPEN"; repo: string; number: number }
  | { type: "QUIT" };

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

export interface Step {
  state: AppState;
  viewModel: ViewModel;
  effects: Effect[];
}

function step(state: AppState, effects: Effect[] = []): Step {
  return { state, viewModel: toViewModel(state), effects };
}

function selectedIssue(state: AppState): IssueSummary | null {
  if (state.list.status !== "ready") return null;
  return state.list.issues[state.selectedIndex] ?? null;
}

/** The issue number the detail pane currently references, or null if none. */
function detailNumber(detail: DetailData): number | null {
  switch (detail.status) {
    case "ready":
      return detail.issue.number;
    case "loading":
    case "error":
      return detail.number;
    case "empty":
      return null;
  }
}

// Make the detail pane track the selected row: load the highlighted issue unless
// the pane already references it. This is what lets selection preview live,
// without waiting for Enter. Idempotent, so callers can invoke it freely.
function trackSelection(state: AppState): { detail: DetailData; effects: Effect[] } {
  const sel = selectedIssue(state);
  if (!sel) return { detail: state.detail, effects: [] };
  if (detailNumber(state.detail) === sel.number) return { detail: state.detail, effects: [] };
  return {
    detail: { status: "loading", number: sel.number },
    effects: [{ type: "GET_ISSUE", repo: state.repo, number: sel.number }],
  };
}

// Make `repo` the active repo: reset the issue list to loading and re-fetch it,
// clearing selection + detail so nothing from the previous repo lingers. Focus
// drops into the issue list so the user lands where the new issues appear.
function switchRepo(state: AppState, repo: string): Step {
  return step(
    {
      ...state,
      repo,
      list: { status: "loading" },
      selectedIndex: 0,
      focus: "list",
      detail: { status: "empty" },
      toast: null,
    },
    [{ type: "LIST", repo, state: state.listState }],
  );
}

export function update(state: AppState, event: Event): Step {
  // While an overlay is up it swallows navigation; only CONFIRM/CANCEL/help act.
  const overlayUp = state.overlay.kind !== "none";

  switch (event.type) {
    case "MOVE": {
      if (overlayUp) return step(state);
      if (state.focus === "repos") {
        const n = state.repos.length;
        if (n === 0) return step(state);
        const selectedRepoIndex = clamp(state.selectedRepoIndex + event.delta, 0, n - 1);
        return step({ ...state, selectedRepoIndex, toast: null });
      }
      if (state.focus !== "list" || state.list.status !== "ready") {
        // Detail-focused movement is native ScrollBox scrolling (host-handled).
        return step(state);
      }
      const n = state.list.issues.length;
      if (n === 0) return step(state);
      const selectedIndex = clamp(state.selectedIndex + event.delta, 0, n - 1);
      const moved = { ...state, selectedIndex, toast: null };
      const { detail, effects } = trackSelection(moved);
      return step({ ...moved, detail }, effects);
    }

    case "JUMP": {
      if (overlayUp) return step(state);
      if (state.focus === "repos") {
        const n = state.repos.length;
        if (n === 0) return step(state);
        const selectedRepoIndex = event.to === "top" ? 0 : n - 1;
        return step({ ...state, selectedRepoIndex, toast: null });
      }
      if (state.focus !== "list" || state.list.status !== "ready") {
        return step(state);
      }
      const n = state.list.issues.length;
      if (n === 0) return step(state);
      const selectedIndex = event.to === "top" ? 0 : n - 1;
      const jumped = { ...state, selectedIndex, toast: null };
      const { detail, effects } = trackSelection(jumped);
      return step({ ...jumped, detail }, effects);
    }

    case "TOGGLE_FOCUS": {
      if (overlayUp) return step(state);
      // Cycle repos -> list -> detail -> repos.
      const next: Record<Focus, Focus> = { repos: "list", list: "detail", detail: "repos" };
      return step({ ...state, focus: next[state.focus], toast: null });
    }

    case "OPEN_SELECTED": {
      if (overlayUp) return step(state);
      if (state.focus === "repos") {
        // Enter on a repo row activates it. If it's already the active repo,
        // just drop focus into its issue list rather than needlessly re-fetch.
        const target = state.repos[state.selectedRepoIndex];
        if (!target) return step(state);
        if (target === state.repo) return step({ ...state, focus: "list", toast: null });
        return switchRepo(state, target);
      }
      // Selection already previews the issue live; Enter just moves focus into
      // the detail pane (loading it too, on the off chance it isn't yet).
      const sel = selectedIssue(state);
      if (!sel) return step(state);
      const { detail, effects } = trackSelection(state);
      return step({ ...state, detail, focus: "detail", toast: null }, effects);
    }

    case "TOGGLE_LIST_STATE": {
      if (overlayUp) return step(state);
      const listState: IssueState = state.listState === "open" ? "closed" : "open";
      return step(
        { ...state, listState, list: { status: "loading" }, selectedIndex: 0, focus: "list", toast: null },
        [{ type: "LIST", repo: state.repo, state: listState }],
      );
    }

    case "RELOAD": {
      // Re-fetch the current set, keeping selection (ISSUES_LOADED re-clamps it).
      if (overlayUp) return step(state);
      return step({ ...state, list: { status: "loading" }, toast: null }, [
        { type: "LIST", repo: state.repo, state: state.listState },
      ]);
    }

    case "REQUEST_GOTO": {
      if (overlayUp) return step(state);
      return step({ ...state, overlay: { kind: "goto", query: "" }, toast: null });
    }

    case "GOTO_APPEND": {
      if (state.overlay.kind !== "goto") return step(state);
      if (state.overlay.query.length >= 9) return step(state); // no issue number is this long
      return step({ ...state, overlay: { kind: "goto", query: state.overlay.query + event.char } });
    }

    case "GOTO_BACKSPACE": {
      if (state.overlay.kind !== "goto") return step(state);
      return step({ ...state, overlay: { kind: "goto", query: state.overlay.query.slice(0, -1) } });
    }

    case "GOTO_SUBMIT": {
      if (state.overlay.kind !== "goto") return step(state);
      const n = Number.parseInt(state.overlay.query, 10);
      if (!Number.isFinite(n) || n <= 0) return step({ ...state, overlay: { kind: "none" } });
      // Load the issue by number directly - it need not be in the current list
      // (e.g. a closed issue while viewing the open set). If it happens to be in
      // the list, move selection there too so the row highlights.
      let selectedIndex = state.selectedIndex;
      if (state.list.status === "ready") {
        const idx = state.list.issues.findIndex((i) => i.number === n);
        if (idx >= 0) selectedIndex = idx;
      }
      return step(
        { ...state, overlay: { kind: "none" }, selectedIndex, detail: { status: "loading", number: n }, focus: "detail", toast: null },
        [{ type: "GET_ISSUE", repo: state.repo, number: n }],
      );
    }

    case "REQUEST_ADDREPO": {
      if (overlayUp) return step(state);
      return step({ ...state, overlay: { kind: "addrepo", query: "" }, toast: null });
    }

    case "ADDREPO_APPEND": {
      if (state.overlay.kind !== "addrepo") return step(state);
      // `char` may be a whole pasted chunk (e.g. a full GitHub URL), not one key.
      if (state.overlay.query.length >= 200) return step(state);
      return step({ ...state, overlay: { kind: "addrepo", query: state.overlay.query + event.char } });
    }

    case "ADDREPO_BACKSPACE": {
      if (state.overlay.kind !== "addrepo") return step(state);
      return step({ ...state, overlay: { kind: "addrepo", query: state.overlay.query.slice(0, -1) } });
    }

    case "ADDREPO_SUBMIT": {
      if (state.overlay.kind !== "addrepo") return step(state);
      // Accept a bare slug, a github.com URL, or an ssh remote - parseRepo pulls
      // the canonical "owner/repo" out of any of them. Unparseable just closes.
      const entry = parseRepo(state.overlay.query);
      if (!entry) return step({ ...state, overlay: { kind: "none" } });
      // Dedupe case-insensitively so "Owner/Repo" and a github.com URL for the
      // same repo can't both land as separate rows. Reuse the stored spelling.
      const existing = state.repos.findIndex((r) => sameRepo(r, entry));
      if (existing >= 0) {
        const known = state.repos[existing]!;
        const withSel = { ...state, selectedRepoIndex: existing, overlay: { kind: "none" as const } };
        return sameRepo(known, state.repo) ? step({ ...withSel, focus: "list" as const }) : switchRepo(withSel, known);
      }
      // Keep the pane grouped: sort by owner so same-owner repos sit together,
      // then point the highlight at the freshly added row.
      const repos = sortRepos([...state.repos, entry]);
      return switchRepo(
        { ...state, repos, selectedRepoIndex: repos.indexOf(entry), overlay: { kind: "none" } },
        entry,
      );
    }

    case "DELETE_REPO": {
      // Only the repo pane owns this key. Keep at least one repo so the app
      // always has an active repo to list.
      if (overlayUp || state.focus !== "repos" || state.repos.length <= 1) return step(state);
      const idx = state.selectedRepoIndex;
      const removed = state.repos[idx];
      if (!removed) return step(state);
      const repos = state.repos.filter((_, i) => i !== idx);
      const selectedRepoIndex = clamp(idx, 0, repos.length - 1);
      // Removing the active repo leaves nothing loaded, so switch to whatever
      // now sits under the highlight. Removing any other repo just shrinks the
      // pane - the active list stays exactly as it was.
      if (removed === state.repo) {
        return switchRepo({ ...state, repos, selectedRepoIndex }, repos[selectedRepoIndex]!);
      }
      return step({ ...state, repos, selectedRepoIndex, toast: null });
    }

    case "REQUEST_CLOSE": {
      if (overlayUp) return step(state);
      const sel = selectedIssue(state);
      if (!sel || sel.state !== "open") return step(state);
      return step({
        ...state,
        overlay: { kind: "confirm", action: "close", number: sel.number, title: sel.title },
      });
    }

    case "REQUEST_REOPEN": {
      if (overlayUp) return step(state);
      const sel = selectedIssue(state);
      if (!sel || sel.state !== "closed") return step(state);
      return step({
        ...state,
        overlay: { kind: "confirm", action: "reopen", number: sel.number, title: sel.title },
      });
    }

    case "TOGGLE_HELP": {
      if (state.overlay.kind === "help") return step({ ...state, overlay: { kind: "none" } });
      if (overlayUp) return step(state); // confirm overlay takes precedence
      return step({ ...state, overlay: { kind: "help" }, toast: null });
    }

    case "CANCEL": {
      // Esc dismisses whatever overlay is up; makes no gateway call.
      if (overlayUp) return step({ ...state, overlay: { kind: "none" } });
      return step(state);
    }

    case "CONFIRM": {
      if (state.overlay.kind !== "confirm") return step(state);
      const { action, number } = state.overlay;
      const effect: Effect =
        action === "close"
          ? { type: "CLOSE", repo: state.repo, number }
          : { type: "REOPEN", repo: state.repo, number };
      return step({ ...state, overlay: { kind: "none" } }, [effect]);
    }

    // ---- effect results -----------------------------------------------------

    case "ISSUES_LOADED": {
      // Ignore stale results from a set/repo we've since toggled or switched away from.
      if (event.repo !== state.repo || event.state !== state.listState) return step(state);
      const selectedIndex = clamp(state.selectedIndex, 0, Math.max(0, event.issues.length - 1));
      const ready = { ...state, list: { status: "ready" as const, issues: event.issues }, selectedIndex };
      const { detail, effects } = trackSelection(ready);
      return step({ ...ready, detail }, effects);
    }

    case "ISSUES_FAILED": {
      if (event.repo !== state.repo || event.state !== state.listState) return step(state);
      return step({ ...state, list: { status: "error", message: event.message } });
    }

    case "ISSUE_LOADED": {
      // Ignore results from another repo, or if the user navigated to a
      // different issue meanwhile.
      if (event.repo !== state.repo) return step(state);
      if (state.detail.status === "loading" && state.detail.number !== event.issue.number) {
        return step(state);
      }
      return step({ ...state, detail: { status: "ready", issue: event.issue } });
    }

    case "ISSUE_FAILED": {
      if (event.repo !== state.repo) return step(state);
      if (state.detail.status === "loading" && state.detail.number !== event.number) {
        return step(state);
      }
      return step({ ...state, detail: { status: "error", number: event.number, message: event.message } });
    }

    case "MUTATION_DONE": {
      // Drop a mutation that resolved after we switched repos: switching back
      // re-lists that repo fresh, so nothing is lost by ignoring it here.
      if (event.repo !== state.repo) return step(state);
      const text = `#${event.number} ${event.action === "close" ? "closed" : "reopened"}`;
      // Re-list the current set so the mutated issue drops out (close from the
      // open list) or the count updates; simplest correct refresh.
      const effects: Effect[] = [{ type: "LIST", repo: state.repo, state: state.listState }];
      // If the detail pane is showing the issue we just mutated, its cached
      // IssueDetail is now stale (wrong state, missing/lingering badge). Re-fetch
      // it so the pane reflects the new state instead of the pre-mutation one.
      let detail = state.detail;
      if (detailNumber(state.detail) === event.number) {
        detail = { status: "loading", number: event.number };
        effects.push({ type: "GET_ISSUE", repo: state.repo, number: event.number });
      }
      return step({ ...state, toast: { text, tone: "success" }, list: { status: "loading" }, detail }, effects);
    }

    case "MUTATION_FAILED": {
      if (event.repo !== state.repo) return step(state);
      return step({ ...state, toast: { text: event.message, tone: "error" } });
    }
  }
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

// ---------------------------------------------------------------------------
// View model - plain data the render layer paints. No OpenTUI types leak here.
// ---------------------------------------------------------------------------

export const LIST_WIDTH = 34;
const ROW_TEXT_WIDTH = LIST_WIDTH - 4; // "> #12 " marker + padding budget

export interface RowVM {
  text: string;
  selected: boolean;
}

export interface RepoRowVM {
  text: string; // just the repo name; the owner lives in the group header
  full: string; // canonical "owner/repo"
  selected: boolean; // highlighted row (matters when the repo pane is focused)
  active: boolean; // the repo whose issues are currently loaded
}

// A path group: one owner header plus its repos, drawn together in the pane.
export interface RepoGroupVM {
  owner: string;
  repos: RepoRowVM[];
}

export type DetailVM =
  | { kind: "empty"; message: string }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | {
      kind: "ready";
      header: string; // "#5  Title"
      meta: string; // "open · author · 15m ago · 2 comments"
      badge: string | null; // "✓ completed" for closed
      body: string; // raw Markdown
      commentsDivider: string; // "─ comments (2) ─"
      comments: { header: string; body: string }[];
    };

export type OverlayVM =
  | { kind: "none" }
  | { kind: "help"; title: string; bindings: { key: string; action: string }[] }
  | { kind: "goto"; title: string; inputLine: string; hint: string }
  | { kind: "addrepo"; title: string; inputLine: string; hint: string }
  | { kind: "confirm"; title: string; issueLine: string; reasonLine: string | null };

export interface ViewModel {
  repoHeader: string; // "Repos (2)"
  repoGroups: RepoGroupVM[]; // repos clustered by owner (path)
  reposFocused: boolean;
  listHeader: string; // "owner/repo · OPEN (28)"
  rows: RowVM[];
  listMessage: string | null; // empty/error message shown in list pane
  focus: Focus;
  detail: DetailVM;
  footer: string;
  overlay: OverlayVM;
  toast: Toast | null;
}

const KEYBINDINGS: { key: string; action: string }[] = [
  { key: "j / ↓", action: "move selection down" },
  { key: "k / ↑", action: "move selection up" },
  { key: "Enter", action: "focus detail / switch repo" },
  { key: "Tab", action: "cycle repos / list / detail" },
  { key: "g / G", action: "jump to top / bottom" },
  { key: "o", action: "toggle open / closed list" },
  { key: "Shift+R", action: "reload the list" },
  { key: "a", action: "add a repo" },
  { key: "d", action: "remove highlighted repo" },
  { key: "s", action: "go to issue by number" },
  { key: "c", action: "close selected issue" },
  { key: "r", action: "reopen selected issue" },
  { key: "?", action: "toggle this help" },
  { key: "q", action: "quit" },
];

export function toViewModel(state: AppState): ViewModel {
  const repoName = state.repo.split("/").pop() ?? state.repo;
  const setLabel = state.listState === "open" ? "OPEN" : "CLOSED";

  let count = 0;
  let rows: RowVM[] = [];
  let listMessage: string | null = null;

  if (state.list.status === "ready") {
    count = state.list.issues.length;
    rows = state.list.issues.map((issue, i) => ({
      text: truncate(`#${issue.number}  ${issue.title}`, ROW_TEXT_WIDTH),
      selected: i === state.selectedIndex,
    }));
    if (count === 0) listMessage = `No ${state.listState} issues.`;
  } else if (state.list.status === "loading") {
    listMessage = "Loading…";
  } else {
    listMessage = state.list.message;
  }

  const listHeader = `${repoName} · ${setLabel} (${count})`;

  // Cluster the (already owner-sorted) repos into path groups: a new group
  // starts whenever the owner changes from the previous row.
  const repoGroups: RepoGroupVM[] = [];
  state.repos.forEach((r, i) => {
    const owner = ownerOf(r);
    const row: RepoRowVM = {
      text: truncate(r.slice(owner.length + 1) || r, ROW_TEXT_WIDTH - 2),
      full: r,
      selected: i === state.selectedRepoIndex,
      active: sameRepo(r, state.repo),
    };
    const last = repoGroups[repoGroups.length - 1];
    if (last && last.owner === owner) last.repos.push(row);
    else repoGroups.push({ owner, repos: [row] });
  });

  return {
    repoHeader: `Repos (${state.repos.length})`,
    repoGroups,
    reposFocused: state.focus === "repos",
    listHeader,
    rows,
    listMessage,
    focus: state.focus,
    detail: detailVM(state),
    footer: footerFor(state),
    overlay: overlayVM(state),
    toast: state.toast,
  };
}

function detailVM(state: AppState): DetailVM {
  switch (state.detail.status) {
    case "empty":
      return { kind: "empty", message: "No issue selected." };
    case "loading":
      return { kind: "loading" };
    case "error":
      return { kind: "error", message: state.detail.message };
    case "ready": {
      const iss = state.detail.issue;
      const meta = `${iss.state} · ${iss.author} · ${relativeAge(iss.createdAt)} · ${iss.commentCount} ${
        iss.commentCount === 1 ? "comment" : "comments"
      }`;
      const badge = iss.state === "closed" && iss.stateReason === "completed" ? "✓ completed" : null;
      return {
        kind: "ready",
        header: `#${iss.number}  ${iss.title}`,
        meta,
        badge,
        body: iss.body.trim().length ? iss.body : "_No description provided._",
        commentsDivider: `─ comments (${iss.comments.length}) ─`,
        comments: iss.comments.map((c) => ({
          header: `${c.author} · ${relativeAge(c.createdAt)}`,
          body: c.body,
        })),
      };
    }
  }
}

function overlayVM(state: AppState): OverlayVM {
  const o = state.overlay;
  if (o.kind === "none") return { kind: "none" };
  if (o.kind === "help") return { kind: "help", title: "Keybindings", bindings: KEYBINDINGS };
  if (o.kind === "goto") {
    return { kind: "goto", title: "Go to issue", inputLine: `#${o.query}`, hint: "[ Enter ] open     [ Esc ] cancel" };
  }
  if (o.kind === "addrepo") {
    return {
      kind: "addrepo",
      title: "Add repo",
      inputLine: o.query,
      hint: "owner/repo   ·   [ Enter ] add     [ Esc ] cancel",
    };
  }
  // confirm
  const verb = o.action === "close" ? "Close" : "Reopen";
  return {
    kind: "confirm",
    title: `${verb} issue?`,
    issueLine: truncate(`#${o.number}  ${o.title}`, 44),
    reasonLine: o.action === "close" ? "Reason: completed" : null,
  };
}

function footerFor(state: AppState): string {
  const toggle = state.listState === "open" ? "o closed" : "o open";
  const mutate = state.listState === "open" ? "c close" : "r reopen";
  return `j/k move · ↵ detail · ${toggle} · ${mutate} · a add-repo · d del-repo · s goto · R reload · tab focus · ? help · q quit`;
}

// ---------------------------------------------------------------------------
// Small pure helpers
// ---------------------------------------------------------------------------

/** The "path" a repo groups under: its owner (the part before the slash). */
export function ownerOf(repo: string): string {
  const i = repo.indexOf("/");
  return i >= 0 ? repo.slice(0, i) : repo;
}

/** Two repo slugs naming the same GitHub repo (owner/repo is case-insensitive). */
export function sameRepo(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

// Sort by owner then repo (case-insensitive) so the pane clusters each owner's
// repos into one contiguous group. Stable enough - equal keys never collide
// because a repo slug is unique.
export function sortRepos(repos: string[]): string[] {
  return [...repos].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
}

// Pull a canonical "owner/repo" out of whatever the user typed or pasted:
//   owner/repo · github.com/owner/repo · https://github.com/owner/repo(.git)
//   git@github.com:owner/repo.git · any of the above with a trailing / or path.
// Returns null when there's no owner/repo to be found.
export function parseRepo(input: string): string | null {
  let s = input.trim();
  if (!s) return null;
  s = s.replace(/^git@[^:]+:/i, ""); // ssh remote -> owner/repo(.git)
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//i, ""); // strip scheme (https://)
  // Drop a leading host segment (first path part containing a dot, e.g. github.com).
  if (/^[^/]*\.[^/]*\//.test(s)) s = s.slice(s.indexOf("/") + 1);
  s = s.replace(/\.git$/i, "").replace(/\/+$/, "");
  const parts = s.split("/").filter(Boolean);
  if (parts.length < 2) return null;
  const [owner, repo] = parts;
  const ok = /^[A-Za-z0-9._-]+$/;
  if (!ok.test(owner!) || !ok.test(repo!)) return null;
  return `${owner}/${repo}`;
}

export function truncate(s: string, width: number): string {
  if (s.length <= width) return s;
  if (width <= 1) return s.slice(0, width);
  return s.slice(0, width - 1) + "…";
}

/** Relative age like "15m ago", "3h ago", "2d ago". `now` injectable for tests. */
export function relativeAge(iso: string, now: number = Date.now()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const secs = Math.max(0, Math.floor((now - then) / 1000));
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

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

export type Focus = "list" | "detail";

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
  | { kind: "confirm"; action: "close" | "reopen"; number: number; title: string };

// A transient status line. `tone` drives its color + icon so a failed mutation
// never renders with a success checkmark.
export interface Toast {
  text: string;
  tone: "success" | "error";
}

export interface AppState {
  repo: string; // "owner/repo"
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
  | { type: "REQUEST_CLOSE" } // c
  | { type: "REQUEST_REOPEN" } // r
  | { type: "CONFIRM" } // Enter in overlay
  | { type: "CANCEL" } // Esc
  | { type: "TOGGLE_HELP" } // ?
  // effect results (fed back by the host)
  | { type: "ISSUES_LOADED"; state: IssueState; issues: IssueSummary[] }
  | { type: "ISSUES_FAILED"; state: IssueState; message: string }
  | { type: "ISSUE_LOADED"; issue: IssueDetail }
  | { type: "ISSUE_FAILED"; number: number; message: string }
  | { type: "MUTATION_DONE"; action: "close" | "reopen"; number: number }
  | { type: "MUTATION_FAILED"; message: string };

// ---------------------------------------------------------------------------
// Effects (data requests the host fulfils via the gateway)
// ---------------------------------------------------------------------------

export type Effect =
  | { type: "LIST"; state: IssueState }
  | { type: "GET_ISSUE"; number: number }
  | { type: "CLOSE"; number: number }
  | { type: "REOPEN"; number: number }
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

export function update(state: AppState, event: Event): Step {
  // While an overlay is up it swallows navigation; only CONFIRM/CANCEL/help act.
  const overlayUp = state.overlay.kind !== "none";

  switch (event.type) {
    case "MOVE": {
      if (overlayUp || state.focus !== "list" || state.list.status !== "ready") {
        // Detail-focused movement is native ScrollBox scrolling (host-handled).
        return step(state);
      }
      const n = state.list.issues.length;
      if (n === 0) return step(state);
      const selectedIndex = clamp(state.selectedIndex + event.delta, 0, n - 1);
      return step({ ...state, selectedIndex, toast: null });
    }

    case "JUMP": {
      if (overlayUp || state.focus !== "list" || state.list.status !== "ready") {
        return step(state);
      }
      const n = state.list.issues.length;
      if (n === 0) return step(state);
      const selectedIndex = event.to === "top" ? 0 : n - 1;
      return step({ ...state, selectedIndex, toast: null });
    }

    case "TOGGLE_FOCUS": {
      if (overlayUp) return step(state);
      const focus: Focus = state.focus === "list" ? "detail" : "list";
      return step({ ...state, focus, toast: null });
    }

    case "OPEN_SELECTED": {
      if (overlayUp) return step(state);
      const sel = selectedIssue(state);
      if (!sel) return step(state);
      return step(
        { ...state, detail: { status: "loading", number: sel.number }, focus: "detail", toast: null },
        [{ type: "GET_ISSUE", number: sel.number }],
      );
    }

    case "TOGGLE_LIST_STATE": {
      if (overlayUp) return step(state);
      const listState: IssueState = state.listState === "open" ? "closed" : "open";
      return step(
        { ...state, listState, list: { status: "loading" }, selectedIndex: 0, focus: "list", toast: null },
        [{ type: "LIST", state: listState }],
      );
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
      const effect: Effect = action === "close" ? { type: "CLOSE", number } : { type: "REOPEN", number };
      return step({ ...state, overlay: { kind: "none" } }, [effect]);
    }

    // ---- effect results -----------------------------------------------------

    case "ISSUES_LOADED": {
      // Ignore stale results from a set we've since toggled away from.
      if (event.state !== state.listState) return step(state);
      const selectedIndex = clamp(state.selectedIndex, 0, Math.max(0, event.issues.length - 1));
      return step({ ...state, list: { status: "ready", issues: event.issues }, selectedIndex });
    }

    case "ISSUES_FAILED": {
      if (event.state !== state.listState) return step(state);
      return step({ ...state, list: { status: "error", message: event.message } });
    }

    case "ISSUE_LOADED": {
      // Ignore if the user navigated to a different issue meanwhile.
      if (state.detail.status === "loading" && state.detail.number !== event.issue.number) {
        return step(state);
      }
      return step({ ...state, detail: { status: "ready", issue: event.issue } });
    }

    case "ISSUE_FAILED": {
      if (state.detail.status === "loading" && state.detail.number !== event.number) {
        return step(state);
      }
      return step({ ...state, detail: { status: "error", number: event.number, message: event.message } });
    }

    case "MUTATION_DONE": {
      const text = `#${event.number} ${event.action === "close" ? "closed" : "reopened"}`;
      // Re-list the current set so the mutated issue drops out (close from the
      // open list) or the count updates; simplest correct refresh.
      const effects: Effect[] = [{ type: "LIST", state: state.listState }];
      // If the detail pane is showing the issue we just mutated, its cached
      // IssueDetail is now stale (wrong state, missing/lingering badge). Re-fetch
      // it so the pane reflects the new state instead of the pre-mutation one.
      let detail = state.detail;
      if (detailNumber(state.detail) === event.number) {
        detail = { status: "loading", number: event.number };
        effects.push({ type: "GET_ISSUE", number: event.number });
      }
      return step({ ...state, toast: { text, tone: "success" }, list: { status: "loading" }, detail }, effects);
    }

    case "MUTATION_FAILED": {
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
  | { kind: "confirm"; title: string; issueLine: string; reasonLine: string | null };

export interface ViewModel {
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
  { key: "Enter", action: "open selected issue" },
  { key: "Tab", action: "toggle list / detail focus" },
  { key: "g / G", action: "jump to top / bottom" },
  { key: "o", action: "toggle open / closed list" },
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

  return {
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
      return { kind: "empty", message: "Select an issue and press Enter to read it." };
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
  return `j/k move · ↵ open · ${toggle} · ${mutate} · tab focus · ? help · q quit`;
}

// ---------------------------------------------------------------------------
// Small pure helpers
// ---------------------------------------------------------------------------

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

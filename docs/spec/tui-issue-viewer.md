# Spec: TUI GitHub issue viewer

Handoff-ready specification for a terminal app that views and manages GitHub issues of the
auto-detected current repository. Produced by the wayfinder effort [TUI GitHub issue viewer
for the current repo - Wayfinder map](https://github.com/stngcoding/tissues/issues/1). Every
decision below is locked; this document is the input to a build effort.

## 1. Purpose and scope

A single-user, keyboard-driven terminal UI (TUI) for **reading and open/closing GitHub issues**
of whatever repo you are standing in. It is a focused companion to `gh`, optimized for browsing
issue bodies and comments with rendered Markdown in a two-pane layout.

**In scope**
- Auto-detect the current repo and list its issues (open by default, hotkey to view closed).
- Read a selected issue: number, title, body, and all comments, with rendered Markdown and scroll.
- Close an open issue (reason `completed`) and reopen a closed one, each behind a confirm prompt.

**Out of scope** (see section 8) - pull requests, writing/editing comments, a `--repo` override,
search/filtering, pagination beyond the first ~30, and any close reason other than `completed`.

## 2. Stack

- **Language/runtime:** TypeScript on **Bun** (>= 1.2). OpenTUI's native renderer requires Bun;
  Node.js only works behind an experimental FFI flag and is not a supported target here.
- **UI:** **OpenTUI** (`@opentui/core`), pinned to an **exact** version `0.4.5` (no `^`/`~`).
  OpenTUI is pre-1.0 and breaks across the whole v0.x line; treat every bump as a deliberate,
  tested upgrade. If `@opentui/react` bindings are used, pin it to `0.4.5` as well.
- **GitHub client:** `@octokit/rest` (official), used **REST-only**.
- Rationale and the OpenTUI-vs-Ratatui comparison: [T1 - Compare OpenTUI vs Ratatui](https://github.com/stngcoding/tissues/issues/2).

## 3. Auth and repo detection (startup sequence)

Both steps run before the TUI renders. Either failure prints a clear message to stderr and
`exit(1)` - the TUI never starts in a degraded state. Detail: [T2 - Data & auth layer](https://github.com/stngcoding/tissues/issues/3).

1. **Detect the repo.** Run `gh repo view --json nameWithOwner` from the process cwd. On non-zero
   exit (not a git repo, no remote, remote is not a known GitHub host), print:
   `No GitHub repository detected in the current directory. Run this from inside a git repo with a GitHub remote.`
   then `exit(1)`. Do **not** prompt for owner/repo. On success, split `nameWithOwner` on `/` into
   `owner` / `repo` and pass both into every Octokit call.
2. **Get the token.** Shell out to `gh auth token` (e.g. `execFileSync("gh", ["auth", "token"])`),
   trim the trailing newline, pass it as Octokit's `auth`. If `gh` is missing or the user is not
   logged in, the command exits non-zero with no usable token; catch it and print
   `Not authenticated - run \`gh auth login\`.` then `exit(1)`. Never pass an empty string to Octokit.

The token is whatever scopes the user's `gh` login already holds (the app cannot request more);
a normal `gh auth login` grant includes `repo`, which covers reading and open/closing issues. No
token refresh logic - re-read via `gh auth token` on each run.

## 4. Data layer (REST via Octokit)

All operations are single, documented REST endpoints; GraphQL is deliberately not used at this scale.

| Operation | Octokit call |
|---|---|
| List issues | `octokit.rest.issues.listForRepo({ owner, repo, state, per_page: 30, sort: "created", direction: "desc" })`, then **filter out any item with a `pull_request` key** |
| Get one issue | `octokit.rest.issues.get({ owner, repo, issue_number })` |
| List comments | `octokit.rest.issues.listComments({ owner, repo, issue_number, per_page: 100 })` (paginate if an issue could exceed 100 comments) |
| Close issue | `octokit.rest.issues.update({ owner, repo, issue_number, state: "closed", state_reason: "completed" })` |
| Reopen issue | `octokit.rest.issues.update({ owner, repo, issue_number, state: "open", state_reason: "reopened" })` |

Critical notes:
- **The list endpoint mixes pull requests in with issues** (every PR is an issue). There is no
  server-side filter; drop items carrying a `pull_request` key client-side. A raw page of 30 can
  therefore yield fewer than 30 real issues in a PR-heavy repo - acceptable for this spec.
- `state` defaults to `open`; pass `"closed"` when the closed-view toggle is on. Pass `per_page: 30`
  explicitly (self-documenting).
- Bodies and comment bodies come back as **raw Markdown**; render them client-side. Do **not** set
  the `Accept: application/vnd.github.html+json` media type.
- On `issues.update`, `state` and `state_reason` **must be sent together** or `state_reason` is ignored.

## 5. Layout and interaction

UX agreed via prototype (ASCII wireframes on branch `prototype/tui-layout`, file
`prototype/tui-layout.md`). Detail: [T4 - TUI layout & interaction design](https://github.com/stngcoding/tissues/issues/5).
OpenTUI component mapping confirmed in [T3 - OpenTUI capabilities audit](https://github.com/stngcoding/tissues/issues/4).

### 5.1 Two-pane layout

- Root `BoxRenderable` with `flexDirection: "row"`, full width/height.
- **List pane** (left): fixed width ~34 columns.
- **Detail pane** (right): `flexGrow: 1`, fills the remainder.
- **Footer**: an always-visible keybind-hint bar (the discoverability crutch); `?` opens a full
  help overlay.

```
+- tissues . OPEN (28) ----------+- #5  T4 [prototype] TUI layout & interaction -------------+
| > #5  T4 [prototype] TUI lay.. | open . stngcoding . opened 15m ago . 0 comments           |
|   #6  T5 [task] Assemble the.. |                                                          |
|   #1  TUI GitHub issue viewe.. | ## Question                                              |
|   ...                          | Produce a rough prototype of the layout ...              |
|                                | - comments -----------------------------------------     |
+--------------------------------+----------------------------------------------------------+
 j/k move . enter open . o closed . c close . r reopen . tab focus . ? help . q quit
```

### 5.2 List pane

- Header: `repo . OPEN|CLOSED (count)`.
- Each row: `#num  title...` (truncated to width). Selected row marked `>` plus reverse-video.
- `o` toggles between the OPEN and CLOSED sets; header and count flip accordingly.
- Closed issues show a `completed` badge on their detail meta line.

### 5.3 Detail pane

- Rendered with `MarkdownRenderable` inside a `ScrollBoxRenderable` (`focusable: true`).
- Header: `#num  title`. Meta line below: `state . author . age . N comments`.
- Body is rendered Markdown (headings, bold/italic, lists, fenced code with syntax highlighting,
  tables). Right-edge scrollbar indicates position.

### 5.4 Comments

- Rendered **inline in the same scroll** as the body, under a `- comments (N) -` divider. One
  continuous read (body then comments); there is no separate comments view.
- Each comment is a bordered card: `author . age` on the top border, Markdown body inside.

### 5.5 Focus and scrolling

- `Tab` toggles focus between the list pane and the detail scrollbox. `j`/`k` (and arrows) drive
  whichever pane is focused; `ScrollBoxRenderable` handles line/page/Home/End scrolling itself when
  focused. Each pane keeps its own scroll offset - no custom bookkeeping beyond calling `.focus()`.
- Keys are captured via the imperative `renderer.keyInput` `"keypress"` event. Global keys (quit,
  help) are bound at the top-level listener so they work regardless of focus.

### 5.6 Close/open confirm flow

- No first-party modal ships in OpenTUI. Build a **small custom overlay** (~30-50 lines): an
  `position: "absolute"` `BoxRenderable` centered over the two panes, rest dimmed, capturing
  `Enter`/`Esc` while focused.
- Content: the issue `#` + title, and `Reason: completed` shown as **non-editable** text
  (`completed` is the only in-scope reason - shown for transparency, not a picker).
- `Enter` confirms and calls `issues.update`; `Esc` cancels. On success the row/state updates and
  a brief toast shows (e.g. `#5 closed`). The reopen overlay is identical minus the reason line.

### 5.7 Keybindings

| Key | Action |
|---|---|
| `j` / down, `k` / up | move selection / scroll the focused pane |
| `Enter` | open the selected issue in the detail pane |
| `Tab` | toggle focus between list and detail |
| `g` / `G` | jump to top / bottom of the focused pane |
| `o` | toggle OPEN <-> CLOSED list |
| `c` | close the selected issue (confirm) |
| `r` | reopen the selected issue (confirm) |
| `?` | help overlay |
| `q` | quit |

## 6. Content and list behavior summary

- List shows the **~30 latest issues** (`sort: created`, `direction: desc`), **open by default**,
  hotkey `o` to view closed. No search, no label/assignee filtering, no pagination beyond page one.
- All Markdown is rendered, all long content scrolls per-pane.

## 7. Known risks and build-time spikes

- **Distribution / how the app is run (open, must resolve during build).** OpenTUI needs the Bun
  runtime; there is no zero-dependency binary. Spike `bun build --compile` early to produce a
  single-file executable and settle the invocation command. **If cross-platform packaging proves
  unreliable, that is the trigger to revisit Ratatui** (the T1 runner-up).
- **API failure and empty states (open, must resolve during build).** Define behavior for rate-limit
  and network errors, and for a repo with zero issues. Not specified by this effort; decide during build.
- **OpenTUI churn.** Pre-1.0, breaking across all of v0.x; the flagship consumer (OpenCode) has hit
  crashes on version bumps. Pin `0.4.5` exactly; treat upgrades as deliberate and tested.
- **`useKeyboard` React hook** is unverified in detail; the imperative `renderer.keyInput` path is
  the solidly confirmed one. If building with `@opentui/react`, confirm the hook signature against
  the installed version.
- **`@tuiparts/dialog`** exists as a community confirm-dialog package but its compatibility with the
  pinned OpenTUI is unverified; the custom overlay (5.6) is the recommended path.

## 8. Out of scope

Each of these was consciously ruled beyond this effort's destination:

- **Pull requests** - separate data model (diff, review, merge state); worth its own effort.
- **Writing / editing comments.**
- **`--repo` override** - viewing repos you are not standing in.
- **Search and advanced filtering** - by label, assignee, or keyword.
- **Pagination** - loading more than ~30 issues.
- **Alternate close reasons** - anything other than `completed` (e.g. `not_planned`).

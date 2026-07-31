# tissues

A terminal UI for browsing and triaging the GitHub issues of the repo you're
standing in. Two panes - a list on the left, the selected issue's rendered
Markdown body and comments on the right - driven entirely by the keyboard.

Built with [Bun](https://bun.sh) and [OpenTUI](https://github.com/sst/opentui);
talks to GitHub through your existing `gh` CLI login.

## What it does

- Lists the latest open (or closed) issues of the current repo.
- Reads an issue's Markdown body and comments inline - headings, emphasis, lists, links, and boxed code blocks.
- Closes and reopens issues (with a confirm step) without leaving the terminal.
- Auto-detects the repo and reuses your `gh` auth - no config, no tokens to paste.

## Prerequisites

- **Bun** 1.2+ - `curl -fsSL https://bun.sh/install | bash`
- **GitHub CLI** (`gh`), authenticated - `gh auth login`

You must run it from inside a git repository that has a GitHub remote; the repo
is detected from the working directory.

## Install

`tissues` is a Bun CLI. Pick whichever fits you - all of them give you a
`tissues` command (or run it on the spot):

```sh
# Run without installing (Bun-native, recommended)
bunx @stngcoding/tissues

# ...or via npm's runner
npx @stngcoding/tissues

# Install it globally, then just type `tissues` anywhere
bun add -g @stngcoding/tissues      # or: npm i -g @stngcoding/tissues
```

The package name on npm is `@stngcoding/tissues`; the command it installs is
just `tissues`.

> Bun must be on your PATH even when you launch through `npx` - the CLI runs on
> the Bun runtime (`#!/usr/bin/env bun`), because OpenTUI is Bun-only.

### From source

To hack on it, or before it's published to a registry:

```sh
git clone https://github.com/stngcoding/tissues.git
cd tissues
bun install
bun link            # registers a global `tissues` pointing at this checkout
```

## Usage

`cd` into the repo whose issues you want to browse, then run it:

```sh
cd ~/code/some-project
tissues
```

That's the whole flow - the app reads issues from whatever repo your **current
directory** belongs to, so there's nothing to configure. (Running from the
source checkout instead? `bun run start` is the equivalent of `tissues`.)

If it can't find a repo or you're not logged in, it says so and exits before the
UI ever opens:

- *No GitHub repository detected ...* - you're not inside a GitHub-backed repo.
- *Not authenticated - run `gh auth login`.* - your `gh` login has expired.

## Keys

| Key       | Action                        |
| --------- | ----------------------------- |
| `j` / `↓` | move selection down           |
| `k` / `↑` | move selection up             |
| `Enter`   | open the selected issue       |
| `Tab`     | toggle list / detail focus    |
| `g` / `G` | jump to top / bottom          |
| `o`       | toggle open / closed list     |
| `c`       | close the selected issue      |
| `r`       | reopen the selected issue     |
| `?`       | show / hide this help         |
| `q`       | quit                          |

When the detail pane is focused (`Tab`), `j`/`k`/`g`/`G` scroll the issue body
instead of moving the list selection.

## Development

```sh
bun test           # full suite (unit + headless E2E)
bun run typecheck  # tsc --noEmit
```

The code is structured as a pure reducer (`src/model.ts`) projected onto a
logic-free render layer (`src/view.ts`), with a host shell (`src/app.ts`)
translating keys into events and running effects against a `GitHubGateway`
(`src/domain.ts`, `src/github-gateway.ts`). Tests drive the real app through
OpenTUI's headless test renderer.

## Distribution

`tissues` ships as a Bun CLI (run via `bunx` / `npx` / a global install), not as
a standalone compiled binary. `bun build --compile` currently produces a binary
that crashes at startup because of how OpenTUI 0.4.5 resolves its tree-sitter
worker asset in the compiled runtime. See
[`docs/adr/0001`](docs/adr/0001-distribution-via-bun-run-not-compiled-binary.md)
for the full finding.

// A deterministic, offline GitHubGateway for tests and demos. Drives the whole
// app without touching the network. Records the calls made so tests can assert
// on gateway behavior (e.g. "close was called with this number").

import type { GitHubGateway, IssueDetail, IssueState, IssueSummary } from "./domain";

export interface GatewayCall {
  method: "listIssues" | "getIssue" | "closeIssue" | "reopenIssue";
  arg: IssueState | number;
}

export interface FakeOptions {
  open?: IssueSummary[];
  closed?: IssueSummary[];
  details?: Record<number, IssueDetail>;
  /** Force listIssues to reject (rate-limit / network error simulation). */
  listError?: string;
  /** Force getIssue to reject. */
  getError?: string;
}

export class FakeGateway implements GitHubGateway {
  readonly calls: GatewayCall[] = [];
  private open: IssueSummary[];
  private closed: IssueSummary[];
  private details: Record<number, IssueDetail>;
  private listError?: string;
  private getError?: string;

  constructor(opts: FakeOptions = {}) {
    this.open = opts.open ?? [];
    this.closed = opts.closed ?? [];
    this.details = opts.details ?? {};
    this.listError = opts.listError;
    this.getError = opts.getError;
  }

  async listIssues(state: IssueState): Promise<IssueSummary[]> {
    this.calls.push({ method: "listIssues", arg: state });
    if (this.listError) throw new Error(this.listError);
    return state === "open" ? [...this.open] : [...this.closed];
  }

  async getIssue(issueNumber: number): Promise<IssueDetail> {
    this.calls.push({ method: "getIssue", arg: issueNumber });
    if (this.getError) throw new Error(this.getError);
    const detail = this.details[issueNumber];
    if (!detail) throw new Error(`Fake has no detail for #${issueNumber}`);
    return detail;
  }

  async closeIssue(issueNumber: number): Promise<void> {
    this.calls.push({ method: "closeIssue", arg: issueNumber });
    // Reflect the mutation so a subsequent re-list drops it from open.
    this.open = this.open.filter((i) => i.number !== issueNumber);
    const d = this.details[issueNumber];
    if (d) {
      this.details[issueNumber] = { ...d, state: "closed", stateReason: "completed" };
      this.closed = [{ number: d.number, title: d.title, state: "closed" }, ...this.closed];
    }
  }

  async reopenIssue(issueNumber: number): Promise<void> {
    this.calls.push({ method: "reopenIssue", arg: issueNumber });
    this.closed = this.closed.filter((i) => i.number !== issueNumber);
    const d = this.details[issueNumber];
    if (d) {
      this.details[issueNumber] = { ...d, state: "open", stateReason: "reopened" };
      this.open = [{ number: d.number, title: d.title, state: "open" }, ...this.open];
    }
  }
}

// A small realistic fixture set. Note one "issue" that is actually a PR is NOT
// included here because the gateway is the layer that filters PRs; the fake
// returns already-filtered summaries (PR filtering is unit-tested against the
// real gateway's mapping). See github-gateway tests.
export function sampleFixture(): FakeOptions {
  const iso = (min: number) => new Date(Date.UTC(2026, 6, 31, 11, 0, 0) - min * 60_000).toISOString();
  const open: IssueSummary[] = [
    { number: 42, title: "Startup: repo detection + auth", state: "open" },
    { number: 41, title: "List open issues", state: "open" },
    { number: 40, title: "Help overlay", state: "open" },
  ];
  const closed: IssueSummary[] = [
    { number: 30, title: "Old bug: pane flicker", state: "closed" },
  ];
  const details: Record<number, IssueDetail> = {
    42: {
      number: 42,
      title: "Startup: repo detection + auth",
      state: "open",
      stateReason: null,
      author: "stngcoding",
      createdAt: iso(15),
      body: "## Goal\n\nDetect the repo and get a token **before** the TUI renders.\n\n- step one\n- step two\n\n```ts\nconst x = 1;\n```",
      commentCount: 2,
      comments: [
        { author: "stngcoding", createdAt: iso(9), body: "First comment with a `code` span." },
        { author: "octocat", createdAt: iso(5), body: "Second comment.\n\nMore text." },
      ],
    },
    41: {
      number: 41,
      title: "List open issues",
      state: "open",
      stateReason: null,
      author: "stngcoding",
      createdAt: iso(20),
      body: "The default view: latest open issues.",
      commentCount: 0,
      comments: [],
    },
    40: {
      number: 40,
      title: "Help overlay",
      state: "open",
      stateReason: null,
      author: "stngcoding",
      createdAt: iso(25),
      body: "Press ? for help.",
      commentCount: 0,
      comments: [],
    },
    30: {
      number: 30,
      title: "Old bug: pane flicker",
      state: "closed",
      stateReason: "completed",
      author: "stngcoding",
      createdAt: iso(120),
      body: "This was fixed.",
      commentCount: 0,
      comments: [],
    },
  };
  return { open, closed, details };
}

// Domain types and the single outbound seam (GitHubGateway).
// Pure data - no OpenTUI, no Octokit, no I/O here.

export type IssueState = "open" | "closed";

export interface IssueSummary {
  number: number;
  title: string;
  state: IssueState;
}

export interface IssueComment {
  author: string;
  createdAt: string; // ISO timestamp
  body: string; // raw Markdown
}

export interface IssueDetail {
  number: number;
  title: string;
  state: IssueState;
  /** "completed" | "reopened" | null - drives the closed badge. */
  stateReason: string | null;
  author: string;
  createdAt: string; // ISO
  body: string; // raw Markdown
  comments: IssueComment[];
  commentCount: number;
}

/**
 * The sole outbound boundary the running app touches. Production wires the
 * real Octokit-backed implementation; tests inject a fake. Repo detection and
 * token retrieval are a startup concern (see startup.ts) - they run before the
 * gateway exists and are not part of this interface.
 */
export interface GitHubGateway {
  listIssues(state: IssueState): Promise<IssueSummary[]>;
  getIssue(issueNumber: number): Promise<IssueDetail>;
  closeIssue(issueNumber: number): Promise<void>;
  reopenIssue(issueNumber: number): Promise<void>;
}

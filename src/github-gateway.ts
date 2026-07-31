// The real outbound boundary: maps the domain gateway onto Octokit REST calls.
// Contains no app logic - just the documented endpoints and the client-side PR
// filter the list endpoint requires.

import type { Octokit } from "@octokit/rest";
import type { GitHubGateway, IssueComment, IssueDetail, IssueState, IssueSummary } from "./domain";

export class OctokitGateway implements GitHubGateway {
  constructor(
    private octokit: Octokit,
    private owner: string,
    private repo: string,
  ) {}

  async listIssues(state: IssueState): Promise<IssueSummary[]> {
    const res = await this.octokit.rest.issues.listForRepo({
      owner: this.owner,
      repo: this.repo,
      state,
      per_page: 30,
      sort: "created",
      direction: "desc",
    });
    // The list endpoint mixes PRs in with issues; drop anything carrying a
    // pull_request key. A page of 30 may yield fewer than 30 real issues.
    return res.data
      .filter((i) => !i.pull_request)
      .map((i) => ({ number: i.number, title: i.title, state: i.state as IssueState }));
  }

  async getIssue(issueNumber: number): Promise<IssueDetail> {
    const { data } = await this.octokit.rest.issues.get({
      owner: this.owner,
      repo: this.repo,
      issue_number: issueNumber,
    });
    const comments = await this.listAllComments(issueNumber);
    return {
      number: data.number,
      title: data.title,
      state: data.state as IssueState,
      stateReason: data.state_reason ?? null,
      author: data.user?.login ?? "unknown",
      createdAt: data.created_at,
      body: data.body ?? "",
      comments,
      commentCount: data.comments,
    };
  }

  async closeIssue(issueNumber: number): Promise<void> {
    // state and state_reason must be sent together or state_reason is ignored.
    await this.octokit.rest.issues.update({
      owner: this.owner,
      repo: this.repo,
      issue_number: issueNumber,
      state: "closed",
      state_reason: "completed",
    });
  }

  async reopenIssue(issueNumber: number): Promise<void> {
    await this.octokit.rest.issues.update({
      owner: this.owner,
      repo: this.repo,
      issue_number: issueNumber,
      state: "open",
      state_reason: "reopened",
    });
  }

  private async listAllComments(issueNumber: number): Promise<IssueComment[]> {
    const out: IssueComment[] = [];
    let page = 1;
    // Paginate for the rare issue exceeding 100 comments.
    for (;;) {
      const res = await this.octokit.rest.issues.listComments({
        owner: this.owner,
        repo: this.repo,
        issue_number: issueNumber,
        per_page: 100,
        page,
      });
      for (const c of res.data) {
        out.push({ author: c.user?.login ?? "unknown", createdAt: c.created_at, body: c.body ?? "" });
      }
      if (res.data.length < 100) break;
      page += 1;
    }
    return out;
  }
}

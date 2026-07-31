// Startup sequence that runs BEFORE the TUI renders. Two steps, each failing
// loud and clean to stderr + exit(1). IO is injected so tests can drive the
// exact failure paths without a real `gh` or a real process exit.

import { execFileSync } from "node:child_process";

export const NO_REPO_MSG =
  "No GitHub repository detected in the current directory. Run this from inside a git repo with a GitHub remote.";
export const NO_AUTH_MSG = "Not authenticated - run `gh auth login`.";

export type Exec = (cmd: string, args: string[]) => string;

export interface StartupIO {
  exec: Exec;
  stderr: (line: string) => void;
  exit: (code: number) => never;
}

export interface StartupResult {
  owner: string;
  repo: string;
  token: string;
}

export function startup(io: StartupIO): StartupResult {
  // 1. Detect the repo from cwd.
  let nameWithOwner: string | undefined;
  try {
    const out = io.exec("gh", ["repo", "view", "--json", "nameWithOwner"]);
    nameWithOwner = (JSON.parse(out) as { nameWithOwner?: string }).nameWithOwner;
  } catch {
    io.stderr(NO_REPO_MSG);
    io.exit(1);
  }
  if (!nameWithOwner || !nameWithOwner.includes("/")) {
    io.stderr(NO_REPO_MSG);
    io.exit(1);
  }
  const [owner, repo] = nameWithOwner!.split("/");

  // 2. Get the token. Never pass an empty string on to Octokit.
  let token = "";
  try {
    token = io.exec("gh", ["auth", "token"]).trim();
  } catch {
    io.stderr(NO_AUTH_MSG);
    io.exit(1);
  }
  if (!token) {
    io.stderr(NO_AUTH_MSG);
    io.exit(1);
  }

  return { owner: owner!, repo: repo!, token };
}

export const realStartupIO: StartupIO = {
  exec: (cmd, args) => execFileSync(cmd, args, { encoding: "utf8" }),
  stderr: (line) => process.stderr.write(line + "\n"),
  exit: (code) => process.exit(code) as never,
};

#!/usr/bin/env bun
// Entry point. Runs the startup sequence (repo detect + auth) BEFORE the TUI,
// then wires the real gateway + renderer + tree-sitter client into the app.

import { Octokit } from "@octokit/rest";
import { createCliRenderer } from "@opentui/core";
import { runApp } from "./app";
import { OctokitGateway } from "./github-gateway";
import { realStartupIO, startup } from "./startup";

const { owner, repo, token } = startup(realStartupIO);

const octokit = new Octokit({ auth: token });
// One gateway per repo, built on demand as the user adds/switches repos.
const makeGateway = (nameWithOwner: string) => {
  const [o, r] = nameWithOwner.split("/");
  return new OctokitGateway(octokit, o!, r!);
};

const renderer = await createCliRenderer({ exitOnCtrlC: true, targetFps: 30 });

runApp({
  renderer,
  makeGateway,
  repo: `${owner}/${repo}`,
  onQuit: () => {
    renderer.destroy();
    process.exit(0);
  },
});

renderer.start();

// Entry point. Runs the startup sequence (repo detect + auth) BEFORE the TUI,
// then wires the real gateway + renderer + tree-sitter client into the app.

import { Octokit } from "@octokit/rest";
import { createCliRenderer, getTreeSitterClient, SyntaxStyle } from "@opentui/core";
import { runApp } from "./app";
import { OctokitGateway } from "./github-gateway";
import { realStartupIO, startup } from "./startup";

const { owner, repo, token } = startup(realStartupIO);

const octokit = new Octokit({ auth: token });
const gateway = new OctokitGateway(octokit, owner, repo);

// Markdown rendering needs an initialised tree-sitter client (see the build
// notes: web-tree-sitter@0.25.10 + a hoisted node_modules).
const treeSitterClient = getTreeSitterClient();
await treeSitterClient.initialize();

const renderer = await createCliRenderer({ exitOnCtrlC: true, targetFps: 30 });

runApp({
  renderer,
  gateway,
  repo: `${owner}/${repo}`,
  deps: { syntaxStyle: SyntaxStyle.create(), treeSitterClient },
  onQuit: () => {
    renderer.destroy();
    process.exit(0);
  },
});

renderer.start();

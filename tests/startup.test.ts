import { describe, expect, test } from "bun:test";
import { NO_AUTH_MSG, NO_REPO_MSG, startup, type StartupIO } from "../src/startup";

// A StartupIO that records stderr + the exit code instead of touching the real
// process, and lets each test script the two `gh` calls.
function harness(exec: StartupIO["exec"]) {
  const errors: string[] = [];
  let exited: number | null = null;
  const io: StartupIO = {
    exec,
    stderr: (line) => errors.push(line),
    // Throw to abort the flow the way process.exit() would (never returns).
    exit: (code) => {
      exited = code;
      throw new Error(`exit ${code}`);
    },
  };
  return { io, errors, exitCode: () => exited };
}

describe("startup", () => {
  test("returns owner, repo, token on the happy path", () => {
    const { io } = harness((_cmd, args) =>
      args[0] === "repo"
        ? JSON.stringify({ nameWithOwner: "acme/widgets" })
        : "gho_secrettoken\n",
    );
    expect(startup(io)).toEqual({ owner: "acme", repo: "widgets", token: "gho_secrettoken" });
  });

  test("no repo detected -> clean message + exit 1", () => {
    const { io, errors, exitCode } = harness(() => {
      throw new Error("gh: no repo");
    });
    expect(() => startup(io)).toThrow("exit 1");
    expect(errors).toContain(NO_REPO_MSG);
    expect(exitCode()).toBe(1);
  });

  test("not authenticated -> auth message + exit 1", () => {
    const { io, errors, exitCode } = harness((_cmd, args) => {
      if (args[0] === "repo") return JSON.stringify({ nameWithOwner: "acme/widgets" });
      throw new Error("gh: not logged in");
    });
    expect(() => startup(io)).toThrow("exit 1");
    expect(errors).toContain(NO_AUTH_MSG);
    expect(exitCode()).toBe(1);
  });

  test("empty token is treated as unauthenticated", () => {
    const { io, errors } = harness((_cmd, args) =>
      args[0] === "repo" ? JSON.stringify({ nameWithOwner: "acme/widgets" }) : "   \n",
    );
    expect(() => startup(io)).toThrow("exit 1");
    expect(errors).toContain(NO_AUTH_MSG);
  });
});

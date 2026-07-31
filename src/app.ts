// The host: the impure shell around the pure model. It owns the AppState,
// translates raw keypresses into semantic events, feeds events through
// `update`, paints each resulting view-model, and runs the emitted effects
// against the injected GitHubGateway - feeding results back in as events.

import type { CliRenderer, KeyEvent } from "@opentui/core";
import type { GitHubGateway } from "./domain";
import { initialState, update, type AppState, type Effect, type Event } from "./model";
import { View } from "./view";

export interface RunAppOptions {
  renderer: CliRenderer;
  // A gateway is bound to one repo, so we take a factory and cache one per repo
  // as the user switches between them.
  makeGateway: (repo: string) => GitHubGateway;
  repo: string; // initial "owner/repo"
  onQuit: () => void;
}

export interface AppHandle {
  getState(): AppState;
  view: View;
}

export function runApp(opts: RunAppOptions): AppHandle {
  const view = new View(opts.renderer);
  let state = initialState(opts.repo);

  const gateways = new Map<string, GitHubGateway>();
  function gatewayFor(repo: string): GitHubGateway {
    let gw = gateways.get(repo);
    if (!gw) {
      gw = opts.makeGateway(repo);
      gateways.set(repo, gw);
    }
    return gw;
  }

  function dispatch(event: Event) {
    const stepResult = update(state, event);
    state = stepResult.state;
    view.render(stepResult.viewModel);
    runEffects(stepResult.effects);
  }

  function runEffects(effects: Effect[]) {
    for (const effect of effects) runEffect(effect);
  }

  function runEffect(effect: Effect) {
    switch (effect.type) {
      case "LIST":
        gatewayFor(effect.repo)
          .listIssues(effect.state)
          .then((issues) => dispatch({ type: "ISSUES_LOADED", repo: effect.repo, state: effect.state, issues }))
          .catch((e) =>
            dispatch({ type: "ISSUES_FAILED", repo: effect.repo, state: effect.state, message: `Failed to load issues: ${msg(e)}` }),
          );
        return;
      case "GET_ISSUE":
        gatewayFor(effect.repo)
          .getIssue(effect.number)
          .then((issue) => dispatch({ type: "ISSUE_LOADED", repo: effect.repo, issue }))
          .catch((e) =>
            dispatch({ type: "ISSUE_FAILED", repo: effect.repo, number: effect.number, message: `Failed to load issue: ${msg(e)}` }),
          );
        return;
      case "CLOSE":
        gatewayFor(effect.repo)
          .closeIssue(effect.number)
          .then(() => dispatch({ type: "MUTATION_DONE", repo: effect.repo, action: "close", number: effect.number }))
          .catch((e) => dispatch({ type: "MUTATION_FAILED", repo: effect.repo, message: `Close failed: ${msg(e)}` }));
        return;
      case "REOPEN":
        gatewayFor(effect.repo)
          .reopenIssue(effect.number)
          .then(() => dispatch({ type: "MUTATION_DONE", repo: effect.repo, action: "reopen", number: effect.number }))
          .catch((e) => dispatch({ type: "MUTATION_FAILED", repo: effect.repo, message: `Reopen failed: ${msg(e)}` }));
        return;
      case "QUIT":
        opts.onQuit();
        return;
    }
  }

  // Keyboard: translate a raw key into either a semantic event, a native
  // detail-scroll, or a quit. Detail scrolling stays out of the model (the
  // ScrollBox owns its offset); everything else flows through `update`.
  opts.renderer.keyInput.on("keypress", (key: KeyEvent) => {
    const name = key.name;
    const shift = key.shift;
    const isEnter = name === "return" || name === "enter" || key.sequence === "\r";
    const isEsc = name === "escape" || name === "esc";
    const isHelp = name === "?" || (name === "/" && shift) || key.sequence === "?";

    const overlay = state.overlay.kind;

    if (overlay === "confirm") {
      if (isEnter) dispatch({ type: "CONFIRM" });
      else if (isEsc) dispatch({ type: "CANCEL" });
      return;
    }
    if (overlay === "help") {
      if (isHelp || isEsc) dispatch({ type: "TOGGLE_HELP" });
      return;
    }
    if (overlay === "goto") {
      if (isEnter) dispatch({ type: "GOTO_SUBMIT" });
      else if (isEsc) dispatch({ type: "CANCEL" });
      else if (name === "backspace") dispatch({ type: "GOTO_BACKSPACE" });
      else if (key.sequence && /^[0-9]$/.test(key.sequence)) dispatch({ type: "GOTO_APPEND", char: key.sequence });
      return;
    }
    if (overlay === "addrepo") {
      if (isEnter) dispatch({ type: "ADDREPO_SUBMIT" });
      else if (isEsc) dispatch({ type: "CANCEL" });
      else if (name === "backspace") dispatch({ type: "ADDREPO_BACKSPACE" });
      // Accept the characters a "owner/repo" slug can contain.
      else if (key.sequence && /^[A-Za-z0-9._/-]$/.test(key.sequence)) dispatch({ type: "ADDREPO_APPEND", char: key.sequence });
      return;
    }

    // No overlay up.
    if (name === "q") {
      runEffect({ type: "QUIT" });
      return;
    }
    if (isHelp) return dispatch({ type: "TOGGLE_HELP" });
    if (name === "tab") return dispatch({ type: "TOGGLE_FOCUS" });
    if (name === "o") return dispatch({ type: "TOGGLE_LIST_STATE" });
    if (name === "s") return dispatch({ type: "REQUEST_GOTO" });
    if (name === "a") return dispatch({ type: "REQUEST_ADDREPO" });
    if (isEnter) return dispatch({ type: "OPEN_SELECTED" });
    if (name === "c") return dispatch({ type: "REQUEST_CLOSE" });
    if ((name === "r" && shift) || key.sequence === "R") return dispatch({ type: "RELOAD" });
    if (name === "r") return dispatch({ type: "REQUEST_REOPEN" });

    const down = name === "j" || name === "down";
    const up = name === "k" || name === "up";
    const top = name === "g" && !shift;
    const bottom = (name === "g" && shift) || name === "G";

    if (state.focus === "detail") {
      if (down) view.scrollDetail(1);
      else if (up) view.scrollDetail(-1);
      else if (top) view.scrollDetailTo("top");
      else if (bottom) view.scrollDetailTo("bottom");
      return;
    }
    if (down) dispatch({ type: "MOVE", delta: 1 });
    else if (up) dispatch({ type: "MOVE", delta: -1 });
    else if (top) dispatch({ type: "JUMP", to: "top" });
    else if (bottom) dispatch({ type: "JUMP", to: "bottom" });
  });

  // Boot: paint the initial (loading) frame, then kick off the first listing.
  view.render(update(state, { type: "MOVE", delta: 0 }).viewModel);
  runEffect({ type: "LIST", repo: state.repo, state: state.listState });

  return {
    getState: () => state,
    view,
  };
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

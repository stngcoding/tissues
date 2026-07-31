// Shared E2E harness: mount the real app against a fake gateway and OpenTUI's
// headless test renderer, driven by synthetic keystrokes. This is the pattern
// every E2E test mirrors (see the build spec's testing decisions).

import { createTestRenderer } from "@opentui/core/testing";
import { runApp, type AppHandle } from "../src/app";
import type { GitHubGateway } from "../src/domain";

export interface MountOptions {
  repo?: string;
  width?: number;
  height?: number;
}

export async function mountApp(gateway: GitHubGateway, opts: MountOptions = {}) {
  const { repo = "stngcoding/tissues", width = 100, height = 30 } = opts;
  // kittyKeyboard mode disambiguates a bare Escape (a lone ESC byte otherwise
  // buffers, waiting to see if it starts a longer sequence). Modern terminals
  // negotiate this protocol, so it also matches how the app runs for real.
  const setup = await createTestRenderer({ width, height, kittyKeyboard: true });
  let quit = false;

  const handle: AppHandle = runApp({
    renderer: setup.renderer,
    gateway,
    repo,
    onQuit: () => {
      quit = true;
    },
  });

  // Wait until the initial listing has settled into a stable frame.
  await setup.waitForVisualIdle();

  return {
    ...setup,
    handle,
    didQuit: () => quit,
    destroy: async () => {
      setup.renderer.destroy?.();
    },
  };
}

// The render layer: a logic-free projection of the ViewModel onto OpenTUI
// renderables. It holds no app state and makes no decisions - it only paints
// what the view-model says, and exposes imperative detail-scroll controls the
// host drives (each pane keeps its own scroll offset because only the focused
// pane is ever scrolled).

import {
  BoxRenderable,
  RGBA,
  ScrollBoxRenderable,
  TextRenderable,
  type CliRenderer,
} from "@opentui/core";
import { uid } from "./ids";
import { renderMarkdown } from "./markdown";
import { LIST_WIDTH, type DetailVM, type OverlayVM, type RepoRowVM, type Toast, type ViewModel } from "./model";

const FOCUSED = "#5FD7FF";
const UNFOCUSED = "#444444";
const SELECTED_BG = "#3A3A3A";
const SELECTED_FG = "#FFFFFF";
const DIM_FG = "#888888";
const ACTIVE_FG = "#3FB950"; // the currently-loaded repo's marker

// Repo pane height: border (2) + up to 6 visible rows; scrolls beyond that.
const REPO_PANE_HEIGHT = 8;

export class View {
  private r: CliRenderer;

  private repoBox!: ScrollBoxRenderable;
  private listBox!: ScrollBoxRenderable;
  private detailBox!: ScrollBoxRenderable;
  private footer!: TextRenderable;
  private toastBox!: BoxRenderable;
  private toastText!: TextRenderable;
  private overlayLayer!: BoxRenderable;
  private overlayCard!: BoxRenderable;

  private repoSig = "";
  private rowSig = "";
  private detailSig = "";
  private detailKey = "";
  private overlaySig = "";

  constructor(r: CliRenderer) {
    this.r = r;
    this.build();
  }

  private build() {
    const r = this.r;
    const screen = new BoxRenderable(r, {
      id: uid("screen"),
      width: "100%",
      height: "100%",
      flexDirection: "column",
    });

    const mainRow = new BoxRenderable(r, {
      id: uid("main"),
      width: "100%",
      flexGrow: 1,
      flexDirection: "row",
    });

    // Left column: a fixed-height scrollable repo list stacked over the issue
    // list, which grows to fill the rest.
    const leftCol = new BoxRenderable(r, {
      id: uid("left"),
      width: LIST_WIDTH,
      height: "100%",
      flexDirection: "column",
    });

    this.repoBox = new ScrollBoxRenderable(r, {
      id: uid("repos"),
      width: "100%",
      height: REPO_PANE_HEIGHT,
      border: true,
      borderStyle: "rounded",
      borderColor: UNFOCUSED,
      title: "",
      titleAlignment: "left",
    });

    this.listBox = new ScrollBoxRenderable(r, {
      id: uid("list"),
      width: "100%",
      flexGrow: 1,
      border: true,
      borderStyle: "rounded",
      borderColor: FOCUSED,
      title: "",
      titleAlignment: "left",
    });

    leftCol.add(this.repoBox);
    leftCol.add(this.listBox);

    this.detailBox = new ScrollBoxRenderable(r, {
      id: uid("detail"),
      flexGrow: 1,
      height: "100%",
      border: true,
      borderStyle: "rounded",
      borderColor: UNFOCUSED,
      title: "",
      titleAlignment: "left",
    });

    mainRow.add(leftCol);
    mainRow.add(this.detailBox);

    this.footer = new TextRenderable(r, {
      id: uid("footer"),
      content: "",
      fg: DIM_FG,
      height: 1,
      width: "100%",
    });

    screen.add(mainRow);
    screen.add(this.footer);
    r.root.add(screen);

    // Toast: absolute, bottom-right, above the footer.
    this.toastBox = new BoxRenderable(r, {
      id: uid("toast"),
      position: "absolute",
      bottom: 1,
      right: 2,
      border: true,
      borderStyle: "rounded",
      borderColor: "#3FB950",
      backgroundColor: "#0B2416",
      zIndex: 50,
      visible: false,
      paddingLeft: 1,
      paddingRight: 1,
    });
    this.toastText = new TextRenderable(r, { id: uid("toast-t"), content: "", fg: "#3FB950" });
    this.toastBox.add(this.toastText);
    r.root.add(this.toastBox);

    // Overlay: full-screen dim layer with a centered card.
    this.overlayLayer = new BoxRenderable(r, {
      id: uid("ovl"),
      position: "absolute",
      top: 0,
      left: 0,
      width: "100%",
      height: "100%",
      backgroundColor: RGBA.fromInts(0, 0, 0, 140),
      justifyContent: "center",
      alignItems: "center",
      zIndex: 100,
      visible: false,
    });
    this.overlayCard = new BoxRenderable(r, {
      id: uid("ovl-card"),
      border: true,
      borderStyle: "double",
      borderColor: FOCUSED,
      backgroundColor: "#1C1C1C",
      padding: 1,
      flexDirection: "column",
      minWidth: 40,
    });
    this.overlayLayer.add(this.overlayCard);
    r.root.add(this.overlayLayer);
  }

  render(vm: ViewModel) {
    this.repoBox.title = ` ${vm.repoHeader} `;
    this.repoBox.borderColor = vm.focus === "repos" ? FOCUSED : UNFOCUSED;
    this.listBox.title = ` ${vm.listHeader} `;
    this.listBox.borderColor = vm.focus === "list" ? FOCUSED : UNFOCUSED;
    this.detailBox.borderColor = vm.focus === "detail" ? FOCUSED : UNFOCUSED;
    this.footer.content = vm.footer;

    this.renderRepos(vm);
    this.renderList(vm);
    this.renderDetail(vm.detail);
    this.renderToast(vm.toast);
    this.renderOverlay(vm.overlay);
  }

  private renderRepos(vm: ViewModel) {
    // The highlight only reads as "selected" when the pane is focused; otherwise
    // just the active-repo marker shows, so an unfocused pane isn't noisy.
    const sig = JSON.stringify({ repos: vm.repos, focused: vm.reposFocused });
    if (sig === this.repoSig) return;
    this.repoSig = sig;
    this.clearChildren(this.repoBox);

    let selectedId: string | null = null;
    for (const repo of vm.repos) {
      const id = uid("repo");
      const highlighted = repo.selected && vm.reposFocused;
      if (repo.selected) selectedId = id;
      const marker = repo.active ? "● " : "  ";
      this.repoBox.add(
        new TextRenderable(this.r, {
          id,
          content: `${marker}${repo.text}`,
          width: "100%",
          fg: highlighted ? SELECTED_FG : repo.active ? ACTIVE_FG : undefined,
          bg: highlighted ? SELECTED_BG : undefined,
        }),
      );
    }
    if (selectedId) this.repoBox.scrollChildIntoView(selectedId);
  }

  private renderList(vm: ViewModel) {
    const sig = JSON.stringify({ msg: vm.listMessage, rows: vm.rows });
    if (sig === this.rowSig) return;
    this.rowSig = sig;
    this.clearChildren(this.listBox);

    if (vm.listMessage) {
      this.listBox.add(
        new TextRenderable(this.r, { id: uid("list-msg"), content: vm.listMessage, fg: DIM_FG, width: "100%" }),
      );
      return;
    }
    let selectedId: string | null = null;
    for (const row of vm.rows) {
      const id = uid("row");
      if (row.selected) selectedId = id;
      this.listBox.add(
        new TextRenderable(this.r, {
          id,
          content: `${row.selected ? "> " : "  "}${row.text}`,
          width: "100%",
          fg: row.selected ? SELECTED_FG : undefined,
          bg: row.selected ? SELECTED_BG : undefined,
        }),
      );
    }
    if (selectedId) this.listBox.scrollChildIntoView(selectedId);
  }

  private renderDetail(d: DetailVM) {
    const sig = detailSignature(d);
    if (sig === this.detailSig) return;
    this.detailSig = sig;
    this.clearChildren(this.detailBox);

    // Moving to a different issue (or its loading frame) starts at the top;
    // an in-place repaint of the same issue preserves the scroll offset.
    const key = detailKey(d);
    if (key !== this.detailKey) {
      this.detailBox.scrollTo(0);
      this.detailKey = key;
    }

    if (d.kind !== "ready") {
      const msg =
        d.kind === "loading" ? "Loading…" : d.kind === "error" ? `⚠ ${d.message}` : d.message;
      this.detailBox.title = "";
      this.detailBox.add(
        new TextRenderable(this.r, {
          id: uid("d-msg"),
          content: msg,
          fg: d.kind === "error" ? "#F85149" : DIM_FG,
          width: "100%",
        }),
      );
      return;
    }

    this.detailBox.title = ` ${d.header} `;
    this.detailBox.add(
      new TextRenderable(this.r, { id: uid("d-meta"), content: d.meta, fg: DIM_FG, width: "100%" }),
    );
    if (d.badge) {
      this.detailBox.add(
        new TextRenderable(this.r, { id: uid("d-badge"), content: d.badge, fg: "#A371F7", width: "100%" }),
      );
    }
    this.detailBox.add(this.markdown(d.body));
    this.detailBox.add(
      new TextRenderable(this.r, {
        id: uid("d-div"),
        content: d.commentsDivider,
        fg: DIM_FG,
        width: "100%",
        marginTop: 1,
      }),
    );
    for (const c of d.comments) {
      const card = new BoxRenderable(this.r, {
        id: uid("cmt"),
        border: true,
        borderStyle: "rounded",
        borderColor: UNFOCUSED,
        title: ` ${c.header} `,
        titleAlignment: "left",
        width: "100%",
        marginTop: 1,
        flexDirection: "column",
      });
      card.add(this.markdown(c.body));
      this.detailBox.add(card);
    }
  }

  private renderToast(toast: Toast | null) {
    if (!toast) {
      this.toastBox.visible = false;
      return;
    }
    const ok = toast.tone === "success";
    this.toastBox.borderColor = ok ? "#3FB950" : "#F85149";
    this.toastBox.backgroundColor = ok ? "#0B2416" : "#2D1214";
    this.toastText.fg = ok ? "#3FB950" : "#F85149";
    this.toastText.content = `${ok ? "✓" : "✗"} ${toast.text}`;
    this.toastBox.visible = true;
  }

  private renderOverlay(o: OverlayVM) {
    const sig = JSON.stringify(o);
    if (sig === this.overlaySig) return;
    this.overlaySig = sig;

    if (o.kind === "none") {
      this.overlayLayer.visible = false;
      return;
    }
    this.overlayLayer.visible = true;
    this.clearChildren(this.overlayCard);

    if (o.kind === "help") {
      this.overlayCard.title = ` ${o.title} `;
      const keyWidth = Math.max(...o.bindings.map((b) => b.key.length));
      for (const b of o.bindings) {
        this.overlayCard.add(
          new TextRenderable(this.r, {
            id: uid("hk"),
            content: `${b.key.padEnd(keyWidth)}   ${b.action}`,
            width: "100%",
          }),
        );
      }
      this.overlayCard.add(
        new TextRenderable(this.r, {
          id: uid("hk-hint"),
          content: "",
          marginTop: 1,
          width: "100%",
        }),
      );
      this.overlayCard.add(
        new TextRenderable(this.r, { id: uid("hk-esc"), content: "Press ? or Esc to close", fg: DIM_FG, width: "100%" }),
      );
      return;
    }

    if (o.kind === "goto" || o.kind === "addrepo") {
      this.overlayCard.title = ` ${o.title} `;
      this.overlayCard.add(
        new TextRenderable(this.r, { id: uid("in-input"), content: `${o.inputLine}▌`, fg: SELECTED_FG, marginBottom: 1, width: "100%" }),
      );
      this.overlayCard.add(
        new TextRenderable(this.r, { id: uid("in-hint"), content: o.hint, fg: DIM_FG, width: "100%" }),
      );
      return;
    }

    // confirm
    this.overlayCard.title = ` ${o.title} `;
    this.overlayCard.add(
      new TextRenderable(this.r, { id: uid("cf-issue"), content: o.issueLine, marginBottom: 1, width: "100%" }),
    );
    if (o.reasonLine) {
      this.overlayCard.add(
        new TextRenderable(this.r, { id: uid("cf-reason"), content: o.reasonLine, fg: DIM_FG, marginBottom: 1, width: "100%" }),
      );
    }
    this.overlayCard.add(
      new TextRenderable(this.r, {
        id: uid("cf-hint"),
        content: "[ Enter ] confirm     [ Esc ] cancel",
        fg: DIM_FG,
        width: "100%",
      }),
    );
  }

  private markdown(content: string): BoxRenderable {
    return renderMarkdown(this.r, content);
  }

  // --- detail scroll controls, driven by the host on focus == detail ---------

  scrollDetail(delta: number) {
    this.detailBox.scrollBy(delta);
  }
  scrollDetailTo(where: "top" | "bottom") {
    this.detailBox.scrollTo(where === "top" ? 0 : Number.MAX_SAFE_INTEGER);
  }

  private clearChildren(box: BoxRenderable) {
    for (const child of [...box.getChildren()]) box.remove(child);
  }
}

// Repaint signature: every field the detail pane paints must be here, or a
// change that leaves header + comment-count untouched (e.g. reopening the same
// issue - new state/badge/meta, same title) would be silently skipped.
function detailSignature(d: DetailVM): string {
  switch (d.kind) {
    case "ready":
      return `ready:${d.header}:${d.meta}:${d.badge}:${d.body.length}:${d.comments.length}`;
    default:
      return `${d.kind}:${"message" in d ? d.message : ""}`;
  }
}

// Scroll-reset identity: only the issue's identity, NOT its volatile meta. A new
// issue (or the loading frame that precedes one) resets scroll to the top;
// repainting the same issue in place keeps the reader's position.
function detailKey(d: DetailVM): string {
  return d.kind === "ready" ? d.header : d.kind;
}

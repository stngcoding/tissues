// Markdown -> OpenTUI renderables.
//
// Why not @opentui/core's MarkdownRenderable? In 0.4.5 it renders inline text
// as empty/raw glyphs through the headless path and drags in a tree-sitter wasm
// chain - the issue body showed up as flat plain text. We already depend on
// `marked` (transitively, now directly) and on TextRenderable/StyledText, which
// paint reliably. So we lex with `marked` and map each token to the same styled
// primitives the rest of the TUI uses. No tree-sitter, no wasm, works in tests.
//
// Scope: the Markdown GitHub issues actually use - headings, emphasis, inline
// code, links, fenced code blocks, lists, blockquotes, rules. Code blocks are
// boxed but not syntax-highlighted (ponytail: per-token highlighting is a later
// add; a distinct color + border already reads as code).

import {
  BoxRenderable,
  bold,
  fg,
  italic,
  StyledText,
  strikethrough,
  TextRenderable,
  underline,
  type CliRenderer,
  type StylableInput,
  type TextChunk,
} from "@opentui/core";
import { marked, type Token, type Tokens } from "marked";
import { uid } from "./ids";

const COLOR = {
  text: "#C9D1D9",
  heading: "#79C0FF",
  code: "#FFA657",
  link: "#58A6FF",
  quote: "#8B949E",
  rule: "#30363D",
  codeBorder: "#30363D",
};

interface InlineStyle {
  fg: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  link?: string;
}

// Decode the HTML entities marked leaves in token text: numeric (decimal + hex,
// covers smart quotes/em-dashes/etc.) plus the common named ones. &amp; is undone
// last so "&amp;lt;" round-trips to "&lt;", not "<".
function unescape(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => codePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => codePoint(parseInt(n, 16)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");
}

function codePoint(n: number): string {
  return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : "";
}

function chunk(text: string, s: InlineStyle): TextChunk {
  let c: StylableInput = unescape(text);
  if (s.bold) c = bold(c);
  if (s.italic) c = italic(c);
  if (s.underline) c = underline(c);
  if (s.strike) c = strikethrough(c);
  const built = fg(s.fg)(c);
  return s.link ? { ...built, link: { url: s.link } } : built;
}

// Flatten inline tokens (which nest: strong > em > text) into styled runs,
// carrying the accumulated style down each branch.
function inline(tokens: Token[] | undefined, s: InlineStyle, out: TextChunk[]): void {
  if (!tokens) return;
  for (const t of tokens as Tokens.Generic[]) {
    switch (t.type) {
      case "text":
        if (t.tokens) inline(t.tokens, s, out);
        else out.push(chunk(t.text ?? "", s));
        break;
      case "strong":
        inline(t.tokens, { ...s, bold: true }, out);
        break;
      case "em":
        inline(t.tokens, { ...s, italic: true }, out);
        break;
      case "del":
        inline(t.tokens, { ...s, strike: true }, out);
        break;
      case "codespan":
        out.push(chunk(t.text ?? "", { ...s, fg: COLOR.code }));
        break;
      case "link":
        inline(t.tokens, { ...s, fg: COLOR.link, underline: true, link: t.href }, out);
        break;
      case "br":
        out.push(chunk("\n", s));
        break;
      default:
        out.push(chunk(t.text ?? t.raw ?? "", s));
    }
  }
}

function styledText(tokens: Token[] | undefined, base: InlineStyle): StyledText {
  const chunks: TextChunk[] = [];
  inline(tokens, base, chunks);
  if (chunks.length === 0) chunks.push(chunk("", base));
  return new StyledText(chunks);
}

function text(r: CliRenderer, content: StyledText, opts: { marginTop?: number } = {}): TextRenderable {
  return new TextRenderable(r, { id: uid("t"), content, width: "100%", marginTop: opts.marginTop ?? 0 });
}

function renderBlock(r: CliRenderer, box: BoxRenderable, token: Token, first: boolean): void {
  const gap = first ? 0 : 1;
  switch (token.type) {
    case "space":
      return;

    case "heading": {
      const t = token as Tokens.Heading;
      box.add(text(r, styledText(t.tokens, { fg: COLOR.heading, bold: true }), { marginTop: gap }));
      return;
    }

    case "paragraph": {
      const t = token as Tokens.Paragraph;
      box.add(text(r, styledText(t.tokens, { fg: COLOR.text }), { marginTop: gap }));
      return;
    }

    case "code": {
      const t = token as Tokens.Code;
      const card = new BoxRenderable(r, {
        id: uid("code"),
        width: "100%",
        marginTop: gap,
        border: true,
        borderStyle: "rounded",
        borderColor: COLOR.codeBorder,
        flexDirection: "column",
        title: t.lang ? ` ${t.lang} ` : undefined,
        titleAlignment: "left",
      });
      for (const line of t.text.split("\n")) {
        card.add(new TextRenderable(r, { id: uid("cl"), content: line, fg: COLOR.code, width: "100%" }));
      }
      box.add(card);
      return;
    }

    case "blockquote": {
      const t = token as Tokens.Blockquote;
      const quote = new BoxRenderable(r, {
        id: uid("quote"),
        width: "100%",
        marginTop: gap,
        paddingLeft: 1,
        borderStyle: "single",
        border: ["left"],
        borderColor: COLOR.quote,
        flexDirection: "column",
      });
      // Quotes are almost always paragraphs; render them dim + italic. Anything
      // else nested (a code block, a list) falls back to normal block rendering.
      t.tokens.forEach((inner, i) => {
        if (inner.type === "paragraph") {
          const p = inner as Tokens.Paragraph;
          quote.add(text(r, styledText(p.tokens, { fg: COLOR.quote, italic: true }), { marginTop: i === 0 ? 0 : 1 }));
        } else {
          renderBlock(r, quote, inner, i === 0);
        }
      });
      box.add(quote);
      return;
    }

    case "list": {
      const t = token as Tokens.List;
      const listBox = new BoxRenderable(r, { id: uid("list"), width: "100%", marginTop: gap, flexDirection: "column" });
      const start = Number.isFinite(Number(t.start)) ? Number(t.start) : 1;
      t.items.forEach((item, i) => {
        const marker = item.task ? (item.checked ? "☑ " : "☐ ") : t.ordered ? `${start + i}. ` : "• ";
        renderListItem(r, listBox, item, marker);
      });
      box.add(listBox);
      return;
    }

    case "hr":
      box.add(new TextRenderable(r, { id: uid("hr"), content: "─".repeat(24), fg: COLOR.rule, width: "100%", marginTop: gap }));
      return;

    default: {
      // Anything we don't paint specially (HTML blocks, GFM tables, unknown
      // types): show the raw source rather than an empty line. Losing the
      // markup is fine; silently losing the content is not.
      const t = token as Tokens.Generic;
      const chunks: TextChunk[] = [];
      if (t.tokens) inline(t.tokens, { fg: COLOR.text }, chunks);
      if (chunks.length === 0) chunks.push(chunk((t.raw ?? "").trimEnd(), { fg: COLOR.text }));
      box.add(text(r, new StyledText(chunks), { marginTop: gap }));
    }
  }
}

// Render one list item: the marker + its lead inline on the first line, then any
// nested blocks (sub-lists, code, quotes) indented beneath it. marked nests an
// item's content under block tokens - usually a leading "text"/"paragraph" whose
// `.tokens` are the inline runs, followed by nested blocks.
function renderListItem(r: CliRenderer, listBox: BoxRenderable, item: Tokens.ListItem, marker: string): void {
  // The marker already carries the checkbox glyph, so drop marked's leading
  // `checkbox` token before splitting into lead line + nested blocks.
  const content = (item.tokens ?? []).filter((t) => t.type !== "checkbox");
  const [lead, ...rest] = content;
  const chunks: TextChunk[] = [chunk(marker, { fg: COLOR.text })];
  if (lead) {
    const g = lead as Tokens.Generic;
    if (g.tokens) inline(g.tokens, { fg: COLOR.text }, chunks);
    else if (g.text != null) chunks.push(chunk(g.text, { fg: COLOR.text }));
  }
  listBox.add(new TextRenderable(r, { id: uid("li"), content: new StyledText(chunks), width: "100%" }));

  if (rest.length) {
    const sub = new BoxRenderable(r, { id: uid("sub"), width: "100%", paddingLeft: 2, flexDirection: "column" });
    rest.forEach((tk) => renderBlock(r, sub, tk, true));
    listBox.add(sub);
  }
}

export function renderMarkdown(r: CliRenderer, content: string): BoxRenderable {
  const box = new BoxRenderable(r, { id: uid("root"), width: "100%", flexDirection: "column" });
  const tokens = marked.lexer(content ?? "");
  let first = true;
  for (const token of tokens) {
    if (token.type === "space") continue;
    renderBlock(r, box, token, first);
    first = false;
  }
  return box;
}

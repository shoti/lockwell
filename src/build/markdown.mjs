// @ts-check
// SPDX-FileCopyrightText: 2026 Shota Mtvarelishvili <mtvarelishvili@proton.me>
// SPDX-License-Identifier: MIT
/**
 * @file A deliberately small Markdown subset parser and renderer that fails loudly on anything unsupported.
 * @author Shota Mtvarelishvili <mtvarelishvili@proton.me> (https://shoti.github.io/)
 */
/**
 * A deliberately small Markdown subset (see docs/CONTENT-GUIDE.md):
 *   headings (## – ####) with optional {#id .class} attributes,
 *   paragraphs, "-" and "1." lists (one level), callouts (> [!note|tip|warning]),
 *   figures on a line of their own (![Caption](figure:name), see figures.mjs),
 *   **bold**, *italic*, `code`, [links](url) and backslash escapes.
 * Anything else fails the build with a clear message instead of rendering wrongly.
 * All text is HTML-escaped; raw HTML is not allowed.
 */
import { ContentError } from './errors.mjs';
import { SafeHtml, escapeHtml } from './html.mjs';

/**
 * @typedef {{ id?: string, classes: string[] }} Attrs
 * @typedef {{ type: 'heading', level: number, text: string, attrs: Attrs, line: number }} HeadingNode
 * @typedef {{ type: 'paragraph', text: string, line: number }} ParagraphNode
 * @typedef {{ text: string, line: number }} ListItem
 * @typedef {{ type: 'list', ordered: boolean, items: ListItem[], line: number }} ListNode
 * @typedef {{ type: 'callout', kind: string, children: BlockNode[], line: number }} CalloutNode
 * @typedef {{ type: 'figure', name: string, caption: string, line: number }} FigureNode
 * @typedef {HeadingNode | ParagraphNode | ListNode | CalloutNode | FigureNode} BlockNode
 */

/**
 * @typedef {object} RenderContext
 * @property {string} file
 * @property {(target: string, line: number) => string} resolveLink  Validates a link target and returns the final href.
 * @property {(kind: string) => string} calloutLabel
 * @property {(name: string, caption: string, line: number) => string} [figure]  Returns the figure's HTML around an already-rendered caption.
 */

export const CALLOUT_KINDS = ['note', 'tip', 'warning'];

/** Ids used by the page layout itself; content may not reuse them. */
export const RESERVED_IDS = ['main'];

// (.*\S) instead of a lazy (.+?), and no leading [ \t]* in ATTRS (the text before
// it is trimmed instead), keep matching linear on long runs of spaces.
const HEADING = /^(#{1,6})[ \t]+(.*\S)[ \t]*$/;
const LIST_ITEM = /^([-*]|\d{1,3}[.)])[ \t]+(.*)$/;
const NESTED_LIST_ITEM = /^[ \t]+([-*]|\d{1,3}[.)])[ \t]+/;
const BLOCKQUOTE = /^>[ \t]?/;
const FENCE = /^ {0,3}(```|~~~)/;
const HTML_TAG = /^[ \t]*<[a-zA-Z/!]/;
const ATTRS = /\{([^{}]*)\}$/;
const FIGURE = /^!\[(.*\S)\]\(figure:([a-z0-9][a-z0-9-]*)\)[ \t]*$/;
const IMAGE = /^!\[/;

/**
 * Parses block-level structure.
 * @param {string} source
 * @param {string} file
 * @param {number} [firstLine]  Line number of the first source line in the file.
 * @returns {BlockNode[]}
 */
export function parseBlocks(source, file, firstLine = 1) {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  /** @type {BlockNode[]} */
  const nodes = [];
  let i = 0;

  /** @param {number} index @param {string} message @returns {never} */
  const fail = (index, message) => {
    throw new ContentError(file, firstLine + index, message);
  };

  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '') {
      i += 1;
      continue;
    }
    if (FENCE.test(line)) fail(i, 'Code blocks are not supported. Use `inline code` instead.');
    if (HTML_TAG.test(line)) fail(i, 'Raw HTML is not allowed in content. Use the Markdown subset described in docs/CONTENT-GUIDE.md.');
    if (NESTED_LIST_ITEM.test(line)) fail(i, 'Indented list items are not supported. Remove the indentation; lists are one level deep.');

    if (IMAGE.test(line)) {
      const figure = FIGURE.exec(line);
      if (!figure) throw new ContentError(file, firstLine + i, 'Images must be figures on a line of their own: ![Caption shown under it](figure:name), with content/<lang>/figures/name.svg.');
      nodes.push({ type: 'figure', name: figure[2], caption: figure[1].trim(), line: firstLine + i });
      i += 1;
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      nodes.push(parseHeading(heading[1].length, heading[2], firstLine + i, file));
      i += 1;
      continue;
    }

    if (BLOCKQUOTE.test(line)) {
      const start = i;
      /** @type {string[]} */
      const inner = [];
      while (i < lines.length && BLOCKQUOTE.test(lines[i])) {
        inner.push(lines[i].replace(BLOCKQUOTE, ''));
        i += 1;
      }
      const marker = /^\[!(\w+)\][ \t]*$/.exec(inner[0]);
      if (!marker) {
        throw new ContentError(file, firstLine + start, `Blockquotes must be callouts. Start them with "> [!${CALLOUT_KINDS.join(']", "> [!')}]".`);
      }
      const kind = marker[1].toLowerCase();
      if (!CALLOUT_KINDS.includes(kind)) fail(start, `Unknown callout type "${kind}". Use one of: ${CALLOUT_KINDS.join(', ')}.`);
      const children = parseBlocks(inner.slice(1).join('\n'), file, firstLine + start + 1);
      if (children.length === 0) fail(start, 'This callout is empty. Add text on the "> " lines below the [!type] line.');
      if (children.some((child) => child.type === 'heading' || child.type === 'callout' || child.type === 'figure')) {
        fail(start, 'Callouts may only contain paragraphs and lists.');
      }
      nodes.push({ type: 'callout', kind, children, line: firstLine + start });
      continue;
    }

    const listItem = LIST_ITEM.exec(line);
    if (listItem) {
      const ordered = /\d/.test(listItem[1]);
      const start = i;
      /** @type {ListItem[]} */
      const items = [];
      while (i < lines.length) {
        const current = lines[i];
        const item = LIST_ITEM.exec(current);
        if (item && /\d/.test(item[1]) === ordered) {
          // Steps are numbered by CSS counters, so a list must count from 1 without gaps.
          if (ordered && Number.parseInt(item[1], 10) !== items.length + 1) {
            fail(i, `List numbers must count 1, 2, 3… (found "${item[1]}" as item ${items.length + 1}). A list can't continue after a callout or paragraph: move the callout below the list, or start a new list at 1.`);
          }
          items.push({ text: item[2].trim(), line: firstLine + i });
          i += 1;
          continue;
        }
        if (NESTED_LIST_ITEM.test(current)) fail(i, 'Nested lists are not supported. Keep lists one level deep.');
        if (/^[ \t]{2,}\S/.test(current) && items.length > 0) {
          items[items.length - 1].text += ` ${current.trim()}`;
          i += 1;
          continue;
        }
        // A single blank line between items keeps the list going.
        if (current.trim() === '' && i + 1 < lines.length) {
          const next = LIST_ITEM.exec(lines[i + 1]);
          if (next && /\d/.test(next[1]) === ordered) {
            i += 1;
            continue;
          }
        }
        if (current.trim() !== '' && !startsBlock(current)) {
          fail(i, 'Text right after a list item must be indented by two spaces to continue that item, or separated from the list by a blank line.');
        }
        break;
      }
      const empty = items.find((entry) => entry.text === '');
      if (empty) throw new ContentError(file, empty.line, 'Empty list item. Remove it or add text.');
      nodes.push({ type: 'list', ordered, items, line: firstLine + start });
      continue;
    }

    const start = i;
    /** @type {string[]} */
    const paragraph = [];
    while (i < lines.length && lines[i].trim() !== '' && !startsBlock(lines[i])) {
      paragraph.push(lines[i].trim());
      i += 1;
    }
    nodes.push({ type: 'paragraph', text: paragraph.join(' '), line: firstLine + start });
  }

  return nodes;
}

/** @param {string} line */
function startsBlock(line) {
  return (
    HEADING.test(line) ||
    IMAGE.test(line) ||
    LIST_ITEM.test(line) ||
    NESTED_LIST_ITEM.test(line) ||
    BLOCKQUOTE.test(line) ||
    FENCE.test(line) ||
    HTML_TAG.test(line)
  );
}

/**
 * @param {number} level
 * @param {string} content
 * @param {number} line
 * @param {string} file
 * @returns {HeadingNode}
 */
function parseHeading(level, content, line, file) {
  if (level > 4) throw new ContentError(file, line, 'Headings deeper than #### are not supported.');
  /** @type {Attrs} */
  const attrs = { classes: [] };
  let text = content;
  const attrMatch = ATTRS.exec(content);
  if (attrMatch) {
    text = content.slice(0, attrMatch.index).trim();
    for (const token of attrMatch[1].trim().split(/\s+/).filter(Boolean)) {
      if (/^#[a-z0-9][a-z0-9-]*$/.test(token)) {
        if (attrs.id) throw new ContentError(file, line, `A heading can have only one id. Found "${attrs.id}" and "${token.slice(1)}".`);
        attrs.id = token.slice(1);
        if (RESERVED_IDS.includes(attrs.id)) {
          throw new ContentError(file, line, `The id "${attrs.id}" is used by the page layout. Choose another id.`);
        }
      } else if (/^\.[a-z][a-z0-9-]*$/.test(token)) {
        attrs.classes.push(token.slice(1));
      } else {
        throw new ContentError(file, line, `Invalid heading attribute "${token}". Use #lowercase-id or .lowercase-class.`);
      }
    }
  }
  if (text === '') throw new ContentError(file, line, 'Heading text is empty.');
  return { type: 'heading', level, text, attrs, line };
}

// A link URL may contain one level of balanced parentheses, e.g. Wikipedia's "Signal_(software)".
// *Italic* must start with a letter and end before a non-letter, so phone codes
// such as *#21# or *21* never turn into italics; a leftover "*" fails the build.
const INLINE =
  /`([^`]+)`|\[([^\]]+)\]\(((?:[^()\s]|\([^()\s]*\))+)\)|\*\*(?=\S)(.+?)(?<=\S)\*\*|(?<![\p{L}\p{N}])\*(?=\p{L})(.+?)(?<=\S)\*(?![\p{L}\p{N}])|\\([\\`*_[\]()#.!{}>+-])/gu;

/**
 * @param {string} text
 * @param {RenderContext} ctx
 * @param {number} line
 * @returns {string}
 */
function inlineToString(text, ctx, line) {
  let out = '';
  let last = 0;
  /** @param {string} plain */
  const appendText = (plain) => {
    if (/\]\(/.test(plain)) {
      throw new ContentError(ctx.file, line, `Could not read a link near "${plain.trim().slice(0, 60)}". Check the brackets: [text](https://…).`);
    }
    if (plain.includes('*')) {
      throw new ContentError(
        ctx.file,
        line,
        `Stray "*" near "${plain.trim().slice(0, 60)}". Write phone codes in backticks (\`*#21#\`), a literal asterisk as \\*, and *italic* / **bold** around words.`,
      );
    }
    out += escapeHtml(plain);
  };
  for (const match of text.matchAll(INLINE)) {
    const index = /** @type {number} */ (match.index);
    appendText(text.slice(last, index));
    const [whole, code, linkText, linkTarget, strong, em, escaped] = match;
    if (code !== undefined) {
      out += `<code>${escapeHtml(code)}</code>`;
    } else if (linkText !== undefined) {
      const href = ctx.resolveLink(linkTarget, line);
      const external = /^https?:\/\//.test(href);
      const rel = external ? ' rel="external noreferrer"' : '';
      out += `<a href="${escapeHtml(href)}"${rel}>${inlineToString(linkText, ctx, line)}</a>`;
    } else if (strong !== undefined) {
      out += `<strong>${inlineToString(strong, ctx, line)}</strong>`;
    } else if (em !== undefined) {
      out += `<em>${inlineToString(em, ctx, line)}</em>`;
    } else {
      out += escapeHtml(escaped);
    }
    last = index + whole.length;
  }
  appendText(text.slice(last));
  return out;
}

/**
 * The bold parts of inline Markdown (menu and setting names), as plain text.
 * @param {string} text
 * @returns {string[]}
 */
export function strongTexts(text) {
  /** @type {string[]} */
  const found = [];
  for (const match of text.matchAll(INLINE)) {
    const [, , linkText, , strong, em] = match;
    if (strong !== undefined) found.push(plainText(strong));
    else if (linkText !== undefined || em !== undefined) found.push(...strongTexts(linkText ?? em ?? ''));
  }
  return found;
}

/**
 * Inline Markdown as plain text: no formatting marks, links reduced to their text.
 * Not escaped; for search text and attributes, which escape on output.
 * @param {string} text
 * @returns {string}
 */
export function plainText(text) {
  return text.replace(INLINE, (_whole, code, linkText, _target, strong, em, escaped) => {
    const nested = linkText ?? strong ?? em;
    return nested !== undefined ? plainText(nested) : (code ?? escaped);
  });
}

/**
 * Renders inline Markdown. Text is always escaped.
 * @param {string} text
 * @param {RenderContext} ctx
 * @param {number} line
 * @returns {SafeHtml}
 */
export function renderInline(text, ctx, line) {
  return new SafeHtml(inlineToString(text, ctx, line));
}

/**
 * Renders block nodes.
 * @param {BlockNode[]} nodes
 * @param {RenderContext} ctx
 * @returns {SafeHtml}
 */
export function renderBlocks(nodes, ctx) {
  return new SafeHtml(blocksToString(nodes, ctx));
}

/**
 * @param {BlockNode[]} nodes
 * @param {RenderContext} ctx
 * @returns {string}
 */
function blocksToString(nodes, ctx) {
  return nodes.map((node) => blockToString(node, ctx)).join('\n');
}

/**
 * @param {BlockNode} node
 * @param {RenderContext} ctx
 * @returns {string}
 */
function blockToString(node, ctx) {
  switch (node.type) {
    case 'heading': {
      if (node.level === 1) {
        throw new ContentError(ctx.file, node.line, 'Don\'t use "#" headings in content. The page title comes from the "title" front matter; start sections with "##".');
      }
      const id = node.attrs.id ? ` id="${escapeHtml(node.attrs.id)}"` : '';
      return `<h${node.level}${id}>${inlineToString(node.text, ctx, node.line)}</h${node.level}>`;
    }
    case 'paragraph':
      return `<p>${inlineToString(node.text, ctx, node.line)}</p>`;
    case 'list': {
      const tag = node.ordered ? 'ol' : 'ul';
      const items = node.items.map((item) => `<li>${inlineToString(item.text, ctx, item.line)}</li>`).join('');
      return `<${tag}>${items}</${tag}>`;
    }
    case 'figure': {
      if (!ctx.figure) throw new ContentError(ctx.file, node.line, 'Figures are not supported here.');
      return ctx.figure(node.name, inlineToString(node.caption, ctx, node.line), node.line);
    }
    case 'callout':
      return `<aside class="callout callout--${node.kind}" role="note"><p class="callout__title">${escapeHtml(ctx.calloutLabel(node.kind))}</p>${blocksToString(node.children, ctx)}</aside>`;
    default:
      throw new Error(`Unknown block node type: ${JSON.stringify(node)}`);
  }
}

/**
 * Every heading id in a document must be unique (they become HTML ids and anchors).
 * @param {BlockNode[]} nodes
 * @param {string} file
 */
export function assertUniqueIds(nodes, file) {
  /** @type {Map<string, number>} */
  const seen = new Map();
  for (const node of nodes) {
    if (node.type !== 'heading' || !node.attrs.id) continue;
    const previous = seen.get(node.attrs.id);
    if (previous !== undefined) {
      throw new ContentError(file, node.line, `Duplicate id "${node.attrs.id}" (also used on line ${previous}). Ids must be unique on a page.`);
    }
    seen.set(node.attrs.id, node.line);
  }
}

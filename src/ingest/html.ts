/**
 * Turns fetched HTML into plain text for extraction and quote checking.
 * The output is untrusted data: it is shown to the model only as page text,
 * and nothing in it can change what the pipeline does.
 */

const DROPPED_ELEMENTS = ["script", "style", "noscript", "template", "svg", "iframe", "object", "embed", "head", "canvas", "math"];
const BLOCK_TAGS =
  "address|article|aside|blockquote|br|dd|details|div|dl|dt|figcaption|figure|footer|form|h[1-6]|header|hr|main|nav|ol|p|pre|section|summary|table|tbody|td|tfoot|th|thead|tr|ul";

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  hellip: "…",
  middot: "·",
  bull: "•",
  copy: "©",
  reg: "®",
  trade: "™",
  euro: "€",
  pound: "£",
  cent: "¢",
  eacute: "é",
  egrave: "è",
  agrave: "à",
  ccedil: "ç",
  ocirc: "ô",
};

/** Zero-width, bidi-override and other invisible characters that could hide text or break quote matching. */
const INVISIBLE = /[­​-‏‪-‮⁠-⁤⁦-⁩﻿]/g;

/** Decodes HTML entities in one pass (so "&amp;lt;" becomes "&lt;", not "<"). */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      const valid = Number.isInteger(code) && code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff);
      return valid ? String.fromCodePoint(code) : "";
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? match;
  });
}

/** Collapses runs of spaces within lines and blank lines between them. */
export function tidyWhitespace(text: string): string {
  return text
    .replace(INVISIBLE, "")
    .replace(/[^\S\n]+/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, "");
}

/**
 * HTML → text. The page title comes first, then the body text with block
 * elements on their own lines, then a "Links:" list of the page's http(s)
 * links (resolved against `baseUrl`) so an apply link can be quoted verbatim.
 */
export function htmlToText(html: string, baseUrl?: string): string {
  let s = html.replace(/<!--[\s\S]*?(?:-->|$)/g, "");

  const title = tidyWhitespace(decodeEntities(stripTags(/<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(s)?.[1] ?? "")));

  for (const tag of DROPPED_ELEMENTS) {
    s = s.replace(new RegExp(`<${tag}\\b[\\s\\S]*?(?:<\\/${tag}\\s*>|$)`, "gi"), " ");
  }

  const links: string[] = [];
  const seen = new Set<string>();
  s = s.replace(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi, (_m, attrs: string, inner: string) => {
    const label = tidyWhitespace(decodeEntities(stripTags(inner))).replace(/\n/g, " ");
    const href = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs);
    const raw = href ? decodeEntities(href[1] ?? href[2] ?? href[3] ?? "").trim() : "";
    try {
      const url = new URL(raw, baseUrl);
      if ((url.protocol === "http:" || url.protocol === "https:") && !seen.has(url.href)) {
        seen.add(url.href);
        links.push(label ? `- ${label}: ${url.href}` : `- ${url.href}`);
      }
    } catch {
      // Unresolvable or relative without a base: ignore the link, keep its text.
    }
    return ` ${inner} `;
  });

  // Source whitespace is insignificant in HTML; line breaks come only from block elements.
  s = s.replace(/\s+/g, " ");
  s = s.replace(/<li\b[^>]*>/gi, "\n- ");
  s = s.replace(new RegExp(`<\\/?(?:${BLOCK_TAGS})\\b[^>]*>`, "gi"), "\n");
  const body = tidyWhitespace(decodeEntities(stripTags(s)));

  return [title, body, links.length ? `Links:\n${links.join("\n")}` : ""].filter(Boolean).join("\n\n");
}

"use client";

import { memo } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * An entry's body rendered as markdown (KANBAN-38). Entries are STORED as plain
 * text; this is display only.
 *
 * Safety: react-markdown builds React elements, never an HTML string, and raw
 * HTML in the text is dropped (`skipHtml`; no rehype-raw), so nothing typed
 * or written over MCP can inject markup. Its default urlTransform already
 * blanks unsafe link protocols (javascript:, data: …). Links open in a new tab
 * with rel="noopener noreferrer". Images are not rendered (an entry is text; a
 * remote image would also be a tracking pixel): an image renders as nothing.
 * GFM adds bare-URL autolinks (PR links), strikethrough, task lists and tables.
 */
const components: Components = {
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer nofollow">
      {children}
    </a>
  ),
  // Headings in a short entry read as bold lines, not page titles.
  h1: ({ children }) => <p className="font-semibold">{children}</p>,
  h2: ({ children }) => <p className="font-semibold">{children}</p>,
  h3: ({ children }) => <p className="font-semibold">{children}</p>,
  h4: ({ children }) => <p className="font-semibold">{children}</p>,
  h5: ({ children }) => <p className="font-semibold">{children}</p>,
  h6: ({ children }) => <p className="font-semibold">{children}</p>,
  table: ({ children }) => (
    <div className="overflow-x-auto">
      <table>{children}</table>
    </div>
  ),
};

export const EntryMarkdown = memo(function EntryMarkdown({ text }: { text: string }) {
  return (
    <div className="prose-mykan entry-md min-w-0 break-words">
      <Markdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        disallowedElements={["img"]}
        unwrapDisallowed
        components={components}
      >
        {text}
      </Markdown>
    </div>
  );
});

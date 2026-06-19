/**
 * Minimal, dependency-free Markdown -> HTML renderer for the project knowledge
 * hub overview (spec 5.5). Supports headings, bold/italic, inline code, fenced
 * code blocks, unordered/ordered lists, links, and paragraphs. Input is HTML-
 * escaped first so a project's markdown cannot inject script (the knowledge_md
 * is admin-authored but still untrusted at render time).
 *
 * This is intentionally small; if richer rendering is needed later, swap in
 * react-markdown + rehype-sanitize without changing call sites.
 */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function inline(s: string): string {
  let out = escapeHtml(s);
  // inline code
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
  // bold then italic
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  // links [text](url) - only http(s) urls are linkified
  out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  return out;
}

export function renderMarkdown(md: string): string {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const html: string[] = [];
  let inCode = false;
  let codeBuf: string[] = [];
  let listType: 'ul' | 'ol' | null = null;
  let para: string[] = [];

  const flushPara = (): void => {
    if (para.length) {
      html.push(`<p>${inline(para.join(' '))}</p>`);
      para = [];
    }
  };
  const closeList = (): void => {
    if (listType) {
      html.push(`</${listType}>`);
      listType = null;
    }
  };

  for (const line of lines) {
    const fence = line.trim().startsWith('```');
    if (fence) {
      if (inCode) {
        html.push(`<pre class="code">${escapeHtml(codeBuf.join('\n'))}</pre>`);
        codeBuf = [];
        inCode = false;
      } else {
        flushPara();
        closeList();
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      codeBuf.push(line);
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flushPara();
      closeList();
      const level = heading[1]!.length;
      html.push(`<h${level}>${inline(heading[2]!)}</h${level}>`);
      continue;
    }

    const ul = /^\s*[-*]\s+(.*)$/.exec(line);
    const ol = /^\s*\d+\.\s+(.*)$/.exec(line);
    if (ul || ol) {
      flushPara();
      const want: 'ul' | 'ol' = ul ? 'ul' : 'ol';
      if (listType !== want) {
        closeList();
        html.push(`<${want}>`);
        listType = want;
      }
      html.push(`<li>${inline((ul ?? ol)![1]!)}</li>`);
      continue;
    }

    if (line.trim() === '') {
      flushPara();
      closeList();
      continue;
    }
    para.push(line.trim());
  }

  if (inCode) html.push(`<pre class="code">${escapeHtml(codeBuf.join('\n'))}</pre>`);
  flushPara();
  closeList();
  return html.join('\n');
}

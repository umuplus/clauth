import { marked } from "marked";
import hljs from "highlight.js";
import "highlight.js/styles/github-dark.css";

marked.use({
  renderer: {
    code({ text, lang }: { text: string; lang?: string }) {
      if (lang && hljs.getLanguage(lang)) {
        try {
          const html = hljs.highlight(text, { language: lang }).value;
          return `<pre><code class="hljs language-${lang}">${html}</code></pre>`;
        } catch {
          // fall through
        }
      }
      const html = hljs.highlightAuto(text).value;
      return `<pre><code class="hljs">${html}</code></pre>`;
    },
  },
});

export function renderMarkdown(md: string): string {
  // Strip YAML frontmatter for display
  const stripped = md.replace(/^---\n[\s\S]*?\n---\n/, "");
  return marked.parse(stripped) as string;
}

export function parseFrontmatter(md: string): Record<string, string> {
  const match = md.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) return {};
  const result: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const [k, ...rest] = line.split(":");
    if (k && rest.length) {
      result[k.trim()] = rest.join(":").trim();
    }
  }
  return result;
}

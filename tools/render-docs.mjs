import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { marked } from 'marked';

const SITE = 'https://joegaffey.com/ghost-driver/';
const OUTPUT_ROOT = 'public';

const DOCS = [
  {
    source: 'SPEC.md',
    output: 'SPEC.html',
    title: 'Specification',
    description: 'Product and technical specification for Ghost Driver.',
  },
  {
    source: 'docs/telemetry-format.md',
    output: 'docs/telemetry-format.html',
    title: 'Telemetry format',
    description: 'Canonical JSON and CSV telemetry import contract.',
  },
  {
    source: 'docs/session-format.md',
    output: 'docs/session-format.html',
    title: 'Session format',
    description: 'Ghost Driver session files, camera sources and per-camera offsets.',
  },
  {
    source: 'docs/wheel-support.md',
    output: 'docs/wheel-support.html',
    title: 'Wheel support',
    description: 'Wheel capability model, adapters and tested devices.',
  },
  {
    source: 'docs/safety.md',
    output: 'docs/safety.html',
    title: 'Safety',
    description: 'Hazards, limits and automatic stop conditions.',
  },
  {
    source: 'docs/roadmap.md',
    output: 'docs/roadmap.html',
    title: 'Roadmap',
    description: 'Milestones and implementation sequencing.',
  },
];

const escapeHtml = (value) =>
  value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[character],
  );

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/['"]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function addHeadingIds(html) {
  const seen = new Map();

  return html.replace(
    /<h([1-6])([^>]*)>([\s\S]*?)<\/h\1>/g,
    (match, level, attributes, inner) => {
      if (/\bid=/.test(attributes)) return match;

      const text = inner
        .replace(/<[^>]*>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\s+/g, ' ')
        .trim();

      const base = slugify(text) || `section-${level}`;
      const count = seen.get(base) ?? 0;
      seen.set(base, count + 1);
      const id = count === 0 ? base : `${base}-${count + 1}`;

      return `<h${level}${attributes} id="${id}">${inner}<a class="heading-anchor" href="#${id}" aria-hidden="true">#</a></h${level}>`;
    },
  );
}

function rewriteLocalMarkdownLinks(html) {
  return html.replace(
    /href="(?!https?:|mailto:|tel:|#)([^"]*)\.md(#[^"]*)?"/g,
    (_match, path, hash = '') => `href="${path}.html${hash}"`,
  );
}

async function renderMarkdown(markdown) {
  const rendered = await marked.parse(markdown, { gfm: true });
  return addHeadingIds(rewriteLocalMarkdownLinks(rendered));
}

function sidebar(prefix, currentOutput) {
  return DOCS.map((doc) => {
    const active = doc.output === currentOutput;
    return `<a href="${prefix}${doc.output}"${active ? ' class="active" aria-current="page"' : ''}>${escapeHtml(doc.title)}</a>`;
  }).join('\n        ');
}

function page({ title, description, content, prefix, output, source }) {
  const fullTitle = `${escapeHtml(title)} — Ghost Driver`;
  const descriptionHtml = escapeHtml(description);
  const canonical = `${SITE}${output}`;
  const sourceUrl = `https://github.com/joegaffey/ghost-driver/blob/main/${source}`;

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${fullTitle}</title>
    <meta name="description" content="${descriptionHtml}" />
    <link rel="icon" type="image/svg+xml" href="${prefix}favicon.svg" />
    <link rel="stylesheet" href="${prefix}docs.css" />
    <link rel="canonical" href="${canonical}" />
    <meta property="og:type" content="article" />
    <meta property="og:site_name" content="Ghost Driver" />
    <meta property="og:title" content="${fullTitle}" />
    <meta property="og:description" content="${descriptionHtml}" />
    <meta property="og:url" content="${canonical}" />
  </head>
  <body>
    <div class="docs-shell">
      <header class="docs-header">
        <a class="brand" href="${prefix}"><span class="brand-mark">◉</span>Ghost Driver</a>
        <span class="badge">experimental</span>
        <nav class="header-nav">
          <a href="${prefix}">Intro</a>
          <a href="${prefix}play.html">Player</a>
          <a class="active" href="${prefix}SPEC.html">Spec</a>
        </nav>
      </header>

      <div class="docs-layout">
        <aside class="docs-sidebar">
          <p class="sidebar-title">Documentation</p>
          ${sidebar(prefix, output)}
          <p class="sidebar-title">Project</p>
          <a href="${prefix}">Intro page</a>
          <a href="${prefix}play.html">Open player</a>
          <a href="https://github.com/joegaffey/ghost-driver">Source repository</a>
        </aside>

        <main class="docs-content">
          ${content}
          <footer class="docs-footer">
            <span>Ghost Driver — experimental prototype.</span>
            <a href="${sourceUrl}">View source</a>
          </footer>
        </main>
      </div>
    </div>
  </body>
</html>
`;
}

await rm(`${OUTPUT_ROOT}/SPEC.html`, { force: true });
await rm(`${OUTPUT_ROOT}/docs`, { recursive: true, force: true });
await mkdir(`${OUTPUT_ROOT}/docs`, { recursive: true });

for (const doc of DOCS) {
  const markdown = await readFile(doc.source, 'utf8');
  const content = await renderMarkdown(markdown);

  const leftovers = content.match(
    /href="(?!https?:|mailto:|tel:|#)([^"]*)\.md(?:#[^"]*)?"/g,
  );
  if (leftovers) {
    throw new Error(`Unrewritten Markdown links in ${doc.source}: ${leftovers.join(', ')}`);
  }

  const prefix = doc.output.startsWith('docs/') ? '../' : './';
  const html = page({
    title: doc.title,
    description: doc.description,
    content,
    prefix,
    output: doc.output,
    source: doc.source,
  });

  const outputPath = `${OUTPUT_ROOT}/${doc.output}`;
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, html);
  console.log(`Generated ${outputPath}`);
}

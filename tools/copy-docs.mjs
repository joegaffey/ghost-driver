import { copyFile, mkdir, readdir } from 'node:fs/promises';

await mkdir('dist/docs', { recursive: true });
await copyFile('SPEC.md', 'dist/SPEC.md');

for (const entry of await readdir('docs')) {
  if (!entry.endsWith('.md')) continue;
  await copyFile(`docs/${entry}`, `dist/docs/${entry}`);
}

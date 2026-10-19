// Compiles worker/library/<folder>/<slug>.md into worker/library/bundle.json (Worker) and web/public/library.json (device).
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SECTIONS = ['Frameworks', 'Delivery', 'Planning', 'People', 'Risk and change', 'Contracts and quality', 'Reporting', 'Closing', 'Templates', 'Reference'];

export function buildLibrary(dir) {
  const pages = [], errors = [], seen = new Set();
  for (const folder of readdirSync(dir).sort()) {
    const fp = join(dir, folder);
    if (!statSync(fp).isDirectory()) continue;
    for (const file of readdirSync(fp).filter((f) => f.endsWith('.md')).sort()) {
      const where = `${folder}/${file}`, slug = file.slice(0, -3);
      const raw = readFileSync(join(fp, file), 'utf8').replace(/\r\n?/g, '\n');
      if (!/^[a-z0-9-]+$/.test(slug)) errors.push(`${where}: slug must match [a-z0-9-]+`);
      if (seen.has(slug)) errors.push(`${where}: duplicate slug "${slug}"`);
      seen.add(slug);
      const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
      if (!m) { errors.push(`${where}: missing front matter`); continue; }
      const fm = Object.fromEntries(m[1].split('\n').map((l) => l.match(/^(\w+):\s*(.*)$/)).filter(Boolean).map((x) => [x[1], x[2].trim()]));
      const body = m[2].trim();
      if (!fm.title) errors.push(`${where}: missing title`);
      if (!fm.section) errors.push(`${where}: missing section`);
      else if (!SECTIONS.includes(fm.section)) errors.push(`${where}: unknown section "${fm.section}"`);
      if (body.length < 300) errors.push(`${where}: body under 300 characters`);
      pages.push({ slug, section: fm.section ?? '', title: fm.title ?? '', body, source: 'bundled' });
    }
  }
  for (const p of pages) for (const l of p.body.matchAll(/\[\[([a-z0-9-]+)(?:\|[^\]]*)?\]\]/g)) if (!seen.has(l[1])) errors.push(`${p.slug}: [[${l[1]}]] names no page`);
  pages.sort((a, b) => SECTIONS.indexOf(a.section) - SECTIONS.indexOf(b.section) || a.title.localeCompare(b.title));
  return { pages, errors };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { pages, errors } = buildLibrary('worker/library');
  if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
  const json = JSON.stringify(pages);
  writeFileSync('worker/library/bundle.json', json);
  writeFileSync('web/public/library.json', json);
  console.log(`library: ${pages.length} page${pages.length === 1 ? '' : 's'}`);
}

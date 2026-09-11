// Finite design experiment; no production-site build integration.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import Markdoc from '@markdoc/markdoc';
import YAML from 'yaml';
const root = new URL('./', import.meta.url);
const paths = ['Menu.doc.card', 'Reading.doc.card', 'Reading.attach/Margin.doc.card', 'Reading.attach/Context.doc.card'];
const cards = {};
for (const path of paths) {
  const source = await readFile(new URL(`cards/${path}`, root), 'utf8');
  const [, front, body] = source.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  const ast = Markdoc.parse(body);
  const errors = Markdoc.validate(ast);
  if (errors.length) throw new Error(`${path}: ${JSON.stringify(errors)}`);
  cards[path] = { ...YAML.parse(front), body: Markdoc.renderers.html(Markdoc.transform(ast)), parent: path.includes('.attach/') ? `${path.split('.attach/')[0]}.doc.card` : null };
}
const css = await Promise.all(['materials', 'card-themes', 'chrome'].map(name => readFile(new URL(`../../beebox/src/frontend/src/themes/${name}.css`, root), 'utf8')));
const shell = await readFile(new URL('shell.html', root), 'utf8');
const html = shell.replace('/* APP_THEME_STYLES */', css.join('\n')).replace('/* CARD_DATA */', `const cards = ${JSON.stringify(cards).replaceAll('<', '\\u003c')};`);
await mkdir(new URL('../../scratch/navigation-prototype/', root), { recursive: true });
await writeFile(new URL('../../scratch/navigation-prototype/index.html', root), html);

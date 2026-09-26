import { readFile, writeFile } from 'node:fs/promises';
const modules = ['config', 'icons', 'geo', 'data', 'preview-scene', 'map', 'ui', 'app'];
let code = '';
for (const name of modules) {
  let source = await readFile(new URL(`../src/${name}.js`, import.meta.url), 'utf8');
  source = source.replace(/^import .*?;\s*$/gm, '').replace(/^export /gm, '');
  code += `\n// MODULE: ${name}\n${source}\n`;
}
let html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
html = html.replace('<html lang="ko" data-theme="dark">', '<html lang="ko" data-theme="dark" data-offline-preview="true">')
  .replace('<link rel="stylesheet" href="/src/styles.css">', `<style>${css}</style>`)
  .replace('<link rel="icon" type="image/svg+xml" href="/favicon.svg">', '')
  .replace('<script type="module" src="/src/app.js"></script>', `<script type="module">${code.replaceAll('</script', '<\\/script')}</script>`)
  .replace('<title>SEO:ON 서구온 · 공간행정 워크스페이스</title>', '<title>SEO:ON 디자인 미리보기 · 가상 도시 / 실제 지도 아님</title>');
await writeFile(new URL('../../seo-on-design-preview.html', import.meta.url), html);
console.log('Created standalone offline DESIGN preview (synthetic city explicitly labelled).');

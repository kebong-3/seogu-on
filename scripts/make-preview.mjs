import {writeFile,mkdir} from 'node:fs/promises';
await mkdir(new URL('../preview/',import.meta.url),{recursive:true});
await writeFile(new URL('../preview/design-preview.html',import.meta.url),`<!doctype html><html lang="ko"><meta charset="utf-8"><title>서구온 디자인 시연 안내</title><body style="font:18px/1.8 system-ui;max-width:700px;margin:70px auto;padding:24px"><h1>서구온 디자인 시연</h1><p>v0.2의 실제 자료와 18개 행정동은 웹서비스에서 확인합니다.</p><p><a href="https://seogu-on.vercel.app/?preview=1">배포된 가상 디자인 시연 열기</a></p><p>로컬에서는 <code>npm run dev</code> 후 <code>http://127.0.0.1:4173/?preview=1</code>을 여세요.</p><p>디자인 시연의 건물·시설·통계는 합성입니다. 실제 행정자료가 아닙니다.</p></body></html>`);
console.log('Updated explicit design-preview launcher; full module app runs through the dev server.');

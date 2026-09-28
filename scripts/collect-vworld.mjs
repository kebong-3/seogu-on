/** Explicit, bounded batch collection. Keys from environment, never printed or saved.
 * Writes a review bundle outside public/. Does not mutate GitHub or production.
 */
import {mkdir,writeFile,rename,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {VW_THEMES} from '../src/city/vworld-catalog.js';
import {readTheme} from '../server/city/vworld-themes.js';
import {scopeFor} from '../server/city/common.js';
import {acceptTopicPage} from '../src/city/resilience-tools.js';
const arg=name=>process.argv.find(v=>v.startsWith('--'+name+'='))?.split('=').slice(1).join('=');
if(process.argv.includes('--help')){console.log('node --env-file-if-exists=.env.local scripts/collect-vworld.mjs --dong=all --group=재난·방재\nOptional --theme=vw-c_up201. Explicit all themes: --all. Saves data-staging/vworld/. Credentials must not be committed.');process.exit(0);}
const dong=arg('dong')||'all';scopeFor(dong);
if(!process.env.VWORLD_API_KEY||!process.env.VWORLD_DOMAIN){console.error('VWORLD_API_KEY와 VWORLD_DOMAIN이 필요합니다. 값은 출력하거나 저장하지 않았습니다.');process.exit(2);}
const theme=arg('theme'),group=arg('group');
if(!theme&&!group&&!process.argv.includes('--all')){console.error('--theme 또는 --group을 지정하세요. 전체 수집에는 명시적인 --all이 필요합니다.');process.exit(2);}
const list=VW_THEMES.filter(t=>(!theme||t.id===theme)&&(!group||t.group===group));if(!list.length){console.error('등록된 주제도/분류가 아닙니다.');process.exit(2);}
const base=resolve('data-staging/vworld',dong),report={startedAt:new Date().toISOString(),scopeDong:dong,rows:[],credentialsRecorded:false};await mkdir(base,{recursive:true});let stop=false;process.once('SIGINT',()=>{stop=true;console.log('현재 요청 후 중지합니다. 미완료 주제도는 쓰지 않습니다.');});
for(const t of list){if(stop)break;const book={total:null,scanned:0,features:new Map(),signatures:new Set()};try{let page=1;for(;page<=30&&!stop;){const b=await readTheme(t.id,new URLSearchParams({dong,page:String(page)}));acceptTopicPage(book,b);if(b.complete)break;if(b.nextPage!==page+1)throw Error('페이지 연결 오류');page=b.nextPage;await new Promise(r=>setTimeout(r,250));}if(stop||!book.last?.complete)throw Error('취소/페이지 한도: 미완료 수집');const snapshot={type:'FeatureCollection',features:[...book.features.values()],metadata:{title:t.title,themeId:t.id,scopeDong:dong,sourceName:'브이월드 WFS',sourceUrl:t.sourceUrl,sourceDate:book.last.sourceDate??null,collectedAt:book.last.collectedAt,totalScanned:book.scanned,rejectedTotals:book.rejectedTotals,complete:true,coverage:'API 반환 범위. 현행 전수/현장 정확성 미검증'}};const text=JSON.stringify(snapshot,null,2),path=resolve(base,t.id+'.geojson');let previous=null;try{previous=JSON.parse(await readFile(path,'utf8'));}catch{}if(previous?.features?.length&&!snapshot.features.length)throw Object.assign(Error('Sudden zero response'),{code:'UNEXPECTED_EMPTY_KEEP_OLD'});await writeFile(path+'.tmp',text);await rename(path+'.tmp',path);report.rows.push({id:t.id,title:t.title,state:'received',features:snapshot.features.length,pages:page,sha256:createHash('sha256').update(text).digest('hex')});console.log(t.title+': '+snapshot.features.length+'도형 수신');}catch(e){report.rows.push({id:t.id,title:t.title,state:'failed',reason:e.code||'SOURCE_UNAVAILABLE'});console.error(t.title+': 수집 실패 · 기존 파일 유지');}}
report.finishedAt=new Date().toISOString();await writeFile(resolve(base,'manifest.json'),JSON.stringify(report,null,2));console.log('검수 대기 결과: '+base);if(report.rows.some(r=>r.state!=='received')||stop)process.exitCode=1;

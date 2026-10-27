#!/usr/bin/env node
/** Stage an official public snapshot for review. This never overwrites published data. */
import {readFile,writeFile,mkdir,realpath} from 'node:fs/promises';
import {resolve,relative,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {collectChildcare} from './collect-childcare.mjs';
const ROOT=fileURLToPath(new URL('../../',import.meta.url)),STAGING=resolve(ROOT,'data-staging');
const SOURCE='https://info.childcare.go.kr/info_html5/stat/sheet/StatCrInfoResult.jsp';
const QUERY='flag=crInfo&std_condi=N&sido=12&sigun=&exlChk=&offset=0&limit=2000';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
export function compareSnapshots(before,after){
 const records=value=>{if(value?.type!=='FeatureCollection'||!Array.isArray(value.features))throw Error('수집본의 GeoJSON 형식을 확인하세요.');const map=new Map();for(const feature of value.features){const id=feature?.properties?.id;if(typeof id!=='string'||!id||map.has(id))throw Error('수집본 식별자가 없거나 중복되었습니다.');map.set(id,feature);}return map;};
 const previous=records(before),next=records(after),added=[],removed=[],changed=[];
 for(const [id,record]of next){const old=previous.get(id);if(!old)added.push(id);else if(JSON.stringify(old)!==JSON.stringify(record))changed.push({id,coordinateChanged:JSON.stringify(old.geometry)!==JSON.stringify(record.geometry),nameChanged:old.properties.name!==record.properties.name,requiresReview:true});}
 for(const id of previous.keys())if(!next.has(id))removed.push(id);
 return {previousRecords:previous.size,nextRecords:next.size,added,removed,changed,requiresReview:true,meaning:'명칭·주소 해시 변경은 추가와 제외로 나타날 수 있습니다. 제외를 폐업으로, 좌표 변경을 검수 완료로 해석하지 않습니다.'};
}
async function fetchOfficial(target){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30000);try{const response=await fetch(SOURCE,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:QUERY,redirect:'error',signal:controller.signal});if(!response.ok)throw Error('공식 공개 SHEET HTTP '+response.status);if(Number(response.headers.get('content-length')||0)>20*1024*1024)throw Error('수집 원문 크기 제한 초과');const reader=response.body.getReader(),chunks=[];let bytes=0;try{while(true){const item=await reader.read();if(item.done)break;bytes+=item.value.byteLength;if(bytes>20*1024*1024){await reader.cancel();throw Error('수집 원문 크기 제한 초과');}chunks.push(Buffer.from(item.value));}}finally{reader.releaseLock();}await writeFile(target,Buffer.concat(chunks));}finally{clearTimeout(timer);}
}
export async function prepareRefresh({fetchSource=false,sourceHtml,collectedAt,outputDirectory}={}){
 const at=collectedAt||new Date().toISOString(),out=resolve(outputDirectory||resolve(STAGING,'childcare-'+new Date().toISOString().replace(/[:.]/g,'-'))),part=relative(STAGING,out);
 if(!part||part==='..'||part.includes(sep)||resolve(part)===part)throw Error('검토 수집본은 data-staging 바로 아래 새 폴더에만 저장합니다.');
 if(!fetchSource&&(!sourceHtml||!collectedAt))throw Error('원문 파일 재처리에는 --source-html과 실제 --collected-at을 지정하세요.');
 if(!Number.isFinite(Date.parse(at)))throw Error('실제 수집시각을 ISO 형식으로 입력하세요.');
 await mkdir(STAGING,{recursive:true});const canonical=await realpath(STAGING),same=(a,b)=>process.platform==='win32'?a.toLowerCase()===b.toLowerCase():a===b;if(!same(canonical,STAGING))throw Error('data-staging 연결 경로를 확인하세요.');
 await mkdir(out,{recursive:false});const raw=resolve(out,'official-childcare.html');
 if(fetchSource)await fetchOfficial(raw);else await writeFile(raw,await readFile(resolve(sourceHtml)));
 const result=await collectChildcare({sourceHtml:raw,collectedAt:at,outputDirectory:out}),reports={};
 for(const regionId of ['seogu','suncheon']){const target=resolve(out,regionId,'childcare.geojson'),old=await readFile(resolve(ROOT,'public/data/decision',regionId,'childcare.geojson')),current=await readFile(target);reports[regionId]={...compareSnapshots(JSON.parse(old),JSON.parse(current)),previousSha256:digest(old),nextSha256:digest(current)};}
 const report={version:1,preparedAt:new Date().toISOString(),sourceUrl:SOURCE,collectedAt:at,sourceDate:null,sourceDateMeaning:'원문 기준일은 제공되지 않습니다. 수집시각으로 대체하지 않습니다.',result,reports,published:false,requiresReview:true,nextSteps:['추가·제외·좌표 변경과 원문을 담당자가 대조','승인한 자료만 수동 반영하고 manifest 해시 갱신','지역경계·개수·자동검사와 화면 검증 후 배포'],limitations:['자동 수집은 현재 운영·현장 출입구 검증이 아닙니다.','이번 작업은 검토 수집본만 생성하며 공개 데이터와 앱을 수정하지 않습니다.']};
 await writeFile(resolve(out,'refresh-review.json'),JSON.stringify(report,null,2));return {outputDirectory:relative(ROOT,out),...report};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2),value=name=>{const index=args.indexOf(name);return index>=0?args[index+1]:undefined;};
 if(args.includes('--help'))console.log('node scripts/data/prepare-refresh.mjs --fetch\n또는 --source-html 파일 --collected-at 실제ISO시각. 결과는 data-staging에 보관하며 자동 반영하지 않습니다.');
 else try{console.log(JSON.stringify(await prepareRefresh({fetchSource:args.includes('--fetch'),sourceHtml:value('--source-html'),collectedAt:value('--collected-at'),outputDirectory:value('--output-directory')}),null,2));}catch(error){console.error('공개자료 갱신 검토 실패: '+error.message);process.exitCode=1;}
}

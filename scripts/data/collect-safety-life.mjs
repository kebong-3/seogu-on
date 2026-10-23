#!/usr/bin/env node
/** Collect published safety facility CSVs from the current official download site.
 * No keys, inferred locations, private shelters, or stale portal JSON fallbacks.
 * node scripts/data/collect-safety-life.mjs --fetch --source-dir /tmp/safety-life
 */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {csvRows} from './lib/csv.mjs';
import {pointInRegion} from '../../shared/region-profile.js';

const ROOT=fileURLToPath(new URL('../../',import.meta.url));
const run=promisify(execFile),clean=v=>String(v??'').trim();
const hash=b=>createHash('sha256').update(b).digest('hex');
const json=v=>JSON.stringify(v,null,2)+'\n';
const assert=(v,message)=>{if(!v)throw Error(message);};
const SOURCES=[
 {id:'emergency-bell',slug:'emergency_call_box_info',pk:'15028206',title:'안전비상벨 공개 수록정보',required:['안전비상벨관리번호','설치위치','최종점검일자']},
 {id:'cctv',slug:'cctv_info',pk:'15013094',title:'CCTV 공개 설치정보',required:['설치목적구분','카메라대수']},
];
const info=s=>`https://file.localdata.go.kr/file/${s.slug}/info`;
const download=s=>`https://file.localdata.go.kr/file/download/${s.slug}/info?orgCode=5810000`;
const portal=s=>`https://www.data.go.kr/data/${s.pk}/standard.do`;
const date=v=>/^\d{4}-\d{2}-\d{2}$/.test(clean(v))?clean(v):null;

async function fetchSources(directory){
 await mkdir(directory,{recursive:true});
 for(const s of SOURCES){
  const files={};
  // Sequential public downloads; a failed source never replaces a good artifact.
  for(const [suffix,url] of [['csv',download(s)],['info.html',info(s)],['portal.html',portal(s)]]){
   const path=resolve(directory,`${s.id}.${suffix}`);
   await run('curl',['--fail','--silent','--show-error','--location','--max-time','50','--user-agent','Mozilla/5.0','--referer',info(s),url,'--output',path]);
   const bytes=await readFile(path);files[suffix]={url,sha256:hash(bytes),bytes:bytes.length};
  }
  await writeFile(resolve(directory,`${s.id}.receipt.json`),json({retrievedAt:new Date().toISOString(),files}));
 }
}

export async function collectSafetyLife({sourceDirectory,outputDirectory=resolve(ROOT,'public/data/city')}={}){
 assert(sourceDirectory,'--source-dir 를 지정하세요.');
 const boundaryBytes=await readFile(resolve(ROOT,'public/data/admin-dongs.geojson'));
 const boundary=JSON.parse(boundaryBytes);assert(boundary.features?.length===18,'서구 경계 변경을 검토하세요.');
 const summary=[];
 for(const s of SOURCES){
  const bytes=await readFile(resolve(sourceDirectory,`${s.id}.csv`));
  const receipt=JSON.parse(await readFile(resolve(sourceDirectory,`${s.id}.receipt.json`),'utf8'));
  assert(receipt.files?.csv?.sha256===hash(bytes),'원문 CSV 해시 불일치');
  assert(Number.isFinite(Date.parse(receipt.retrievedAt)),'원문 수집시각 누락');
  const portalHtml=await readFile(resolve(sourceDirectory,`${s.id}.portal.html`),'utf8');
  assert(portalHtml.includes('이용허락범위 제한 없음')&&portalHtml.includes(info(s)),'공식 출처·이용허락 범위 확인 필요');
  const all=[...csvRows(resolve(sourceDirectory,`${s.id}.csv`))],headers=all.shift()||[];
  for(const key of ['개방자치단체코드','관리번호','WGS84위도','WGS84경도','데이터기준일자',...s.required])assert(headers.includes(key),`${s.id}: 원문 열 ${key} 확인 필요`);
  const rows=all.map(cells=>Object.fromEntries(headers.map((key,i)=>[key,clean(cells[i])])));
  assert(rows.length>0,`${s.id}: 빈 다운로드는 시설 없음으로 게시하지 않습니다.`);
  const features=[],ids=new Set();let outside=0,invalid=0,excludedPurpose=0;
  for(const [i,row] of rows.entries()){
   assert(row['개방자치단체코드']==='5810000','다른 지역 자료 수록 금지');
   const xy=[row['WGS84경도'],row['WGS84위도']].map(Number);
   if(!row['WGS84경도']||!row['WGS84위도']||!xy.every(Number.isFinite)||xy[0]<124||xy[0]>132||xy[1]<32||xy[1]>39){invalid++;continue;}
   if(!pointInRegion(xy,boundary)){outside++;continue;}
   // Current file can include traffic enforcement CCTV; never relabel it as a women's safety camera.
   const purpose=row['설치목적구분']||row['설치목적'];
   const id=`seogu-${s.id}-${row['관리번호']}`;assert(!ids.has(id),`${s.id}: 원문 관리번호 중복`);ids.add(id);
   const dong=boundary.features.find(f=>pointInRegion(xy,{features:[f]}))?.properties;
   const original=Object.fromEntries(Object.entries(row).filter(([key])=>key!=='관리기관전화번호'));
   const address=row['소재지도로명주소']||row['소재지지번주소'];
   const name=s.id==='emergency-bell'?`${row['설치장소유형']||'공개시설'} 비상벨 ${row['안전비상벨관리번호']}`:`${purpose||'공개'} CCTV ${i+1}`;
   features.push({type:'Feature',id,geometry:{type:'Point',coordinates:xy},properties:{id,name,datasetId:s.id,category:s.id,regionId:'seogu',topic:'safety',dongId:dong.dongId,dongName:dong.dongName,address,
    sourceName:`행정안전부 지방행정인허가데이터개방 · ${s.title}`,sourceUrl:portal(s),downloadSourceUrl:info(s),sourceDate:date(row['데이터기준일자']),collectedAt:receipt.retrievedAt,
    originalId:row['관리번호'],idMeaning:'official-published-management-number',sourceRow:i+2,geometryMeaning:'원문 WGS84 대표위치. 출입구·촬영범위·안전한 보행경로가 아님.',
    facilityType:row['설치장소유형']||purpose,installationPurpose:purpose,sourceAttributes:original,operationalStatus:'현재 작동·개방·현행 지정 미확인',verificationStatus:'needs-current-verification',
    note:`공개 수록정보의 기준일은 ${date(row['데이터기준일자'])||'미제공'}입니다. 시스템 데이터갱신시점은 기준일·현장점검일과 다릅니다. 현재 작동·경찰연계·안전도를 보장하지 않습니다.`,
    ...(s.id==='emergency-bell'?{locationDescription:row['설치위치'],policeLinked:row['경찰연계유무']==='Y'?true:row['경찰연계유무']==='N'?false:null,lastInspectionDate:date(row['최종점검일자']),publishedInspectionResult:row['최종점검결과구분'],connectionMethod:row['연계방식']}:{cameraCount:Number(row['카메라대수'])||null}),
   }});
  }
  assert(features.length>0,`${s.id}: 검수된 지역 좌표 없음`);
  const dates=[...new Set(features.map(f=>f.properties.sourceDate).filter(Boolean))].sort();
  const metadata={state:'published',regionId:'seogu',datasetId:s.id,topic:'safety',sourceName:`행정안전부 지방행정인허가데이터개방 · ${s.title}`,sourceUrl:portal(s),downloadSourceUrl:info(s),sourceDate:dates.length===1?dates[0]:null,sourceDateRange:[dates[0],dates.at(-1)],collectedAt:receipt.retrievedAt,
   sourceRows:rows.length,publishedRecords:features.length,rejectedOutside:outside,rejectedInvalidCoordinates:invalid,excludedPurpose,sourceSha256:hash(bytes),boundarySha256:hash(boundaryBytes),complete:false,sourceDownloadComplete:true,
   coordinateSystem:'EPSG:4326',coordinateEvidence:'CSV의 명시적 WGS84위도/WGS84경도 열 사용. 웹 요약의 EPSG:5174 설명을 적용하지 않음. 수치 범위·서구 경계 대조.',
   license:'이용허락범위 제한 없음',verificationStatus:'needs-current-verification',coverage:`${dates.length===1?dates[0]:'개별 원문 기준일'} 기준 공식 공개 수록본. 현재 시설 전수·작동·범죄예방 효과를 뜻하지 않습니다. 기준일 이후의 변경과 누락을 현장 확인하세요.`,
   privacy:'공공장소 설치시설의 공개 허용속성만 수록. 피해자 보호시설·이용자·관리자 개인정보 제외.',retrievalEvidence:receipt.files,
  };
  await mkdir(outputDirectory,{recursive:true});
  const path=resolve(outputDirectory,`safety-${s.id}.geojson`);await writeFile(path,json({type:'FeatureCollection',metadata,features}));
  summary.push({datasetId:s.id,path,records:features.length,sourceDate:metadata.sourceDate,rejectedOutside:outside,rejectedInvalidCoordinates:invalid,purposes:[...new Set(features.map(f=>f.properties.installationPurpose))]});
 }
 return summary;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2),value=k=>args.includes(k)?args[args.indexOf(k)+1]:null;
 assert(value('--source-dir'),'--source-dir /tmp/safety-life 를 지정하세요.');
 const sourceDirectory=resolve(value('--source-dir'));
 if(args.includes('--fetch'))await fetchSources(sourceDirectory);
 console.log(json(await collectSafetyLife({sourceDirectory,outputDirectory:value('--out')?resolve(value('--out')):undefined})));
}

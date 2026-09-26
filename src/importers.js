import {validateImport} from './data.js';
import {validDate,collection} from './geo.js';
import {DONG_NAMES,pointOK,coordinatesOf} from './admin.js';
// A small RFC4180 reader; quoted commas/newlines and UTF-8 BOM are supported.
export function parseCSV(text){
  if(typeof text!=='string'||text.length>2*1024*1024)throw Error('UTF-8 CSV는 2MB 이하만 지원합니다.');
  text=text.replace(/^\uFEFF/,'');const rows=[];let row=[],cell='',quoted=false,closed=false;
  for(let i=0;i<text.length;i++){
    const c=text[i];if(quoted){if(c==='"'){if(text[i+1]==='"'){cell+='"';i++;}else {quoted=false;closed=true;}}else cell+=c;continue;}
    if(c==='"'){if(cell||closed)throw Error('CSV 따옴표 형식을 확인하세요.');quoted=true;continue;}
    if(c===','||c==='\n'||c==='\r'){row.push(cell);cell='';closed=false;if(c!==','){if(c==='\r'&&text[i+1]==='\n')i++;if(row.some(v=>v.trim()))rows.push(row);row=[];}continue;}
    if(closed&&c.trim())throw Error('CSV 닫는 따옴표 뒤의 문자를 확인하세요.');if(!closed)cell+=c;
  }
  if(quoted)throw Error('CSV의 따옴표가 닫히지 않았습니다.');row.push(cell);if(row.some(v=>v.trim()))rows.push(row);
  const headers=(rows.shift()||[]).map(v=>v.trim());if(!headers.length||new Set(headers).size!==headers.length||headers.some(h=>['__proto__','constructor','prototype'].includes(h)))throw Error('CSV 제목행이 없거나 중복되었습니다.');
  if(rows.length>5000)throw Error('한 번에 5,000행 이하만 가져오세요.');
  return rows.map((r,i)=>{if(r.length!==headers.length)throw Error(`${i+2}행 열 수가 제목행과 다릅니다.`);return Object.fromEntries(headers.map((h,j)=>[h,r[j].trim()]));});
}
function num(v){return v==null||String(v).trim()===''?null:Number(String(v).replaceAll(',',''));}
export function importFacilitiesCSV(text){
  const rows=parseCSV(text),required=['id','name','category','longitude','latitude','sourceName','sourceDate'];
  if(rows.length&&required.some(k=>!(k in rows[0])))throw Error(`시설 CSV 필수 열: ${required.join(', ')}`);
  const fs=rows.map(r=>({type:'Feature',geometry:{type:'Point',coordinates:[num(r.longitude),num(r.latitude)]},properties:{...r,sourceDate:r.sourceDate||null,capacity:num(r.capacity),monthly:Object.fromEntries(Object.entries(r).filter(([k])=>/^\d{4}-(0[1-9]|1[0-2])$/.test(k)).map(([k,v])=>[k,num(v)]))}}));
  return validateImport(collection(fs));
}
export function importDongStats(text){
  const rows=typeof text==='string'?parseCSV(text):text?.rows;
  if(!Array.isArray(rows)||rows.length>5000)throw Error('행정동 통계는 rows 배열 또는 CSV여야 합니다.');
  const seen=new Set();return rows.map((r,i)=>{
    const name=String(r.dongName||'').replace('제',''),value=num(r.value),key=`${name}|${r.month}|${r.metricName}|${r.metricUnit}`;
    if(!DONG_NAMES.includes(name)||!/^\d{4}-(0[1-9]|1[0-2])$/.test(r.month)||!r.metricName||!r.metricUnit||!r.sourceName||!validDate(r.sourceDate)||!(value===null||(Number.isFinite(value)&&value>=0)))throw Error(`${i+2}행: 행정동명·기준월·지표·단위·출처·기준일·값을 확인하세요.`);
    if(seen.has(key))throw Error(`${i+2}행: 동·월·지표가 중복되었습니다.`);seen.add(key);
    return {dongName:name,month:r.month,metricName:String(r.metricName).slice(0,60),metricUnit:String(r.metricUnit).slice(0,20),value,sourceName:String(r.sourceName).slice(0,200),sourceDate:r.sourceDate};
  });
}
export function importProjects(raw){
  if(raw?.type!=='FeatureCollection'||!Array.isArray(raw.features)||raw.features.length>1000)throw Error('사업은 1,000개 이하의 GeoJSON FeatureCollection이어야 합니다.');
  const ids=new Set();return raw.features.map((f,i)=>{
    const p=f.properties||{},g=f.geometry,pts=coordinatesOf(g);
    if(!['Point','LineString','Polygon','MultiPolygon'].includes(g?.type)||!pts.length||pts.length>10000||!pts.every(pointOK))throw Error(`${i+1}번 사업의 EPSG:4326 도형을 확인하세요.`);
    const rings=g.type==='Polygon'?g.coordinates:g.type==='MultiPolygon'?g.coordinates.flat():[];
    if(rings.some(r=>r.length<4||r[0][0]!==r.at(-1)[0]||r[0][1]!==r.at(-1)[1]))throw Error('사업 Polygon의 경계가 닫히지 않았습니다.');
    if(!p.id||!p.name||!p.sourceName||!validDate(p.sourceDate)||!validDate(p.start)||!validDate(p.end)||p.start>p.end)throw Error(`${i+1}번 사업의 id·명칭·출처·기준일·기간을 확인하세요.`);
    const id=String(p.id).slice(0,120);if(ids.has(id))throw Error('사업 위치 id가 중복되었습니다.');ids.add(id);
    return {type:'Feature',geometry:g,properties:{id,projectId:String(p.projectId||p.id).slice(0,120),name:String(p.name).slice(0,150),department:String(p.department||'').slice(0,100),sourceName:String(p.sourceName).slice(0,200),sourceDate:p.sourceDate,start:p.start,end:p.end,note:String(p.note||'').slice(0,500),dataKind:'provided',reviewStatus:'unverified'}};
  });
}

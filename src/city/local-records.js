import {OP_LAYERS,importOperational} from './operations.js';
export const RECORDS_KEY='seo-on.public-operations.v1';
export const MAX_RECORD_BYTES=3*1024*1024;
export function encodeRecords(entries,scope,now=new Date()) {
 const layers=[];
 for(const id of OP_LAYERS){const entry=entries.get(id);if(!entry?.features?.length||!entry.metadata?.userRegistered)continue;
  const checked=importOperational({type:'FeatureCollection',features:entry.features},id,scope,now);
  layers.push({id,geojson:{type:'FeatureCollection',features:checked.features,metadata:{userRegistered:true,source:'사용자 공개 관리기록',exportedAt:now.toISOString()}}});
 }
 if(!layers.length)throw Error('저장할 사용자 관리기록이 없습니다.');
 const text=JSON.stringify({format:'seo-on-public-operations',schema:1,savedAt:now.toISOString(),layers});
 if(new TextEncoder().encode(text).length>MAX_RECORD_BYTES)throw Error('이 브라우저 저장 한도는 3MB입니다. GeoJSON으로 내보내세요.');
 return text;
}
export function decodeRecords(text,scope,now=new Date()) {
 if(typeof text!=='string'||new TextEncoder().encode(text).length>MAX_RECORD_BYTES)throw Error('저장 파일이 없거나 3MB를 초과합니다.');
 const b=JSON.parse(text);
 if(b?.format!=='seo-on-public-operations'||b.schema!==1||!Array.isArray(b.layers)||!b.layers.length||b.layers.length>OP_LAYERS.length)throw Error('서구온 공개 관리기록 형식이 아닙니다.');
 const entries=new Map();
 for(const l of b.layers){if(!OP_LAYERS.includes(l.id)||entries.has(l.id))throw Error('알 수 없거나 중복된 자료 종류입니다.');
  const result=importOperational(l.geojson,l.id,scope,now);if(result.rejected.length)throw Error('저장자료에 검수 오류가 있습니다. 원본을 확인한 뒤 GeoJSON으로 가져오세요.');
  result.metadata={...result.metadata,userRegistered:true,restoredFrom:b.savedAt};entries.set(l.id,result);
 }
 return entries;
}

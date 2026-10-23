/** Only field mappings and public URLs live here. All authentication comes from server environment variables. */
const shared = { type:'standard', keyEnv:'DATA_GO_KR_SERVICE_KEY', pageSize:1000, pageBase:1, publicOnly:true,
  query:{instt_nm:'서구'}, queryDescription:'제공기관명 서구 조회 + 수신 좌표를 18개 행정동 도형과 대조. 제공기관 검색 누락 가능.',
  fields:{name:['name','시설명'],longitude:['longitude','LONGITUDE','경도'],latitude:['latitude','LATITUDE','위도'],address:['rdnmadr','RDNMADR','소재지도로명주소','lnmadr','LNMADR','소재지지번주소'],sourceDate:['referenceDate','REFERENCE_DATE','데이터기준일자'],phone:['phoneNumber','PHONE_NUMBER','전화번호'],department:['chrgDeptNm','담당부서명']} };
export const PRESETS = Object.freeze([
  {...shared,id:'parks',name:'도시공원',category:'park',pageBase:0,sourceName:'전국도시공원정보표준데이터',sourceUrl:'https://www.data.go.kr/data/15012890/standard.do',url:'https://api.data.go.kr/openapi/tn_pubr_public_cty_park_info_api',fields:{...shared.fields,name:['PARK_NM','parkNm','공원명'],id:['MANAGE_NO','manageNo','관리번호']}},
  {...shared,id:'parking',name:'공영·공개 주차장',category:'parking',sourceName:'전국주차장정보표준데이터',sourceUrl:'https://www.data.go.kr/data/15012896/standard.do',url:'https://api.data.go.kr/openapi/tn_pubr_prkplce_info_api',fields:{...shared.fields,name:['PRKPLCE_NM','prkplceNm','주차장명'],id:['prkplceNo','주차장관리번호'],capacity:['prkcmprt','주차구획수'],hours:['operDay','운영요일']},note:'주차장 현황입니다. 실시간 빈자리·상시 개방을 뜻하지 않습니다.'},
  {...shared,id:'public-facilities',name:'공공시설 개방정보',category:'admin',sourceName:'전국공공시설개방정보표준데이터',sourceUrl:'https://www.data.go.kr/data/15013117/standard.do',url:'https://api.data.go.kr/openapi/tn_pubr_public_pblfclt_opn_info_api',fields:{...shared.fields,name:['OPEN_FCLTY_NM','openFcltyNm','개방시설명'],capacity:['aceptncPosblCo','수용가능인원수']},note:'예약·휴관·유료 여부는 원문과 운영기관에서 확인하세요.'},
  {...shared,id:'libraries',name:'도서관·작은도서관',category:'culture',pageBase:0,sourceName:'전국도서관표준데이터',sourceUrl:'https://www.data.go.kr/data/15013109/standard.do',url:'https://api.data.go.kr/openapi/tn_pubr_public_lbrry_api',query:{SIGNGU_NM:'서구'},fields:{...shared.fields,name:['LBRRY_NM','lbrryNm','도서관명'],phone:['PHONE_NUMBER','phoneNumber','도서관전화번호'],hours:['CLOSE_DAY','closeDay','휴관일']},note:'도서관·작은도서관 공개 현황입니다. 폐관·이전·운영시간은 기관 확인.'},
  {...shared,id:'safety-guardian-house',name:'공개 안심지킴이집',category:'shelter',pageBase:0,sourceName:'전국안심지킴이집표준데이터',sourceUrl:'https://www.data.go.kr/data/15034535/standard.do',url:'https://api.data.go.kr/openapi/tn_pubr_public_female_safety_prtchouse_api',fields:{...shared.fields,name:['STOR_NM','storNm','점포명'],phone:['PHONE_NUMBER','phoneNumber','안심지킴이집전화번호']},note:'공개 지정 편의점의 원문 수록정보입니다. 운영 여부는 원문에서 별도 확인하며 현재 운영·긴급대응을 보장하지 않습니다. 비공개 피해자 보호시설은 포함하지 않습니다.'},

]);
const RESERVED = new Set(['__proto__','constructor','prototype']);
export function sourcesFromEnv(env=process.env){
  let custom=[];
  if(env.DATA_SOURCES_JSON){try{custom=JSON.parse(env.DATA_SOURCES_JSON);}catch{throw new Error('DATA_SOURCES_JSON 형식 오류');}}
  if(!Array.isArray(custom)||custom.length>24)throw new Error('DATA_SOURCES_JSON은 24개 이하 배열이어야 합니다.');
  const result=new Map(PRESETS.map(x=>[x.id,{...x,fields:{...x.fields}}]));
  for(const d of custom){
    if(!d||!/^[-a-z0-9]{1,40}$/.test(d.id||'')||RESERVED.has(d.id)||!['standard','odcloud'].includes(d.type)||d.publicOnly!==true)throw new Error('자료 id·형식·공개자료 여부를 확인하세요.');
    if(!['park','recycle','shelter','care','admin','parking','health','culture','toilet'].includes(d.category))throw new Error('자료 분류가 올바르지 않습니다.');
    if(!d.sourceName||!d.fields?.name||!d.fields.longitude||!d.fields.latitude)throw new Error('자료명·시설명·좌표 열 매핑이 필요합니다.');
    if(!/^[A-Z][A-Z0-9_]{0,70}$/.test(d.keyEnv||'DATA_GO_KR_SERVICE_KEY'))throw new Error('인증키 환경변수 이름을 확인하세요.');
    const q=d.query||{};if(typeof q!=='object'||Array.isArray(q)||Object.keys(q).length>30)throw new Error('추가 조회조건을 확인하세요.');
    if(Object.entries(q).some(([k,v])=>RESERVED.has(k)||typeof v==='object'||String(v).length>250))throw new Error('허용되지 않는 조회조건입니다.');
    result.set(d.id,{...d,keyEnv:d.keyEnv||'DATA_GO_KR_SERVICE_KEY',pageSize:Math.min(1000,Math.max(1,Number(d.pageSize)||1000)),pageBase:d.pageBase===0?0:1,query:q});
  }
  return [...result.values()];
}
export function publicCatalog(env=process.env){
  return sourcesFromEnv(env).map(s=>({id:s.id,name:s.name||s.sourceName,category:s.category,configured:!!env[s.keyEnv],sourceName:s.sourceName,sourceUrl:s.sourceUrl||'',sourceDate:s.sourceDate||null,note:s.note||'',queryDescription:s.queryDescription||'설정된 API 조회범위만 수집합니다.'}));
}

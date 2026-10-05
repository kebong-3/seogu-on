/* Public-source catalogue. Geometry is supplied, never manufactured from a facility point. */
const specs=[
 ['school','학교','교육','book','#92b9ed'],['university','대학','교육','book','#afa2e6'],
 ['kindergarten','유치원','교육·돌봄','sun','#ebbe73'],['childcare','어린이집·영유아','교육·돌봄','home','#e6a4bb'],
 ['civic','행정복지센터','행정','building','#6dd6c7'],['government','관공서','행정','building','#91bbd2'],
 ['community','주민공동이용시설','행정','home','#a9c5a0'],['culture','공연·문화공간','문화·체육','book','#d49ce4'],
 ['museum','박물관·미술관','문화·체육','building','#bfade9'],['library','도서관 건물·구역','문화·체육','book','#c8acf5'],
 ['sports','체육시설·운동장','문화·체육','shield','#92cf8a'],['playground','놀이터','교육·돌봄','sun','#e9ba78'],
 ['welfare','복지기관','건강·복지','home','#dfabc7'],['medical','병원·의원','건강·복지','cross','#eaa6a5'],
 ['pharmacy','약국','건강·복지','cross','#b2d68a'],['police','경찰관서','안전','shield','#98b9e7'],
 ['fire','소방관서','안전','shield','#efa190'],['toilet','화장실','생활편의','building','#a1d5d9'],
 ['post','우체국','생활편의','home','#eeb59a'],['ev','전기차충전소','교통','pin','#a6d990'],
 ['recycle','자원순환시설','생활편의','layers','#90ccb6'],['bus','버스정류장','교통','road','#e8d296'],
 ['rail','철도·도시철도역','교통','road','#b7c4ea'],['parking','주차장 구역','교통','parking','#9bbffc'],
 ['cold','한파쉼터','기후·안전','home','#a9c5ed'],['grit','적사함·제설함','기후·안전','cube','#e5c898'],
 ['snow-routes','제설 작업구간','기후·안전','road','#9bcfee'],['snow-priority','제설 검토구간','기후·안전','warning','#f2bc73'],
 ['shade-structures','그늘막·그늘쉼터','기후·안전','sun','#e2ce8e']
];
export const INFRA_LAYERS=specs.map(([name,title,group,icon,color])=>({id:'infra-'+name,name,title,group,icon,color,kind:'mixed',url:`/data/city/infra/${name}.geojson`,note:name==='school'?'교육부 학교 대표위치 + OSM 도형 · 서로 더해 학교 수로 계산하지 않음':'출처별 부분 수록 · 점은 대표위치, 면은 확보한 도형. 실제 출입구·운영 여부 별도 확인'}));
/* Official file snapshots written by scripts/data/ingest.mjs (see docs/DATA_INBOX.md). Kept beside OSM layers, never merged into them. */
const official=[
 ['heat-shelter','무더위쉼터 (공식 공개본)','기후·안전','sun','#f5b477','official/heat-shelter'],['shade-shelter','그늘막쉼터 (전국 표준데이터)','기후·안전','sun','#d9b45c','official/shade-shelter'],
 ['cold-shelter','한파쉼터 (공식 공개본)','기후·안전','home','#a9c5ed','official/cold-shelter'],['earthquake-shelter','지진 옥외대피장소 (공식 공개본)','안전','shield','#95cfee','official/earthquake-shelter'],
 ['childcare','어린이집 (공식 표준데이터)','교육·돌봄','home','#e6a4bb','infra/childcare-official'],['toilet','공중화장실 (공식 표준데이터)','생활편의','building','#a1d5d9','official/toilet'],
 ['child-protection-zone','어린이보호구역 대상시설','안전','shield','#f0c36a','official/child-protection-zone'],['senior-disabled-protection-zone','노인·장애인보호구역 대상시설','안전','shield','#c9b2e8','official/senior-disabled-protection-zone'],
 ['civil-kiosk','무인민원발급기','행정','building','#6dd6c7','official/civil-kiosk'],['traditional-market','전통시장','생활편의','home','#eeb59a','official/traditional-market'],
 ['bus-info-terminal','버스도착안내단말기 설치 정류소','교통','road','#e8d296','official/bus-info-terminal'],
 ['civil-defense-shelter','민방위 대피소 (공식 공개본)','안전','shield','#7789d2','official/civil-defense-shelter'],
 ['emergency-water','민방위 비상급수시설','안전','water','#549fd2','official/emergency-water'],
 ['chemical-shelter','화학사고 대피장소','안전','shield','#98b676','official/chemical-shelter'],
 ['fine-dust-shelter','미세먼지 쉼터','기후·안전','wind','#96bcaf','official/fine-dust-shelter'],
 ['temporary-housing','이재민 임시주거시설','안전','home','#ae92cc','official/temporary-housing'],
 ['police-official','경찰관서 (공식 공개본)','안전','shield','#819fd5','official/police-official'],
 ['emergency-medical','응급의료시설 (공식 공개본)','건강·복지','cross','#df8da5','official/emergency-medical'],
 ['aed','자동심장충격기(AED) 장비','건강·복지','cross','#d57b98','official/aed'],
 ['steep-slope','급경사지 (공식 공개본)','기후·안전','warning','#d1a179','official/steep-slope'],
 ['welfare-official','무료급식소·복지관 (공식 공개본)','건강·복지','home','#be9bc8','official/welfare-official'],
 ['pharmacy-official','약국 (공식 공개본)','건강·복지','cross','#b2d68a','official/pharmacy-official'],
 ['security-light','보안등 설치위치','생활편의','sun','#d5b473','official/security-light']
];
export const OFFICIAL_LAYERS=official.map(([name,title,categoryGroup,icon,color,file])=>({id:'official-'+name,name,title,group:'공식 공개자료',categoryGroup,icon,color,kind:'point',url:`/data/city/${file}.geojson`,official:true,note:'공식 공개자료 중 서구 경계 안의 검증 좌표 · 출처·기준일·현재 운영 여부는 상세 확인'}));
export const INFRA_CATEGORIES=[
 {id:'park',title:'공원',group:'공원·생활',icon:'tree',layers:['parks','park-areas']},
 {id:'library',title:'도서관',group:'문화·체육',icon:'book',layers:['libraries','infra-library']},
 {id:'parking',title:'주차장',group:'교통',icon:'parking',layers:['parking','infra-parking']},
 {id:'rooms',title:'공공 개방공간',group:'공원·생활',icon:'building',layers:['public-facilities']},
 ...INFRA_LAYERS.filter(l=>!['library','parking'].includes(l.name)).map(l=>({id:l.name,title:l.title,group:l.group,icon:l.icon,layers:l.name==='shade-structures'?['local-shade',l.id]:l.name==='cold'?['official-cold-shelter',l.id]:[l.id]})),
 {id:'heat',title:'무더위쉼터',group:'기후·안전',icon:'sun',layers:['official-heat-shelter']},
 {id:'evacuation',title:'지진대피 학교',group:'안전',icon:'shield',layers:['shelter-schools']},
 {id:'emergency',title:'응급의료기관',group:'건강·복지',icon:'cross',layers:['emergency'],api:true}
];
/* 서구 그늘막 공개본(local-shade)은 위 '그늘막·그늘쉼터' 종류에 연결. 쿨링포그는 그늘막이 아니므로 따로 둔다. */
INFRA_CATEGORIES.push(...OFFICIAL_LAYERS.map(l=>({id:l.id,title:l.title,group:l.categoryGroup,icon:l.icon,layers:[l.id]})),{id:'local-icing',title:'상습결빙구간 (공식 공개본)',group:'기후·안전',icon:'warning',layers:['local-icing']},{id:'official-cooling',title:'쿨링포그 (서구 공개본)',group:'기후·안전',icon:'water',layers:['local-cooling']},{id:'flood-history',title:'과거 침수피해 기록',group:'기후·안전',icon:'water',layers:['local-flood-history']});
export const OVERLAY_LAYERS=[
 {id:'shade-result',title:'시간별 그늘 근사',group:'분석·관측',kind:'polygon',color:'#756f96',icon:'sun',analysis:true},
 {id:'weather-observed',title:'기상청 격자 실황',group:'분석·관측',kind:'point',color:'#efca7c',icon:'sun',analysis:true},
 {id:'weather-forecast',title:'선택 시각 예보',group:'분석·관측',kind:'point',color:'#b4c4ed',icon:'wind',analysis:true},
 {id:'air-observed',title:'미세먼지 관측값',group:'분석·관측',kind:'point',color:'#b7d7bc',icon:'wind',analysis:true}
];
export function infrastructureCounts(category,entries){let points=0,areas=0,lines=0,missing=0;for(const id of category.layers){const e=entries.get(id);if(!e?.features?.length){missing++;continue;}for(const f of e.features){if(f.geometry?.type==='Point')points++;else if(f.geometry?.type?.includes('Polygon'))areas++;else lines++;}}return {points,areas,lines,missing};}

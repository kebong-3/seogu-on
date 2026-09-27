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
export const INFRA_CATEGORIES=[
 {id:'park',title:'공원',group:'공원·생활',icon:'tree',layers:['parks','park-areas']},
 {id:'library',title:'도서관',group:'문화·체육',icon:'book',layers:['libraries','infra-library']},
 {id:'parking',title:'주차장',group:'교통',icon:'parking',layers:['parking','infra-parking']},
 {id:'rooms',title:'공공 개방공간',group:'공원·생활',icon:'building',layers:['public-facilities']},
 ...INFRA_LAYERS.filter(l=>!['library','parking'].includes(l.name)).map(l=>({id:l.name,title:l.title,group:l.group,icon:l.icon,layers:[l.id]})),
 {id:'heat',title:'무더위쉼터',group:'기후·안전',icon:'sun',layers:['heat'],api:true},
 {id:'evacuation',title:'지진대피 학교',group:'안전',icon:'shield',layers:['shelter-schools']},
 {id:'emergency',title:'응급의료기관',group:'건강·복지',icon:'cross',layers:['emergency'],api:true}
];
export const OVERLAY_LAYERS=[
 {id:'shade-result',title:'시간별 그늘 근사',group:'분석·관측',kind:'polygon',color:'#756f96',icon:'sun',analysis:true},
 {id:'weather-observed',title:'기상청 격자 실황',group:'분석·관측',kind:'point',color:'#efca7c',icon:'sun',analysis:true},
 {id:'weather-forecast',title:'선택 시각 예보',group:'분석·관측',kind:'point',color:'#b4c4ed',icon:'wind',analysis:true},
 {id:'air-observed',title:'미세먼지 관측값',group:'분석·관측',kind:'point',color:'#b7d7bc',icon:'wind',analysis:true}
];
export function infrastructureCounts(category,entries){let points=0,areas=0,lines=0,missing=0;for(const id of category.layers){const e=entries.get(id);if(!e?.features?.length){missing++;continue;}for(const f of e.features){if(f.geometry?.type==='Point')points++;else if(f.geometry?.type?.includes('Polygon'))areas++;else lines++;}}return {points,areas,lines,missing};}

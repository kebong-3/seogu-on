import {SAFETY_LAYERS} from './safety-catalog.js';
import {VW_LAYERS} from './vworld-catalog.js';
import {INFRA_LAYERS,OFFICIAL_LAYERS,OVERLAY_LAYERS} from './infrastructure.js';
export const LAYERS=[
 {id:'parks',group:'생활인프라',title:'공원 위치',icon:'tree',color:'#74d79b',kind:'point',url:'/data/layers/parks.geojson',note:'공공데이터 위치 · 법적 공원 경계와 별개'},
 {id:'park-areas',group:'생활인프라',title:'공원 면',icon:'tree',color:'#74d79b',kind:'polygon',url:'/data/city/park-areas.geojson',note:'OSM 공원 도형 · 행정상 지정경계 아님'},
 {id:'parking',group:'생활인프라',title:'주차장',icon:'parking',color:'#9bbffc',kind:'point',url:'/data/layers/parking.geojson',note:'공개 시설정보 · 실시간 빈자리 아님'},
 {id:'libraries',group:'생활인프라',title:'도서관',icon:'book',color:'#c8acf5',kind:'point',url:'/data/layers/libraries.geojson'},
 {id:'public-facilities',group:'생활인프라',title:'공공공간',icon:'building',color:'#f3c974',kind:'point',url:'/data/layers/public-facilities.geojson'},
 {id:'shelter-schools',group:'안전·복지',title:'대피학교',icon:'shield',color:'#95cfee',kind:'point',url:'/data/layers/shelter-schools.geojson',note:'학교 대표위치 · 출입구/대피구역 아님'},
 {id:'heat',group:'안전·복지',title:'무더위쉼터',icon:'sun',color:'#f5b477',kind:'point',api:true,key:'safety',note:'API 운영기간·야간개방 정보 확인'},
 {id:'emergency',group:'안전·복지',title:'응급의료기관',icon:'cross',color:'#f799a7',kind:'point',api:true,key:'emergency',note:'기관 기본정보 · 실시간 수용가능/병상 상태 아님'},
 {id:'events',group:'교통',title:'돌발상황',icon:'warning',color:'#f2bc73',kind:'point',api:true,key:'its'},
 {id:'cctv',group:'교통',title:'공개 교통CCTV',icon:'camera',color:'#97c6fa',kind:'point',api:true,key:'its',note:'ITS 공개영상만 · 비공개 방범CCTV 아님'},
 {id:'accidents',group:'교통',title:'사고다발구역',icon:'warning',color:'#f695a6',kind:'polygon',api:true,key:'taas',note:'API 지정 기준연도 자료 · 미래 위험예측 아님'},
 {id:'flow',group:'교통',title:'교통소통',icon:'road',color:'#87d1c2',kind:'raster',key:'flow',note:'ITS WMS 제공범위'},
 {id:'national-flood',group:'침수·홍수',title:'국가하천 범람지도',icon:'water',color:'#80b9f2',kind:'raster',key:'safemap'},
 {id:'local-flood',group:'침수·홍수',title:'지방하천 범람지도',icon:'water',color:'#93ceff',kind:'raster',key:'safemap'},
 {id:'flood-trace',group:'침수·홍수',title:'침수흔적도',icon:'water',color:'#a7a7ef',kind:'raster',key:'safemap'},
 {id:'city-flood',group:'침수·홍수',title:'도시침수 30년 빈도',icon:'water',color:'#83d5ed',kind:'raster',key:'floodmap',note:'빈도 시나리오 지도 · 현재 침수/예보 아님'},
 {id:'air-stations',group:'환경',title:'대기 측정소',icon:'wind',color:'#b9d2a0',kind:'point',api:true,key:'air',note:'측정소 관측값 · 모든 건물의 농도 아님'},
 {id:'cadastral',group:'입지·계획',title:'지적도 참고층',icon:'parcel',color:'#e0cc9d',kind:'raster',key:'vworldRest',note:'법적 경계 확정·측량용 아님'}
];
LAYERS.push(...INFRA_LAYERS,...OFFICIAL_LAYERS,...OVERLAY_LAYERS,...VW_LAYERS,...SAFETY_LAYERS,
 {id:'local-icing',title:'상습결빙구간 (공식 공개본)',group:'서구 공식자료',icon:'warning',color:'#36a1db',kind:'mixed',url:'/data/city/local-icing.geojson',note:'생활안전지도 광주 서구 등록구간의 시작·종료 관리지점 · 지점 수와 구간 수는 다름 · 현재 노면 결빙 관측 아님'},
 {id:'local-shade',title:'서구 그늘막 공개본',group:'서구 공식자료',icon:'sun',color:'#de9a27',kind:'point',url:'/data/city/local-shade.geojson',note:'공식 공개본 · 기준일은 자료 상세 참조 · 현재 운영 별도'},
 {id:'local-cooling',title:'서구 쿨링포그 공개본',group:'서구 공식자료',icon:'water',color:'#209ab7',kind:'point',url:'/data/city/local-cooling.geojson',note:'공식 공개본 · 기준일은 자료 상세 참조 · 현재 가동 별도'},
 {id:'local-flood-history',title:'과거 침수피해 기록',group:'서구 공식자료',icon:'water',color:'#7769ba',kind:'point',url:'/data/city/local-flood-history.geojson',note:'발생연도별 과거 기록 · 현재 위험 예측 아님'}
);
export const LAYER_BY_ID=Object.fromEntries(LAYERS.map(l=>[l.id,l]));
export const PRESETS=[
 {id:'parks',label:'공원',icon:'tree',layers:['parks','park-areas']},
 {id:'parking',label:'주차',icon:'parking',layers:['parking','infra-parking']},
 {id:'culture',label:'생활시설',icon:'book',layers:['libraries','public-facilities']},
 {id:'safety',label:'안전·복지',icon:'shield',layers:['shelter-schools']},
 {id:'traffic',label:'교통',icon:'road',layers:[]},
 {id:'environment',label:'환경',icon:'wind',layers:[]},
 {id:'planning',label:'입지·계획',icon:'parcel',layers:[]},
];
export const PATHS={tree:'M12 3 5 13h4l-3 5h12l-3-5h4L12 3Zm0 15v4',parking:'M8 21V3h6a5 5 0 0 1 0 10H8',book:'M3 4h7l2 2 2-2h7v15h-7l-2 2-2-2H3V4Zm9 2v15',building:'M5 21V3h14v18M3 21h18M9 7h1m4 0h1M9 11h1m4 0h1M10 21v-5h4v5',shield:'M12 3 3 7v5c0 5 9 10 9 10s9-5 9-10V7L12 3Zm-4 9 3 3 5-6',sun:'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2',cross:'M9 3h6v6h6v6h-6v6H9v-6H3V9h6Z',warning:'m12 3 10 18H2L12 3Zm0 5v6m0 3v1',camera:'M3 7h13v12H3V7Zm13 4 5-3v10l-5-3M7 3h5',road:'M8 3 3 21M16 3l5 18M12 3v4m0 3v4m0 3v4',water:'M12 2C9 7 4 10 4 15a8 8 0 0 0 16 0c0-5-5-8-8-13Z',wind:'M2 8h13a3 3 0 1 0-3-3M2 12h18a3 3 0 1 1-3 3M2 17h8a3 3 0 1 1-3 3',parcel:'m3 7 9-4 9 4v10l-9 4-9-4V7Zm9-4v18M3 7l18 10',home:'m3 11 9-8 9 8M5 10v11h14V10M9 21v-7h6v7',layers:'m12 3 10 6-10 6L2 9l10-6Zm-10 10 10 6 10-6M2 17l10 6 10-6',close:'m6 6 12 12M6 18 18 6',search:'M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm5 12 6 6',arrow:'m9 5 7 7-7 7',rotate:'M20 7a9 9 0 1 0 1 9M20 2v6h-6',expand:'M3 9V3h6m6 0h6v6M3 15v6h6m6 0h6v-6',settings:'M4 6h16M4 12h16M4 18h16M8 3v6m8 0v6m-7 0v6',download:'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5',pin:'M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7Zm0 4a3 3 0 1 0 0 6 3 3 0 0 0 0-6',cube:'m12 2 10 6v8l-10 6L2 16V8l10-6ZM2 8l10 6 10-6m-10 6v8',chart:'M3 3v18h18M6 15l4-5 5 3 6-8'};
export const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const icon=(id,cls='')=>`<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${PATHS[id]||PATHS.pin}"/></svg>`;
export function iconData(id,color='#8dd7bd'){return 'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="40" height="46" viewBox="0 0 40 46"><rect x="3" y="2" width="34" height="34" rx="11" fill="#122b39" stroke="${color}" stroke-width="2"/><path d="m16 36 4 6 4-6" fill="${color}"/><g transform="translate(9 8) scale(.9)" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="${PATHS[id]||PATHS.pin}"/></g></svg>`);}

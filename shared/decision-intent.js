/** Shared, deliberately narrow routing. Existing factual questions still use /api/ask. */
export function isDecisionQuestion(question) {
  const q=String(question||'').replace(/\s+/g,' ').trim();
  if(/설치\s*기준|법적\s*근거|법령|조례|입소\s*(?:기준|자격)/.test(q)&&!/후보지|배치\s*(?:비교|검토)|위치\s*(?:비교|검토)/.test(q))return false;
  return /(?:시설|그늘막|쉼터|거점|공간|어린이집|돌봄센터|비상벨|안심벨|보안등).{0,35}(?:추가|배치|설치|옮기|이전|없애|중단)/.test(q)
    || /(?:추가|배치|설치).{0,25}(?:시설|그늘막|쉼터|거점)/.test(q)
    || /(?:어린이집|돌봄시설|여성\s*안심|여성\s*안전|비상벨|안심벨|보안등).{0,35}(?:점검|위치\s*비교)/.test(q)
    || /사업\s*(?:후보|위치|지)|후보지.{0,20}(?:비교|검토|주변)|어디.{0,12}(?:추가|설치|점검)|점검\s*(?:대상|우선|목록)/.test(q);
}

/** A current-facility lookup must not silently create hypothetical new facilities. */
export function livingMapIntent(question,{boundaries}={}) {
  const q=String(question||'').normalize('NFKC').replace(/\s+/g,' ').trim();
  if(!q||isDecisionQuestion(q)||/점검|정비|후보지|공백|사각지대|반경|비교|부족|더 필요|늘려|확충|육아휴직|지원금|보육료|설치\s*기준|법령|조례|입소\s*(?:기준|자격)/.test(q))return null;
  const care=/육아\s*(?:시설|지원시설|지도|공간)|돌봄\s*(?:시설|센터|지도|공간)|어린이집|유치원|지역아동센터|공동육아|아이돌봄\s*(?:시설|센터)/.test(q);
  const safety=/여성안심|여성 안심|여성안전|여성 안전|안심시설|안전시설|안심벨|비상벨|안심지킴|보안등|안심택배/.test(q);
  if(!care&&!safety)return null;
  const lookup=/보여|지도|위치|어디|현황|찾아|조회|목록|알려/.test(q)||q.length<35;
  if(!lookup)return null;
  const named=(boundaries?.features||[]).filter(f=>q.includes(f.properties?.dongName));
  const result={topic:safety?'safety':'care'};
  if(named.length===1)result.scopeId=named[0].properties.dongId;
  if(/전체|전역/.test(q))result.scopeId='all';
  return result;
}

export function decisionIntent(question,{manifest,boundaries,current={}}) {
  const q=String(question||'').normalize('NFKC').replace(/\s+/g,' ').trim();
  const next={...current};
  const named=boundaries.features.filter(f=>q.includes(f.properties.dongName));
  if(named.length===1)next.scopeId=named[0].properties.dongId;
  if(/전체|전역/.test(q))next.scopeId='all';
  const presets=manifest.presets;
  const chosen=presets.map(p=>({p,score:(p.keywords||[]).reduce((n,k)=>n+(q.includes(k)?k.length:0),0)})).sort((a,b)=>b.score-a.score)[0];
  if(chosen?.score)next.presetId=chosen.p.id;
  const domain=/여성\s*안심|여성\s*안전|비상벨|안심벨|안심시설|안전시설/.test(q)?'women-safety':/보안등|가로등|밤길|야간/.test(q)?'night-safety':/어린이집|돌봄시설|돌봄 시설|육아시설|보육/.test(q)&&!/그늘막|쉼터/.test(q)?'childcare':null;
  if(domain&&presets.some(p=>p.id===domain))next.presetId=domain;
  if(/후보지|사업\s*(?:후보|위치|지)|주변\s*(?:여건|비교)/.test(q))next.workflow='site';
  else if(/점검|정비\s*대상/.test(q))next.workflow='inspection';
  else if(/추가|배치|설치|공백|사각|중단|이전/.test(q))next.workflow='coverage';
  const radius=q.match(/(?:반경|거리|이내|조건)?\s*(\d+(?:\.\d+)?)\s*(km|킬로미터|m|미터)(?:\s*(?:이내|안|반경))?/i);
  if(radius)next.radiusM=Number(radius[1])*(/km|킬로/.test(radius[2])?1000:1);
  const count=q.match(/(\d+|한|하나|두|둘|세|셋|네|넷|다섯)\s*(?:곳|개|지점)(?:만|을|를|씩|에)?/);
  if(count){const words={한:1,하나:1,두:2,둘:2,세:3,셋:3,네:4,넷:4,다섯:5};next.maxNew=words[count[1]]??Number(count[1]);delete next.proposedSites;}
  if(/추가\s*없이|추가하지|현재만/.test(q)){next.maxNew=0;next.proposedSites=[];}
  // A different service or scope requires new candidates, never carry old coordinates implicitly.
  if(next.presetId!==current.presetId||next.scopeId!==current.scopeId){delete next.proposedSites;delete next.excludedServiceIds;delete next.sites;}
  return next;
}

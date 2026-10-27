export const DEFAULT_MODEL='gemma-4-26b-a4b-it';
export const SOLAR_MODEL='solar-pro4';
const REASONING_EFFORTS=new Set(['none','minimal','low','medium','high','xhigh','max']);
const clean=v=>String(v || '').trim().replace(/^['"]|['"]$/g,'').trim();
/** 서버 환경변수만 읽는다. HTTP 요청으로 모델·연결주소를 바꿀 수 없다. */
export function modelConfig(env) {
  const selected=clean(env.AI_PROVIDER) || 'google';
  const provider=selected==='solar'?'upstage':selected;
  const legacy=clean(env.GEMINI_MODEL).replace(/^models\//,'');
  // 명시적으로 지정한 모델을 존중한다. 이전 GEMINI_MODEL도 다른 계열로 몰래 바꾸지 않는다.
  const model=(clean(env.AI_MODEL)||(provider==='upstage'?SOLAR_MODEL:clean(env.GEMMA_MODEL)||legacy||DEFAULT_MODEL)).replace(provider==='google'?/^models\//:/^$/,'');
  if(!['google','openai-compatible','upstage'].includes(provider))return {error:'AI_PROVIDER'};
  if(!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,119}$/.test(model)||model.includes('..'))return {error:'AI_MODEL'};
  if(provider==='google')return {provider,model,key:clean(env.AI_API_KEY)||clean(env.GEMINI_API_KEY)};
  const reasoningEffort=clean(env.AI_REASONING_EFFORT)||(provider==='upstage'?'medium':'');
  if(reasoningEffort&&!REASONING_EFFORTS.has(reasoningEffort))return {error:'AI_REASONING_EFFORT'};
  // Solar's destination is fixed; an unrelated compatible endpoint cannot receive this key.
  if(provider==='upstage')return {provider,model,key:clean(env.UPSTAGE_API_KEY)||clean(env.AI_API_KEY),baseUrl:'https://api.upstage.ai/v1',reasoningEffort};
  try {
    const url=new URL(clean(env.AI_API_BASE));
    const loopback=['localhost','127.0.0.1','[::1]'].includes(url.hostname);
    if((url.protocol!=='https:'&&!(url.protocol==='http:'&&loopback&&!env.VERCEL))||url.username||url.password||url.search||url.hash)throw Error();
    return {provider,model,key:clean(env.AI_API_KEY),baseUrl:url.href.replace(/\/+$/,''),...(reasoningEffort?{reasoningEffort}:{})};
  }catch{return {error:'AI_API_BASE'};}
}

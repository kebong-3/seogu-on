import {LlmError} from './llm-errors.js';
function schema(s) {
  if(!s||typeof s!=='object')return s;
  if(Array.isArray(s))return s.map(schema);
  return Object.fromEntries(Object.entries(s).map(([k,v])=>[k,k==='type'&&typeof v==='string'?v.toLowerCase():schema(v)]));
}
/** vLLM 등 Chat Completions 호환 서버용 전송 어댑터. 공간도구·근거 검사는 공유한다. */
export async function generateCompatible({fetcher,key,model,baseUrl,body,timeoutMs}) {
  const messages=[{role:'system',content:body.systemInstruction.parts.map(p=>p.text||'').join('\n')}];
  let serial=0;
  const waiting=[];
  for(const item of body.contents) {
    const content=item.parts.map(p=>p.text||'').join('');
    const calls=item.parts.filter(p=>p.functionCall).map(p=>{
      const c=p.functionCall,id=c.id||`tool-${++serial}`;waiting.push({id,name:c.name});
      return {id,type:'function',function:{name:c.name,arguments:JSON.stringify(c.args||{})}};
    });
    const responses=item.parts.filter(p=>p.functionResponse);
    if(responses.length)for(const p of responses){
      const r=p.functionResponse,index=waiting.findIndex(c=>r.id?c.id===r.id:c.name===r.name);
      if(index<0)throw new LlmError('LLM_BAD_RESPONSE','도구 응답 연결을 확인하지 못했습니다.');
      const [call]=waiting.splice(index,1);messages.push({role:'tool',tool_call_id:call.id,content:JSON.stringify(r.response)});
    }
    else messages.push({role:item.role==='model'?'assistant':'user',content:content||null,...(calls.length?{tool_calls:calls}:{})});
  }
  const request={model,messages,temperature:body.generationConfig.temperature,max_tokens:body.generationConfig.maxOutputTokens,
    tools:body.tools[0].functionDeclarations.map(d=>({type:'function',function:{name:d.name,description:d.description,parameters:schema(d.parameters)||{type:'object',properties:{}}}})),
    tool_choice:body.toolConfig.functionCallingConfig.mode==='NONE'?'none':'auto'};
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
  try {
    const response=await fetcher(`${baseUrl}/chat/completions`,{method:'POST',headers:{'Content-Type':'application/json',...(key?{Authorization:`Bearer ${key}`}:{})},body:JSON.stringify(request),signal:controller.signal,redirect:'error'});
    if(!response.ok)throw new LlmError(response.status===404?'LLM_MODEL_NOT_FOUND':response.status===429?'LLM_QUOTA':[401,403].includes(response.status)?'LLM_KEY_REJECTED':response.status===400?'LLM_BAD_REQUEST':'LLM_BAD_RESPONSE',`AI 서버 응답 상태 ${Number(response.status)||0}`);
    const payload=await response.json(),message=payload.choices?.[0]?.message;
    if(!message)throw new LlmError('LLM_BAD_RESPONSE','AI 응답을 확인하지 못했습니다.');
    const parts=[];
    if(typeof message.content==='string')parts.push({text:message.content});
    for(const c of message.tool_calls||[]){let args;try{args=JSON.parse(c.function.arguments);}catch{throw new LlmError('LLM_BAD_RESPONSE','AI 도구 인자를 해석하지 못했습니다.');}
      parts.push({functionCall:{id:c.id,name:c.function.name,args}});
    }
    return {candidates:[{content:{parts},finishReason:payload.choices[0].finish_reason==='length'?'MAX_TOKENS':'STOP'}]};
  }catch(error){
    if(error instanceof LlmError)throw error;
    throw new LlmError(controller.signal.aborted?'LLM_TIMEOUT':'LLM_BAD_RESPONSE','AI 연결 또는 응답을 확인하지 못했습니다.');
  }finally{clearTimeout(timer);}
}

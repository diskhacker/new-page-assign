import http from 'node:http';
import {randomUUID} from 'node:crypto';
import {unzipSync,strFromU8} from 'fflate';
const port=Number(process.env.PORT||3001);
const MAX_ZIP=5*1024*1024,MAX_TOTAL=15*1024*1024,MAX_FILES=200,MAX_FILE=150000;
const TTL=30*60*1000,MAX_SESSIONS=10;
const sessions=new Map();
const allowed=/\.(?:js|jsx|ts|tsx|mjs|cjs)$/i;
const ignored=/(^|\/)(?:node_modules|\.git|dist|build|coverage)(\/|$)/;
const tokens=s=>[...new Set((s.toLowerCase().match(/[a-z_$][\w$]{2,}/g)||[]))];
const clean=()=>{for(const [id,s] of sessions)if(s.expires<Date.now())sessions.delete(id)};
const timer=setInterval(clean,60000);timer.unref();
function validatePath(p){return p&&!p.startsWith('/')&&!p.includes('\\')&&!p.split('/').some(x=>x==='..'||x==='.')&&!/^[A-Za-z]:/.test(p)}
export function parseArchive(bytes){
 let total=0,count=0;
 const archive=unzipSync(bytes,{filter:e=>{
   if(!validatePath(e.name))throw Error('Unsafe archive path');
   if(e.name.endsWith('/'))return false;
   if(++count>MAX_FILES)throw Error('Too many archive entries');
   if(!allowed.test(e.name)||ignored.test(e.name))return false;
   if(e.originalSize>MAX_FILE || (total+=e.originalSize)>MAX_TOTAL)throw Error('Archive exceeds expanded size limit');
   return true;
 }});
 const files=Object.entries(archive).map(([name,data])=>{if(data.length>MAX_FILE)throw Error('File exceeds size limit');return {path:name,source:strFromU8(data)};});
 if(!files.length)throw Error('No supported JS/TS files in archive');
 return files;
}
export function buildGraph(files){
 const symbols=[],edges=[],docs=[];
 for(const file of files){
   const lines=file.source.split('\n');
   const local=[];
   for(let i=0;i<lines.length;i++){
     const m=lines[i].match(/\b(?:function|class|interface|type|const|let|var)\s+([\w$]+)/);
     if(m){const symbol={id:file.path+':'+(i+1),name:m[1],path:file.path,line:i+1};symbols.push(symbol);local.push(symbol)}
   }
   docs.push({path:file.path,lines,source:file.source,local});
 }
 const byName=new Map();for(const s of symbols){const arr=byName.get(s.name)||[];arr.push(s);byName.set(s.name,arr)}
 for(const doc of docs){
   for(let i=0;i<doc.lines.length;i++){
     const line=doc.lines[i];
     for(const m of line.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)){
       const matches=byName.get(m[1])||[];
       if(matches.length===1 && matches[0].path===doc.path && matches[0].line!==i+1)
         edges.push({type:'possible-call',from:doc.path+':'+(i+1),to:matches[0].id});
     }
     const imp=line.match(/\bfrom\s+['"]([^'"]+)['"]/);
     if(imp)edges.push({type:'import',from:doc.path,to:imp[1]});
   }
 }
 return {docs,symbols,edges};
}
export function retrieve(graph,question){
 const terms=tokens(question);
 return graph.docs.map(d=>{
   const matches=d.local.filter(s=>terms.includes(s.name.toLowerCase()));
   const ranked=d.lines.map((line,i)=>({line:i+1,score:terms.filter(t=>line.toLowerCase().includes(t)).length})).filter(x=>x.score>0).sort((a,b)=>b.score-a.score);
   const score=matches.length*8+ranked.slice(0,8).reduce((n,x)=>n+x.score,0)+terms.filter(t=>d.path.toLowerCase().includes(t)).length*3;
   const focus=matches[0]?.line||ranked[0]?.line||1;
   const start=Math.max(1,focus-4),end=Math.min(d.lines.length,focus+12);
   return {path:d.path,start,end,score,source:d.lines.slice(start-1,end).map((line,i)=>`${start+i}: ${line}`).join('\n')};
 }).filter(x=>x.score>0).sort((a,b)=>b.score-a.score).slice(0,4);
}
async function explain(question,evidence){
 if(!process.env.LLM_BASE_URL||!process.env.LLM_API_KEY||!process.env.LLM_MODEL)
   return {answer:'LLM not configured. Relevant code evidence is listed below.',mode:'retrieval-only'};
 const context=evidence.map(e=>`${e.path} [${e.start}-${e.end}]\n${e.source}`).join('\n\n').slice(0,10000);
 const res=await fetch(process.env.LLM_BASE_URL.replace(/\/$/,'')+'/chat/completions',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+process.env.LLM_API_KEY},body:JSON.stringify({model:process.env.LLM_MODEL,temperature:0,max_tokens:500,messages:[{role:'system',content:'Explain only supported behavior from the supplied source. Do not invent paths, calls or facts. State uncertainty.'},{role:'user',content:question+'\n'+context}]}),signal:AbortSignal.timeout(20000)});
 if(!res.ok)throw Error('LLM unavailable ('+res.status+')');
 const data=await res.json();return {answer:data.choices?.[0]?.message?.content||'No answer returned.',mode:'llm'};
}
export async function ask(session,question){
 if(typeof question!=='string'||!question.trim()||question.length>1000)throw Error('Question must be 1-1000 characters');
 const key=question.trim().toLowerCase();
 if(session.cache.has(key))return {...session.cache.get(key),cache:'hit'};
 const evidence=retrieve(session.graph,question);
 if(!evidence.length)return {answer:'Insufficient evidence in this uploaded codebase.',citations:[],cache:'miss',mode:'no-evidence'};
 const output=await explain(question,evidence);
 const result={...output,citations:evidence.map(({path,start,end})=>({path,start,end})),cache:'miss'};
 if(session.cache.size>=50)session.cache.delete(session.cache.keys().next().value);
 session.cache.set(key,result);return result;
}
async function readBody(req,limit){
 const chunks=[];let length=0;
 for await(const chunk of req){length+=chunk.length;if(length>limit)throw Error('Upload/request too large');chunks.push(chunk)}
 return Buffer.concat(chunks);
}
function send(res,status,data){res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(data))}
function getSession(req){
 const id=req.headers['x-session-id'];const s=typeof id==='string'?sessions.get(id):null;
 if(!s||s.expires<Date.now())throw Error('Session missing or expired');
 s.expires=Date.now()+TTL;return s;
}
export async function handler(req,res){
 const allowedOrigin=process.env.UI_ORIGIN||'http://127.0.0.1:5173';
 const origin=req.headers.origin;
 if(origin&&origin!==allowedOrigin)return send(res,403,{error:'Origin not allowed'});
 res.setHeader('access-control-allow-origin',allowedOrigin);
 res.setHeader('vary','Origin');
 res.setHeader('access-control-allow-headers','content-type,x-session-id');
 res.setHeader('access-control-allow-methods','GET,POST,DELETE,OPTIONS');
 if(req.method==='OPTIONS')return send(res,200,{});
 try{
  clean();
  if(req.method==='GET'&&req.url==='/api/health')return send(res,200,{status:'ok'});
  if(req.method==='POST'&&req.url==='/api/session/upload'){
   if(sessions.size>=MAX_SESSIONS)throw Error('Session capacity reached');
   if(req.headers['content-type']!=='application/zip')throw Error('Expected application/zip');
   const bytes=await readBody(req,MAX_ZIP);
   if(bytes.length<4||bytes[0]!==80||bytes[1]!==75)throw Error('Invalid ZIP signature');
   const files=parseArchive(bytes),graph=buildGraph(files);
   const id=randomUUID()+randomUUID();
   sessions.set(id,{graph,cache:new Map(),expires:Date.now()+TTL});
   return send(res,200,{sessionId:id,filesIndexed:graph.docs.length,symbolsIndexed:graph.symbols.length,edgesIndexed:graph.edges.length,ttlSeconds:TTL/1000});
  }
  if(req.method==='GET'&&req.url==='/api/graph'){
   const s=getSession(req);
   return send(res,200,{files:s.graph.docs.map(d=>d.path),symbols:s.graph.symbols.slice(0,200),edges:s.graph.edges.slice(0,300)});
  }
  if(req.method==='POST'&&req.url==='/api/chat'){
   const s=getSession(req);const data=JSON.parse((await readBody(req,4096)).toString('utf8'));
   if(!data||typeof data!=='object')throw Error('Invalid request body');
   return send(res,200,await ask(s,data.question));
  }
  if(req.method==='DELETE'&&req.url==='/api/session'){
   getSession(req);sessions.delete(req.headers['x-session-id']);return send(res,200,{ended:true});
  }
  return send(res,404,{error:'Not found'});
 }catch(e){return send(res,400,{error:e.message})}
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href)
 http.createServer(handler).listen(port,'127.0.0.1',()=>console.log('API on '+port));

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

const root = path.resolve(process.env.REPO_ROOT || process.cwd());
const port = Number(process.env.PORT || 3001);
const MAX_FILES = 300, MAX_BYTES = 100_000, MAX_CONTEXT = 12000;
const allowed = new Set(['.js','.jsx','.ts','.tsx','.mjs','.cjs']);
const ignored = new Set(['node_modules','.git','dist','build','coverage','.next']);
let index = null;
const cache = new Map();
const hash = x => createHash('sha256').update(x).digest('hex');
const words = s => [...new Set((s.toLowerCase().match(/[a-z_][a-z_0-9]*/g) || []).filter(x => x.length > 2))];

async function collect(dir, output=[]) {
  for (const entry of await fs.readdir(dir,{withFileTypes:true})) {
    if (output.length >= MAX_FILES) break;
    if (entry.isSymbolicLink() || ignored.has(entry.name)) continue;
    const absolute = path.join(dir,entry.name);
    if (entry.isDirectory()) await collect(absolute,output);
    else if (entry.isFile() && allowed.has(path.extname(entry.name))) {
      const stat = await fs.stat(absolute);
      if (stat.size <= MAX_BYTES) output.push(absolute);
    }
  }
  return output;
}
export async function buildIndex() {
  const files=[];
  for (const absolute of await collect(root)) {
    const content=await fs.readFile(absolute,'utf8');
    const relative=path.relative(root,absolute).split(path.sep).join('/');
    const lines=content.split('\n');
    const symbols=[];
    for (let i=0;i<lines.length;i++) {
      const m=lines[i].match(/\b(?:function|class|interface|type|const|let|var)\s+([A-Za-z_$][\w$]*)/);
      if(m) symbols.push({name:m[1],line:i+1});
    }
    const imports=[...content.matchAll(/(?:import\s+(?:[\s\S]*?\s+from\s+)?|require\s*\()['"]([^'"\n]+)['"]/g)].map(m=>m[1]);
    files.push({path:relative,content,lines,symbols,imports});
  }
  const revision=hash(files.map(f=>f.path+'\0'+f.content).join('\0'));
  index={files,revision};cache.clear();
  return {revision,filesIndexed:files.length,symbolsIndexed:files.reduce((n,f)=>n+f.symbols.length,0)};
}
export function retrieve(question, idx=index) {
  if (!idx) throw new Error('Repository not indexed');
  const terms=words(question);
  return idx.files.map(f=>{
    const hits=f.symbols.filter(s=>terms.includes(s.name.toLowerCase()));
    const lines=f.lines.map((line,i)=>({line,i:i+1,score:words(line).filter(w=>terms.includes(w)).length})).filter(x=>x.score>0);
    const score=hits.length*8+lines.reduce((n,x)=>n+x.score,0)+terms.filter(w=>f.path.toLowerCase().includes(w)).length*3;
    const focus=hits[0]?.line ?? lines.sort((a,b)=>b.score-a.score)[0]?.i ?? 1;
    const start=Math.max(1,focus-5),end=Math.min(f.lines.length,focus+15);
    return {path:f.path,start,end,score,source:f.lines.slice(start-1,end).map((s,i)=>`${start+i}: ${s}`).join('\n'),imports:f.imports};
  }).filter(x=>x.score>0).sort((a,b)=>b.score-a.score).slice(0,5);
}
async function generate(question,evidence) {
  const endpoint=process.env.LLM_BASE_URL;
  if (!endpoint || !process.env.LLM_API_KEY || !process.env.LLM_MODEL) return {answer:'LLM is not configured. Relevant source evidence is listed below.',mode:'retrieval-only'};
  const context=evidence.map(x=>`FILE ${x.path} LINES ${x.start}-${x.end}\n${x.source}`).join('\n\n').slice(0,MAX_CONTEXT);
  const response=await fetch(`${endpoint.replace(/\/$/,'')}/chat/completions`,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${process.env.LLM_API_KEY}`},body:JSON.stringify({model:process.env.LLM_MODEL,temperature:0,messages:[{role:'system',content:'Explain only the provided code. Do not invent files, line numbers or behavior. If evidence is insufficient, say so. Citations are supplied separately by the server.'},{role:'user',content:`Question: ${question}\n\nEvidence:\n${context}`}],max_tokens:600}),signal:AbortSignal.timeout(30000)});
  if(!response.ok) throw new Error(`LLM returned HTTP ${response.status}`);
  const data=await response.json();
  return {answer:data.choices?.[0]?.message?.content || 'No explanation returned.',mode:'llm'};
}
export async function ask(question) {
  if(typeof question!=='string'||!question.trim()||question.length>1000) throw new Error('Question must be 1–1000 characters');
  if(!index) throw new Error('Repository not indexed');
  const key=hash(index.revision+'\0'+question.trim().toLowerCase());
  const cached=cache.get(key);if(cached && cached.expires>Date.now()) return {...cached.result,cache:'hit'};
  const evidence=retrieve(question);
  if(!evidence.length) return {answer:'Insufficient evidence in the indexed repository.',citations:[],cache:'miss',mode:'no-evidence'};
  const output=await generate(question,evidence);
  const result={...output,citations:evidence.map(({path,start,end})=>({path,start,end})),cache:'miss'};
  if(cache.size>=100) cache.delete(cache.keys().next().value);
  cache.set(key,{result,expires:Date.now()+10*60_000});return result;
}
async function handler(req,res){
  res.setHeader('access-control-allow-origin',process.env.UI_ORIGIN || 'http://localhost:5173');
  res.setHeader('access-control-allow-methods','GET,POST,OPTIONS');res.setHeader('access-control-allow-headers','content-type');
  res.setHeader('content-type','application/json');
  if(req.method==='OPTIONS'){res.writeHead(204);return res.end();}
  try {
    if(req.method==='GET'&&req.url==='/api/health') return res.end(JSON.stringify({status:'ok',indexed:!!index}));
    if(req.method==='POST'&&req.url==='/api/repository/index') return res.end(JSON.stringify(await buildIndex()));
    if(req.method==='POST'&&req.url==='/api/chat') {
      let body='';for await(const part of req){body+=part;if(body.length>4096) throw new Error('Request too large');}
      return res.end(JSON.stringify(await ask(JSON.parse(body).question)));
    }
    res.writeHead(404);res.end(JSON.stringify({error:'Not found'}));
  } catch(error){res.writeHead(400);res.end(JSON.stringify({error:error.message}));}
}
if(process.argv[1] && path.resolve(process.argv[1])===path.resolve(new URL(import.meta.url).pathname)) http.createServer(handler).listen(port,'127.0.0.1',()=>console.log(`API http://127.0.0.1:${port} root=${root}`));

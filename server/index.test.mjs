import test from 'node:test';import assert from 'node:assert/strict';import {zipSync,strToU8} from 'fflate';import {parseArchive,buildGraph,retrieve,ask,handler} from './index.mjs';
const zip=files=>zipSync(Object.fromEntries(Object.entries(files).map(([name,content])=>[name,strToU8(content)])));
test('FINAL PROOF: ZIP → CodeGraph → grounded retrieval → session cache',async()=>{
 const files=parseArchive(zip({'src/math.ts':'export function calculateTotal(price: number) { return price * 2; }\nexport function checkout() { return calculateTotal(5); }'}));
 const graph=buildGraph(files);
 assert.equal(graph.docs.length,1);assert.ok(graph.symbols.some(s=>s.name==='calculateTotal'));
 assert.ok(graph.edges.some(e=>e.type==='possible-call'));
 const evidence=retrieve(graph,'calculateTotal');assert.ok(evidence.length);assert.equal(evidence[0].path,'src/math.ts');
 const session={graph,cache:new Map()};
 const first=await ask(session,'calculateTotal');const second=await ask(session,'calculateTotal');
 assert.equal(first.cache,'miss');assert.equal(second.cache,'hit');assert.ok(first.citations.length);
});
test('FINAL PROOF: archive path traversal rejected',()=>assert.throws(()=>parseArchive(zip({'../escape.ts':'export const bad=1'})),/Unsafe archive path/));
test('FINAL PROOF: unsupported archive rejected',()=>assert.throws(()=>parseArchive(zip({'README.md':'test'})),/No supported/));
test('FINAL PROOF: unsupported question has no invented citations',async()=>{
 const graph=buildGraph([{path:'src/a.ts',source:'export function alpha() { return 1; }'}]);
 const session={graph,cache:new Map()};
 const result=await ask(session,'zzzzzzzzuniqueunknown');
 assert.equal(result.citations.length,0);
});

import http from 'node:http';
import {once} from 'node:events';
test('FINAL PROOF: HTTP upload -> ask -> cache hit -> end -> rejected',async()=>{
 const server=http.createServer(handler);
 server.listen(0,'127.0.0.1');
 await once(server,'listening');
 const base='http://127.0.0.1:'+server.address().port;
 const archive=zip({'src/example.ts':'export function greet() { return "hello"; }'});
 try {
  const uploaded=await fetch(base+'/api/session/upload',{method:'POST',headers:{'content-type':'application/zip'},body:Buffer.from(archive)});
  assert.equal(uploaded.status,200);
  const {sessionId,filesIndexed}=await uploaded.json();
  assert.equal(filesIndexed,1);assert.ok(sessionId);
  const send=()=>fetch(base+'/api/chat',{method:'POST',headers:{'content-type':'application/json','x-session-id':sessionId},body:JSON.stringify({question:'greet'})});
  const first=await send();assert.equal(first.status,200);assert.equal((await first.json()).cache,'miss');
  const second=await send();assert.equal(second.status,200);assert.equal((await second.json()).cache,'hit');
  const deleted=await fetch(base+'/api/session',{method:'DELETE',headers:{'x-session-id':sessionId}});
  assert.equal(deleted.status,200);
  const after=await send();assert.equal(after.status,400);
  assert.match((await after.json()).error,/Session missing or expired/);
 }finally{server.close();await once(server,'close')}
});

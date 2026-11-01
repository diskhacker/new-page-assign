import test from 'node:test';import assert from 'node:assert/strict';import {buildIndex,retrieve,ask} from './index.mjs';
test('indexes source and retrieves evidence',async()=>{const stats=await buildIndex();assert.ok(stats.filesIndexed>0);assert.ok(retrieve('buildIndex').some(x=>x.path.endsWith('index.mjs')));});
test('rejects empty question',async()=>{await assert.rejects(ask(''),/Question/)});
test('no evidence returns no invented citations',async()=>{const r=await ask('zzzz_unfindable_' + Date.now() + '_8976');assert.equal(r.citations.length,0)});
test('repeat exact question uses bounded cache',async()=>{const q='buildIndex';const a=await ask(q);const b=await ask(q);assert.equal(a.cache,'miss');assert.equal(b.cache,'hit')});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import worker from '../worker/index';

const context={waitUntil:()=>{}} as unknown as ExecutionContext;
test('API requests reach the handler instead of the SPA fallback, including browser navigations',async()=>{
  let assets=0;
  const env={ASSETS:{fetch:async()=>{assets++;return new Response('<html>app</html>');}}} as any;
  for(const path of ['/api','/api/me','/api/missing']){
    const response=await worker.fetch(new Request(`https://groovy.test${path}`,{headers:{'Sec-Fetch-Mode':'navigate'}}),env,context);
    assert.equal(response.status,503);assert.match(response.headers.get('content-type')!,/application\/json/);
    assert.equal((await response.json() as any).error,'Database is not configured. See the setup guide.');
  }
  assert.equal(assets,0);
});
test('frontend, icons, manifest, and app navigation are delegated to static assets',async()=>{
  const paths:string[]=[];
  const env={ASSETS:{fetch:async(request:Request)=>{paths.push(new URL(request.url).pathname);return new Response('asset',{headers:{'X-Asset':'yes'}});}}} as any;
  for(const path of ['/','/favicon.png','/apple-touch-icon.png','/site.webmanifest','/podcasts/one','/apiary']){
    const response=await worker.fetch(new Request(`https://groovy.test${path}`),env,context);
    assert.equal(await response.text(),'asset');assert.equal(response.headers.get('X-Asset'),'yes');
  }
  assert.equal(paths.length,6);
});
test('Workers deployment config preserves D1 and routes API requests before SPA assets',()=>{
  const config=JSON.parse(readFileSync('wrangler.jsonc','utf8'));
  assert.equal(config.main,'worker/index.ts');assert.equal(config.assets.binding,'ASSETS');assert.equal(config.assets.directory,'./dist');
  assert.equal(config.assets.not_found_handling,'single-page-application');assert.deepEqual(config.assets.run_worker_first,['/api','/api/*']);
  assert.equal(config.d1_databases[0].binding,'DB');assert.equal(config.d1_databases[0].database_name,'groovy');
  assert.ok(!('pages_build_output_dir'in config));
});

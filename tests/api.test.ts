import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import worker from '../worker/index';
import { digest } from '../worker/lib';
import { hashPassword } from '../worker/password.mjs';
const fixtureHashes = {alice:await hashPassword('alice'.repeat(10)),bob:await hashPassword('bob'.repeat(10))};
function database() {
  const sqlite=new DatabaseSync(':memory:');sqlite.exec(readFileSync('migrations/0001_initial.sql','utf8'));sqlite.exec(readFileSync('migrations/0002_resume_playback.sql','utf8'));sqlite.exec(readFileSync('migrations/0003_podcast_speeds.sql','utf8'));sqlite.exec(readFileSync('migrations/0004_public_artwork.sql','utf8'));sqlite.exec(readFileSync('migrations/0005_library_view.sql','utf8'));
  const wrap=(sql:string,values:unknown[]=[])=>({bind:(...v:unknown[])=>wrap(sql,v),first:async()=>sqlite.prepare(sql).get(...values as any[])||null,run:async()=>sqlite.prepare(sql).run(...values as any[]),all:async()=>({results:sqlite.prepare(sql).all(...values as any[])})});
  return {sqlite,db:{prepare:(sql:string)=>wrap(sql),batch:async(statements:any[])=>Promise.all(statements.map(s=>s.all()))}};
}
async function setup(searchEnv: {PODCAST_INDEX_KEY?:string;PODCAST_INDEX_SECRET?:string}={}){const {sqlite,db}=database();const credentials={...fixtureHashes};for(const id of ['alice','bob'])sqlite.prepare('INSERT INTO users(id,password_hash) VALUES(?,?)').run(id,await digest(id.repeat(10)));return {sqlite,credentials,request:async(path:string,method='GET',data?:unknown,cookie='',origin='https://groovy.test')=>await worker.fetch(new Request(`https://groovy.test/api/${path}`,{method,headers:{'Origin':origin,'Content-Type':'application/json','Cookie':cookie},body:data?JSON.stringify(data):undefined}),{DB:db,USER_PASSWORD_HASHES:JSON.stringify(credentials),...searchEnv,ASSETS:{fetch:async()=>new Response('Unexpected asset request',{status:500})}},{waitUntil:()=>{}} as any) as Response};}
test('password-only login, session cookies, progress isolation, settings and logout',async()=>{
  const {request,sqlite}=await setup();try{
    assert.equal((await request('me')).status,401);
    const login=await request('login','POST',{password:'alice'.repeat(10)});assert.equal(login.status,200);
    const cookie=login.headers.get('set-cookie')!;assert.match(cookie,/HttpOnly/);assert.match(cookie,/Secure/);assert.match(cookie,/SameSite=Strict/);
    const auth=cookie.split(';')[0];
    assert.equal((await request('progress','PUT',{id:'episode1',position:55},auth)).status,200);
    assert.equal((await request('settings','PUT',{speed:1.5,skipBack:10,skipForward:45},auth)).status,200);
    const me=await (await request('me','GET',undefined,auth)).json() as any;assert.equal(me.progress.episode1,55);assert.equal(me.settings.speed,1.5);
    const bob=await request('login','POST',{password:'bob'.repeat(10)});const bobAuth=bob.headers.get('set-cookie')!.split(';')[0];
    assert.deepEqual((await (await request('me','GET',undefined,bobAuth)).json() as any).progress,{});
    assert.equal((await request('progress','PUT',{id:'episode1',position:-1},auth)).status,400);
    assert.equal((await request('settings','PUT',{speed:4,skipBack:10,skipForward:45},auth)).status,400);
    assert.equal((await request('logout','POST',{},auth,'https://evil.test')).status,403);
    await request('logout','POST',{},auth);assert.equal((await request('me','GET',undefined,auth)).status,401);
  }finally{sqlite.close();}
});
test('expired sessions fail and repeated failed logins are rate limited',async()=>{
  const {request,sqlite}=await setup();try{
    sqlite.prepare('INSERT INTO sessions VALUES(?,?,?)').run(await digest('expired'),'alice',1);
    assert.equal((await request('me','GET',undefined,'session=expired')).status,401);
    for(let i=0;i<10;i++)assert.equal((await request('login','POST',{password:'wrong'.repeat(10)})).status,401);
    assert.equal((await request('login','POST',{password:'wrong'.repeat(10)})).status,429);
  }finally{sqlite.close();}
});
test('secret rotation preserves libraries and revokes old sessions, including after a new login',async()=>{
  const {request,sqlite,credentials}=await setup();try{
    const login=await request('login','POST',{password:'alice'.repeat(10)});const auth=login.headers.get('set-cookie')!.split(';')[0];
    sqlite.prepare('INSERT INTO subscriptions VALUES(?,?,?,?,?)').run('alice','https://feeds.example.org/rss','Show','Host','');
    credentials.alice=await hashPassword('new'.repeat(10));
    assert.equal((await request('me','GET',undefined,auth)).status,401);
    assert.equal((await request('login','POST',{password:'alice'.repeat(10)})).status,401);
    assert.equal((await request('login','POST',{password:'new'.repeat(10)})).status,200);
    assert.equal((await request('me','GET',undefined,auth)).status,401);
    assert.equal(sqlite.prepare('SELECT count(*) AS n FROM subscriptions WHERE user_id=?').get('alice')!.n,1);
  }finally{sqlite.close();}
});
test('rejects oversized JSON and private RSS URLs',async()=>{
  const {request,sqlite}=await setup();try{
    assert.equal((await request('login','POST',{password:'a'.repeat(17000)})).status,413);
    const login=await request('login','POST',{password:'alice'.repeat(10)});const auth=login.headers.get('set-cookie')!.split(';')[0];
    assert.equal((await request('feed?url=http://127.0.0.1/rss','GET',undefined,auth)).status,400);
  }finally{sqlite.close();}
});
test('search requires both Podcast Index credentials',async()=>{
  for(const env of [{},{PODCAST_INDEX_KEY:'test-key'},{PODCAST_INDEX_SECRET:'test-secret'}]){
    const {request,sqlite}=await setup(env);
    try{
      const login=await request('login','POST',{password:'alice'.repeat(10)}),auth=login.headers.get('set-cookie')!.split(';')[0];
      const response=await request('search?q=casefile','GET',undefined,auth);
      assert.equal(response.status,503);
      assert.match((await response.json() as any).error,/PODCAST_INDEX_KEY and PODCAST_INDEX_SECRET/);
    }finally{sqlite.close();}
  }
});
test('Podcast Index search signs requests and returns only podcasts with feeds',async()=>{
  const originalFetch=globalThis.fetch, originalCaches=Object.getOwnPropertyDescriptor(globalThis,'caches');
  const hits: string[]=[];
  Object.defineProperty(globalThis,'caches',{configurable:true,value:{default:{match:async()=>undefined,put:async()=>{}}}});
  globalThis.fetch=async(input,init)=>{
    const url=String(input);
    if(url.includes('cloudflare-dns.com'))return Response.json({Answer:[{type:1,data:'1.1.1.1'}]});
    assert.equal(new URL(url).hostname,'api.podcastindex.org');
    const headers=new Headers(init?.headers),timestamp=headers.get('X-Auth-Date')!;
    assert.equal(headers.get('X-Auth-Key'),'test-key');assert.equal(headers.get('User-Agent'),'Groovy/1.0');
    assert.ok(Math.abs(Number(timestamp)-Date.now()/1000)<5);
    const {createHash}=await import('node:crypto');
    assert.equal(headers.get('Authorization'),createHash('sha1').update('test-key'+'test-secret'+timestamp).digest('hex'));
    hits.push(url);
    return Response.json({feeds:[{title:'A show',author:'A host',url:'https://feeds.example.org/show',artwork:'https://cdn.example.org/art.jpg'},{title:'No feed'}]});
  };
  const {request,sqlite}=await setup({PODCAST_INDEX_KEY:'test-key',PODCAST_INDEX_SECRET:'test-secret'});
  try{
    const login=await request('login','POST',{password:'alice'.repeat(10)}), auth=login.headers.get('set-cookie')!.split(';')[0];
    assert.equal((await request('search?q=hi')).status,401);
    assert.equal((await request('search?q=x','GET',undefined,auth)).status,400);
    const response=await request('search?q=science%20%26%20space','GET',undefined,auth);assert.equal(response.status,200);
    assert.deepEqual(await response.json(),[{url:'https://feeds.example.org/show',title:'A show',author:'A host',artwork:'https://cdn.example.org/art.jpg'}]);
    assert.equal(hits.length,1);
    const query=new URL(hits[0]);assert.equal(query.searchParams.get('q'),'science & space');assert.equal(query.pathname,'/api/1.0/search/byterm');assert.equal(query.searchParams.get('max'),'30');
  }finally{sqlite.close();globalThis.fetch=originalFetch;if(originalCaches)Object.defineProperty(globalThis,'caches',originalCaches);else delete (globalThis as any).caches;}
});
test('resume history excludes completed episodes and stays isolated per account',async()=>{
  const {request,sqlite}=await setup();
  const playback={episode:{id:'one',title:'Episode',audio:'https://cdn.example.org/one.mp3',artwork:'',duration:100,description:'',date:''},podcast:{url:'https://feeds.example.org/rss',title:'Show',author:'Host',artwork:''}};
  try{
    const login=await request('login','POST',{password:'alice'.repeat(10)}),auth=login.headers.get('set-cookie')!.split(';')[0];
    assert.equal((await request('progress','PUT',{id:'one',position:40,playback,completed:false},auth)).status,200);
    const second={...playback,episode:{...playback.episode,id:'two'}};
    await request('progress','PUT',{id:'two',position:20,playback:second,completed:false},auth);
    sqlite.prepare('UPDATE progress SET updated=1 WHERE episode_id=?').run('one');
    let me=await (await request('me','GET',undefined,auth)).json() as any;
    assert.deepEqual(me.history.map((entry:any)=>entry.episode.id),['two','one']);assert.equal(me.history[1].updatedAt,1);assert.equal(me.history[0].podcast.title,'Show');assert.equal(me.history[0].completed,false);assert.deepEqual(me.completed,{one:false,two:false});assert.deepEqual(me.resume.map((r:any)=>r.id),['two','one']);assert.equal(me.resume[0].playback.episode.title,'Episode');assert.equal(me.resume[0].position,20);
    await request('progress','PUT',{id:'two',position:100,playback:second,completed:true},auth);
    me=await (await request('me','GET',undefined,auth)).json() as any;assert.deepEqual(me.resume.map((r:any)=>r.id),['one']);assert.equal(me.completed.two,true);assert.equal(me.history[0].completed,true);assert.deepEqual(me.episodePodcasts.two,playback.podcast);
    assert.equal((await request('progress','PUT',{id:'one',position:20,playback:{...playback,episode:{...playback.episode,audio:'javascript:alert(1)'}}},auth)).status,400);
    const bob=await request('login','POST',{password:'bob'.repeat(10)});const bobAuth=bob.headers.get('set-cookie')!.split(';')[0];
    const bobState=await (await request('me','GET',undefined,bobAuth)).json() as any;assert.deepEqual(bobState.history,[]);assert.deepEqual(bobState.resume,[]);assert.deepEqual(bobState.completed,{});assert.deepEqual(bobState.episodePodcasts,{});
    await request('progress','PUT',{id:'two',position:0,playback:second,completed:false},auth);
    me=await (await request('me','GET',undefined,auth)).json() as any;assert.equal(me.resume[0].id,'two');assert.equal(me.completed.two,false);assert.equal(me.progress.two,0);assert.deepEqual(me.history.map((entry:any)=>entry.episode.id),['one']);
  }finally{sqlite.close();}
});
test('short chosen passwords provision accounts on first login and removed users lose access',async()=>{
  const {request,sqlite,credentials}=await setup();
  try{
    sqlite.prepare('DELETE FROM users WHERE id=?').run('alice');
    credentials.alice=await hashPassword('short');
    const login=await request('login','POST',{password:'short'});assert.equal(login.status,200);
    const auth=login.headers.get('set-cookie')!.split(';')[0];assert.equal((await request('me','GET',undefined,auth)).status,200);
    delete (credentials as Partial<typeof credentials>).alice;
    assert.equal((await request('me','GET',undefined,auth)).status,401);
    assert.equal((await request('login','POST',{password:'short'})).status,401);
  }finally{sqlite.close();}
});
test('duplicate passwords never select an arbitrary account',async()=>{
  const {request,sqlite,credentials}=await setup();
  try{
    credentials.bob=await hashPassword('alice'.repeat(10));
    assert.equal((await request('login','POST',{password:'alice'.repeat(10)})).status,401);
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM sessions').get()!.n,0);
  }finally{sqlite.close();}
});

test('podcast speed overrides persist per account without replacing the default speed',async()=>{
  const {request,sqlite}=await setup();
  try{
    const login=await request('login','POST',{password:'alice'.repeat(10)}),auth=login.headers.get('set-cookie')!.split(';')[0];
    const defaults={speed:1.25,skipBack:15,skipForward:30};
    const podcastUrl='https://feeds.example.org/show';
    assert.equal((await request('settings','PUT',defaults,auth)).status,200);
    assert.equal((await request('settings','PUT',{...defaults,speed:1.75,podcastUrl,override:true},auth)).status,200);
    let me=await(await request('me','GET',undefined,auth)).json() as any;
    assert.equal(me.settings.speed,1.25);assert.deepEqual(me.podcastSpeeds,{[podcastUrl]:1.75});
    const bob=await request('login','POST',{password:'bob'.repeat(10)}),bobAuth=bob.headers.get('set-cookie')!.split(';')[0];
    assert.deepEqual((await(await request('me','GET',undefined,bobAuth)).json() as any).podcastSpeeds,{});
    assert.equal((await request('settings','PUT',{...defaults,speed:2,podcastUrl,override:true},auth)).status,200);
    assert.equal((await request('settings','PUT',{...defaults,speed:.75},auth)).status,200);
    const again=await request('login','POST',{password:'alice'.repeat(10)}),againAuth=again.headers.get('set-cookie')!.split(';')[0];
    me=await(await request('me','GET',undefined,againAuth)).json() as any;
    assert.equal(me.settings.speed,.75);assert.equal(me.podcastSpeeds[podcastUrl],2);
    for(const extra of [{podcastUrl},{override:true},{podcastUrl,override:'yes'},{podcastUrl:'http://127.0.0.1/feed',override:true},{podcastUrl,override:true,speed:2.1},{podcastUrl,override:true,speed:null}]){
      assert.equal((await request('settings','PUT',{...defaults,...extra},auth)).status,400);
    }
    assert.equal((await request('settings','PUT',{...defaults,podcastUrl,override:false},auth)).status,200);
    me=await(await request('me','GET',undefined,auth)).json() as any;
    assert.deepEqual(me.podcastSpeeds,{});assert.equal(me.settings.speed,1.25);
  }finally{sqlite.close();}
});

test('feed requests accept more than 4 MB and enforce the 12 MB feed limit',async()=>{
  const originalFetch=globalThis.fetch,originalCaches=Object.getOwnPropertyDescriptor(globalThis,'caches');
  Object.defineProperty(globalThis,'caches',{configurable:true,value:{default:{match:async()=>undefined,put:async()=>{}}}});
  let oversized=false;
  globalThis.fetch=async(input)=>{
    if(String(input).includes('cloudflare-dns.com'))return Response.json({Answer:[{type:1,data:'1.1.1.1'}]});
    return new Response(oversized?new Uint8Array(12_000_001):`<rss><channel><title>Large podcast</title><!--${'x'.repeat(4_000_000)}--><item><title>Episode</title><enclosure url="https://example.org/audio.mp3" type="audio/mpeg"/></item></channel></rss>`);
  };
  const {request,sqlite}=await setup();
  try{
    const login=await request('login','POST',{password:'alice'.repeat(10)}),auth=login.headers.get('set-cookie')!.split(';')[0];
    const path='feed?url='+encodeURIComponent('https://feeds.example.org/show');
    const response=await request(path,'GET',undefined,auth);
    assert.equal(response.status,200);assert.equal((await response.json() as any).episodes.length,1);
    oversized=true;
    const rejected=await request(path,'GET',undefined,auth);
    assert.equal(rejected.status,413);assert.match((await rejected.json() as any).error,/12 MB maximum/);
  }finally{sqlite.close();globalThis.fetch=originalFetch;if(originalCaches)Object.defineProperty(globalThis,'caches',originalCaches);else delete (globalThis as any).caches;}
});

test('artwork proxy requires login, limits downloads, and serves only public raster images',async()=>{
  const originalFetch=globalThis.fetch;
  let mode='jpeg';
  globalThis.fetch=async(input)=>{
    if(String(input).includes('cloudflare-dns.com'))return Response.json({Answer:[{type:1,data:mode==='private'?'127.0.0.1':'1.1.1.1'}]});
    if(mode==='redirect')return new Response(null,{status:302,headers:{location:'http://127.0.0.1/image'}});
    if(mode==='oversized')return new Response(new Uint8Array(4_000_001));
    if(mode==='svg')return new Response('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    return new Response(new Uint8Array([255,216,255,224]));
  };
  const {request,sqlite}=await setup();
  const path='artwork?url='+encodeURIComponent('https://cdn.example.org/art.jpg');
  try{
    assert.equal((await request(path)).status,401);
    const login=await request('login','POST',{password:'alice'.repeat(10)}),auth=login.headers.get('set-cookie')!.split(';')[0];
    const response=await request(path,'GET',undefined,auth);
    assert.equal(response.status,200);assert.equal(response.headers.get('Content-Type'),'image/jpeg');
    assert.equal(response.headers.get('X-Content-Type-Options'),'nosniff');
    assert.equal(response.headers.get('Cache-Control'),'private,max-age=86400');
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()),new Uint8Array([255,216,255,224]));
    assert.equal((await request('artwork?url='+encodeURIComponent('http://127.0.0.1/art'),'GET',undefined,auth)).status,400);
    for(const [scenario,status] of [['private',400],['redirect',400],['oversized',413],['svg',415]] as const){
      mode=scenario;assert.equal((await request(path,'GET',undefined,auth)).status,status);
    }
  }finally{sqlite.close();globalThis.fetch=originalFetch;}
});

test('published artwork is a stable public JPEG while uploads require a valid session',async()=>{
  const {request,sqlite}=await setup();
  const bytes=new Uint8Array([255,216,255,192,0,17,8,2,0,2,0,3,1,17,0,2,17,0,3,17,0,255,217]);
  const jpeg=Buffer.from(bytes).toString('base64');
  try{
    assert.equal((await request('artwork','POST',{jpeg})).status,401);
    const login=await request('login','POST',{password:'alice'.repeat(10)}),auth=login.headers.get('set-cookie')!.split(';')[0];
    const published=await request('artwork','POST',{jpeg},auth);
    assert.equal(published.status,200);
    const {url}=await published.json() as {url:string};
    assert.match(url,/^https:\/\/groovy\.test\/api\/artwork\/[a-f0-9]{64}\.jpg$/);
    assert.deepEqual(await(await request('artwork','POST',{jpeg},auth)).json(),{url});
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM public_artwork').get()!.count,1);
    for(const invalid of ['not base64!',Buffer.from('<svg/>').toString('base64'),Buffer.from(bytes.map((byte,index)=>index===8?1:byte)).toString('base64')]){
      assert.equal((await request('artwork','POST',{jpeg:invalid},auth)).status,400);
    }
    assert.equal((await request('artwork','POST',{jpeg:'A'.repeat(512_000)},auth)).status,413);
    assert.equal((await request('artwork','POST',{jpeg},auth,'https://evil.test')).status,403);
    await request('logout','POST',{},auth);
    const image=await request(new URL(url).pathname.slice(5));
    assert.equal(image.status,200);assert.equal(image.headers.get('Content-Type'),'image/jpeg');
    assert.match(image.headers.get('Cache-Control')!,/public.*immutable/);
    assert.equal(image.headers.get('X-Content-Type-Options'),'nosniff');
    assert.deepEqual(new Uint8Array(await image.arrayBuffer()),bytes);
    const head=await request(new URL(url).pathname.slice(5),'HEAD',undefined,'','');
    assert.equal(head.status,200);assert.equal(head.headers.get('Content-Length'),String(bytes.length));assert.equal(await head.text(),'');
    assert.equal((await request('artwork/'+ '0'.repeat(64)+'.jpg')).status,404);
  }finally{sqlite.close();}
});

test('library layout persists per account without changing playback settings',async()=>{
  const {request,sqlite}=await setup();try{
    const login=await request('login','POST',{password:'alice'.repeat(10)});
    const auth=login.headers.get('set-cookie')!.split(';')[0];
    const me=async(cookie=auth)=>await (await request('me','GET',undefined,cookie)).json() as any;
    assert.equal((await me()).libraryView,'tiles');
    assert.equal((await request('settings','PUT',{libraryView:'list'},auth)).status,200);
    assert.equal((await me()).libraryView,'list');
    assert.equal((await me()).settings.speed,1);
    await request('settings','PUT',{speed:1.5,skipBack:15,skipForward:30},auth);
    assert.equal((await me()).libraryView,'list');
    assert.equal((await request('settings','PUT',{libraryView:'grid'},auth)).status,400);
    const bob=await request('login','POST',{password:'bob'.repeat(10)});
    assert.equal((await me(bob.headers.get('set-cookie')!.split(';')[0])).libraryView,'tiles');
    const again=await request('login','POST',{password:'alice'.repeat(10)});
    assert.equal((await me(again.headers.get('set-cookie')!.split(';')[0])).libraryView,'list');
    await request('settings','PUT',{libraryView:'tiles'},auth);
    assert.equal((await me()).libraryView,'tiles');
  }finally{sqlite.close();}
});

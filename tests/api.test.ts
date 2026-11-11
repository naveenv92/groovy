import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import worker from '../worker/index';
import { digest } from '../worker/lib';
import { hashPassword } from '../worker/password.mjs';
const fixtureHashes = {alice:await hashPassword('alice'.repeat(10)),bob:await hashPassword('bob'.repeat(10))};
function database() {
  const sqlite=new DatabaseSync(':memory:');sqlite.exec(readFileSync('migrations/0001_initial.sql','utf8'));sqlite.exec(readFileSync('migrations/0002_resume_playback.sql','utf8'));
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
    assert.deepEqual(me.resume.map((r:any)=>r.id),['two','one']);assert.equal(me.resume[0].playback.episode.title,'Episode');assert.equal(me.resume[0].position,20);
    await request('progress','PUT',{id:'two',position:100,playback:second,completed:true},auth);
    me=await (await request('me','GET',undefined,auth)).json() as any;assert.deepEqual(me.resume.map((r:any)=>r.id),['one']);
    assert.equal((await request('progress','PUT',{id:'one',position:20,playback:{...playback,episode:{...playback.episode,audio:'javascript:alert(1)'}}},auth)).status,400);
    const bob=await request('login','POST',{password:'bob'.repeat(10)});const bobAuth=bob.headers.get('set-cookie')!.split(';')[0];
    assert.deepEqual((await (await request('me','GET',undefined,bobAuth)).json() as any).resume,[]);
    await request('progress','PUT',{id:'two',position:5,playback:second,completed:false},auth);
    me=await (await request('me','GET',undefined,auth)).json() as any;assert.equal(me.resume[0].id,'two');
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

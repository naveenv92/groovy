import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { onRequest } from '../functions/api/[[path]]';
import { digest } from '../functions/lib';
function database() {
  const sqlite=new DatabaseSync(':memory:');sqlite.exec(readFileSync('migrations/0001_initial.sql','utf8'));sqlite.exec(readFileSync('migrations/0002_resume_playback.sql','utf8'));
  const wrap=(sql:string,values:unknown[]=[])=>({bind:(...v:unknown[])=>wrap(sql,v),first:async()=>sqlite.prepare(sql).get(...values as any[])||null,run:async()=>sqlite.prepare(sql).run(...values as any[]),all:async()=>({results:sqlite.prepare(sql).all(...values as any[])})});
  return {sqlite,db:{prepare:(sql:string)=>wrap(sql),batch:async(statements:any[])=>Promise.all(statements.map(s=>s.all()))}};
}
async function setup(){const {sqlite,db}=database();for(const id of ['alice','bob'])sqlite.prepare('INSERT INTO users(id,password_hash) VALUES(?,?)').run(id,await digest(id.repeat(10)));return {sqlite,request:async(path:string,method='GET',data?:unknown,cookie='',origin='https://groovy.test')=>await onRequest({request:new Request(`https://groovy.test/api/${path}`,{method,headers:{'Origin':origin,'Content-Type':'application/json','Cookie':cookie},body:data?JSON.stringify(data):undefined}),env:{DB:db},waitUntil:()=>{}} as any) as Response};}
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
test('manual account rotation keeps subscriptions and revokes existing sessions',async()=>{
  const {request,sqlite}=await setup();try{
    const login=await request('login','POST',{password:'alice'.repeat(10)});const auth=login.headers.get('set-cookie')!.split(';')[0];
    sqlite.prepare('INSERT INTO subscriptions VALUES(?,?,?,?,?)').run('alice','https://feeds.example.org/rss','Show','Host','');
    sqlite.prepare('UPDATE users SET password_hash=? WHERE id=?').run(await digest('new'.repeat(10)),'alice');sqlite.prepare('DELETE FROM sessions WHERE user_id=?').run('alice');
    assert.equal((await request('me','GET',undefined,auth)).status,401);
    assert.equal((await request('login','POST',{password:'alice'.repeat(10)})).status,401);
    assert.equal((await request('login','POST',{password:'new'.repeat(10)})).status,200);
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
test('Apple search needs no credentials and returns only podcasts with feeds',async()=>{
  const originalFetch=globalThis.fetch, originalCaches=Object.getOwnPropertyDescriptor(globalThis,'caches');
  const hits: string[]=[];
  Object.defineProperty(globalThis,'caches',{configurable:true,value:{default:{match:async()=>undefined,put:async()=>{}}}});
  globalThis.fetch=async(input)=>{
    const url=String(input);
    if(url.includes('cloudflare-dns.com'))return Response.json({Answer:[{type:1,data:'1.1.1.1'}]});
    assert.equal(new URL(url).hostname,'itunes.apple.com');
    hits.push(url);
    return Response.json({results:[{collectionName:'A show',artistName:'A host',feedUrl:'https://feeds.example.org/show',artworkUrl600:'https://cdn.example.org/art.jpg'},{collectionName:'No feed'}]});
  };
  const {request,sqlite}=await setup();
  try{
    const login=await request('login','POST',{password:'alice'.repeat(10)}), auth=login.headers.get('set-cookie')!.split(';')[0];
    assert.equal((await request('search?q=hi')).status,401);
    assert.equal((await request('search?q=x','GET',undefined,auth)).status,400);
    const response=await request('search?q=science%20%26%20space','GET',undefined,auth);assert.equal(response.status,200);
    assert.deepEqual(await response.json(),[{url:'https://feeds.example.org/show',title:'A show',author:'A host',artwork:'https://cdn.example.org/art.jpg'}]);
    assert.equal(hits.length,1);
    const query=new URL(hits[0]);assert.equal(query.searchParams.get('term'),'science & space');assert.equal(query.searchParams.get('entity'),'podcast');
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

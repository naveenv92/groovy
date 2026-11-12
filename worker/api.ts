import { readPasswordHashes, verifyPassword } from './password.mjs';
import { digest, fail, fetchLimited, fetchLimitedBytes, rasterImageType, isSquareArtworkJpeg, HttpError, parseFeed, publicUrl } from './lib';
export interface ApiEnv { DB: D1Database; USER_PASSWORD_HASHES?: string; PODCAST_INDEX_KEY?: string; PODCAST_INDEX_SECRET?: string }
const json = (data: unknown, status = 200, headers = {}) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
const cookie = (token: string, age: number, secure: boolean) => `session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${secure ? '; Secure' : ''}`;
export async function handleApi(request: Request, env: ApiEnv, ctx: Pick<ExecutionContext, 'waitUntil'>): Promise<Response> {
  try {
    const url = new URL(request.url), path = url.pathname.slice(5), method = request.method;
    const db = env.DB;
    if (!db) fail(503, 'Database is not configured. See the setup guide.');
    const publicArtwork=path.match(/^artwork\/([a-f0-9]{64})\.jpg$/);
    if (publicArtwork && (method==='GET'||method==='HEAD')) {
      const image=await db.prepare('SELECT jpeg FROM public_artwork WHERE id=?').bind(publicArtwork[1]).first<{jpeg:string}>();
      if (!image) return json({error:'Artwork not found.'},404);
      const bytes=Uint8Array.from(atob(image.jpeg),char=>char.charCodeAt(0));
      return new Response(method==='HEAD'?null:bytes,{headers:{'Content-Type':'image/jpeg','Content-Length':String(bytes.length),'X-Content-Type-Options':'nosniff','Access-Control-Allow-Origin':'*','Cache-Control':'public,max-age=31536000,immutable'}});
    }
    if (!['GET', 'POST', 'PUT', 'DELETE'].includes(method)) fail(405, 'Method not allowed.');
    if (method !== 'GET' && request.headers.get('Origin') !== url.origin) fail(403, 'Request origin is not allowed.');
    const body = async (): Promise<any> => {
      if (!request.headers.get('content-type')?.includes('application/json')) fail(415, 'Expected JSON.');
      const reader = request.body?.getReader(); if (!reader) fail(400, 'A JSON body is required.');
      const decoder = new TextDecoder(); let raw = '', size = 0;
      try {
        for (;;) { const {done,value} = await reader!.read(); if (done) break; size += value.byteLength; if (size > (path==='artwork'&&method==='POST'?512_000:16_384)) fail(413, 'Request is too large.'); raw += decoder.decode(value,{stream:true}); }
        raw += decoder.decode();
      } finally { await reader!.cancel(); }
      try { const parsed = JSON.parse(raw); if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) fail(400, 'Expected an object.'); return parsed; } catch { return fail(400, 'Invalid JSON.'); }
    };
    const now = Math.floor(Date.now() / 1000);
    function passwordHashes() {
      try { return readPasswordHashes(env.USER_PASSWORD_HASHES); }
      catch (error) { return fail(503,(error as Error).message); }
    }
    if (path === 'login' && method === 'POST') {
      const ipHash = await digest(request.headers.get('CF-Connecting-IP') || 'local');
      const rate = await db.prepare('INSERT INTO login_attempts(ip_hash,attempts,reset_at) VALUES(?,1,?) ON CONFLICT(ip_hash) DO UPDATE SET attempts=CASE WHEN reset_at<=? THEN 1 ELSE attempts+1 END, reset_at=CASE WHEN reset_at<=? THEN ? ELSE reset_at END RETURNING attempts').bind(ipHash, now+900, now, now, now+900).first<{attempts:number}>();
      if (rate!.attempts > 10) fail(429, 'Too many attempts. Try again in 15 minutes.');
      const { password } = await body();
      if (typeof password !== 'string' || password.length < 1 || password.length > 256) fail(401, 'Password not recognized.');
      const hashes = passwordHashes();
      let user: string | null = null;
      let matches = 0;
      // shortcut: password-only login checks every account; add usernames when the user list grows.
      for (const [id,hash] of Object.entries(hashes)) {
        if (await verifyPassword(password,hash)) { user=id; matches++; }
      }
      if (matches !== 1 || !user) fail(401,'Password not recognized.');
      const credential = await digest(hashes[user!]);
      const token = crypto.randomUUID() + crypto.randomUUID();
      await db.batch([
        db.prepare('DELETE FROM sessions WHERE user_id=? AND EXISTS(SELECT 1 FROM users WHERE id=? AND password_hash<>?)').bind(user,user,credential),
        db.prepare('INSERT INTO users(id,password_hash) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET password_hash=excluded.password_hash').bind(user,credential),
        db.prepare('INSERT INTO sessions VALUES(?,?,?)').bind(await digest(token), user, now+30*86400),
        db.prepare('DELETE FROM sessions WHERE expires<=?').bind(now),
        db.prepare('DELETE FROM login_attempts WHERE reset_at<=? OR ip_hash=?').bind(now,ipHash),
      ]);
      return json({ ok:true },200,{'Set-Cookie':cookie(token,30*86400,url.protocol==='https:')});
    }
    const token = request.headers.get('cookie')?.match(/(?:^|;\s*)session=([^;]+)/)?.[1] || '';
    const tokenHash = await digest(token);
    const session = await db.prepare('SELECT sessions.user_id,users.password_hash FROM sessions JOIN users ON users.id=sessions.user_id WHERE token_hash=? AND expires>?').bind(tokenHash,now).first<{user_id:string;password_hash:string}>();
    if (!session) fail(401, 'Please sign in.');
    const user = session!.user_id;
    const configuredHash = passwordHashes()[user];
    if (!configuredHash || await digest(configuredHash) !== session!.password_hash) fail(401,'Please sign in.');
    if (path === 'logout' && method === 'POST') {
      await db.prepare('DELETE FROM sessions WHERE token_hash=?').bind(tokenHash).run();
      return json({ok:true},200,{'Set-Cookie':cookie('',0,url.protocol==='https:')});
    }
    if (path==='artwork' && method==='POST') {
      const {jpeg}=await body();
      if (typeof jpeg!=='string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(jpeg)) fail(400,'Expected a base64 JPEG.');
      let bytes: Uint8Array;
      try {bytes=Uint8Array.from(atob(jpeg),char=>char.charCodeAt(0));}catch{return fail(400,'Invalid JPEG encoding.');}
      if (!isSquareArtworkJpeg(bytes!)) fail(400,'Artwork must be a 512×512 JPEG.');
      const id=await digest(jpeg);
      // shortcut: retain small trial JPEGs in D1; move to R2 if the artwork archive grows.
      await db.prepare('INSERT INTO public_artwork(id,jpeg) VALUES(?,?) ON CONFLICT(id) DO NOTHING').bind(id,jpeg).run();
      return json({url:`${url.origin}/api/artwork/${id}.jpg`});
    }
    if (path === 'artwork' && method === 'GET') {
      const bytes = await fetchLimitedBytes(publicUrl(url.searchParams.get('url') || ''),{'Accept':'image/jpeg,image/png,image/webp,image/gif','User-Agent':'Groovy/1.0'});
      const type = rasterImageType(bytes);
      if (!type) fail(415,'Artwork must be a JPEG, PNG, WebP, or GIF image.');
      return new Response(bytes,{headers:{'Content-Type':type!,'X-Content-Type-Options':'nosniff','Cache-Control':'private,max-age=86400'}});
    }
    if (path === 'me' && method === 'GET') {
      const results = await db.batch([
        db.prepare('SELECT library_view AS libraryView,speed,skip_back AS skipBack,skip_forward AS skipForward FROM users WHERE id=?').bind(user),
        db.prepare('SELECT url,title,author,artwork FROM subscriptions WHERE user_id=? ORDER BY title').bind(user),
        db.prepare('SELECT episode_id,position,playback,completed,updated FROM progress WHERE user_id=? ORDER BY updated DESC, rowid DESC').bind(user),
        db.prepare('SELECT url,speed FROM podcast_speeds WHERE user_id=?').bind(user),
      ]);
      const resume = results[2].results.filter((r:any)=>!r.completed).map((r:any)=>({id:r.episode_id,position:r.position,playback:r.playback?JSON.parse(r.playback):null}));
      const history = results[2].results.filter((r:any)=>r.playback&&(r.position>0||r.completed)).map((r:any)=>({...JSON.parse(r.playback),position:r.position,completed:!!r.completed,updatedAt:r.updated}));
      return json({libraryView:(results[0].results[0] as {libraryView:string}).libraryView,resume,history,episodePodcasts:Object.fromEntries(results[2].results.filter((r:any)=>r.playback).map((r:any)=>[r.episode_id,JSON.parse(r.playback).podcast])),completed:Object.fromEntries(results[2].results.map((r:any)=>[r.episode_id,!!r.completed])),podcastSpeeds:Object.fromEntries(results[3].results.map((r:any)=>[r.url,r.speed])),settings:results[0].results[0], subscriptions:results[1].results,progress:Object.fromEntries(results[2].results.map((r:any)=>[r.episode_id,r.position]))});
    }
    if (path === 'settings' && method === 'PUT') {
      const data = await body();
      if ('libraryView' in data) {
        if (data.libraryView !== 'tiles' && data.libraryView !== 'list') fail(400,'Invalid library view.');
        await db.prepare('UPDATE users SET library_view=? WHERE id=?').bind(data.libraryView,user).run();
        return json({ok:true});
      }
      const {speed,skipBack,skipForward,podcastUrl,override} = data;
      if (typeof speed !== 'number' || !Number.isFinite(speed) || speed < .5 || speed > 2 || ![skipBack,skipForward].every(v=>Number.isInteger(v)&&v>=5&&v<=120)) fail(400,'Invalid playback settings.');
      if (podcastUrl !== undefined || override !== undefined) {
        if (typeof podcastUrl !== 'string' || podcastUrl.length>2048 || typeof override !== 'boolean') fail(400,'Invalid podcast speed override.');
        const feedUrl = publicUrl(podcastUrl);
        if (override) await db.prepare('INSERT INTO podcast_speeds(user_id,url,speed) VALUES(?,?,?) ON CONFLICT(user_id,url) DO UPDATE SET speed=excluded.speed').bind(user,feedUrl,speed).run();
        else await db.batch([
          db.prepare('DELETE FROM podcast_speeds WHERE user_id=? AND url=?').bind(user,feedUrl),
          db.prepare('UPDATE users SET speed=?,skip_back=?,skip_forward=? WHERE id=?').bind(speed,skipBack,skipForward,user),
        ]);
      } else await db.prepare('UPDATE users SET speed=?,skip_back=?,skip_forward=? WHERE id=?').bind(speed,skipBack,skipForward,user).run();
      return json({ok:true});
    }
    if (path === 'progress' && method === 'PUT') {
      const {id,position,playback,completed=false} = await body();
      if (typeof id!=='string' || !id.length || id.length>4096 || typeof position!=='number' || !Number.isFinite(position) || position<0 || position>6048000) fail(400,'Invalid listening progress.');
      if (typeof completed !== 'boolean') fail(400,'Invalid completion status.');
      let snapshot = null;
      if (playback !== undefined) {
        const {episode,podcast} = playback || {};
        const isText = (value:unknown,max=2048) => typeof value==='string' && value.length<=max;
        if (!episode || !podcast || episode.id!==id || !isText(episode.title) || !isText(podcast.title) || !isText(podcast.author) || !isText(episode.audio) || !isText(podcast.url) || !isText(episode.artwork) || !isText(podcast.artwork) || typeof episode.duration!=='number' || !Number.isFinite(episode.duration) || episode.duration<0) fail(400,'Invalid episode details.');
        snapshot = JSON.stringify({episode:{id,title:episode.title,audio:publicUrl(episode.audio),artwork:episode.artwork?publicUrl(episode.artwork):'',duration:episode.duration,description:'',date:''},podcast:{url:publicUrl(podcast.url),title:podcast.title,author:podcast.author,artwork:podcast.artwork?publicUrl(podcast.artwork):''}});
      }
      await db.prepare('INSERT INTO progress(user_id,episode_id,position,updated,playback,completed) VALUES(?,?,?,?,?,?) ON CONFLICT(user_id,episode_id) DO UPDATE SET position=excluded.position,updated=excluded.updated,playback=COALESCE(excluded.playback,progress.playback),completed=excluded.completed').bind(user,id,position,Date.now(),snapshot,completed?1:0).run();
      return json({ok:true});
    }
    if (path === 'subscriptions' && ['POST','DELETE'].includes(method)) {
      const data = await body();
      if (typeof data.url!=='string') fail(400,'A feed URL is required.');
      const feedUrl = publicUrl(data.url);
      if (method === 'DELETE') await db.prepare('DELETE FROM subscriptions WHERE user_id=? AND url=?').bind(user,feedUrl).run();
      else {
        const feed = await loadFeed(feedUrl);
        await db.prepare('INSERT INTO subscriptions VALUES(?,?,?,?,?) ON CONFLICT(user_id,url) DO UPDATE SET title=excluded.title,author=excluded.author,artwork=excluded.artwork').bind(user,feedUrl,feed.title,feed.author,feed.artwork).run();
      }
      return json({ok:true});
    }
    async function cached(key: string, loader:()=>Promise<unknown>) {
      const cache = (caches as CacheStorage & { default: Cache }).default;
      const cacheRequest = new Request(`${url.origin}/_cache/${await digest(key)}`);
      const hit = await cache.match(cacheRequest);
      if (hit) return hit.json();
      const value = await loader();
      ctx.waitUntil(cache.put(cacheRequest,new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json','Cache-Control':'public,max-age=900'}})));
      return value;
    }
    async function loadFeed(feedUrl: string) {
      return await cached(`feed:all:${feedUrl}`,async()=>parseFeed(await fetchLimited(feedUrl,{'Accept':'application/rss+xml,application/xml,text/xml','User-Agent':'Groovy/1.0'},12_000_000),feedUrl)) as ReturnType<typeof parseFeed>;
    }
    if (path === 'feed' && method === 'GET') return json(await loadFeed(publicUrl(url.searchParams.get('url') || '')));
    if (path === 'search' && method === 'GET') {
      const query = url.searchParams.get('q')?.trim() || '';
      if (query.length < 2 || query.length > 100) fail(400,'Enter 2–100 characters to search.');
      if (!env.PODCAST_INDEX_KEY || !env.PODCAST_INDEX_SECRET) fail(503,'Podcast search is not configured. Set PODCAST_INDEX_KEY and PODCAST_INDEX_SECRET.');
      const results = await cached(`search:podcastindex:${query.toLowerCase()}`,async()=>{
        const timestamp = String(Math.floor(Date.now()/1000));
        const authorization = [...new Uint8Array(await crypto.subtle.digest('SHA-1',new TextEncoder().encode(env.PODCAST_INDEX_KEY!+env.PODCAST_INDEX_SECRET!+timestamp)))].map(n=>n.toString(16).padStart(2,'0')).join('');
        let raw: string;
        try {
          raw = await fetchLimited(`https://api.podcastindex.org/api/1.0/search/byterm?q=${encodeURIComponent(query)}&max=30`,{'User-Agent':'Groovy/1.0','X-Auth-Key':env.PODCAST_INDEX_KEY!,'X-Auth-Date':timestamp,'Authorization':authorization});
        } catch (error) {
          if (error instanceof HttpError && error.status===502) fail(502,error.message.replace('The publisher','Podcast Index'));
          throw error;
        }
        const data = JSON.parse(raw);
        if (!Array.isArray(data.feeds)) fail(502,'Podcast Index returned an invalid search response.');
        return data.feeds.filter((f:any)=>f && typeof f.url==='string' && f.url).map((f:any)=>({url:f.url,title:f.title || 'Untitled podcast',author:f.author || '',artwork:f.artwork || f.image || ''}));
      });
      return json(results);
    }
    return json({error:'Not found.'},404);
  } catch(error) {
    if (error instanceof HttpError) return json({error:error.message},error.status);
    console.error('API request failed',error instanceof Error ? error.name : 'UnknownError');
    return json({error:'Unable to complete the request. Please try again.'},502);
  }
}

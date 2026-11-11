import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import type { Account, Episode, Feed, Podcast, Settings } from './types';
import './style.css';
import { sortEpisodes } from './episodes';
import { seekPosition, findResume, playbackSnapshot, loadPaused } from './playback';

async function api<T>(path: string, method='GET', data?: unknown, keepalive=false): Promise<T> {
  const response = await fetch(`/api/${path}`, {method, credentials:'same-origin',keepalive,headers:data ? {'Content-Type':'application/json'} : {},body:data ? JSON.stringify(data) : undefined});
  const result: any = await response.json();
  if (!response.ok) throw new Error(result.error || 'Request failed. Please retry.');
  return result;
}
const clock = (seconds: number) => { const n = Math.floor(Number.isFinite(seconds) ? Math.max(0,seconds) : 0); return `${Math.floor(n/60)}:${String(n%60).padStart(2,'0')}`; };
const minutes = (seconds: number) => seconds ? `${Math.round(seconds/60)} min` : '';
function Icon({name,size=22}: {name:string;size?:number}) {
  const paths: Record<string,React.ReactNode> = {
    knob:<><circle cx="12" cy="12" r="7"/><path d="m12 12 3-4M4 4 2.5 2.5M12 2V0.5M20 4l1.5-1.5M2 12H.5M22 12h1.5"/></>,
    mic:<><rect x="7" y="2" width="10" height="14" rx="5"/><path d="M7 6h4m2 0h4M7 10h4m2 0h4M4 11v1a8 8 0 0 0 16 0v-1M12 20v2m-4 0h8"/></>,
    play:<path d="m9 5 11 7-11 7Z"/>,pause:<><path d="M8 5v14M16 5v14"/></>,search:<><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></>,library:<><path d="M4 4v16M9 4v16M14 5l5-1 3 15-5 1Z"/></>,plus:<path d="M12 5v14M5 12h14"/>,check:<path d="m5 12 4 4L19 6"/>,arrow:<path d="m14 5-7 7 7 7"/>,wave:<><path d="M4 10v4M8 5v14M12 8v8M16 3v18M20 9v6"/></>,settings:<><path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="15" cy="17" r="3"/></>,logout:<><path d="M9 4H4v16h5M13 12h9m-4-4 4 4-4 4"/></>,back:<><path d="M5.64 5.64A9 9 0 1 1 3 12M5.64 1.64v4h4"/></>,forward:<><path d="M18.36 5.64A9 9 0 1 0 21 12M18.36 1.64v4h-4"/></>,close:<path d="m6 6 12 12M6 18 18 6"/>,headphones:<><path d="M4 14v-2a8 8 0 0 1 16 0v2"/><rect x="3" y="12" width="4" height="8" rx="2"/><rect x="17" y="12" width="4" height="8" rx="2"/></>,link:<><path d="m10 13 4-4M9 16l-2 2a4 4 0 0 1-5-5l4-4a4 4 0 0 1 6 0m0 6a4 4 0 0 0 6 0l4-4a4 4 0 0 0-6-6l-2 2"/></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] || paths.wave}</svg>;
}
function Art({src,title,small=false}:{src:string;title:string;small?:boolean}) {
  const [failed,setFailed]=useState(false);
  useEffect(()=>setFailed(false),[src]);
  return <div className={`art ${small?'small':''}`}>{src&&!failed?<img src={src} alt={`${title} artwork`} loading="lazy" referrerPolicy="no-referrer" onError={()=>setFailed(true)}/>:<Icon name="wave" size={small?25:54}/>}</div>;
}
function SpeedSlider({speed}:{speed:number}) {
  const [value,setValue]=useState(speed);
  return <label className="speed-slider"><span className="speed-slider-heading">Playback speed <output>{value}×</output></span><input name="speed" type="range" min="0.5" max="2" step="0.25" value={value} aria-valuetext={`${value} times normal speed`} onChange={e=>setValue(Number(e.target.value))} style={{'--speed-fill':`${(value-.5)/1.5*100}%`} as React.CSSProperties}/><span className="speed-stops" aria-hidden="true">{[.5,.75,1,1.25,1.5,1.75,2].map(speed=><span key={speed} className={speed===value?'selected':''}>{speed}×</span>)}</span></label>;
}
function App() {
  const [account,setAccount]=useState<Account|null>(null),[boot,setBoot]=useState(true),[password,setPassword]=useState('');
  const [searched,setSearched]=useState(false);
  const [oldestFirst,setOldestFirst]=useState(false);
  const [playerExpanded,setPlayerExpanded]=useState(false);
  const [view,setView]=useState<'library'|'discover'>('library'),[query,setQuery]=useState(''),[rss,setRss]=useState(''),[results,setResults]=useState<Podcast[]>([]);
  const [feed,setFeed]=useState<Feed|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[settingsOpen,setSettingsOpen]=useState<false|'speed'|'all'>(false);
  const [current,setCurrent]=useState<{episode:Episode;podcast:Podcast}|null>(null),[playing,setPlaying]=useState(false),[position,setPosition]=useState(0),[duration,setDuration]=useState(0),[buffering,setBuffering]=useState(false);
  const audio=useRef<HTMLAudioElement>(null),accountRef=useRef(account),currentRef=useRef(current),restore=useRef(0),feedRequest=useRef(0),lastSave=useRef(0);
  accountRef.current=account; currentRef.current=current;
  useEffect(()=>{api<Account>('me').then(setAccount).catch(e=>{if(e.message!=='Please sign in.')setError(e.message);}).finally(()=>setBoot(false));},[]);
  useEffect(()=>{
    if (boot || !account) return;
    let cancelled=false;
    void findResume(account.resume, url=>api<Feed>(`feed?url=${encodeURIComponent(url)}`)).then(saved=>{
      if (!saved || cancelled || currentRef.current || !audio.current) return;
      const item={episode:saved.episode,podcast:saved.podcast};
      restore.current=saved.position;currentRef.current=item;setCurrent(item);
      setPosition(saved.position);setDuration(saved.episode.duration);setPlaying(false);
      loadPaused(audio.current,item,account.settings.speed);
      if('mediaSession' in navigator)navigator.mediaSession.playbackState='paused';
    });
    return()=>{cancelled=true;};
  },[boot,!!account]);
  async function action(work:()=>Promise<void>) { setBusy(true);setError('');try {await work();}catch(e){setError((e as Error).message);}finally{setBusy(false);} }
  async function refresh() { setAccount(await api<Account>('me')); }
  async function openFeed(podcast:Podcast) {
    const request=++feedRequest.current;setBusy(true);setError('');
    try { const result=await api<Feed>(`feed?url=${encodeURIComponent(podcast.url)}`);if(request===feedRequest.current){setFeed(result);setOldestFirst(false);} }
    catch(e){if(request===feedRequest.current)setError((e as Error).message);}
    finally {if(request===feedRequest.current)setBusy(false);}
  }
  async function subscribe(podcast:Podcast) {
    await action(async()=>{await api('subscriptions',subscribed(podcast.url)?'DELETE':'POST',{url:podcast.url});await refresh();});
  }
  async function signOut() {
    await action(async()=>{
      await saveProgress();audio.current?.pause();await api('logout','POST',{});
      currentRef.current=null;setCurrent(null);setAccount(null);setSettingsOpen(false);setPlayerExpanded(false);
      setFeed(null);setResults([]);setQuery('');setRss('');setSearched(false);
      if('mediaSession'in navigator){navigator.mediaSession.metadata=null;navigator.mediaSession.playbackState='none';}
    });
  }
  const subscribed=(url:string)=>account?.subscriptions.some(p=>p.url===url);
  async function saveProgress(keepalive=false) {
    const item=currentRef.current,element=audio.current;
    if (!item||!element||element.readyState<1||element.currentSrc!==item.episode.audio||!Number.isFinite(element.currentTime))return;
    const p=element.currentTime;
    setAccount(a=>a?{...a,progress:{...a.progress,[item.episode.id]:p}}:a);
    try{await api('progress','PUT',{id:item.episode.id,position:p,playback:playbackSnapshot(item,element.duration),completed:element.ended||(Number.isFinite(element.duration)&&element.duration>0&&p>=element.duration)},keepalive);}catch{setError('Progress could not sync. Check your connection; playback can continue.');}
  }
  useEffect(()=>{
    const timer=window.setInterval(()=>{if(audio.current&&!audio.current.paused)void saveProgress();},10000);
    const hide=()=>{if(document.visibilityState==='hidden')void saveProgress(true);};
    const leave=()=>void saveProgress(true);
    document.addEventListener('visibilitychange',hide);window.addEventListener('pagehide',leave);
    return()=>{clearInterval(timer);document.removeEventListener('visibilitychange',hide);window.removeEventListener('pagehide',leave);};
  },[]);
  async function play(episode:Episode,podcast:Podcast) {
    setError('');const element=audio.current!;
    if(currentRef.current?.episode.id===episode.id){toggle();return;}
    void saveProgress();element.pause();
    restore.current=accountRef.current?.progress[episode.id] || 0;
    currentRef.current={episode,podcast};setCurrent({episode,podcast});setPosition(restore.current);setDuration(episode.duration);setBuffering(true);
    element.src=episode.audio;element.playbackRate=accountRef.current?.settings.speed || 1;element.preservesPitch=true;
    try{await element.play();}catch{setBuffering(false);setError('Could not play this episode. Tap play to retry, or try another episode.');}
  }
  function expandPlayer(expanded:boolean) {
    if (document.startViewTransition && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      document.startViewTransition(()=>flushSync(()=>setPlayerExpanded(expanded)));
    } else setPlayerExpanded(expanded);
  }
  function toggle(){const a=audio.current;if(!a||!currentRef.current)return;if(a.paused)a.play().catch(()=>setError('Playback failed. The publisher may be unavailable.'));else a.pause();}
  function seek(value:number){const a=audio.current;if(!a||a.readyState<1)return;const next=seekPosition(value,a.duration);try{a.currentTime=next;setPosition(next);updatePosition();}catch{setError('This episode cannot seek to that position yet.');}}
  function skip(direction:number){seek((audio.current?.currentTime||0)+direction*(direction<0?(accountRef.current?.settings.skipBack||15):(accountRef.current?.settings.skipForward||30)));}
  function updatePosition(){const a=audio.current;if('mediaSession'in navigator&&a&&Number.isFinite(a.duration)&&a.duration>0){try{navigator.mediaSession.setPositionState({duration:a.duration,playbackRate:a.playbackRate,position:Math.min(a.currentTime,a.duration)});}catch{/* Browser may not support position state. */}}}
  async function settings(next:Settings){const previous=accountRef.current?.settings;if(!previous)return;setAccount(a=>a?{...a,settings:next}:a);if(audio.current){audio.current.playbackRate=next.speed;updatePosition();}try{await api('settings','PUT',next);}catch(e){setAccount(a=>a?{...a,settings:previous}:a);if(audio.current)audio.current.playbackRate=previous.speed;setError((e as Error).message);}}
  useEffect(()=>{
    if(!current||!('mediaSession'in navigator))return;
    const {episode,podcast}=current;
    navigator.mediaSession.metadata=new MediaMetadata({title:episode.title,artist:podcast.title,album:podcast.title,artwork:episode.artwork?[{src:episode.artwork}]:[]});
    const handlers: [MediaSessionAction,MediaSessionActionHandler][]=[['play',()=>{void audio.current?.play().catch(()=>setError('Tap play to resume.'));}],['pause',()=>audio.current?.pause()],['seekbackward',d=>d.seekOffset?seek((audio.current?.currentTime||0)-d.seekOffset):skip(-1)],['seekforward',d=>d.seekOffset?seek((audio.current?.currentTime||0)+d.seekOffset):skip(1)],['seekto',d=>{if(d.seekTime!==undefined)seek(d.seekTime);}]];
    for(const [name,handler]of handlers){try{navigator.mediaSession.setActionHandler(name,handler);}catch{/* Unsupported action on this browser. */}}
    return()=>{for(const [name]of handlers){try{navigator.mediaSession.setActionHandler(name,null);}catch{}}};
  },[current]);
  useEffect(()=>{
    if(!settingsOpen&&!playerExpanded)return;
    const previous=document.activeElement as HTMLElement|null;
    const dialog=document.querySelector<HTMLElement>(settingsOpen?'.modal':'.player-expanded');
    const overflow=document.body.style.overflow;
    document.body.style.overflow='hidden';
    dialog?.querySelector<HTMLButtonElement>('button')?.focus();
    const key=(e:KeyboardEvent)=>{
      if(e.key==='Escape'){if(settingsOpen)setSettingsOpen(false);else expandPlayer(false);return;}
      if(e.key!=='Tab'||!dialog)return;
      const items=Array.from(dialog.querySelectorAll<HTMLElement>('button,input,select'));
      const first=items[0],last=items[items.length-1];
      if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}
      else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
    };
    document.addEventListener('keydown',key);return()=>{document.removeEventListener('keydown',key);document.body.style.overflow=overflow;(playerExpanded&&!settingsOpen?document.querySelector<HTMLButtonElement>('button.now-playing'):previous)?.focus();};
  },[settingsOpen,playerExpanded]);
  const changeView=(next:'library'|'discover')=>{feedRequest.current++;setBusy(false);setView(next);setFeed(null);setError('');};
  const player=<audio ref={audio} preload="metadata" onLoadedMetadata={()=>{const a=audio.current!;setDuration(Number.isFinite(a.duration)?a.duration:currentRef.current?.episode.duration||0);if(restore.current){const p=restore.current;restore.current=0;seek(p);}a.playbackRate=accountRef.current?.settings.speed||1;updatePosition();void saveProgress();}} onTimeUpdate={()=>{setPosition(audio.current?.currentTime||0);if(Date.now()-lastSave.current>1000){updatePosition();lastSave.current=Date.now();}}} onPlay={()=>{setPlaying(true);if('mediaSession'in navigator)navigator.mediaSession.playbackState='playing';void saveProgress();}} onPause={()=>{setPlaying(false);if('mediaSession'in navigator)navigator.mediaSession.playbackState='paused';void saveProgress();}} onWaiting={()=>setBuffering(true)} onPlaying={()=>setBuffering(false)} onCanPlay={()=>setBuffering(false)} onEnded={()=>{setPlaying(false);void saveProgress();}} onError={()=>{setBuffering(false);setPlaying(false);setError('This audio could not load. Retry playback or choose another episode.');}}/>;
  const nowPlaying=current&&<><Art src={current.episode.artwork||current.podcast.artwork} title={current.podcast.title} small={!playerExpanded}/><div><strong id="player-title">{current.episode.title}</strong><span>{current.podcast.title}</span></div></>;
  if(boot)return <div className="boot"><Icon name="wave" size={40}/><p>Loading Groovy…</p></div>;
  if(!account)return <div className="login"><div className="login-story"><div className="brand"><Icon name="mic" size={30}/>groovy<span className="brand-dot">.</span></div><div><span className="eyebrow">A LITTLE LESS NOISE</span><h1>Good stories.<br/>Your own pace.</h1><p>A home for the voices that stay with you.</p><div className="sound-art" aria-hidden="true">{Array.from({length:27},(_,i)=><i key={i} style={{height:`${22+Math.sin(i*.65)**2*110}px`}}/>)}</div></div><span className="story-bottom">PRESS PLAY. GET SOMEWHERE NEW.</span></div><main className="login-form"><span className="pill"><span/> YOUR LISTENING SPACE</span><h2>Welcome back.</h2><p>Great listening starts here. Enter your personal password to make yourself at home.</p><form onSubmit={e=>{e.preventDefault();void action(async()=>{await api('login','POST',{password});await refresh();setPassword('');});}}><label htmlFor="password">Your password</label><input id="password" type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} required placeholder="Enter your personal password"/><button className="primary" disabled={busy}>{busy?'Signing in…':'Start listening'} <span>→</span></button></form>{error&&<p className="error" role="alert">{error}</p>}<p className="fine">Invite only, for now. Use the password shared with you by the app owner.</p><div className="login-features"><span><Icon name="headphones" size={18}/> Your pace</span><span><Icon name="wave" size={18}/> Your podcasts</span></div></main></div>;
  return <div className={`app ${current?'has-player':''}`}>{player}<aside className="sidebar" inert={playerExpanded||!!settingsOpen}><div className="brand"><Icon name="mic" size={28}/>groovy<span className="brand-dot">.</span></div><span className="nav-label">YOUR SPACE</span><nav><button className={view==='library'?'active':''} onClick={()=>changeView('library')}><Icon name="library"/>My library<span>{account.subscriptions.length}</span></button><button className={view==='discover'?'active':''} onClick={()=>changeView('discover')}><Icon name="search"/>Discover</button></nav><div className="sidebar-bottom"><button onClick={()=>setSettingsOpen('all')}><Icon name="settings"/>Playback settings</button><button onClick={()=>void signOut()}><Icon name="logout"/>Sign out</button></div></aside><div className="workspace" inert={playerExpanded||!!settingsOpen}><header className="topbar"><button className="avatar" onClick={()=>setSettingsOpen('all')} aria-label="Open playback settings"><Icon name="headphones" size={20}/></button></header><main className="content">{error&&<div className="error banner" role="alert"><span>{error}</span><button onClick={()=>setError('')} aria-label="Dismiss error"><Icon name="close" size={18}/></button></div>}
    {feed?<><button className="back-link" onClick={()=>setFeed(null)}><Icon name="arrow" size={16}/>Back to {view==='library'?'library':'discovery'}</button><div className="feed-hero"><Art src={feed.artwork} title={feed.title}/><div><span className="eyebrow">PODCAST</span><h1>{feed.title}</h1><p className="author">{feed.author}</p><p className="feed-description">{feed.description}</p><button className={subscribed(feed.url)?'secondary':'primary'} disabled={busy} onClick={()=>void subscribe(feed)}><Icon name={subscribed(feed.url)?'check':'plus'} size={18}/>{subscribed(feed.url)?'Following · Unfollow':'Follow podcast'}</button></div></div><div className="section-heading"><h2>Episodes <span className="count">{feed.episodes.length}</span></h2><label className="episode-sort">Sort: <select aria-label="Episode order" value={oldestFirst?'oldest':'newest'} onChange={e=>setOldestFirst(e.target.value==='oldest')}><option value="newest">Newest first</option><option value="oldest">Oldest first</option></select></label></div><div className="episode-list">{feed.episodes.length===0&&<p className="muted">This feed has no playable audio episodes.</p>}{sortEpisodes(feed.episodes,oldestFirst).map(ep=>{const active=current?.episode.id===ep.id;const saved=account.progress[ep.id]||0;const date=new Date(ep.date);return <article className={`episode ${active?'selected':''}`} key={ep.id}><button className={`episode-play ${active?'is-active':''}`} onClick={()=>void play(ep,feed)} aria-label={`${active&&playing?'Pause':'Play'} ${ep.title}`}><Icon name={active&&playing?'pause':'play'} size={19}/></button><div className="episode-body"><div className="episode-meta">{!Number.isNaN(date.getTime())&&date.toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'})}{ep.duration>0&&<><span>·</span>{minutes(ep.duration)}</>}{saved>0&&<span className="progress-label">{clock(saved)} listened</span>}</div><h3><button onClick={()=>void play(ep,feed)}>{ep.title}</button></h3><p>{ep.description}</p></div></article>;})}</div></>:<><div className="page-heading"><div><h1>{view==='library'?'Your library.':'Find your next favorite.'}</h1>{view==='discover'&&<p>Big ideas, small discoveries, and everything in between.</p>}</div>{view==='library'&&<button className="secondary" onClick={()=>changeView('discover')}><Icon name="plus" size={18}/>Find podcasts</button>}</div>
    {view==='library'?<><div className="section-heading"><h2>Following <span className="count">{account.subscriptions.length}</span></h2><span>Your personal collection</span></div>{account.subscriptions.length?<div className="podcast-grid">{account.subscriptions.map(p=><button className="podcast-card" key={p.url} onClick={()=>void openFeed(p)} disabled={busy}><Art src={p.artwork} title={p.title}/><h3>{p.title}</h3><p>{p.author||'Independent podcast'}</p></button>)}</div>:<div className="empty"><div className="empty-icon"><Icon name="library" size={30}/></div><h3>Your next obsession starts here.</h3><p>Follow a podcast to give it a home in your library.</p><button className="primary" onClick={()=>changeView('discover')}><Icon name="search" size={18}/>Explore podcasts</button></div>}</>:<><form className="search-form" onSubmit={e=>{e.preventDefault();void action(async()=>{setResults(await api<Podcast[]>(`search?q=${encodeURIComponent(query)}`));setSearched(true);});}}><Icon name="search"/><input aria-label="Search podcasts" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search podcasts, topics, or people" minLength={2} maxLength={100} required/><button className="primary" disabled={busy}>{busy?'Searching…':'Search'}</button></form><div className="rss-panel"><div><Icon name="link" size={22}/><div><strong>Already have a feed?</strong><p>Add any freely accessible podcast RSS URL.</p></div></div><form onSubmit={e=>{e.preventDefault();void openFeed({url:rss,title:'',author:'',artwork:''});}}><input aria-label="RSS feed URL" type="url" required placeholder="https://example.com/feed.xml" value={rss} onChange={e=>setRss(e.target.value)}/><button className="secondary" disabled={busy}>Open feed <span>→</span></button></form></div><div className="section-heading"><h2>{results.length?'Search results':'A world of listening'}</h2><span>Search public podcasts</span></div>{results.length?<div className="podcast-grid">{results.map(p=><button className="podcast-card" key={p.url} onClick={()=>void openFeed(p)} disabled={busy}><Art src={p.artwork} title={p.title}/><h3>{p.title}</h3><p>{p.author}</p><span className="card-link">Explore episodes <span>↗</span></span></button>)}</div>:<div className="empty"><div className="empty-icon"><Icon name="search" size={30}/></div><h3>{searched?'No podcasts found.':'Follow your curiosity.'}</h3><p>Search for a favorite show or a topic you love.<br/>Public RSS feeds are always welcome here.</p></div>}</> }</>}{busy&&<p role="status" className="loading">Tuning in…</p>}<footer className="page-footer"><span>GROOVY <span className="brand-dot">●</span></span></footer></main></div>
    {current&&<section className={`player ${playerExpanded?'player-expanded':''}`} role={playerExpanded?'dialog':undefined} aria-modal={playerExpanded?true:undefined} aria-label="Audio player" inert={!!settingsOpen} onClick={e=>{if(!playerExpanded&&!(e.target as HTMLElement).closest('button,input,select,label'))expandPlayer(true);}}>
      {playerExpanded&&<header className="expanded-player-header"><button className="player-close" onClick={()=>expandPlayer(false)} aria-label="Close full player"><Icon name="arrow" size={26}/></button><span className="eyebrow">NOW PLAYING</span><Icon name="mic" size={24}/></header>}
      {playerExpanded?<div className="now-playing">{nowPlaying}</div>:<button className="now-playing" onClick={()=>expandPlayer(true)} aria-label="Open full player" aria-expanded={false}>{nowPlaying}</button>}
      {playerExpanded&&error&&<p className="error" role="alert">{error}</p>}<div className="player-center"><div className="transport"><button className="skip" onClick={()=>skip(-1)} aria-label={`Back ${account.settings.skipBack} seconds`}><Icon name="back" size={28}/><small>{account.settings.skipBack}</small></button><button className="main-play" onClick={toggle} aria-label={playing?'Pause':'Play'}><Icon name={playing?'pause':'play'} size={23}/></button><button className="skip" onClick={()=>skip(1)} aria-label={`Forward ${account.settings.skipForward} seconds`}><Icon name="forward" size={28}/><small>{account.settings.skipForward}</small></button><span className="buffering" role="status">{buffering?'Loading…':''}</span></div><div className="timeline"><span>{clock(position)}</span><input aria-label="Playback position" type="range" min="0" max={duration||0} step="1" value={Math.min(position,duration||0)} disabled={!duration} onChange={e=>seek(Number(e.target.value))} onPointerUp={()=>void saveProgress()}/><span>{clock(duration)}</span></div></div><div className="player-settings"><button className="speed-knob" onClick={()=>setSettingsOpen('speed')} aria-label={`Playback speed: ${account.settings.speed} times. Adjust speed.`}><Icon name="knob" size={24}/><span>{account.settings.speed}×</span></button><button onClick={()=>setSettingsOpen('all')} aria-label="Playback settings"><Icon name="settings"/></button></div></section>}
    {settingsOpen&&<div className="modal-backdrop" onClick={()=>setSettingsOpen(false)}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="settings-title" onClick={e=>e.stopPropagation()}><button className="modal-close" onClick={()=>setSettingsOpen(false)} aria-label="Close settings" autoFocus><Icon name="close"/></button><span className="eyebrow">MAKE IT YOURS</span><h2 id="settings-title">{settingsOpen==='speed'?'Playback speed.':'Your listening pace.'}</h2><p>Saved to your account, wherever you listen.</p><form onSubmit={e=>{e.preventDefault();const data=new FormData(e.currentTarget);void settings({speed:Number(data.get('speed')),skipBack:Number(data.get('back')??account.settings.skipBack),skipForward:Number(data.get('forward')??account.settings.skipForward)});setSettingsOpen(false);}}><SpeedSlider speed={account.settings.speed}/>{settingsOpen==='all'&&<div className="settings-row"><label>Skip back (seconds)<input type="number" name="back" min="5" max="120" required defaultValue={account.settings.skipBack}/></label><label>Skip forward (seconds)<input type="number" name="forward" min="5" max="120" required defaultValue={account.settings.skipForward}/></label></div>}<p className="fine">Pitch stays natural at every speed. Car display artwork depends on your phone and receiver.</p><button className="primary">{settingsOpen==='speed'?'Save speed':'Save preferences'}</button></form>{settingsOpen==='all'&&<button className="signout-setting" disabled={busy} onClick={()=>void signOut()}><Icon name="logout" size={16}/>Sign out</button>}</section></div>}
  </div>;
}
createRoot(document.getElementById('root')!).render(<App/>);

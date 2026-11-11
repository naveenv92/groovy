import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import type { Account, Episode, Feed, Podcast, Settings, Playback, ListeningHistory } from './types';
import './style.css';
import { filterEpisodes, sortEpisodes } from './episodes';
import { listeningStats } from './stats';
import { mediaArtwork } from './media-artwork';
import { seekPosition, playbackSpeed, findResume, playbackSnapshot, loadPaused } from './playback';

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
    tiles:<><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>,
    list:<path d="M4 6h16M4 12h16M4 18h16"/>,
    graph:<path d="M4 3v17h17M7 14l4-5 4 3 5-7"/>,
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
  const [visibleEpisodes,setVisibleEpisodes]=useState(50);
  const [visibleHistory,setVisibleHistory]=useState(50);
  const [episodeQuery,setEpisodeQuery]=useState('');
  const [appliedEpisodeQuery,setAppliedEpisodeQuery]=useState('');
  useEffect(()=>{
    if(episodeQuery===appliedEpisodeQuery)return;
    const timer=window.setTimeout(()=>{setAppliedEpisodeQuery(episodeQuery);setVisibleEpisodes(50);},200);
    return()=>window.clearTimeout(timer);
  },[episodeQuery,appliedEpisodeQuery]);
  const [libraryList,setLibraryList]=useState(false);
  const [descriptionExpanded,setDescriptionExpanded]=useState(false);
  const [selectedEpisode,setSelectedEpisode]=useState<Episode|null>(null);
  const episodeListScroll=useRef(0);
  const [playerExpanded,setPlayerExpanded]=useState(false);
  const [view,setView]=useState<'library'|'discover'|'stats'>('library'),[query,setQuery]=useState(''),[rss,setRss]=useState(''),[results,setResults]=useState<Podcast[]>([]);
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
      loadPaused(audio.current,item,playbackSpeed(account,item.podcast.url));
      if('mediaSession' in navigator)navigator.mediaSession.playbackState='paused';
    });
    return()=>{cancelled=true;};
  },[boot,!!account]);
  async function action(work:()=>Promise<void>) { setBusy(true);setError('');try {await work();}catch(e){setError((e as Error).message);}finally{setBusy(false);} }
  async function refresh() { setAccount(await api<Account>('me')); }
  async function openFeed(podcast:Podcast) {
    const request=++feedRequest.current;setBusy(true);setError('');
    try { const result=await api<Feed>(`feed?url=${encodeURIComponent(podcast.url)}`);if(request===feedRequest.current){setFeed(result);setSelectedEpisode(null);setOldestFirst(false);setVisibleEpisodes(50);setEpisodeQuery('');setAppliedEpisodeQuery('');setDescriptionExpanded(false);} }
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
      setFeed(null);setSelectedEpisode(null);setResults([]);setQuery('');setRss('');setSearched(false);
      if('mediaSession'in navigator){navigator.mediaSession.metadata=null;navigator.mediaSession.playbackState='none';}
    });
  }
  const subscribed=(url:string)=>account?.subscriptions.some(p=>p.url===url);
  function updateEpisodeProgress(id:string,position:number,completed:boolean,playback?:Playback) {
    const a=accountRef.current;if(!a)return;
    const item=playback||(currentRef.current?.episode.id===id?currentRef.current:undefined);
    const history=(a.history||[]).filter(entry=>entry.episode.id!==id);
    if(item&&(position>0||completed))history.unshift({...playbackSnapshot(item,item.episode.duration),position,completed,updatedAt:Date.now()});
    const next={...a,history,progress:{...a.progress,[id]:position},completed:{...a.completed,[id]:completed},episodePodcasts:item?{...a.episodePodcasts,[id]:item.podcast}:a.episodePodcasts};
    accountRef.current=next;setAccount(next);
  }
  async function markEpisode(episode:Episode,podcast:Podcast) {
    await action(async()=>{
      const completed=!accountRef.current?.completed?.[episode.id];
      if(currentRef.current?.episode.id===episode.id){audio.current?.pause();await saveProgress();}
      const position=completed?episode.duration||accountRef.current?.progress[episode.id]||0:0;
      await api('progress','PUT',{id:episode.id,position,completed,playback:playbackSnapshot({episode,podcast},episode.duration)});
      updateEpisodeProgress(episode.id,position,completed,{episode,podcast});
      if(currentRef.current?.episode.id===episode.id)dismissPlayer();
    });
  }
  function dismissPlayer() {
    currentRef.current=null;setCurrent(null);setPlaying(false);setPlayerExpanded(false);setBuffering(false);
    restore.current=0;setPosition(0);setDuration(0);
    if(settingsOpen==='speed')setSettingsOpen(false);
    const element=audio.current;
    if(element){element.pause();element.removeAttribute('src');element.load();}
    if('mediaSession' in navigator){navigator.mediaSession.metadata=null;navigator.mediaSession.playbackState='none';}
  }
  async function saveProgress(keepalive=false) {
    const item=currentRef.current,element=audio.current;
    if (!item||!element||element.readyState<1||element.currentSrc!==item.episode.audio||!Number.isFinite(element.currentTime))return;
    const p=element.currentTime;
    const completed=!!accountRef.current?.completed?.[item.episode.id]||element.ended||(Number.isFinite(element.duration)&&element.duration>0&&p>=element.duration);
    const snapshot=playbackSnapshot(item,element.duration);
    updateEpisodeProgress(item.episode.id,p,completed,item);
    try{await api('progress','PUT',{id:item.episode.id,position:p,playback:snapshot,completed},keepalive);}catch{setError('Progress could not sync. Check your connection; playback can continue.');}
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
    restore.current=accountRef.current?.completed?.[episode.id]?0:accountRef.current?.progress[episode.id] || 0;
    currentRef.current={episode,podcast};setCurrent({episode,podcast});setPosition(restore.current);setDuration(episode.duration);setBuffering(true);
    element.src=episode.audio;element.playbackRate=playbackSpeed(accountRef.current,podcast.url);element.preservesPitch=true;
    try{await element.play();}catch{if(currentRef.current?.episode.id===episode.id&&element.paused&&element.currentTime===0)dismissPlayer();setBuffering(false);setError('Could not play this episode. Tap play to retry, or try another episode.');}
  }
  function openEpisode(episode:Episode) {
    episodeListScroll.current=window.scrollY;
    setSelectedEpisode(episode);
  }
  async function openHistoryEpisode(entry:ListeningHistory) {
    if(busy)return;
    const request=++feedRequest.current,scroll=window.scrollY;
    setBusy(true);setError('');
    try {
      const result=await api<Feed>(`feed?url=${encodeURIComponent(entry.podcast.url)}`);
      if(request===feedRequest.current){
        setFeed(result);episodeListScroll.current=scroll;
        setSelectedEpisode(result.episodes.find(episode=>episode.id===entry.episode.id)||entry.episode);
      }
    }catch(e){if(request===feedRequest.current)setError((e as Error).message);}
    finally{if(request===feedRequest.current)setBusy(false);}
  }
  function closeEpisode() {
    const id=selectedEpisode?.id;
    setSelectedEpisode(null);
    requestAnimationFrame(()=>{
      const target=Array.from(document.querySelectorAll<HTMLButtonElement>(view==='stats'?'.history-open':'.episode-title')).find(button=>button.dataset.episodeId===id);
      (target||document.querySelector<HTMLElement>('.stats-page h1'))?.focus({preventScroll:true});
      window.scrollTo(0,episodeListScroll.current);
    });
  }
  useEffect(()=>{
    if(!selectedEpisode)return;
    window.scrollTo(0,0);
    document.querySelector<HTMLElement>('.episode-detail h1')?.focus({preventScroll:true});
  },[selectedEpisode]);
  function toggleDescription(button:HTMLButtonElement) {
    const text=button.querySelector<HTMLElement>('.feed-description-text')!;
    const from=button.getBoundingClientRect().height;
    button.getAnimations().forEach(animation=>animation.cancel());
    const reset=()=>{text.style.removeProperty('display');text.style.removeProperty('-webkit-line-clamp');text.style.removeProperty('max-height');button.style.removeProperty('overflow');};
    reset();
    flushSync(()=>setDescriptionExpanded(!descriptionExpanded));
    const to=button.getBoundingClientRect().height;
    if(!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      // Keep all text visible inside the animated height; restore the ellipsis only when it settles.
      text.style.display='block';text.style.webkitLineClamp='unset';text.style.maxHeight='none';button.style.overflow='hidden';
      const animation=button.animate([{height:`${from}px`},{height:`${to}px`}],{duration:600,easing:'cubic-bezier(.4,0,.2,1)'});
      animation.onfinish=reset;
    }
  }
  function expandPlayer(expanded:boolean) {
    if (document.startViewTransition && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      document.startViewTransition(()=>flushSync(()=>setPlayerExpanded(expanded)));
    } else setPlayerExpanded(expanded);
  }
  function toggle(){const a=audio.current,item=currentRef.current;if(!a||!item)return;if(a.paused){if(a.ended||accountRef.current?.completed?.[item.episode.id]){seek(0);}a.play().catch(()=>setError('Playback failed. The publisher may be unavailable.'));}else a.pause();}
  function seek(value:number){const a=audio.current;if(!a||a.readyState<1)return;const next=seekPosition(value,a.duration);try{a.currentTime=next;setPosition(next);updatePosition();}catch{setError('This episode cannot seek to that position yet.');}}
  function skip(direction:number){seek((audio.current?.currentTime||0)+direction*(direction<0?(accountRef.current?.settings.skipBack||15):(accountRef.current?.settings.skipForward||30)));}
  function updatePosition(){const a=audio.current;if('mediaSession'in navigator&&a&&Number.isFinite(a.duration)&&a.duration>0){try{navigator.mediaSession.setPositionState({duration:a.duration,playbackRate:a.playbackRate,position:Math.min(a.currentTime,a.duration)});}catch{/* Browser may not support position state. */}}}
  async function settings(next:Settings,podcast?:{url:string;enabled:boolean}) {
    const previous=accountRef.current;if(!previous)return;
    const podcastSpeeds={...previous.podcastSpeeds};
    if(podcast){if(podcast.enabled)podcastSpeeds[podcast.url]=next.speed;else delete podcastSpeeds[podcast.url];}
    const updated={...previous,settings:podcast?.enabled?previous.settings:next,podcastSpeeds};
    accountRef.current=updated;setAccount(updated);
    if(audio.current){audio.current.playbackRate=playbackSpeed(updated,currentRef.current?.podcast.url);updatePosition();}
    try{await api('settings','PUT',{...next,...(podcast?{podcastUrl:podcast.url,override:podcast.enabled}:{})});}
    catch(e){
      setAccount(a=>a?{...a,settings:previous.settings,podcastSpeeds:previous.podcastSpeeds}:a);
      accountRef.current={...accountRef.current!,settings:previous.settings,podcastSpeeds:previous.podcastSpeeds};
      if(audio.current){audio.current.playbackRate=playbackSpeed(accountRef.current,currentRef.current?.podcast.url);updatePosition();}
      setError((e as Error).message);
    }
  }

  useEffect(()=>{
    if(!current||!('mediaSession'in navigator))return;
    const {episode,podcast}=current;
    const artwork=episode.artwork||podcast.artwork;
    const metadata={title:episode.title,artist:podcast.title,album:podcast.title};
    navigator.mediaSession.metadata=new MediaMetadata({...metadata,artwork:artwork?[{src:artwork}]:[]});
    let cancelled=false;
    void mediaArtwork(artwork).then(images=>{if(!cancelled&&currentRef.current?.episode.id===episode.id)navigator.mediaSession.metadata=new MediaMetadata({...metadata,artwork:images});});
    const handlers: [MediaSessionAction,MediaSessionActionHandler][]=[['play',()=>{void audio.current?.play().catch(()=>setError('Tap play to resume.'));}],['pause',()=>audio.current?.pause()],['seekbackward',d=>d.seekOffset?seek((audio.current?.currentTime||0)-d.seekOffset):skip(-1)],['seekforward',d=>d.seekOffset?seek((audio.current?.currentTime||0)+d.seekOffset):skip(1)],['seekto',d=>{if(d.seekTime!==undefined)seek(d.seekTime);}]];
    for(const [name,handler]of handlers){try{navigator.mediaSession.setActionHandler(name,handler);}catch{/* Unsupported action on this browser. */}}
    return()=>{cancelled=true;for(const [name]of handlers){try{navigator.mediaSession.setActionHandler(name,null);}catch{}}};
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
  const changeView=(next:'library'|'discover'|'stats')=>{if(next==='stats')setVisibleHistory(50);feedRequest.current++;setBusy(false);setView(next);setFeed(null);setSelectedEpisode(null);setError('');};
  const player=<audio ref={audio} preload="metadata" onLoadedMetadata={()=>{const a=audio.current!;setDuration(Number.isFinite(a.duration)?a.duration:currentRef.current?.episode.duration||0);if(restore.current){const p=restore.current;restore.current=0;seek(p);}a.playbackRate=playbackSpeed(accountRef.current,currentRef.current?.podcast.url);updatePosition();void saveProgress();}} onTimeUpdate={()=>{setPosition(audio.current?.currentTime||0);if(Date.now()-lastSave.current>1000){updatePosition();lastSave.current=Date.now();}}} onPlay={()=>{const id=currentRef.current?.episode.id;if(!id)return;if(accountRef.current?.completed?.[id]){updateEpisodeProgress(id,0,false);seek(0);}setPlaying(true);if('mediaSession'in navigator)navigator.mediaSession.playbackState='playing';void saveProgress();}} onPause={()=>{setPlaying(false);if('mediaSession'in navigator)navigator.mediaSession.playbackState=currentRef.current?'paused':'none';void saveProgress();}} onWaiting={()=>setBuffering(true)} onPlaying={()=>setBuffering(false)} onCanPlay={()=>setBuffering(false)} onEnded={()=>{void saveProgress();dismissPlayer();}} onError={()=>{setBuffering(false);setPlaying(false);setError('This audio could not load. Retry playback or choose another episode.');}}/>;
  const podcastOverride=current?account?.podcastSpeeds?.[current.podcast.url]:undefined;
  const currentSpeed=playbackSpeed(account,current?.podcast.url);
  const matchingEpisodes=useMemo(()=>sortEpisodes(filterEpisodes(feed?.episodes||[],appliedEpisodeQuery),oldestFirst),[feed,appliedEpisodeQuery,oldestFirst]);
  const stats=account?listeningStats(account.progress,account.completed||{},account.episodePodcasts||{}):null;
  const selectedPlaying=!!selectedEpisode&&current?.episode.id===selectedEpisode.id&&playing;
  const selectedInProgress=!!selectedEpisode&&(account?.progress[selectedEpisode.id]||0)>0&&!account?.completed?.[selectedEpisode.id];
  const nowPlaying=current&&<><Art src={current.episode.artwork||current.podcast.artwork} title={current.podcast.title} small={!playerExpanded}/><div><strong id="player-title">{current.episode.title}</strong><span>{current.podcast.title}</span></div></>;
  if(boot)return <div className="boot"><Icon name="wave" size={40}/><p>Loading Groovy…</p></div>;
  if(!account)return <div className="login"><div className="login-story"><div className="brand"><Icon name="mic" size={30}/>groovy<span className="brand-dot">.</span></div><div><span className="eyebrow">A LITTLE LESS NOISE</span><h1>Good stories.<br/>Your own pace.</h1><p>A home for the voices that stay with you.</p><div className="sound-art" aria-hidden="true">{Array.from({length:27},(_,i)=><i key={i} style={{height:`${22+Math.sin(i*.65)**2*110}px`}}/>)}</div></div><span className="story-bottom">PRESS PLAY. GET SOMEWHERE NEW.</span></div><main className="login-form"><span className="pill"><span/> YOUR LISTENING SPACE</span><h2>Welcome back.</h2><p>Great listening starts here. Enter your personal password to make yourself at home.</p><form onSubmit={e=>{e.preventDefault();void action(async()=>{await api('login','POST',{password});await refresh();setPassword('');});}}><label htmlFor="password">Your password</label><input id="password" type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} required placeholder="Enter your personal password"/><button className="primary" disabled={busy}>{busy?'Signing in…':'Start listening'} <span>→</span></button></form>{error&&<p className="error" role="alert">{error}</p>}<p className="fine">Invite only, for now. Use the password shared with you by the app owner.</p><div className="login-features"><span><Icon name="headphones" size={18}/> Your pace</span><span><Icon name="wave" size={18}/> Your podcasts</span></div></main></div>;
  return <div className={`app ${current?'has-player':''}`}>{player}<aside className="sidebar" inert={playerExpanded||!!settingsOpen}><button className="brand" onClick={()=>changeView('library')} aria-label="Groovy — My library"><Icon name="mic" size={28}/>groovy<span className="brand-dot">.</span></button><span className="nav-label">YOUR SPACE</span><nav><button className={view==='library'?'active':''} onClick={()=>changeView('library')}><Icon name="library"/>My library<span>{account.subscriptions.length}</span></button><button className={view==='discover'?'active':''} onClick={()=>changeView('discover')}><Icon name="search"/>Discover</button><button className={view==='stats'?'active':''} onClick={()=>changeView('stats')}><Icon name="graph"/>Stats</button></nav><div className="sidebar-bottom"><button onClick={()=>setSettingsOpen('all')}><Icon name="settings"/>Playback settings</button><button onClick={()=>void signOut()}><Icon name="logout"/>Sign out</button></div></aside><div className="workspace" inert={playerExpanded||!!settingsOpen}><header className="topbar"><button className="avatar" onClick={()=>setSettingsOpen('all')} aria-label="Open playback settings"><Icon name="headphones" size={20}/></button></header><main className="content">{error&&<div className="error banner" role="alert"><span>{error}</span><button onClick={()=>setError('')} aria-label="Dismiss error"><Icon name="close" size={18}/></button></div>}
    {view==='stats'&&!selectedEpisode?<section className="stats-page"><div className="page-heading"><h1 tabIndex={-1}>Stats.</h1></div><dl className="listening-stats"><div><dt>Total time listened:</dt><dd>{stats!.time}</dd></div><div><dt>Total episodes listened:</dt><dd>{stats!.episodes.toLocaleString()}</dd></div><div><dt>Most popular</dt><dd>{stats!.mostPopular||'No completed podcasts yet'}</dd></div></dl><p className="fine">Based on episode progress and completed episodes, including those marked played.</p><section className="listening-history"><h2>Listening history</h2><p className="fine">Most recent first. Dates reflect the last saved progress update, including episodes marked played.</p>{account.history?.length?<><ul>{account.history.slice(0,visibleHistory).map(entry=><li className="history-row" key={entry.episode.id} onClick={e=>{if(!(e.target as HTMLElement).closest('button'))void openHistoryEpisode(entry);}}><Art src={entry.episode.artwork||entry.podcast.artwork} title={entry.podcast.title} small/><div className="history-details"><h3><button className="history-open" data-episode-id={entry.episode.id} disabled={busy} onClick={()=>void openHistoryEpisode(entry)}>{entry.episode.title}</button></h3><p>{entry.podcast.title}</p>{!entry.completed&&entry.position>0&&<span className="progress-label history-status">In progress</span>}</div><time dateTime={new Date(entry.updatedAt).toISOString()} title={new Date(entry.updatedAt).toLocaleString()} aria-label={`Date listened: ${new Date(entry.updatedAt).toLocaleDateString()}`}>{new Date(entry.updatedAt).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'})}</time></li>)}</ul>{account.history.length>50&&<div className="episode-pagination"><p className="fine" role="status">Showing {Math.min(visibleHistory,account.history.length)} of {account.history.length} episodes</p>{visibleHistory<account.history.length&&<button className="secondary" onClick={()=>setVisibleHistory(count=>count+50)}>Show more history</button>}</div>}</>:<p className="muted">No listening history yet.</p>}</section></section>:feed&&selectedEpisode?<section className="episode-detail"><button className="back-link" onClick={closeEpisode}><Icon name="arrow" size={16}/>{view==='stats'?'Back to Stats':'Back to podcast'}</button><div className="episode-detail-hero"><Art src={selectedEpisode.artwork||feed.artwork} title={selectedEpisode.title}/><div><p className="eyebrow">{feed.title}</p><h1 tabIndex={-1}>{selectedEpisode.title}</h1><div className="episode-detail-actions"><button className={`primary ${selectedInProgress&&!selectedPlaying?'in-progress':''}`} disabled={busy} onClick={()=>void play(selectedEpisode,feed)}><Icon name={selectedPlaying?'pause':'play'} size={22}/>{selectedPlaying?'Pause Episode':selectedInProgress?'Resume Episode':'Play Episode'}</button><button className="secondary" disabled={busy} onClick={()=>void markEpisode(selectedEpisode,feed)}>{account.completed?.[selectedEpisode.id]?'Mark unplayed':'Mark played'}</button></div></div></div><div className="episode-detail-description"><h2>About this episode</h2><p>{selectedEpisode.description||'No description provided for this episode.'}</p></div></section>:feed?<><button className="back-link" onClick={()=>setFeed(null)}><Icon name="arrow" size={16}/>Back to {view==='library'?'library':'discovery'}</button><div className="feed-hero"><Art src={feed.artwork} title={feed.title}/><div><span className="eyebrow">PODCAST</span><h1>{feed.title}</h1><p className="author">{feed.author}</p><button className={`feed-description ${descriptionExpanded?'expanded':''}`} aria-expanded={descriptionExpanded} onClick={e=>toggleDescription(e.currentTarget)}><span className="feed-description-text">{feed.description}</span></button><button className={subscribed(feed.url)?'secondary':'primary'} disabled={busy} onClick={()=>void subscribe(feed)}><Icon name={subscribed(feed.url)?'check':'plus'} size={18}/>{subscribed(feed.url)?'Following · Unfollow':'Follow podcast'}</button></div></div><div className="section-heading"><h2>Episodes <span className="count">{matchingEpisodes.length}</span></h2><label className="episode-sort">Sort: <select aria-label="Episode order" value={oldestFirst?'oldest':'newest'} onChange={e=>{setOldestFirst(e.target.value==='oldest');setVisibleEpisodes(50);}}><option value="newest">Newest first</option><option value="oldest">Oldest first</option></select></label></div><div className="search-form episode-search" role="search" aria-label="Episode search"><Icon name="search"/><input type="search" aria-label="Search episodes" placeholder="Search episode titles or descriptions" value={episodeQuery} onChange={e=>setEpisodeQuery(e.target.value)}/></div><div className="episode-list">{feed.episodes.length===0&&<p className="muted">This feed has no playable audio episodes.</p>}{feed.episodes.length>0&&matchingEpisodes.length===0&&<p className="muted" role="status">No episodes match your search.</p>}{matchingEpisodes.slice(0,visibleEpisodes).map(ep=>{const active=current?.episode.id===ep.id;const saved=account.progress[ep.id]||0;const completed=!!account.completed?.[ep.id];const date=new Date(ep.date);return <article className={`episode ${active?'selected':''} ${completed?'completed':''}`} key={ep.id} onClick={e=>{if(!(e.target as HTMLElement).closest('button'))openEpisode(ep);}}><button className={`episode-play ${active?'is-active':''} ${saved>0&&!completed&&!active?'in-progress':''}`} onClick={()=>void play(ep,feed)} aria-label={`${active&&playing?'Pause':'Play'} ${ep.title}`}><Icon name={active&&playing?'pause':'play'} size={19}/></button><div className="episode-body"><div className="episode-meta">{!Number.isNaN(date.getTime())&&date.toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'})}{ep.duration>0&&<><span>·</span>{minutes(ep.duration)}</>}{completed?<span className="progress-label">Completed</span>:saved>0&&<span className="progress-label">{clock(saved)} listened</span>}</div><h3><button className="episode-title" data-episode-id={ep.id} onClick={()=>openEpisode(ep)}>{ep.title}</button></h3><p>{ep.description}</p></div></article>;})}</div>{matchingEpisodes.length>50&&<div className="episode-pagination"><p className="fine" role="status">Showing {Math.min(visibleEpisodes,matchingEpisodes.length)} of {matchingEpisodes.length} episodes</p>{visibleEpisodes<matchingEpisodes.length&&<button className="secondary" onClick={()=>setVisibleEpisodes(count=>count+50)}>Show more episodes</button>}</div>}</>:<><div className="page-heading"><div><h1>{view==='library'?'Your library.':'Find your next favorite.'}</h1>{view==='discover'&&<p>Big ideas, small discoveries, and everything in between.</p>}</div>{view==='library'&&<button className="secondary" onClick={()=>changeView('discover')}><Icon name="plus" size={18}/>Find podcasts</button>}</div>
    {view==='library'?<><div className="section-heading"><h2>Following <span className="count">{account.subscriptions.length}</span></h2><div className="library-view-toggle" role="group" aria-label="Library view"><button aria-label="Tile view" aria-pressed={!libraryList} onClick={()=>setLibraryList(false)}><Icon name="tiles" size={20}/></button><button aria-label="List view" aria-pressed={libraryList} onClick={()=>setLibraryList(true)}><Icon name="list" size={20}/></button></div></div>{account.subscriptions.length?<div className={libraryList?'library-list':'podcast-grid'}>{account.subscriptions.map(p=><button className="podcast-card" key={p.url} onClick={()=>void openFeed(p)} disabled={busy}><Art src={p.artwork} title={p.title}/><div className="podcast-card-details"><h3>{p.title}</h3><p>{p.author||'Independent podcast'}</p></div></button>)}</div>:<div className="empty"><div className="empty-icon"><Icon name="library" size={30}/></div><h3>Your next obsession starts here.</h3><p>Follow a podcast to give it a home in your library.</p><button className="primary" onClick={()=>changeView('discover')}><Icon name="search" size={18}/>Explore podcasts</button></div>}</>:<><form className="search-form" onSubmit={e=>{e.preventDefault();void action(async()=>{setResults(await api<Podcast[]>(`search?q=${encodeURIComponent(query)}`));setSearched(true);});}}><Icon name="search"/><input aria-label="Search podcasts" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search podcasts, topics, or people" minLength={2} maxLength={100} required/><button className="primary" disabled={busy}>{busy?'Searching…':'Search'}</button></form><div className="rss-panel"><div><Icon name="link" size={22}/><div><strong>Already have a feed?</strong><p>Add any freely accessible podcast RSS URL.</p></div></div><form onSubmit={e=>{e.preventDefault();void openFeed({url:rss,title:'',author:'',artwork:''});}}><input aria-label="RSS feed URL" type="url" required placeholder="https://example.com/feed.xml" value={rss} onChange={e=>setRss(e.target.value)}/><button className="secondary" disabled={busy}>Open feed <span>→</span></button></form></div><div className="section-heading"><h2>{results.length?'Search results':'A world of listening'}</h2><span>Search public podcasts</span></div>{results.length?<div className="podcast-grid">{results.map(p=><button className="podcast-card" key={p.url} onClick={()=>void openFeed(p)} disabled={busy}><Art src={p.artwork} title={p.title}/><h3>{p.title}</h3><p>{p.author}</p><span className="card-link">Explore episodes <span>↗</span></span></button>)}</div>:<div className="empty"><div className="empty-icon"><Icon name="search" size={30}/></div><h3>{searched?'No podcasts found.':'Follow your curiosity.'}</h3><p>Search for a favorite show or a topic you love.<br/>Public RSS feeds are always welcome here.</p></div>}</> }</>}{busy&&<p role="status" className="loading">Tuning in…</p>}<footer className="page-footer"><span>GROOVY <span className="brand-dot">●</span></span></footer></main></div>
    {current&&<section className={`player ${playerExpanded?'player-expanded':''}`} role={playerExpanded?'dialog':undefined} aria-modal={playerExpanded?true:undefined} aria-label="Audio player" inert={!!settingsOpen} onClick={e=>{if(!playerExpanded&&!(e.target as HTMLElement).closest('button,input,select,label'))expandPlayer(true);}}>
      {playerExpanded&&<header className="expanded-player-header"><button className="player-close" onClick={()=>expandPlayer(false)} aria-label="Close full player"><Icon name="arrow" size={26}/></button><span className="eyebrow">NOW PLAYING</span><Icon name="mic" size={24}/></header>}
      {playerExpanded?<div className="now-playing">{nowPlaying}</div>:<button className="now-playing" onClick={()=>expandPlayer(true)} aria-label="Open full player" aria-expanded={false}>{nowPlaying}</button>}
      {playerExpanded&&error&&<p className="error" role="alert">{error}</p>}<div className="player-center"><div className="transport"><button className="skip" onClick={()=>skip(-1)} aria-label={`Back ${account.settings.skipBack} seconds`}><Icon name="back" size={28}/><small>{account.settings.skipBack}</small></button><button className="main-play" onClick={toggle} aria-label={playing?'Pause':'Play'}><Icon name={playing?'pause':'play'} size={23}/></button><button className="skip" onClick={()=>skip(1)} aria-label={`Forward ${account.settings.skipForward} seconds`}><Icon name="forward" size={28}/><small>{account.settings.skipForward}</small></button><span className="buffering" role="status">{buffering?'Loading…':''}</span></div><div className="timeline"><span>{clock(position)}</span><input aria-label="Playback position" type="range" min="0" max={duration||0} step="1" value={Math.min(position,duration||0)} disabled={!duration} onChange={e=>seek(Number(e.target.value))} onPointerUp={()=>void saveProgress()}/><span>{clock(duration)}</span></div></div><div className="player-settings"><button className={`speed-knob ${podcastOverride!==undefined?'has-override':''}`} onClick={()=>setSettingsOpen('speed')} aria-label={`Playback speed: ${currentSpeed} times.${podcastOverride!==undefined?' Podcast override active.':''} Adjust speed.`}><Icon name="knob" size={24}/><span>{currentSpeed}×</span></button>{playerExpanded&&<button className="secondary player-mark" disabled={busy} onClick={()=>void markEpisode(current.episode,current.podcast)}>{account.completed?.[current.episode.id]?'Mark unplayed':'Mark played'}</button>}</div></section>}
    {settingsOpen&&<div className="modal-backdrop" onClick={()=>setSettingsOpen(false)}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="settings-title" onClick={e=>e.stopPropagation()}><button className="modal-close" onClick={()=>setSettingsOpen(false)} aria-label="Close settings" autoFocus><Icon name="close"/></button><span className="eyebrow">MAKE IT YOURS</span><h2 id="settings-title">{settingsOpen==='speed'?'Playback speed.':'Your listening pace.'}</h2><p>Saved to your account, wherever you listen.</p><form onSubmit={e=>{e.preventDefault();const data=new FormData(e.currentTarget);void settings({speed:Number(data.get('speed')),skipBack:Number(data.get('back')??account.settings.skipBack),skipForward:Number(data.get('forward')??account.settings.skipForward)},settingsOpen==='speed'&&current?{url:current.podcast.url,enabled:data.has('podcastOverride')}:undefined);setSettingsOpen(false);}}><SpeedSlider speed={settingsOpen==='speed'?currentSpeed:account.settings.speed}/>{settingsOpen==='speed'&&current&&<label className="podcast-speed-override"><input type="checkbox" name="podcastOverride" defaultChecked={podcastOverride!==undefined}/><span>Override speed for <strong>{current.podcast.title}</strong></span></label>}{settingsOpen==='all'&&<div className="settings-row"><label>Skip back (seconds)<input type="number" name="back" min="5" max="120" required defaultValue={account.settings.skipBack}/></label><label>Skip forward (seconds)<input type="number" name="forward" min="5" max="120" required defaultValue={account.settings.skipForward}/></label></div>}<p className="fine">Pitch stays natural at every speed. Car display artwork depends on your phone and receiver.</p><button className="primary">{settingsOpen==='speed'?'Save speed':'Save preferences'}</button></form>{settingsOpen==='all'&&<button className="signout-setting" disabled={busy} onClick={()=>void signOut()}><Icon name="logout" size={16}/>Sign out</button>}</section></div>}
  </div>;
}
createRoot(document.getElementById('root')!).render(<App/>);

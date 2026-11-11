import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seekPosition, playbackSpeed } from '../src/playback';
test('skips clamp at start/end and can seek before total duration is known',()=>{
  assert.equal(seekPosition(5-15,100),0);assert.equal(seekPosition(90+30,100),100);
  assert.equal(seekPosition(40,100),40);assert.equal(seekPosition(30,Infinity),30);
  assert.equal(seekPosition(NaN,100),0);assert.equal(seekPosition(20,NaN),20);
});

import { findResume, loadPaused, playbackSnapshot } from '../src/playback';
import type { Feed, Playback } from '../src/types';
const item: Playback = {episode:{id:'one',title:'Episode',audio:'https://cdn.example.org/one.mp3',artwork:'',duration:100,description:'Description',date:''},podcast:{url:'https://feeds.example.org/rss',title:'Show',author:'Host',artwork:''}};
test('restores the newest unfinished snapshot without requiring a feed request',async()=>{
  const result=await findResume([{id:'finished',position:100,playback:item},{id:'one',position:45,playback:item}],async()=>{throw new Error('Should not fetch saved snapshots');});
  assert.equal(result?.episode.title,'Episode');assert.equal(result?.position,45);
  assert.equal(await findResume([],async()=>{throw new Error();}),null);
});
test('restores older progress from feeds and skips missing and completed episodes',async()=>{
  const id=JSON.stringify([item.podcast.url,'old']);
  const feed:Feed={...item.podcast,description:'',episodes:[{...item.episode,id}]};
  const result=await findResume([{id:'invalid',position:1,playback:null},{id,position:100,playback:null},{id,position:25,playback:null}],async()=>feed);
  assert.equal(result?.position,25);assert.equal(result?.episode.id,id);
  assert.equal(await findResume([{id,position:1,playback:null}],async()=>{throw new Error('Feed down');}),null);
});
test('paused restoration sets the source and pitch-preserving speed without autoplay',()=>{
  let paused=false,plays=0;
  const audio={pause(){paused=true;},play(){plays++;},src:'',playbackRate:1,preservesPitch:false};
  loadPaused(audio as unknown as HTMLAudioElement,item,1.5);
  assert.equal(paused,true);assert.equal(plays,0);assert.equal(audio.src,item.episode.audio);assert.equal(audio.playbackRate,1.5);assert.equal(audio.preservesPitch,true);
});
test('snapshots keep actual duration without embedding the feed episode list',()=>{
  const feed:Feed={...item.podcast,description:'Large feed',episodes:[item.episode]};
  const snapshot=playbackSnapshot({...item,podcast:feed},120);
  assert.equal(snapshot.episode.duration,120);assert.equal(snapshot.episode.description,'');assert.equal('episodes' in snapshot.podcast,false);
});

test('effective playback speed uses the current podcast override and falls back to the account default',()=>{
  const account={settings:{speed:1.25,skipBack:15,skipForward:30},podcastSpeeds:{'https://feeds.example.org/a':1.75},subscriptions:[],progress:{},completed:{},episodePodcasts:{},history:[],resume:[]};
  assert.equal(playbackSpeed(account,'https://feeds.example.org/a'),1.75);
  assert.equal(playbackSpeed(account,'https://feeds.example.org/b'),1.25);
  assert.equal(playbackSpeed(account),1.25);
  account.settings.speed=.75;
  assert.equal(playbackSpeed(account,'https://feeds.example.org/a'),1.75);
  delete account.podcastSpeeds['https://feeds.example.org/a'];
  assert.equal(playbackSpeed(account,'https://feeds.example.org/a'),.75);
  assert.equal(playbackSpeed(null),1);
});

test('resume ignores zero progress and invalid positions without loading their feeds',async()=>{
  const zero={id:JSON.stringify(['https://example.org/rss','zero']),position:0,playback:null};
  assert.equal(await findResume([zero,{...zero,playback:item},{...zero,position:.5},{...zero,position:-1},{...zero,position:NaN}],async()=>{throw new Error('Must not load zero-progress feeds');}),null);
  const saved=await findResume([{...zero,playback:item},{id:'started',position:12,playback:item}],async()=>{throw new Error();});
  assert.equal(saved?.position,12);
});

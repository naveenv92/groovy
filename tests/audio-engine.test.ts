import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createNativeAudioEngine, type NativePlayer} from '../src/audio-engine';
import type {Playback} from '../src/types';
const item:Playback={episode:{id:'one',title:'Episode',audio:'https://example.org/one.mp3',artwork:'',description:'',date:'',duration:100},podcast:{url:'https://example.org/rss',title:'Show',author:'',artwork:''}};
test('native audio adapter forwards commands and filters stale episode events',async()=>{
  const commands:Record<string,unknown>[]=[];
  let listener:(state:any)=>void=()=>{};
  let removed=false;
  const native:NativePlayer={command:async value=>{commands.push(value);},snapshot:async()=>({item:null,position:0,playing:false}),addListener:async(_,callback)=>{listener=callback;return{remove:async()=>{removed=true;}};}};
  const audio=createNativeAudioEngine(native);
  let metadata=0,plays=0,ended=0;
  audio.addEventListener('loadedmetadata',()=>metadata++);
  audio.addEventListener('play',()=>plays++);
  audio.addEventListener('ended',()=>ended++);
  audio.configure!(item,15,30);
  listener({id:'old',position:60,duration:100,paused:false,ended:false,buffering:false});
  assert.equal(audio.currentTime,0);assert.equal(plays,0);
  listener({id:'one',position:20,duration:100,paused:false,ended:false,buffering:false});
  listener({id:'one',position:21,duration:100,paused:false,ended:false,buffering:false});
  assert.equal(metadata,1);assert.equal(plays,1);assert.equal(audio.currentTime,21);
  audio.currentTime=40;audio.playbackRate=1.5;audio.updateSettings!(10,45);await audio.play();audio.pause();
  assert.deepEqual(commands.map(c=>c.action),['load','seek','speed','settings','play','pause']);
  listener({id:'one',position:100,duration:100,paused:true,ended:true,buffering:false});assert.equal(ended,1);
  audio.removeAttribute('src');listener({id:'one',position:50,duration:100,paused:false,ended:false,buffering:false});assert.equal(audio.currentSrc,'');
  audio.dispose!();await Promise.resolve();assert.equal(removed,true);
});
test('native audio adapter reattaches to active playback without loading or pausing it',async()=>{
  const commands:unknown[]=[];
  const native:NativePlayer={command:async value=>{commands.push(value);},snapshot:async()=>({item,position:32,playing:true}),addListener:async()=>({remove:async()=>{}})};
  const audio=createNativeAudioEngine(native);
  const saved=await audio.restoreActive!();
  assert.equal(saved.item?.episode.id,'one');assert.equal(audio.currentTime,32);assert.equal(audio.paused,false);assert.deepEqual(commands,[]);
});

test('native load passes a compact snapshot instead of the full podcast feed',()=>{
  const commands:Record<string,unknown>[]=[];
  const native:NativePlayer={command:async value=>{commands.push(value);},snapshot:async()=>({item:null,position:0,playing:false}),addListener:async()=>({remove:async()=>{}})};
  const feed={...item.podcast,description:'Long podcast description',episodes:Array(500).fill({...item.episode,description:'Long episode description'.repeat(100)})};
  const audio=createNativeAudioEngine(native);
  audio.configure!({episode:item.episode,podcast:feed},15,30);
  const snapshot=commands[0].item as Playback;
  assert.deepEqual(snapshot.podcast,item.podcast);
  assert.ok(JSON.stringify(snapshot).length<1000);
});

test('native restoration loads the saved position without issuing a user seek',()=>{
  const commands:Record<string,unknown>[]=[];
  const native:NativePlayer={command:async value=>{commands.push(value);},snapshot:async()=>({item:null,position:0,playing:false}),addListener:async()=>({remove:async()=>{}})};
  const audio=createNativeAudioEngine(native);
  audio.configure!(item,15,30,65);
  assert.equal(commands[0].position,65);assert.equal(audio.currentTime,65);
  assert.deepEqual(commands.map(command=>command.action),['load']);
});

test('a delayed native snapshot cannot overwrite a newly selected episode',async()=>{
  let reply!:(value:{item:Playback;position:number;playing:boolean})=>void;
  const native:NativePlayer={command:async()=>{},snapshot:()=>new Promise(resolve=>{reply=resolve;}),addListener:async()=>({remove:async()=>{}})};
  const audio=createNativeAudioEngine(native);
  const pending=audio.restoreActive!();
  const next={...item,episode:{...item.episode,id:'new',audio:'https://example.org/new.mp3'}};
  audio.configure!(next,15,30,40);
  reply({item,position:10,playing:false});await pending;
  assert.equal(audio.currentSrc,next.episode.audio);assert.equal(audio.currentTime,40);
});

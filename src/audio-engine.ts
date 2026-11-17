import { registerPlugin } from '@capacitor/core';
import { nativeIOS } from './api';
import type { Playback, ActivePlayback } from './types';
import { playbackSnapshot } from './playback';

interface NativeState { id:string;position:number;duration:number;paused:boolean;ended:boolean;buffering:boolean;error?:string }
export interface NativePlayer {
  snapshot():Promise<ActivePlayback>;
  command(options:Record<string,unknown>):Promise<void>;
  addListener(name:string,listener:(state:NativeState)=>void):Promise<{remove():Promise<void>}>;
}
const player=registerPlugin<NativePlayer>('Groovy');
export type AudioEngine = Pick<HTMLAudioElement,'src'|'currentSrc'|'currentTime'|'duration'|'paused'|'ended'|'readyState'|'playbackRate'|'preservesPitch'|'play'|'pause'|'load'|'removeAttribute'|'addEventListener'|'removeEventListener'> & { configure?(item:Playback,back:number,forward:number,position?:number):void; restoreActive?():Promise<ActivePlayback>; updateSettings?(back:number,forward:number):void; dispose?():void };
export function createAudioEngine():AudioEngine {
  if(!nativeIOS){const audio=new Audio();audio.preload='metadata';return audio;}
  return createNativeAudioEngine(player);
}
export function createNativeAudioEngine(player:NativePlayer):AudioEngine {
  const target=new EventTarget();
  let src='',position=0,duration=NaN,paused=true,ended=false,rate=1,id='',intentRevision=0;
  const send=(data:Record<string,unknown>)=>player.command(data).catch(()=>target.dispatchEvent(new Event('error')));
  const listener=player.addListener('state',state=>{
    if(state.id!==id)return;
    const metadata=duration!==state.duration && state.duration>0;
    const changed=paused!==state.paused; position=state.position;duration=state.duration;paused=state.paused;ended=state.ended;
    if(changed)target.dispatchEvent(new Event(paused?'pause':'play'));
    if(metadata)target.dispatchEvent(new Event('loadedmetadata'));
    target.dispatchEvent(new Event('timeupdate'));
    target.dispatchEvent(new Event(state.buffering?'waiting':'playing'));
    if(state.error)target.dispatchEvent(new Event('error'));
    if(ended)target.dispatchEvent(new Event('ended'));
  });
  Object.defineProperties(target,{
    src:{get:()=>src,set:(value:string)=>{src=value;}},currentSrc:{get:()=>src},
    currentTime:{get:()=>position,set:(value:number)=>{intentRevision++;position=value;void send({action:'seek',position:value});}},
    duration:{get:()=>duration},paused:{get:()=>paused},ended:{get:()=>ended},readyState:{get:()=>Number.isFinite(duration)?1:0},
    playbackRate:{get:()=>rate,set:(value:number)=>{rate=value;void send({action:'speed',speed:value});}},
  });
  return Object.assign(target,{
    preservesPitch:true,
    async restoreActive(){const revision=intentRevision;const saved=await player.snapshot();if(saved.item&&revision===intentRevision){id=saved.item.episode.id;src=saved.item.episode.audio;position=saved.position;paused=!saved.playing;}return saved;},
    configure(item:Playback,back:number,forward:number,start=0){intentRevision++;id=item.episode.id;duration=NaN;src=item.episode.audio;position=start;void send({action:'load',item:playbackSnapshot(item,item.episode.duration),back,forward,speed:rate,position:start});},
    updateSettings(back:number,forward:number){void send({action:'settings',back,forward});},
    play(){intentRevision++;return player.command({action:'play'});},pause(){intentRevision++;void send({action:'pause'});},
    removeAttribute(){intentRevision++;id='';src='';void send({action:'stop'});},load(){},
    dispose(){void listener.then(value=>value.remove());},
  }) as unknown as AudioEngine;
}

import { Capacitor, registerPlugin } from '@capacitor/core';

export const nativeIOS = Capacitor.getPlatform() === 'ios';
export const nativeBridge = registerPlugin<{
  pendingProgress():Promise<{count:number}>;
  request(options:{path:string;method:string;data?:unknown}):Promise<{status:number;data:any}>;
}>('Groovy');

export async function api<T>(path:string,method='GET',data?:unknown,keepalive=false):Promise<T> {
  if(nativeIOS){
    if(path==='logout'){
      const pending=await nativeBridge.pendingProgress();
      if(pending.count>0){
        if(!window.confirm('Some listening progress has not synced. Sign out and discard it?'))throw new Error('Sign out cancelled. Your listening progress is kept on this device.');
        data={discardPending:true};
      }
    }
    const response=await nativeBridge.request({path,method,data});
    if(response.status<200||response.status>=300)throw new Error(response.data.error||'Request failed. Please retry.');
    return response.data;
  }
  const response=await fetch(`/api/${path}`,{method,credentials:'same-origin',keepalive,headers:data?{'Content-Type':'application/json'}:{},body:data?JSON.stringify(data):undefined});
  const result:any=await response.json();
  if(!response.ok)throw new Error(result.error||'Request failed. Please retry.');
  return result;
}

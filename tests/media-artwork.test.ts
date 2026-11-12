import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mediaArtwork } from '../src/media-artwork';

test('media artwork creates a declared square JPEG and preserves original artwork on conversion failure',async()=>{
  const originals=new Map(['Image','document','window','fetch'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  let blocked=false,tainted=false,uploadFailed=false;
  const draws:unknown[][]=[];
  const canvas={width:0,height:0,getContext:()=>({fillStyle:'',fillRect(){},drawImage:(...args:unknown[])=>draws.push(args)}),toDataURL:(type:string)=>{assert.equal(type,'image/jpeg');if(tainted)throw new Error('Canvas is tainted');return 'data:image/jpeg;base64,fixture';}};
  class ImageStub {
    naturalWidth=1200;naturalHeight=600;crossOrigin='';onload:(()=>void)|null=null;onerror:(()=>void)|null=null;
    set src(value:string){assert.equal(value,'/api/artwork?url=https%3A%2F%2Fexample.org%2Fart.png');assert.equal(this.crossOrigin,'anonymous');queueMicrotask(()=>blocked?this.onerror?.():this.onload?.());}
  }
  Object.defineProperty(globalThis,'Image',{configurable:true,value:ImageStub});
  Object.defineProperty(globalThis,'document',{configurable:true,value:{createElement:(tag:string)=>{assert.equal(tag,'canvas');return canvas;}}});
  Object.defineProperty(globalThis,'window',{configurable:true,value:{setTimeout,location:{href:'https://groovy.test/',origin:'https://groovy.test'}}});
  Object.defineProperty(globalThis,'fetch',{configurable:true,value:async(path:string,init:RequestInit)=>{assert.equal(path,'/api/artwork');assert.equal(init.method,'POST');assert.deepEqual(JSON.parse(init.body as string),{jpeg:'fixture'});return uploadFailed?new Response(null,{status:503}):Response.json({url:'https://groovy.test/api/artwork/published.jpg'});}});
  try{
    assert.deepEqual(await mediaArtwork(''),[]);
    assert.deepEqual(await mediaArtwork('https://example.org/art.png'),[{src:'https://groovy.test/api/artwork/published.jpg',sizes:'512x512',type:'image/jpeg'}]);
    assert.equal(canvas.width,512);assert.equal(canvas.height,512);
    assert.deepEqual(draws[0].slice(1),[0,128,512,256]);
    blocked=true;assert.deepEqual(await mediaArtwork('https://example.org/art.png'),[{src:'https://example.org/art.png'}]);
    blocked=false;tainted=true;assert.deepEqual(await mediaArtwork('https://example.org/art.png'),[{src:'https://example.org/art.png'}]);
    tainted=false;uploadFailed=true;assert.deepEqual(await mediaArtwork('https://example.org/art.png'),[{src:'https://example.org/art.png'}]);
  }finally{for(const [key,descriptor] of originals){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key);}}
});

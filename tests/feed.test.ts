import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFeed, publicUrl, seconds, fetchLimited, digest, publicAddress } from '../worker/lib';
const feed=`<?xml version="1.0"?><rss xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" version="2.0"><channel><title>Good &amp; Curious</title><itunes:author>A host</itunes:author><itunes:image href="https://cdn.example.org/show.jpg"/><description><![CDATA[<p>Welcome</p>]]></description><item><guid isPermaLink="false">one</guid><title>First episode</title><description><![CDATA[<b>Hello</b> world]]></description><enclosure url="https://cdn.example.org/audio.mp3" type="audio/mpeg"/><itunes:duration>1:02:03</itunes:duration></item><item><title>No audio</title></item></channel></rss>`;
test('parses RSS metadata, namespaced artwork, duration, guid, and safe plain descriptions',()=>{
  const result=parseFeed(feed,'https://feeds.example.org/show.xml');
  assert.equal(result.title,'Good & Curious');assert.equal(result.author,'A host');assert.equal(result.description,'Welcome');
  assert.equal(result.artwork,'https://cdn.example.org/show.jpg');assert.equal(result.episodes.length,1);
  assert.equal(result.episodes[0].duration,3723);assert.equal(result.episodes[0].description,'Hello world');
  assert.equal(result.episodes[0].id,JSON.stringify(['https://feeds.example.org/show.xml','one']));
});
test('handles missing art, relative enclosure, and single item',()=>{
  const result=parseFeed('<rss><channel><title>Minimal</title><item><enclosure url="/episode.mp3" /></item></channel></rss>','https://feeds.example.org/rss');
  assert.equal(result.artwork,'');assert.equal(result.episodes[0].audio,'https://feeds.example.org/episode.mp3');assert.equal(result.episodes[0].title,'Untitled episode');
});
test('rejects invalid XML, entity declarations and feeds without channels',()=>{
  for(const xml of ['<rss>','<html/>','<!DOCTYPE rss [<!ENTITY x "bad">]><rss/>'])assert.throws(()=>parseFeed(xml,'https://feeds.example.org/rss'));
});
test('rejects private URLs and bypass forms',()=>{
  for(const url of ['file:///etc/passwd','https://127.0.0.1/rss','http://2130706433/','http://0x7f000001/','https://[::1]/','http://localhost/rss','http://foo.local/rss','https://user:pass@site.org/rss','https://site.org:8443/rss'])assert.throws(()=>publicUrl(url));
  assert.equal(publicUrl('https://feeds.example.org/rss#section'),'https://feeds.example.org/rss');
});
test('parses duration values and handles invalid input',()=>{assert.equal(seconds('32:10'),1930);assert.equal(seconds('90'),90);assert.equal(seconds('bad'),0);});
test('bounded fetch rejects oversized feeds and redirects to private destinations',async()=>{
  const original=globalThis.fetch;
  try{
    globalThis.fetch=async(input)=>String(input).includes('dns-query')?Response.json({Answer:[{type:1,data:'93.184.216.34'}]}):new Response('oversize');await assert.rejects(fetchLimited('https://feeds.example.org/rss',{},3),/too large/);
    globalThis.fetch=async(input)=>String(input).includes('dns-query')?Response.json({Answer:[{type:1,data:'93.184.216.34'}]}):new Response(null,{status:302,headers:{location:'http://127.0.0.1/private'}});await assert.rejects(fetchLimited('https://feeds.example.org/rss'),/public/);
  }finally{globalThis.fetch=original;}
});
test('credential digests are deterministic and do not store plaintext',async()=>{assert.equal((await digest('secret')).length,64);assert.notEqual(await digest('secret'),await digest('other'));});

test('DNS validation rejects private, loopback, mapped IPv6, and link-local addresses',()=>{for(const ip of ['10.1.1.1','127.0.0.1','169.254.169.254','172.16.0.1','192.168.0.1','100.64.0.1','::1','::ffff:127.0.0.1','fe80::1','fc00::1'])assert.equal(publicAddress(ip),false);assert.equal(publicAddress('1.1.1.1'),true);assert.equal(publicAddress('2606:4700:4700::1111'),true);});
test('rejects public hostnames that resolve privately before fetching the feed',async()=>{const original=globalThis.fetch;try{globalThis.fetch=async()=>Response.json({Answer:[{type:1,data:'10.0.0.1'}]});await assert.rejects(fetchLimited('https://feeds.example.org/rss'),/public internet/);}finally{globalThis.fetch=original;}});

test('feeds include audio episodes beyond the first 500 entries',()=>{
  const items=Array.from({length:505},(_,index)=>`<item><title>Episode ${index}</title><enclosure url="https://example.org/${index}.mp3" type="audio/mpeg"/></item>`).join('');
  const feed=parseFeed(`<rss><channel><title>Full archive</title><item><title>No audio</title></item>${items}</channel></rss>`,'https://example.org/feed');
  assert.equal(feed.episodes.length,505);
  assert.equal(feed.episodes[504].title,'Episode 504');
});

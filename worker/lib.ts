import { SaxesParser } from 'saxes';
import type { Feed } from '../src/types';

export class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }
export const fail = (status: number, message: string): never => { throw new HttpError(status, message); };
export async function digest(value: string) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(n => n.toString(16).padStart(2, '0')).join('');
}
export function publicUrl(value: string) {
  let url: URL;
  try { url = new URL(value); } catch { return fail(400, 'Enter a valid feed URL.'); }
  const host = url.hostname.toLowerCase();
  // Reject IP literals entirely; Workers' public fetch handles DNS routing.
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || (url.port && !['80', '443'].includes(url.port)) || !host.includes('.') || /^[\d.]+$/.test(host) || host.includes(':') || /\.(localhost|local|internal|test|invalid|example|home|lan)$/.test(host) || host === 'localhost' || host.endsWith('.localhost')) fail(400, 'Use a public HTTP or HTTPS feed URL.');
  url.hash = '';
  return url.href;
}
const array = (v: any): any[] => v == null ? [] : Array.isArray(v) ? v : [v];
const string = (v: any): string => typeof v === 'string' || typeof v === 'number' ? String(v) : v?.['#text'] ? String(v['#text']) : '';
const text = (v: any) => string(v).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
function mediaUrl(value: any, base: string) {
  if (!string(value).trim()) return '';
  try { const u = new URL(string(value), base); return ['https:', 'http:'].includes(u.protocol) && !u.username && !u.password ? u.href : ''; } catch { return ''; }
}
export function seconds(value: any) {
  const v = string(value); const parts = v.split(':').map(Number);
  const n = parts.reduce((sum, p) => sum * 60 + p, 0);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}
export function parseFeed(xml: string, url: string): Feed {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) fail(422, 'XML entities and document types are not supported.');
  const root: Record<string, any> = {};
  const stack: { name: string; value: Record<string, any>; text: string }[] = [{ name: '', value: root, text: '' }];
  const parser = new SaxesParser();
  parser.on('opentag', tag => {
    if (stack.length > 64) fail(422, 'This feed is nested too deeply.');
    stack.push({name:tag.name, value:Object.fromEntries(Object.entries(tag.attributes).map(([key,value])=>['@_'+key,value])), text:''});
  });
  parser.on('text', value => { stack[stack.length-1].text += value; });
  parser.on('cdata', value => { stack[stack.length-1].text += value; });
  parser.on('closetag', () => {
    const node = stack.pop()!, parent = stack[stack.length-1].value;
    const value = Object.keys(node.value).length ? {...node.value, '#text':node.text} : node.text;
    if (parent[node.name] === undefined) parent[node.name] = value;
    else parent[node.name] = [...array(parent[node.name]), value];
  });
  try { parser.write(xml).close(); } catch (error) { if (error instanceof HttpError) throw error; fail(422, 'This feed is not valid RSS XML.'); }
  const channel = root.rss?.channel;
  if (!channel || !string(channel.title)) fail(422, 'This URL does not contain a podcast RSS feed.');
  const artwork = mediaUrl(channel['itunes:image']?.['@_href'] || channel.image?.url, url);
  return {
    url, title: text(channel.title), author: text(channel['itunes:author'] || channel.author), artwork,
    description: text(channel.description),
    episodes: array(channel.item).slice(0, 500).flatMap(item => {
      const enclosure = array(item.enclosure).find(e => !e['@_type'] || String(e['@_type']).startsWith('audio/'));
      const audio = mediaUrl(enclosure?.['@_url'], url);
      if (!audio) return [];
      return [{ id: JSON.stringify([url, string(item.guid) || audio]), title: text(item.title) || 'Untitled episode', audio,
        artwork: mediaUrl(item['itunes:image']?.['@_href'], url) || artwork,
        description: text(item.description || item['itunes:summary']), date: string(item.pubDate), duration: seconds(item['itunes:duration']) }];
    }),
  };
}
export function publicAddress(address: string) {
  if (address.includes(':')) return /^[23][0-9a-f]{0,3}:/i.test(address);
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some(p=>!Number.isInteger(p)||p<0||p>255)) return false;
  const [a,b] = parts;
  return !(a===0 || a===10 || a===127 || a>=224 || (a===169&&b===254) || (a===172&&b>=16&&b<=31) || (a===192&&(b===168||b===0)) || (a===100&&b>=64&&b<=127) || (a===198&&(b===18||b===19)));
}
async function checkDns(url: string, signal: AbortSignal) {
  const hostname = new URL(url).hostname;
  const responses = await Promise.all(['A','AAAA'].map(async type=>{
    const response = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(hostname)}&type=${type}`,{headers:{Accept:'application/dns-json'},signal});
    if (!response.ok) fail(502, 'Could not resolve the publisher address.');
    const data = await response.json() as { Answer?: { type:number; data:string }[] };
    return (data.Answer || []).filter(a=>a.type===1||a.type===28).map(a=>a.data);
  }));
  const addresses = responses.flat();
  if (!addresses.length || !addresses.every(publicAddress)) fail(400, 'The feed must resolve to a public internet address.');
}
export async function fetchLimited(input: string, headers: Record<string, string> = {}, maxBytes = 4_000_000) {
  let url = publicUrl(input);
  const signal = AbortSignal.timeout(12_000);
  for (let redirects = 0; redirects <= 4; redirects++) {
    await checkDns(url, signal);
    const response = await fetch(url, { headers, redirect: 'manual', signal });
    if ([301,302,303,307,308].includes(response.status)) {
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (!location) fail(502, 'The feed returned an invalid redirect.');
      url = publicUrl(new URL(location!, url).href); continue;
    }
    if (!response.ok) { await response.body?.cancel(); fail(502, `The publisher returned HTTP ${response.status}. Try again later.`); }
    const reader = response.body?.getReader(); if (!reader) fail(502, 'Empty publisher response.');
    const chunks: Uint8Array[] = []; let size = 0;
    try { for (;;) { const { done, value } = await reader!.read(); if (done) break; size += value.byteLength; if (size > maxBytes) fail(413, `This feed is too large (${maxBytes/1_000_000} MB maximum).`); chunks.push(value); } }
    finally { await reader!.cancel(); }
    const output = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length; }
    return new TextDecoder().decode(output);
  }
  return fail(502, 'Too many publisher redirects.');
}

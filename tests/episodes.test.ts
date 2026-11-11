import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterEpisodes, sortEpisodes } from '../src/episodes';
import type { Episode } from '../src/types';

test('episode sorting orders dates both ways, keeps undated episodes last, and preserves the feed', () => {
  const episodes = ['2020-01-01', '', '2024-01-01', 'invalid', '2020-01-01'].map((date, index): Episode => ({
    id: String(index), date, title: '', audio: '', artwork: '', description: '', duration: 0,
  }));
  assert.deepEqual(sortEpisodes(episodes).map(ep => ep.id), ['2', '0', '4', '1', '3']);
  assert.deepEqual(sortEpisodes(episodes, true).map(ep => ep.id), ['0', '4', '2', '1', '3']);
  assert.deepEqual(episodes.map(ep => ep.id), ['0', '1', '2', '3', '4']);
  assert.deepEqual(sortEpisodes([]), []);
});

test('episode search matches titles and descriptions case-insensitively across the full archive', () => {
  const episodes=Array.from({length:600},(_,index): Episode=>({id:String(index),title:`Episode ${index}`,description:index===599?'A SPECIAL guest':'Weekly show',audio:'',artwork:'',date:'',duration:0}));
  assert.deepEqual(filterEpisodes(episodes,' episode 599 ').map(ep=>ep.id),['599']);
  assert.deepEqual(filterEpisodes(episodes,'special GUEST').map(ep=>ep.id),['599']);
  assert.equal(filterEpisodes(episodes,'   ').length,600);
  assert.deepEqual(filterEpisodes(episodes,'missing'),[]);
  assert.deepEqual(filterEpisodes([],'guest'),[]);
  assert.equal(episodes.length,600);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatListeningTime, listeningStats } from '../src/stats';

test('listening time rounds to minutes and carries into hours and days', () => {
  assert.equal(formatListeningTime(0), '0 minutes');
  assert.equal(formatListeningTime(29), '0 minutes');
  assert.equal(formatListeningTime(30), '1 minute');
  assert.equal(formatListeningTime(300), '5 minutes');
  assert.equal(formatListeningTime(3599), '1 hour, 0 minutes');
  assert.equal(formatListeningTime(86399), '1 day, 0 minutes');
  assert.equal(formatListeningTime(93780), '1 day, 2 hours, 3 minutes');
});

test('stats sum all progress and count only completed episodes, reflecting resets', () => {
  assert.deepEqual(listeningStats({}, {}), {time: '0 minutes', episodes: 0, mostPopular: null});
  assert.deepEqual(listeningStats({one: 90, two: 60, three: 30}, {one: true, two: false, three: true}), {time: '3 minutes', episodes: 2, mostPopular: null});
  assert.deepEqual(listeningStats({one: 0, two: 60, three: 30}, {one: false, two: false, three: true}), {time: '2 minutes', episodes: 1, mostPopular: null});
});

test('most popular groups completed episodes by feed and breaks ties by title', () => {
  const a={url:'https://example.com/a',title:'Alpha',author:'',artwork:''};
  const b={...a,url:'https://example.com/b',title:'Beta'};
  const podcasts={one:a,two:b,three:b,four:a};
  assert.equal(listeningStats({}, {one:true,two:true,three:true,four:false}, podcasts).mostPopular,'Beta');
  assert.equal(listeningStats({}, {one:true,two:true,three:false}, podcasts).mostPopular,'Alpha');
  assert.equal(listeningStats({}, {missing:true}, podcasts).mostPopular,null);
  assert.equal(listeningStats({}, {one:true,two:true}, {one:a,two:{...b,title:'Alpha'}}).mostPopular,'Alpha');
});

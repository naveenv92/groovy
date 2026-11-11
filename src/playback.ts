import type { Account } from './types';

export function playbackSpeed(account: Account | null, podcastUrl?: string) {
  return (podcastUrl ? account?.podcastSpeeds?.[podcastUrl] : undefined) ?? account?.settings.speed ?? 1;
}

export function seekPosition(value: number, duration: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(Number.isFinite(duration) && duration >= 0 ? duration : Infinity, value));
}

import type { Feed, Playback, ResumeCandidate } from './types';

export async function findResume(candidates: ResumeCandidate[], loadFeed: (url: string) => Promise<Feed>) {
  for (const saved of candidates) {
    if (!Number.isFinite(saved.position) || saved.position < 1) continue;
    if (saved.playback) {
      if (saved.playback.episode.duration > 0 && saved.position >= saved.playback.episode.duration) continue;
      return { ...saved.playback, position: saved.position };
    }
    try {
      const [url] = JSON.parse(saved.id);
      if (typeof url !== 'string') continue;
      const feed = await loadFeed(url);
      const episode = feed.episodes.find(ep => ep.id === saved.id);
      if (episode && (!episode.duration || saved.position < episode.duration)) {
        return { episode, podcast: feed, position: saved.position };
      }
    } catch { /* Older progress may refer to an unavailable feed. */ }
  }
  return null;
}

export function playbackSnapshot(item: Playback, duration: number): Playback {
  const { episode, podcast } = item;
  return {
    episode: { id: episode.id, title: episode.title, audio: episode.audio, artwork: episode.artwork, duration: Number.isFinite(duration) && duration > 0 ? duration : episode.duration, description: '', date: '' },
    podcast: { url: podcast.url, title: podcast.title, author: podcast.author, artwork: podcast.artwork },
  };
}

export function loadPaused(element: HTMLAudioElement, item: Playback, speed: number) {
  element.pause();
  element.src = item.episode.audio;
  element.playbackRate = speed;
  element.preservesPitch = true;
}

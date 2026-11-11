import type { Podcast } from './types';

export function formatListeningTime(seconds: number) {
  const totalMinutes = Math.round(seconds / 60);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor(totalMinutes % 1440 / 60);
  const minutes = totalMinutes % 60;
  return ([[days, 'day'], [hours, 'hour'], [minutes, 'minute']] as const)
    .filter(([count, unit]) => unit === 'minute' || count > 0)
    .map(([count, unit]) => `${count} ${unit}${count === 1 ? '' : 's'}`).join(', ');
}

export function listeningStats(progress: Record<string, number>, completed: Record<string, boolean>, podcasts: Record<string, Podcast> = {}) {
  const counts = new Map<string, {title: string; count: number}>();
  for (const [id, finished] of Object.entries(completed)) {
    const podcast = podcasts[id];
    if (!finished || !podcast) continue;
    const entry = counts.get(podcast.url);
    if (entry) entry.count++;
    else counts.set(podcast.url, {title: podcast.title, count: 1});
  }
  const mostPopular = [...counts.values()].sort((a, b) => b.count - a.count || a.title.localeCompare(b.title))[0]?.title ?? null;
  return {
    time: formatListeningTime(Object.values(progress).reduce((total, seconds) => total + seconds, 0)),
    episodes: Object.values(completed).filter(Boolean).length,
    mostPopular,
  };
}

import type { Episode } from './types';

export function sortEpisodes(episodes: Episode[], oldestFirst = false) {
  return [...episodes].sort((a, b) => {
    const first = Date.parse(a.date), second = Date.parse(b.date);
    if (Number.isNaN(first)) return Number.isNaN(second) ? 0 : 1;
    if (Number.isNaN(second)) return -1;
    return oldestFirst ? first - second : second - first;
  });
}

export function filterEpisodes(episodes: Episode[], query: string) {
  const term = query.trim().toLowerCase();
  return term ? episodes.filter(episode => `${episode.title} ${episode.description}`.toLowerCase().includes(term)) : episodes;
}

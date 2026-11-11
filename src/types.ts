export interface Podcast { url: string; title: string; author: string; artwork: string }
export interface Episode { id: string; title: string; audio: string; artwork: string; description: string; date: string; duration: number }
export interface Feed extends Podcast { description: string; episodes: Episode[] }
export interface Settings { speed: number; skipBack: number; skipForward: number }
export interface Account { settings: Settings; podcastSpeeds: Record<string, number>; subscriptions: Podcast[]; progress: Record<string, number>; completed: Record<string, boolean>; episodePodcasts: Record<string, Podcast>; history: ListeningHistory[]; resume: ResumeCandidate[] }
export interface Playback { episode: Episode; podcast: Podcast }
export interface ResumeCandidate { id: string; position: number; playback: Playback | null }

export interface ListeningHistory extends Playback { position: number; completed: boolean; updatedAt: number }

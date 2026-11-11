export interface Podcast { url: string; title: string; author: string; artwork: string }
export interface Episode { id: string; title: string; audio: string; artwork: string; description: string; date: string; duration: number }
export interface Feed extends Podcast { description: string; episodes: Episode[] }
export interface Settings { speed: number; skipBack: number; skipForward: number }
export interface Account { settings: Settings; subscriptions: Podcast[]; progress: Record<string, number>; resume: ResumeCandidate[] }
export interface Playback { episode: Episode; podcast: Podcast }
export interface ResumeCandidate { id: string; position: number; playback: Playback | null }

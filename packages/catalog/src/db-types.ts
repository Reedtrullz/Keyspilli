export interface SongRow {
  id: string;
  baseId: string;
  title: string;
  artist: string;
  category: string;
  difficulty: string;
  difficultyScore: number;
  key: string;
  tempo: number;
  style: string;
  mood: string;
  bassPattern: string;
  duration: number;
  contentType: string;
  acquiredVia: string | null;
  sourceYoutubeUrl: string | null;
  hasSheetXml: number;
  sections: string | null;
  plays: number;
  level: string;
  createdAt: string;
}

export interface JobRow {
  id: string;
  youtubeUrl: string;
  status: "queued" | "processing" | "done" | "error";
  songId: string | null;
  error: string | null;
  attempts?: number;
  startedAt?: string | null;
  createdAt: string;
  finishedAt: string | null;
}

export interface SongFilters {
  difficulty?: string;
  key?: string;
  style?: string;
  mood?: string;
  bassPattern?: string;
  category?: string;
  artist?: string;
  q?: string;
  sort?: "popular" | "title" | "artist" | "difficulty";
  limit?: number;
  offset?: number;
}

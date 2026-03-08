// Shared type definitions for the entire project

export type Platform = "bilibili" | "youtube";
export type TopicStatus = "idle" | "collecting" | "transcribing" | "done" | "error";
export type TaskType = "scrape" | "transcribe";
export type TaskStatus = "pending" | "running" | "done" | "failed";
export type TranscriptSource = "subtitle" | "groq_whisper" | "qwen_asr" | "local_whisper";

export interface Topic {
  id: string;
  name: string;
  platforms: Platform[];
  status: TopicStatus;
  videoCount: number;
  transcribedCount: number;
  creatorCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface Creator {
  id: string;
  platform: Platform;
  platformUid: string;
  name: string;
  avatarUrl?: string;
  followerCount?: number;
  videoCount: number;
  topicId: string;
}

export interface Video {
  id: string;
  platform: Platform;
  platformVideoId: string;
  title: string;
  description?: string;
  thumbnailUrl?: string;
  duration: number;
  viewCount?: number;
  likeCount?: number;
  publishedAt?: string;
  creatorId: string;
  creatorName: string;
  topicId: string;
  hasTranscript: boolean;
  transcriptSource?: TranscriptSource;
}

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}

export interface Transcript {
  videoId: string;
  source: TranscriptSource;
  language: string;
  segments: TranscriptSegment[];
  fullText: string;
}

export interface Task {
  id: string;
  topicId: string;
  type: TaskType;
  status: TaskStatus;
  progress: number;
  message?: string;
  errorMsg?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProgressUpdate {
  taskId: string;
  type: TaskType;
  status: TaskStatus;
  progress: number;
  message: string;
  detail?: {
    currentItem?: string;
    completed?: number;
    total?: number;
  };
}

export interface CreateTopicRequest {
  name: string;
  platforms: Platform[];
  maxCreators?: number;
  maxVideosPerCreator?: number;
}

export interface CollectRequest {
  topicId: string;
  skipExisting?: boolean;
}

export interface VideoListParams {
  topicId?: string;
  creatorId?: string;
  platform?: Platform;
  hasTranscript?: boolean;
  search?: string;
  page?: number;
  pageSize?: number;
}

export interface VideoListResponse {
  videos: Video[];
  total: number;
  page: number;
  pageSize: number;
}

export interface DashboardStats {
  totalTopics: number;
  totalVideos: number;
  totalTranscribed: number;
  totalCreators: number;
  transcriptionRate: number;
  platformBreakdown: {
    bilibili: number;
    youtube: number;
  };
  recentTopics: Topic[];
}

export interface KnowledgeSearchResult {
  videoId: string;
  videoTitle: string;
  creatorName: string;
  platform: Platform;
  relevantSegments: {
    text: string;
    startTime: number;
    endTime: number;
  }[];
  score: number;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  toolCalls?: {
    toolName: string;
    args: Record<string, unknown>;
    result?: unknown;
  }[];
  sources?: {
    videoId: string;
    videoTitle: string;
    creatorName: string;
    timestamp?: number;
  }[];
}

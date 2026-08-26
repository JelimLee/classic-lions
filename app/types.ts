
export enum Era {
  BAROQUE = 'Baroque',
  CLASSICAL = 'Classical',
  ROMANTIC = 'Romantic',
  MODERN = 'Modern/Contemporary'
}

export enum Instrument {
  PIANO = 'Piano',
  VIOLIN = 'Violin',
  CELLO = 'Cello',
  ORCHESTRA = 'Orchestra',
  OPERA = 'Opera'
}

export interface Concert {
  id: string;
  title: string;
  artist: string;
  venue: string;
  date: string;
  program: string[];
  imageUrl?: string;
  type: 'past' | 'upcoming';
  bookingUrl?: string;
  composer?: string;
  relevanceScore?: number;
  reason?: string;
  price?: number;
}

export interface AgentStep {
  step: string;
  label: string;
  input: string;
  output: string;
  durationMs: number;
}

export interface ChatMessage {
  role: 'user' | 'model';
  parts: { text: string }[];
  timestamp?: number;
  sources?: GroundingSource[];
  agentSteps?: AgentStep[];
}

export interface FeedbackEntry {
  concertTitle: string;
  composer: string;
  liked: boolean;
  reason: string;
  timestamp: number;
}

export interface ProgramNote {
  title: string;
  composer: string;
  opus: string;
  background: string;
  listeningTip: string;
  recommendedRecording: string;
}

export interface ProgramEnrichment {
  notes: ProgramNote[];
  sources: GroundingSource[];
}

export interface UserProfile {
  preferredEras: Era[];
  preferredInstruments: Instrument[];
  favoriteArtists: string[];
  favoriteComposers: string[];
  location: string;
  travelWillingness: boolean;
}

export interface SystemMetrics {
  accuracy: number;
  judgeFeedback: string;
  queryExpansionCount: number;
  candidatePoolSize: number;
  totalLatencyMs: number;
}

export interface GroundingSource {
  title?: string;
  uri?: string;
}

export interface HistoryStats {
  topComposers: { name: string; count: number }[];
  monthlyAttendance: { month: string; count: number }[];
  totalSpent: number;
}

export interface AdvancedSearchResponse {
  recommendations: Concert[];
  metrics: SystemMetrics;
  composerHits: Record<string, number>;
  sources: GroundingSource[];
  aiAnalysis?: string;
}

export interface OCRResult {
  title: string;
  artist: string;
  venue: string;
  date: string;
  program: string[];
}

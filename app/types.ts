
// OCR 관련 타입의 단일 출처는 services/ocrSchema.ts 다 (앱과 평가가 갈라지지 않도록).
export type { ParsedSeat, OCRFieldValue, RawOCRResponse, OCRResult } from './services/ocrSchema';
import type { ParsedSeat } from './services/ocrSchema';

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
  /** zero-padded YYYY-MM-DD. 정규화 실패한 값은 저장하지 않는다 */
  date: string;
  /** 인식한 날짜 원문 (검증/재파싱용으로 보존) */
  dateRaw?: string;
  /** HH:MM */
  time?: string;
  program: string[];
  imageUrl?: string;
  type: 'past' | 'upcoming';
  bookingUrl?: string;
  /** program에서 뽑은 대표 작곡가 */
  composer?: string;
  /** program에서 뽑은 작곡가 전체 */
  composers?: string[];
  /** 좌석 원문 */
  seatRaw?: string;
  /** 파싱된 좌석 */
  seat?: ParsedSeat;
  relevanceScore?: number;
  reason?: string;
  price?: number;
  /** OCR 필드별 신뢰도 스냅샷 (검수 이력) */
  ocrConfidence?: Record<string, number>;
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
  /** 이 턴의 분류 결과 */
  intent?: ChatIntent;
  /**
   * 이 응답에서 실제로 추천된 공연들. 피드백은 메시지가 아니라 이 카드 단위로 붙는다.
   * undefined = 아직 추출 중, [] = 추출했으나 특정 가능한 공연이 없음.
   */
  recommendations?: Concert[];
}

export type ChatIntent = 'recommendation' | 'statistics' | 'information' | 'general';

export interface FeedbackEntry {
  /** 더미가 아니라 실제 추천된 공연 */
  concertId: string;
  concertTitle: string;
  artist: string;
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
  totalCount: number;
  topComposers: { name: string; count: number }[];
  topVenues: { name: string; count: number }[];
  topArtists: { name: string; count: number }[];
  monthlyAttendance: { month: string; count: number }[];
  totalSpent: number;
  firstDate: string | null;
  lastDate: string | null;
}

export interface AdvancedSearchResponse {
  recommendations: Concert[];
  metrics: SystemMetrics;
  composerHits: Record<string, number>;
  sources: GroundingSource[];
  aiAnalysis?: string;
}



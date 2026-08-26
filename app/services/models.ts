/**
 * models.ts — 모델 ID 단일 출처
 *
 * 모델 ID를 코드 곳곳에 문자열로 흩뿌리지 않는다.
 * 평가 담당이 모델을 바꿔가며 A/B 하려면 여기 한 곳만 바뀌어야 한다.
 *
 * ⚠️ alias(`-latest`)를 쓰지 말 것. 평가 재현성이 깨진다. 명시적 버전으로 핀 고정.
 *
 * 2026-08-26 실측 기준 이 키에서 사용 가능한 ID:
 *   gemini-3-flash-preview / gemini-3.1-pro-preview / gemini-2.5-pro
 *   gemini-3.5-flash / gemini-3.6-flash / gemini-3.7-flash
 * (`gemini-3-pro-preview` 는 **존재하지 않는다** — 쓰면 런타임 404)
 */
export const MODELS = {
  /** 티켓 판독 (멀티모달) */
  ocr: 'gemini-3-flash-preview',
  /** 의도 분류 */
  intent: 'gemini-3-flash-preview',
  /** 쿼리 확장 */
  expand: 'gemini-3-flash-preview',
  /** 추천 카드 추출 / 피드백 요약 */
  utility: 'gemini-3-flash-preview',
  /** 프로그램 노트 생성 */
  enrich: 'gemini-3.1-pro-preview',
  /** 최종 응답 생성 */
  chat: 'gemini-3.1-pro-preview',
  /** 잡담 — Pro를 쓸 이유가 없다 */
  general: 'gemini-3-flash-preview',
} as const;

export type ModelRole = keyof typeof MODELS;

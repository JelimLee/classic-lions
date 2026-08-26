// app/services/ocrSchema.ts 를 import 한다.
// 이 파일은 "코드 담당" 소유물이다. 평가기는 프롬프트/스키마를 절대 복사하지 않는다.
// (복사하면 평가가 실제 앱과 갈라져서 측정이 무의미해진다.)
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const CONTRACT = `
필요한 named export (인터페이스 계약):
  export const OCR_MODEL: string
  export const OCR_PROMPT: string
  export const OCR_RESPONSE_SCHEMA: object
  export function parseSeat(raw: string): ParsedSeat
  export function normalizeDate(raw: string): { value: string|null; confidence: number }
`.trim();

export class SchemaModuleError extends Error {
  constructor(msg, { pending = false } = {}) { super(msg); this.pending = pending; }
}

const REQUIRED = ['OCR_MODEL', 'OCR_PROMPT', 'OCR_RESPONSE_SCHEMA', 'parseSeat', 'normalizeDate'];

export function defaultSchemaPath(rootDir) {
  return path.join(rootDir, 'app', 'services', 'ocrSchema.ts');
}

/**
 * @param {string} modPath  절대 경로 (.ts 또는 .mjs)
 * @returns {Promise<{mod:object, path:string}>}
 */
export async function loadOcrSchema(modPath) {
  if (!fs.existsSync(modPath)) {
    throw new SchemaModuleError(
      `코드 담당 산출물 대기 중 — ${modPath} 가 아직 없습니다.\n\n${CONTRACT}\n\n` +
      `이 파일이 생기면 평가 하네스는 수정 없이 그대로 동작합니다.`,
      { pending: true }
    );
  }

  let mod;
  try {
    mod = await import(pathToFileURL(modPath).href + `?t=${Date.now()}`);
  } catch (err) {
    if (err && err.code === 'ERR_MODULE_NOT_FOUND') {
      throw new SchemaModuleError(
        `${modPath} 는 존재하지만 의존 모듈을 찾지 못했습니다.\n  ${err.message}\n\n` +
        `대개 app/node_modules 미설치가 원인입니다. 해결:\n  (cd app && npm install)\n\n` +
        `참고: 계약상 ocrSchema.ts 는 브라우저/SDK 의존이 없는 순수 모듈이어야 합니다.`,
        { pending: true }
      );
    }
    if (err && (err.code === 'ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX' || /TypeScript/i.test(err.message || ''))) {
      throw new SchemaModuleError(
        `${modPath} 의 TypeScript 문법을 Node가 그대로 실행할 수 없습니다.\n  ${err.message}\n\n` +
        `Node의 타입 스트리핑은 enum / namespace / 파라미터 프로퍼티를 지원하지 않습니다.\n` +
        `해당 문법을 피하거나(권장), 'as const' 객체로 바꿔 주세요.`,
        { pending: true }
      );
    }
    throw new SchemaModuleError(`${modPath} import 실패:\n  ${err && err.message}`, { pending: false });
  }

  const missing = REQUIRED.filter((k) => mod[k] === undefined);
  if (missing.length) {
    throw new SchemaModuleError(
      `${modPath} 에서 다음 export가 빠졌습니다: ${missing.join(', ')}\n\n${CONTRACT}`,
      { pending: true }
    );
  }
  for (const fn of ['parseSeat', 'normalizeDate']) {
    if (typeof mod[fn] !== 'function') {
      throw new SchemaModuleError(`${modPath} 의 ${fn} 이 함수가 아닙니다 (실제: ${typeof mod[fn]}).`, { pending: true });
    }
  }
  return { mod, path: modPath };
}

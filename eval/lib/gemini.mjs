// Gemini REST 호출. SDK 의존 없음(app/node_modules 미설치 상태에서도 동작).
// 키는 URL이 아니라 헤더로 보낸다 — URL은 로그/에러에 그대로 찍히기 쉽다.
import { redact } from './env.mjs';

const BASE = 'https://generativelanguage.googleapis.com/v1beta';

export class GeminiError extends Error {
  constructor(msg, { status = 0, retriable = false } = {}) { super(msg); this.status = status; this.retriable = retriable; }
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

/**
 * 단일 이미지 OCR 호출.
 * @returns {{ json:any, rawText:string, latencyMs:number, usage:object, attempts:number, finishReason:string|null }}
 */
export async function generateOcr({ apiKey, model, prompt, schema, imageBase64, mimeType = 'image/jpeg', maxRetries = 4, timeoutMs = 90000, temperature }) {
  const body = {
    contents: [{
      role: 'user',
      parts: [
        { inline_data: { mime_type: mimeType, data: imageBase64 } },
        { text: prompt },
      ],
    }],
    generationConfig: {
      responseMimeType: 'application/json',
      ...(schema ? { responseSchema: schema } : {}),
      ...(typeof temperature === 'number' ? { temperature } : {}),
    },
  };

  let attempt = 0;
  let lastErr = null;
  const started = Date.now();

  while (attempt <= maxRetries) {
    attempt++;
    const t0 = Date.now();
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetch(`${BASE}/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify(body),
        signal: ctl.signal,
      });
      clearTimeout(timer);
      const latencyMs = Date.now() - t0;

      if (!res.ok) {
        const text = redact(await res.text().catch(() => ''), apiKey).slice(0, 800);
        const retriable = res.status === 429 || res.status === 408 || res.status >= 500;
        const err = new GeminiError(`HTTP ${res.status}: ${text}`, { status: res.status, retriable });
        if (!retriable) throw err;
        lastErr = err;
        const ra = Number(res.headers.get('retry-after'));
        const backoff = Number.isFinite(ra) && ra > 0 ? ra * 1000 : Math.min(32000, 1000 * 2 ** (attempt - 1)) + Math.random() * 500;
        if (attempt > maxRetries) break;
        await sleep(backoff);
        continue;
      }

      const data = await res.json();
      const cand = data.candidates && data.candidates[0];
      const finishReason = cand ? (cand.finishReason ?? null) : null;
      const rawText = (cand?.content?.parts || []).map((p) => p.text || '').join('');
      let json = null, parseError = null;
      try { json = rawText ? JSON.parse(rawText) : null; }
      catch (e) {
        // 코드펜스로 감싸 오는 경우 방어
        const m = rawText.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (m) { try { json = JSON.parse(m[1]); } catch (e2) { parseError = e2.message; } }
        else parseError = e.message;
      }
      return {
        json, rawText, parseError, finishReason,
        latencyMs, totalMs: Date.now() - started, attempts: attempt,
        usage: data.usageMetadata || null,
        promptFeedback: data.promptFeedback || null,
      };
    } catch (e) {
      clearTimeout(timer);
      if (e instanceof GeminiError && !e.retriable) throw e;
      lastErr = e.name === 'AbortError' ? new GeminiError(`타임아웃 ${timeoutMs}ms`, { retriable: true }) : e;
      if (attempt > maxRetries) break;
      await sleep(Math.min(32000, 1000 * 2 ** (attempt - 1)) + Math.random() * 500);
    }
  }
  throw new GeminiError(`재시도 ${maxRetries}회 모두 실패: ${redact(lastErr && lastErr.message, apiKey)}`, { status: lastErr?.status || 0 });
}

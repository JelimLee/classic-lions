import path from 'path';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * ⚠️⚠️ 보안 경고 — 이 설정은 **로컬 개발 전용**이다 ⚠️⚠️
 *
 * 아래 `define`은 Vite의 빌드 시점 **문자열 치환**이다.
 * `process.env.API_KEY` 가 번들 JS에 **평문으로 그대로 박힌다.**
 * 즉 `npm run build` 결과물을 어디든 올리는 순간, 누구나 DevTools →
 * Sources에서 Gemini API 키를 그대로 꺼내 쓸 수 있다.
 *
 *   - 로컬에서 `npm run dev` 로 돌려보는 용도로만 쓸 것
 *   - dist/ 를 배포하거나 시연 링크로 공유하지 말 것
 *   - 배포가 필요해지면 키를 서버(서버리스 프록시)로 옮기고 이 define을 삭제할 것
 *     (ARCHITECTURE.md 2-1 / 7단계 "0. 지혈" 참고)
 *
 * 키가 없거나 자리표시자일 때는 앱이 조용히 실패하지 않고 화면에 이유를 띄운다
 * (services/geminiService.ts 의 MissingApiKeyError).
 */
function apiKeyWarningPlugin(hasKey: boolean): Plugin {
  return {
    name: 'classic-lions:api-key-warning',
    apply: 'build',
    buildStart() {
      const bar = '='.repeat(72);
      if (hasKey) {
        this.warn(
          `\n${bar}\n` +
          `  ⚠️  프로덕션 빌드에 GEMINI_API_KEY가 평문으로 포함됩니다.\n` +
          `      이 dist/ 를 공개된 곳에 배포하면 키가 즉시 유출됩니다.\n` +
          `      배포하려면 먼저 서버리스 프록시로 키를 옮기세요.\n` +
          `      (자세한 내용: app/README.md, ARCHITECTURE.md)\n` +
          `${bar}\n`,
        );
      } else {
        this.warn(
          `\n${bar}\n` +
          `  ⚠️  GEMINI_API_KEY가 비어 있습니다. 빌드는 되지만 모든 AI 기능이 실패합니다.\n` +
          `      app/.env 에 GEMINI_API_KEY=... 를 설정하세요.\n` +
          `${bar}\n`,
        );
      }
    },
  };
}

export default defineConfig(({ mode }) => {
  // .env / .env.[mode] / .env.local 순으로 읽는다.
  const env = loadEnv(mode, '.', '');
  const apiKey = (env.GEMINI_API_KEY || '').trim();

  return {
    server: {
      port: 3000,
      host: '0.0.0.0',
    },
    plugins: [react(), apiKeyWarningPlugin(apiKey.length >= 10)],
    define: {
      // ⚠️ 위 주석 참고 — 번들에 평문으로 박힌다. 로컬 개발 전용.
      'process.env.API_KEY': JSON.stringify(apiKey),
      'process.env.GEMINI_API_KEY': JSON.stringify(apiKey),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
  };
});

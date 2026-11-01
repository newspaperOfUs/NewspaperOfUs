import { loadEnv, type Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

/**
 * Token tarayıcıda yaşadığı için production build'e sıkı bir CSP koyuyoruz:
 * site sadece kendi dosyalarını yükler ve sadece GitHub API ile konuşur.
 */
function csp(apiBase: string): Plugin {
  const policy = [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self'",
    `connect-src ${apiBase}`,
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
  return {
    name: 'nou-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(
        '<head>',
        `<head>\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`,
      );
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  return {
    // Pages alt yolda (/NewspaperOfUs/) yayınlanıyor; göreli yollar her yerde çalışır.
    base: './',
    plugins: [csp(env.VITE_GITHUB_API || 'https://api.github.com')],
    build: { target: 'es2022', chunkSizeWarningLimit: 1200 },
    // tests/e2e altındakiler Playwright'a ait.
    test: { include: ['tests/*.test.ts'] },
  };
});

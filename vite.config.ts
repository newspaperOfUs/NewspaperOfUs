import { loadEnv, type Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

/**
 * Token tarayıcıda yaşadığı için production build'e sıkı bir CSP koyuyoruz.
 * 'self' yerine tam yol kullanılır: aynı origin'deki başka projelerin dosyaları buraya yüklenemez.
 * API de yalnızca veri reposuyla sınırlıdır: token ele geçse bile sayfadan başka repoya veri yazılamaz.
 */
function csp(siteUrl: string, dataRepoApi: string): Plugin {
  // Geçersiz adres CSP'yi bozmasın; "/" ile bitmeyen adres de dosyaları dışarıda bırakır.
  const site = new URL(siteUrl).href;
  if (!site.endsWith('/')) throw new Error(`VITE_SITE_URL "/" ile bitmeli: ${site}`);
  const policy = [
    "default-src 'none'",
    `script-src ${site}`,
    `style-src ${site} 'unsafe-inline'`,
    `img-src ${site} blob: data:`,
    `font-src ${site}`,
    `connect-src ${dataRepoApi} ${dataRepoApi}/`,
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
    plugins: [
      csp(
        // Actions yayınlarken VITE_SITE_URL'yi kendisi verir; site taşınsa da doğru kalır.
        env.VITE_SITE_URL || process.env.VITE_SITE_URL || 'https://emirhankskn.github.io/NewspaperOfUs/',
        // src/config.ts ile aynı varsayılanlar.
        `${env.VITE_GITHUB_API || 'https://api.github.com'}/repos/${env.VITE_DATA_OWNER || 'emirhankskn'}/${env.VITE_DATA_REPO || 'NewspaperOfUs-data'}`,
      ),
    ],
    build: { target: 'es2022', chunkSizeWarningLimit: 1200 },
    // tests/e2e altındakiler Playwright'a ait.
    test: { include: ['tests/*.test.ts'] },
  };
});

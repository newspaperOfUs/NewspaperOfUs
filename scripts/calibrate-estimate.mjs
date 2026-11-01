// Sayfa tahmininin (src/newspaper/estimate.ts) gerçek dizgiyle karşılaştırması.
//   node scripts/calibrate-estimate.mjs [--seeds 1,2,3,4,5,6] [--only 3k,5x2k] [--json dosya.json]
import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';

const { values } = parseArgs({
  options: {
    seeds: { type: 'string', default: '1,2,3,4,5,6' },
    only: { type: 'string' },
    json: { type: 'string' },
  },
});

// [ad, yazı sayısı, karakter, fotoğraf]. Karakter 'mix' ise gerçek arşiv gibi her yazı farklı uzunlukta ve fotoğraflıdır.
const SCENARIOS = [
  ['mix5', 5, 'mix', 0], ['mix10', 10, 'mix', 0], ['mix20', 20, 'mix', 0], ['mix50', 50, 'mix', 0], ['mix100', 100, 'mix', 0], ['mix150', 150, 'mix', 0],
  ['tiny', 1, 60, 0], ['tiny+1', 1, 60, 1],
  ['1k', 1, 1000, 0], ['1k+1', 1, 1000, 1], ['1k+3', 1, 1000, 3], ['1k+6', 1, 1000, 6], ['1k+12', 1, 1000, 12], ['1k+30', 1, 1000, 30],
  ['0k+4', 1, 0, 4], ['0k+20', 1, 0, 20], ['0k+60', 1, 0, 60],
  ['3k', 1, 3000, 0], ['3k+2', 1, 3000, 2], ['3k+4', 1, 3000, 4],
  ['6k', 1, 6000, 0], ['6k+2', 1, 6000, 2], ['6k+6', 1, 6000, 6],
  ['10k', 1, 10000, 0], ['10k+3', 1, 10000, 3],
  ['15k', 1, 15000, 0], ['15k+3', 1, 15000, 3],
  ['25k', 1, 25000, 0], ['25k+5', 1, 25000, 5],
  ['50k', 1, 50000, 0], ['50k+10', 1, 50000, 10],
  ['100k', 1, 100000, 0],
  ['2x500', 2, 500, 1], ['2x2k', 2, 2000, 1], ['2x6k+2', 2, 6000, 2],
  ['3x800', 3, 800, 1], ['3x3k', 3, 3000, 1], ['3x5k+2', 3, 5000, 2],
  ['5x300', 5, 300, 0], ['5x800', 5, 800, 1], ['5x2k', 5, 2000, 1], ['5x4k+2', 5, 4000, 2],
  ['8x800', 8, 800, 1], ['8x2k', 8, 2000, 1],
  ['10x200', 10, 200, 0], ['10x1k', 10, 1000, 1], ['10x3k+2', 10, 3000, 2],
  ['20x500', 20, 500, 1], ['20x1500', 20, 1500, 1], ['20x4k+3', 20, 4000, 3],
  ['50x300', 50, 300, 0], ['50x1k', 50, 1000, 1], ['50x3k+2', 50, 3000, 2],
  ['100x800', 100, 800, 1],
  ['150x1k', 150, 1000, 1],
];

const seeds = values.seeds.split(',').map(Number);
const only = values.only ? new Set(values.only.split(',')) : null;

const server = await createServer({ server: { port: 5198, strictPort: false, hmr: false, watch: null }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch();
const page = await browser.newPage();
page.on('pageerror', (e) => console.error('pageerror:', e.message));
await page.goto(server.resolvedUrls.local[0]);

const rows = [];
for (const [name, count, chars, photos] of SCENARIOS) {
  if (only && !only.has(name)) continue;
  const row = await page.evaluate(
    async ({ count, chars, photos, seeds }) => {
      const { countPages } = await import('/src/newspaper/index.ts');
      const { docStats, estimatePages } = await import('/src/newspaper/estimate.ts');
      const paragraph =
        'O sabah uyandığımızda dışarıda ince bir yağmur vardı ve ikimiz de hiçbir yere gitmek istemiyorduk. Kahveyi demledik, pencerenin önüne oturduk ve uzun uzun sokaktan geçenleri izledik. Şemsiyesini ters çeviren adama güldük, sonra kendi halimize güldük. Öğleden sonra hava açınca sahile doğru yürümeye karar verdik.';
      const makeDoc = (length) => {
        const content = [];
        for (let left = length; left > 0; left -= paragraph.length) {
          content.push({ type: 'paragraph', content: [{ type: 'text', text: paragraph.slice(0, Math.min(left, paragraph.length)) }] });
        }
        return { type: 'doc', content };
      };
      const load = () => Promise.reject(new Error('dizgide fotoğraf yüklenmez'));
      // Sabit dizi: her çalıştırmada aynı karışım.
      const MIX_CHARS = [300, 600, 900, 1500, 250, 2500, 800, 1200, 4000, 500, 700, 1800];
      const MIX_PHOTOS = [0, 1, 1, 2, 3, 0, 1, 5, 2, 0, 1, 4, 0];
      const mixed = chars === 'mix';
      const posts = Array.from({ length: count }, (_, i) => ({
        id: `p${i}`,
        title: `Yazı numarası ${i + 1} için güzel bir başlık`,
        author: 'Emir',
        date: '2026-10-01',
        doc: makeDoc(mixed ? MIX_CHARS[i % MIX_CHARS.length] : chars),
        // Üçte biri dikey: telefon fotoğrafları böyle gelir.
        photos: Array.from({ length: mixed ? MIX_PHOTOS[i % MIX_PHOTOS.length] : photos }, (_, n) =>
          n % 3 === 2 ? { load, w: 1600, h: 2400, caption: '' } : { load, w: 2400, h: 1600, caption: '' },
        ),
      }));
      const estimate = estimatePages(posts.map((post) => docStats(post.doc, post.photos.length)));
      const pages = [];
      const started = performance.now();
      for (const seed of seeds) {
        pages.push((await countPages({ name: 'The Newspaper of Us', posts, seed, volume: 1, issueNumber: 1 })).pageCount);
      }
      return { estimate, pages, ms: Math.round((performance.now() - started) / seeds.length) };
    },
    { count, chars, photos, seeds },
  );
  const inRange = row.pages.filter((p) => p >= row.estimate.min && p <= row.estimate.max).length;
  const near = row.pages.filter((p) => p >= row.estimate.min - 1 && p <= row.estimate.max + 1).length;
  rows.push({ name, ...row, inRange, near });
  const label = row.estimate.min === row.estimate.max ? `${row.estimate.max}` : `${row.estimate.min}-${row.estimate.max}`;
  console.log(`${name.padEnd(9)} tahmin ${label.padEnd(7)} gerçek ${row.pages.join(' ').padEnd(26)} isabet ${inRange}/${row.pages.length}  ${row.ms} ms`);
}

const total = rows.reduce((sum, r) => sum + r.pages.length, 0);
const hit = rows.reduce((sum, r) => sum + r.inRange, 0);
const close = rows.reduce((sum, r) => sum + r.near, 0);
console.log(`\nAralık içinde: ${hit}/${total} (%${Math.round((hit / total) * 100)}) · en fazla 1 sayfa sapma: ${close}/${total} (%${Math.round((close / total) * 100)})`);
if (values.json) writeFileSync(values.json, JSON.stringify(rows, null, 1));

await browser.close();
await server.close();

// Gazete motorunun görsel kontrolü: GitHub olmadan örnek yazılarla gerçek tarayıcıda PNG üretir.
//   node scripts/render-samples.mjs --photos <klasör> --out <klasör> [--cases a,b] [--seeds 1,2] [--era wartime] [--full]
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { chromium, webkit } from '@playwright/test';
import { createServer } from 'vite';

const { values } = parseArgs({
  options: {
    photos: { type: 'string' },
    out: { type: 'string' },
    cases: { type: 'string' },
    seeds: { type: 'string', default: '1,2,3' },
    era: { type: 'string' },
    browser: { type: 'string', default: 'chromium' },
    full: { type: 'boolean', default: false },
  },
});

const paragraph = (text, marks) => ({
  type: 'paragraph',
  content: [{ type: 'text', text, ...(marks ? { marks } : {}) }],
});

const TEXT = [
  'O sabah uyandığımızda dışarıda ince bir yağmur vardı ve ikimiz de hiçbir yere gitmek istemiyorduk. Kahveyi demledik, pencerenin önüne oturduk ve uzun uzun sokaktan geçenleri izledik. Şemsiyesini ters çeviren adama güldük, sonra kendi halimize güldük.',
  'Öğleden sonra hava açınca sahile doğru yürümeye karar verdik. Yol boyunca çocukluğumuzdan, eski mahallelerimizden ve hiç gitmediğimiz şehirlerden konuştuk. Martılar simidimizin peşine düştü, ben yarısını kaptırdım, sen de buna günlerce güldün.',
  'Akşam olduğunda küçük bir balıkçıya girdik. Garson bizi yıllardır tanıyormuş gibi karşıladı; ısrarla en güzel masayı verdi. Şişenin yarısına geldiğimizde birbirimize söz verdik: her yıl bugün, ne olursa olsun, buraya geri geleceğiz.',
  'Dönüş yolunda otobüs kaçınca yürümek zorunda kaldık. Ayakkabılarımız ıslanmıştı, üşüyorduk ve neredeyse bütün şehri boydan boya geçtik. Yine de o gece, bugüne kadar geçirdiğimiz en güzel gecelerden biriydi; çünkü hiçbir şeyin önemi yoktu, yanımda sen vardın.',
  'Eve geldiğimizde çayı koyduk, battaniyeyi kaptık ve filmi yarıda bırakıp uyuyakaldık. Sabah kalktığımızda ikimizin de boynu tutulmuştu. Bu gazeteyi yıllar sonra okuduğumuzda, o küçük ağrıyı bile özleyeceğimizi şimdiden biliyorum.',
];

const FILM = [
  'Dün gece izlediğimiz film hakkında uzun uzun tartıştık. Sen başından beri katilin komşu olduğunu söyledin, ben ise son sahneye kadar inanmadım. İtiraf ediyorum: haklıydın. Bunu bir daha yazılı olarak görmeyeceksin, tadını çıkar.',
  'Görüntü yönetmeni şehri bir karakter gibi kullanmış. Özellikle gece çekilen tren sahnesinde ikimiz de nefesimizi tuttuk. Müzik biraz fazla bağırıyordu ama finaldeki sessizlik hepsini affettirdi.',
];

const rich = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Bu yazı ' },
        { type: 'text', text: 'kalın', marks: [{ type: 'bold' }] },
        { type: 'text', text: ', ' },
        { type: 'text', text: 'italik', marks: [{ type: 'italic' }] },
        { type: 'text', text: ', ' },
        { type: 'text', text: 'altı çizili', marks: [{ type: 'underline' }] },
        { type: 'text', text: ' ve ' },
        { type: 'text', text: 'kıpkırmızı', marks: [{ type: 'textStyle', attrs: { color: '#c0271f' } }, { type: 'bold' }] },
        { type: 'text', text: ' kelimeler içeriyor; bir de ' },
        { type: 'text', text: 'lacivert italik', marks: [{ type: 'textStyle', attrs: { color: '#1d3a8a' } }, { type: 'italic' }] },
        { type: 'text', text: ' olanlar var. ' + TEXT[0] },
      ],
    },
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Akşamın en güzel anı' }] },
    paragraph(TEXT[1]),
    { type: 'blockquote', content: [paragraph('Her yıl bugün, ne olursa olsun, buraya geri geleceğiz.')] },
    paragraph(TEXT[2]),
    {
      type: 'bulletList',
      content: ['Sıcak çay', 'Battaniye', 'Yarıda kalan film'].map((t) => ({
        type: 'listItem',
        content: [paragraph(t)],
      })),
    },
    { type: 'horizontalRule' },
    paragraph(TEXT[3]),
  ],
};

const doc = (paragraphs) => ({ type: 'doc', content: paragraphs.map((t) => paragraph(t)) });
const longText = Array.from({ length: 40 }, (_, i) => TEXT[i % TEXT.length]);

const post = (id, title, author, date, content, photos = []) => ({ id, title, author, date, doc: content, photoIdx: photos });

const CASES = {
  single: [post('a', 'Yağmurlu Pazarın Ardından Sahilde Unutulmaz Bir Gün', 'Emir', '2026-10-18', doc(TEXT), [0])],
  rich: [post('a', 'Her Yıl Bugün, Aynı Masada', 'Emir', '2026-10-18', rich, [1])],
  two: [
    post('a', 'İlk Birlikte Tatilimiz', 'Emir', '2026-08-02', doc(TEXT.slice(0, 4)), [0, 3]),
    post('b', 'Bu Filmi Neden Sevdik?', 'Ayşe', '2026-09-11', doc(FILM), [2]),
  ],
  three: [
    post('a', 'Kapadokya Sabahında Balonlar Havalandı', 'Emir', '2026-05-14', doc(TEXT), [2, 4]),
    post('b', 'Katil Yine Komşu Çıktı', 'Ayşe', '2026-09-11', doc(FILM), [1]),
    post('c', 'Mutfakta Büyük Karnıyarık Faciası', 'Emir', '2026-07-22', doc(TEXT.slice(1, 3))),
  ],
  five: [
    post('a', 'Şehirde Yağmur, Evde Çay', 'Emir', '2026-10-18', doc(TEXT), [0]),
    post('b', 'Katil Yine Komşu Çıktı', 'Ayşe', '2026-09-11', doc(FILM), [1]),
    post('c', 'İğneada Yolunda Kaybolduk', 'Emir', '2026-07-22', doc(TEXT.slice(0, 2)), [2]),
    post('d', 'Yılbaşı Gecesi Şarkı Söyledik', 'Ayşe', '2026-01-01', doc(TEXT.slice(2, 4))),
    post('e', 'Kedimiz Çiçeği Yedi', 'Ayşe', '2026-03-03', doc([FILM[1]]), [3]),
  ],
  short: [post('a', 'Seni Seviyorum', 'Emir', '2026-02-14', doc(['Bugün sana bunu yazmak istedim. Bu kadar.']))],
  shortphoto: [post('a', 'O Gün', 'Ayşe', '2026-06-01', doc(['Sadece bu fotoğrafı buraya koymak istedim.']), [1])],
  long: [post('a', 'Uzun Bir Yolculuğun Hikâyesi', 'Emir', '2026-04-04', doc(longText), [0, 1])],
  photos: [
    post('a', 'Yaz Albümü', 'Ayşe', '2026-08-30', doc(TEXT.slice(0, 1)), [0, 1, 2, 3, 4, 5, 6, 7, 0, 1, 2, 3]),
  ],
  mixed: [
    post('a', 'Sahilde Unutulmaz Bir Gün', 'Emir', '2026-07-03', doc(['O sabah uyandığımızda dışarıda ince bir yağmur vardı. Kahveyi demledik ve uzun uzun sokaktan geçenleri izledik.']), [0, 1]),
    post('b', 'Bu Filmi Neden Sevdik?', 'Ayşe', '2026-09-11', doc(['Dün gece izlediğimiz film hakkında uzun uzun tartıştık. Katil yine komşu çıktı.'])),
  ],
  vertical: [
    post('a', 'Telefonla Çekilmiş Bir Gün', 'Emir', '2026-07-03', doc(TEXT.slice(0, 3)), [1, 5, 1]),
    post('b', 'Küçük Bir Not', 'Ayşe', '2026-09-11', doc(FILM), [5]),
    post('c', 'Bir Dikey Daha', 'Ayşe', '2026-09-12', doc(TEXT.slice(3)), [1]),
  ],
  longtitle: [
    post(
      'a',
      'Çok Uzun Bir Başlık: İkimizin Bir Pazar Sabahı Çıktığı Ama Bir Türlü Bitiremediği O Kısacık Yürüyüşün Hazin Öyküsü',
      'Emir',
      '2026-04-04',
      doc(TEXT.slice(0, 2)),
      [2],
    ),
  ],
};

const photoDir = values.photos;
const photoFiles = readdirSync(photoDir).filter((f) => /\.(jpe?g|png)$/i.test(f)).sort();
const photoUrls = photoFiles.map((f) => `data:image/jpeg;base64,${readFileSync(join(photoDir, f)).toString('base64')}`);
mkdirSync(values.out, { recursive: true });

const server = await createServer({ server: { port: 5199, strictPort: false }, logLevel: 'error' });
await server.listen();
const base = server.resolvedUrls.local[0];
const browser = await (values.browser === 'webkit' ? webkit : chromium).launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
page.on('pageerror', (e) => console.error('pageerror:', e.message));
page.on('console', (m) => m.type() === 'error' && console.error('console:', m.text()));
await page.goto(base);

const wanted = values.cases ? values.cases.split(',') : Object.keys(CASES);
const seeds = values.seeds.split(',').map(Number);

for (const name of wanted) {
  for (const seed of seeds) {
    const started = Date.now();
    const result = await page.evaluate(
      async ({ posts, seed, era, photoUrls }) => {
        const { renderNewspaper } = await import('/src/newspaper/index.ts');
        const load = async (url) => {
          const img = new Image();
          img.src = url;
          await img.decode();
          return img;
        };
        const images = await Promise.all(photoUrls.map(load));
        const input = posts.map((p) => ({
          ...p,
          photos: p.photoIdx.map((i) => ({
            source: images[i % images.length],
            w: images[i % images.length].naturalWidth,
            h: images[i % images.length].naturalHeight,
            caption: i % 3 === 0 ? 'Sahilde, gün batımına doğru yürürken.' : '',
          })),
        }));
        const out = await renderNewspaper({ name: 'The Newspaper of Us', posts: input, seed, volume: 1, issueNumber: 12, era });
        const pages = out.pages.map((canvas) => {
          const preview = document.createElement('canvas');
          preview.width = 1100;
          preview.height = Math.round((canvas.height / canvas.width) * 1100);
          const ctx = preview.getContext('2d');
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(canvas, 0, 0, preview.width, preview.height);
          return { preview: preview.toDataURL('image/jpeg', 0.88), png: canvas.toDataURL('image/png') };
        });
        return { styleName: out.styleName, pages };
      },
      { posts: CASES[name], seed, era: values.era, photoUrls },
    );
    result.pages.forEach((p, i) => {
      const file = join(values.out, `${name}-s${seed}-p${i + 1}.jpg`);
      writeFileSync(file, Buffer.from(p.preview.split(',')[1], 'base64'));
      if (values.full) writeFileSync(file.replace(/\.jpg$/, '.png'), Buffer.from(p.png.split(',')[1], 'base64'));
    });
    const sizeMb = result.pages.map((p) => ((p.png.length * 0.75) / 1048576).toFixed(1)).join('+');
    console.log(`${name} seed=${seed}: ${result.styleName} | ${result.pages.length} sayfa | ${sizeMb} MB PNG | ${Date.now() - started} ms`);
  }
}

await browser.close();
await server.close();

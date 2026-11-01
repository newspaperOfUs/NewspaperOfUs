import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { crc32 } from 'node:zlib';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

const API = 'http://localhost:4599';
const TOKEN = 'good-token';

const control = (action: string) => fetch(`${API}/__test/${action}`).then((r) => r.json());

interface RepoState {
  files: Record<string, any>;
  messages: string[];
}
const repo = (): Promise<RepoState> => control('state');

/** Test için tarayıcıda gerçek bir JPEG üretir. */
async function makePhoto(page: Page, w: number, h: number, hue: number): Promise<Buffer> {
  const data = await page.evaluate(
    ({ w, h, hue }) => {
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d')!;
      const gradient = ctx.createLinearGradient(0, 0, w, h);
      gradient.addColorStop(0, `hsl(${hue},70%,75%)`);
      gradient.addColorStop(1, `hsl(${hue + 60},60%,25%)`);
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(w / 2, h / 2, Math.min(w, h) / 4, 0, Math.PI * 2);
      ctx.fill();
      return canvas.toDataURL('image/jpeg', 0.9);
    },
    { w, h, hue },
  );
  return Buffer.from(data.split(',')[1], 'base64');
}

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    // Sadece CSP ihlallerini ve beklenmeyen hataları topla; HTTP 401/409 logları beklenen akış.
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text());
  });
  return errors;
}

async function login(page: Page, name: string, remember = true) {
  await page.goto('/');
  await page.fill('#token', TOKEN);
  await page.fill('#name', name);
  await page.setChecked('#remember', remember);
  await page.click('button[type=submit]');
  await expect(page.locator('.feed')).toBeVisible();
}

async function newContext(browser: Browser, base: BrowserContext): Promise<BrowserContext> {
  return browser.newContext({ baseURL: 'http://localhost:4173', ...(base as any)._options });
}

async function writePost(page: Page, title: string, body: string, photos: Buffer[] = [], tags: string[] = []) {
  await page.goto('/#/yeni');
  await page.fill('.title-input', title);
  await page.click('.tiptap');
  await page.keyboard.type(body);
  for (const tag of tags) {
    await page.fill('.tag-input', tag);
    await page.press('.tag-input', 'Enter');
  }
  if (photos.length) {
    await page.setInputFiles(
      'input[type=file]',
      photos.map((buffer, i) => ({ name: `foto${i}.jpg`, mimeType: 'image/jpeg', buffer })),
    );
    await expect(page.locator('.gallery-edit-item')).toHaveCount(photos.length);
  }
  await page.getByRole('button', { name: 'Yayınla' }).click();
  await expect(page).toHaveURL(/#\/yazi\//);
}

test.beforeEach(async () => {
  await control('reset');
});

test('yanlış token içeriğe erişemez, hiçbir şey saklanmaz', async ({ page }) => {
  await page.goto('/');
  await page.fill('#token', 'yanlis-token');
  await page.fill('#name', 'Emir');
  await page.click('button[type=submit]');
  await expect(page.locator('.error')).toContainText('Anahtar yanlış');
  await expect(page.locator('.feed')).toHaveCount(0);
  const stored = await page.evaluate(() => [localStorage.length, sessionStorage.length]);
  expect(stored).toEqual([0, 0]);
});

test('cihazı hatırla: yenileyince girişte kalır; seçilmezse token kalıcı saklanmaz', async ({ page, context }) => {
  await login(page, 'Emir', true);
  await page.reload();
  await expect(page.locator('.feed')).toBeVisible();
  await expect(page.locator('#token')).toHaveCount(0);

  // Yeni sekme de hatırlar
  const second = await context.newPage();
  await second.goto('/');
  await expect(second.locator('.feed')).toBeVisible();
  await second.close();

  await page.getByRole('button', { name: 'Çıkış', exact: true }).click();
  await page.getByRole('button', { name: 'Çıkış yap' }).click();
  await expect(page.locator('#token')).toBeVisible();
  expect(await page.evaluate(() => localStorage.length + sessionStorage.length)).toBe(0);

  await login(page, 'Emir', false);
  expect(await page.evaluate(() => localStorage.length)).toBe(0);
  expect(await page.evaluate(() => sessionStorage.length)).toBe(1);

  // Sekme kapanınca unutulur: yeni sekme tekrar giriş ister.
  const fresh = await context.newPage();
  await fresh.goto('/');
  await expect(fresh.locator('#token')).toBeVisible();
});

test('süresi dolan token girişe döndürür ve cihazdan silinir', async ({ page }) => {
  await login(page, 'Emir');
  await control('revoke');
  await page.reload();
  await expect(page.locator('#token')).toBeVisible();
  await expect(page.locator('.error')).toContainText('geçerli değil');
  expect(await page.evaluate(() => localStorage.length)).toBe(0);
});

test('zengin metin, galeri ve tek commit kayıt', async ({ page }) => {
  const errors = watchErrors(page);
  await login(page, 'Emir');
  await expect(page.locator('.empty')).toContainText('ilk sayısı');

  await page.goto('/#/yeni');
  await page.fill('.title-input', 'Çığ gibi şölen: İğneada’da güzel gün');
  await page.click('.tiptap');
  await page.locator('.tool-b').click();
  await page.keyboard.type('kalin ');
  await page.locator('.tool-b').click();
  await page.keyboard.type('renkli');
  // Son kelimeyi seçip renk ver: anlık renk değişimi
  for (let i = 0; i < 6; i++) await page.keyboard.press('Shift+ArrowLeft');
  await page.getByRole('button', { name: 'Yazı rengi: Kırmızı' }).click();
  await page.keyboard.press('ArrowRight');
  // İnsan hızı: editör seçim değişikliğini tarayıcıdan bir sonraki olayda öğrenir.
  await page.waitForTimeout(60);
  await page.keyboard.press('Enter');
  await page.locator('.tool-i').click();
  await page.keyboard.type('italik');

  const landscape = await makePhoto(page, 3200, 2000, 30);
  const portrait = await makePhoto(page, 1000, 1500, 200);
  await page.setInputFiles('input[type=file]', [
    { name: 'a.jpg', mimeType: 'image/jpeg', buffer: landscape },
    { name: 'b.jpg', mimeType: 'image/jpeg', buffer: portrait },
  ]);
  await expect(page.locator('.gallery-edit-item')).toHaveCount(2);
  await page.locator('.caption-input').first().fill('Sahilde gün batımı');
  await page.getByRole('button', { name: 'Arkaya al' }).first().click();

  await page.getByRole('button', { name: 'Yayınla' }).click();
  await expect(page).toHaveURL(/#\/yazi\//);

  // Görünüm biçimleri korudu mu?
  await expect(page.locator('.prose strong')).toHaveText('kalin ');
  await expect(page.locator('.prose em')).toContainText('italik');
  const colored = page.locator('.prose span[style*="color"]');
  await expect(colored.first()).toHaveText('renkli');
  await expect(page.locator('.gallery-item')).toHaveCount(2);
  await expect(page.locator('.gallery-item img').first()).toHaveJSProperty('complete', true);

  // Repodaki durum
  const state = await repo();
  const postPath = Object.keys(state.files).find((p) => p.startsWith('posts/'))!;
  const post = state.files[postPath];
  expect(post.author).toBe('Emir');
  expect(post.title).toBe('Çığ gibi şölen: İğneada’da güzel gün');
  expect(post.images).toHaveLength(2);
  // Sıra değişikliği ve altyazı korundu: dikey foto öne geçti, altyazı yatayda kaldı
  expect(post.images[0].w).toBeLessThan(post.images[0].h);
  expect(post.images[1].caption).toBe('Sahilde gün batımı');
  // Büyük foto küçültüldü
  expect(post.images[1].w).toBe(2400);
  for (const image of post.images) {
    expect(state.files[image.path]).toBeGreaterThan(0);
    expect(state.files[image.thumb]).toBeGreaterThan(0);
    expect(state.files[image.thumb]).toBeLessThan(state.files[image.path]);
  }
  // Fotoğraflar + yazı tek commit (README commit'i hariç)
  expect(state.messages).toHaveLength(2);
  expect(state.messages[0]).toContain('Yeni yazı');
  // Token hiçbir dosyaya sızmadı
  expect(JSON.stringify(post)).not.toContain(TOKEN);

  // Lightbox
  await page.locator('.gallery-item').first().click();
  await expect(page.locator('.lightbox-img')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.lightbox')).toHaveCount(0);

  // Yeniden yüklenince de aynı
  await page.reload();
  await expect(page.locator('.prose strong')).toHaveText('kalin ');
  expect(errors).toEqual([]);
});

test('iki kişi aynı token ile birbirinin yazısını görür; aynı anda kayıtta veri kaybolmaz', async ({ page, browser, context }) => {
  await login(page, 'Emir');
  await writePost(page, 'Emir’in yazısı', 'Birinci yazı içeriği.');

  const herContext = await newContext(browser, context);
  const her = await herContext.newPage();
  await login(her, 'Sevgilim');
  await expect(her.locator('.card-title')).toContainText(['Emir’in yazısı']);

  // Tam kayıt anında başkası commit atıyor: 422 → yeniden deneme → ikisi de kalır.
  await control('race');
  await writePost(her, 'Onun yazısı', 'İkinci yazı içeriği.');
  const state = await repo();
  expect(state.files['baskasi.txt']).toBeGreaterThan(0);
  expect(Object.keys(state.files).filter((p) => p.startsWith('posts/'))).toHaveLength(2);

  await page.goto('/#/');
  await page.getByRole('button', { name: 'Yenile' }).click();
  await expect(page.locator('.card')).toHaveCount(2);
  await expect(page.locator('.card .meta').first()).toBeVisible();
  const metas = await page.locator('.card .meta').allTextContents();
  expect(metas.some((m) => m.includes('Sevgilim'))).toBe(true);
  expect(metas.some((m) => m.includes('Emir'))).toBe(true);
  await herContext.close();
});

test('aynı yazıyı iki kişi düzenlerse üzerine yazılmaz; taslak korunur', async ({ page, browser, context }) => {
  await login(page, 'Emir');
  await writePost(page, 'Ortak yazı', 'İlk hali.');
  const url = page.url();
  await page.getByRole('link', { name: 'Düzenle' }).click();
  await page.click('.tiptap');
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type(' Emir ekledi.');

  const otherContext = await newContext(browser, context);
  const other = await otherContext.newPage();
  await login(other, 'Sevgilim');
  await other.goto(url);
  await other.getByRole('link', { name: 'Düzenle' }).click();
  await other.click('.tiptap');
  await other.keyboard.press('ControlOrMeta+End');
  await other.keyboard.type(' O ekledi.');
  await other.getByRole('button', { name: 'Kaydet' }).click();
  await expect(other).toHaveURL(/#\/yazi\//);

  await page.getByRole('button', { name: 'Kaydet' }).click();
  await expect(page.locator('.error')).toContainText('değiştirilmiş');
  // Emir'in metni ekranda duruyor, diğerininki repoda duruyor
  await expect(page.locator('.tiptap')).toContainText('Emir ekledi');
  const state = await repo();
  const post = Object.entries(state.files).find(([p]) => p.startsWith('posts/'))![1] as any;
  expect(JSON.stringify(post.doc)).toContain('O ekledi');
  expect(JSON.stringify(post.doc)).not.toContain('Emir ekledi');
  await otherContext.close();

  // Yenilense bile taslak geri gelir
  await page.waitForTimeout(900);
  page.on('dialog', (d) => d.accept());
  await page.reload();
  await expect(page.locator('.banner')).toContainText('taslağın geri yüklendi');
  await expect(page.locator('.tiptap')).toContainText('Emir ekledi');

  // Geri yüklenen taslak da diğer kişinin değişikliğinin üzerine yazamaz
  await page.getByRole('button', { name: 'Kaydet' }).click();
  await expect(page.locator('.error')).toContainText('değiştirilmiş');
  const after = await repo();
  const stillTheirs = Object.entries(after.files).find(([p]) => p.startsWith('posts/'))![1] as any;
  expect(JSON.stringify(stillTheirs.doc)).toContain('O ekledi');

  // Taslak atılınca güncel hâl açılır
  await page.getByRole('button', { name: 'Taslağı at' }).click();
  await expect(page.locator('.tiptap')).toContainText('O ekledi');
  await expect(page.locator('.tiptap')).not.toContainText('Emir ekledi');
});

/** Üç soruyu da onaylar. */
async function confirmDelete(page: Page) {
  await page.getByRole('button', { name: 'Sil', exact: true }).click();
  await page.getByRole('button', { name: 'Evet, sil' }).click();
  await page.getByRole('button', { name: 'Eminim, sil' }).click();
  await page.getByRole('button', { name: 'Son kararım, sil' }).click();
}

test('fotoğraf silme ve yazı silme repodan da temizler', async ({ page }) => {
  await login(page, 'Emir');
  const a = await makePhoto(page, 800, 600, 10);
  const b = await makePhoto(page, 800, 600, 120);
  await writePost(page, 'Silinecek', 'İçerik.', [a, b]);

  await page.getByRole('link', { name: 'Düzenle' }).click();
  await page.getByRole('button', { name: 'Fotoğrafı kaldır' }).first().click();
  await page.getByRole('button', { name: 'Kaydet' }).click();
  await expect(page).toHaveURL(/#\/yazi\//);
  await expect(page.locator('.gallery-item')).toHaveCount(1);
  let state = await repo();
  expect(Object.keys(state.files).filter((p) => p.startsWith('images/'))).toHaveLength(2);

  await confirmDelete(page);
  await expect(page.locator('.empty')).toBeVisible();
  state = await repo();
  expect(Object.keys(state.files)).toEqual(['README.md']);
});

function pngSize(buffer: Buffer) {
  expect(buffer.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  return { w: buffer.readUInt32BE(16), h: buffer.readUInt32BE(20) };
}

async function downloadPng(page: Page): Promise<Buffer> {
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /PNG indir/ }).click()]);
  expect(download.suggestedFilename()).toMatch(/^newspaper-of-us-\d+.*\.png$/);
  return readFileSync(await download.path());
}

const hash = (buffer: Buffer) => createHash('sha256').update(buffer).digest('hex');

test('gazete: seçim, üretim, yeniden üretim, geçmişe dönüş, indirme ve yazdırma', async ({ page }) => {
  test.slow();
  const errors = watchErrors(page);
  await login(page, 'Emir');
  const photo = await makePhoto(page, 1600, 1000, 40);
  await writePost(page, 'Şirin bir gün', 'Bugün çok güzeldi. İğneada’ya gittik ve çığlık çığlığa eğlendik.', [photo]);
  await writePost(page, 'Film gecesi', 'Dün izlediğimiz film hakkında yazıyorum. Katil yine komşu çıktı.');
  await writePost(page, 'Üçüncü yazı', 'Bu yazı gazeteye girmeyecek.');

  await page.goto('/#/');
  await expect(page.locator('.card')).toHaveCount(3);
  const generate = page.getByRole('button', { name: /Gazete üret/ });

  await page.locator('.card', { hasText: 'Şirin bir gün' }).locator('input[type=checkbox]').check();
  await page.locator('.card', { hasText: 'Film gecesi' }).locator('input[type=checkbox]').check();
  await expect(generate).toContainText('2 yazı · tahmini 1 sayfa');
  await generate.click();

  await expect(page.locator('.preview-page')).toHaveCount(1, { timeout: 60_000 });
  await expect(page.locator('.history-item')).toHaveCount(1);

  const first = await downloadPng(page);
  expect(pngSize(first)).toEqual({ w: 2480, h: 3508 });

  // Yeniden üret: farklı tasarım
  await page.getByRole('button', { name: 'Yeniden üret' }).click();
  await expect(page.locator('.history-item')).toHaveCount(2, { timeout: 60_000 });
  await expect(page.getByRole('button', { name: 'Yeniden üret' })).toBeEnabled();
  const second = await downloadPng(page);
  expect(hash(second)).not.toBe(hash(first));

  // Beğendiğin eski tasarıma dön: birebir aynısı gelmeli
  await page.locator('.history-item').last().click();
  await expect(page.locator('.history-item').last()).toHaveClass(/on/, { timeout: 60_000 });
  await expect(page.getByRole('button', { name: 'Yeniden üret' })).toBeEnabled();
  const again = await downloadPng(page);
  expect(hash(again)).toBe(hash(first));

  // Yazdır
  await page.evaluate(() => {
    window.print = () => {
      (window as any).__printed = document.querySelectorAll('#print-sheet img').length;
    };
  });
  await page.getByRole('button', { name: 'Yazdır' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__printed)).toBe(1);

  // Seçim değişince eski tasarım geçmişi temizlenir
  const item = page.locator('.chooser-item', { hasText: 'Üçüncü yazı' });
  if (!(await item.isVisible())) await page.locator('.chooser-panel summary').click();
  await item.locator('input').check();
  await expect(page.locator('.history-item')).toHaveCount(0);

  expect(errors).toEqual([]);
});

test('tek yazıdan doğrudan gazete', async ({ page }) => {
  test.slow();
  await login(page, 'Emir');
  await writePost(page, 'Tek başına', 'Tek bir yazıdan gazete çıkışı denemesi.');
  await page.getByRole('button', { name: /Bu yazıdan gazete üret/ }).click();
  await expect(page.locator('.preview-page')).toHaveCount(1, { timeout: 60_000 });
  const png = await downloadPng(page);
  expect(pngSize(png)).toEqual({ w: 2480, h: 3508 });
});

test('silmek için üç kez sorar; herhangi bir adımda vazgeçilirse yazı kalır', async ({ page }) => {
  const errors = watchErrors(page);
  await login(page, 'Emir');
  await writePost(page, 'Kıyılamayan anı', 'İçerik.');
  const posts = async () => Object.keys((await repo()).files).filter((p) => p.startsWith('posts/')).length;

  // Birinci adımda vazgeç
  const deleteButton = page.getByRole('button', { name: 'Sil', exact: true });
  await deleteButton.click();
  await expect(page.locator('dialog')).toContainText('Kıyılamayan anı');
  await page.getByRole('button', { name: 'Yok, kalsın' }).click();
  await expect(page.locator('dialog')).toHaveCount(0);

  // İkinci adımda Esc: yine hayır
  await deleteButton.click();
  await page.getByRole('button', { name: 'Evet, sil' }).click();
  await expect(page.locator('dialog')).toContainText('Emin misin');
  await page.keyboard.press('Escape');
  await expect(page.locator('dialog')).toHaveCount(0);

  // Üçüncü adımda vazgeç
  await deleteButton.click();
  await page.getByRole('button', { name: 'Evet, sil' }).click();
  await page.getByRole('button', { name: 'Eminim, sil' }).click();
  await expect(page.locator('dialog')).toContainText('Son kararın mı');
  await page.getByRole('button', { name: 'Tamam, vazgeçtim' }).click();
  expect(await posts()).toBe(1);

  // Aynı yere art arda tıklayarak geçilemez: sil düğmesi yer değiştirir.
  await deleteButton.click();
  const first = await page.getByRole('button', { name: 'Evet, sil' }).boundingBox();
  await page.getByRole('button', { name: 'Evet, sil' }).click();
  const second = await page.getByRole('button', { name: 'Eminim, sil' }).boundingBox();
  expect(second!.x).not.toBe(first!.x);
  await page.keyboard.press('Escape');
  expect(await posts()).toBe(1);

  await confirmDelete(page);
  await expect(page.locator('.toast')).toContainText('arşivden kaldırıldı');
  await expect(page.locator('.empty')).toBeVisible();
  expect(await posts()).toBe(0);
  expect(errors).toEqual([]);
});

test('başkasının yazısını silerken yazarını hatırlatır', async ({ page, browser, context }) => {
  await login(page, 'Emir');
  await writePost(page, 'Emir’in anısı', 'İçerik.');
  const url = page.url();
  const otherContext = await newContext(browser, context);
  const other = await otherContext.newPage();
  await login(other, 'Sevgilim');
  await other.goto(url);
  await other.getByRole('button', { name: 'Sil', exact: true }).click();
  await other.getByRole('button', { name: 'Evet, sil' }).click();
  await expect(other.locator('dialog')).toContainText('Bu yazıyı Emir yazmış');
  await otherContext.close();
});

test('etiketler, arama ve filtre ana sayfada ve gazete seçiminde çalışır', async ({ page }) => {
  const errors = watchErrors(page);
  await login(page, 'Emir');
  await writePost(page, 'Güneşli Sahil', 'Martılar simidimizi kaptı.', [], ['Tatil', 'Yaz']);
  await writePost(page, 'Katil Yine Komşu', 'Görüntü yönetmeni şehri çok güzel kullanmış.', [], ['Film']);
  await writePost(page, 'Etiketsiz Not', 'Sadece küçük bir not. Kahve içtik.');

  // Aynı etiket farklı yazılışla ikinci kez oluşmaz; yazılıp Enter'a basılmayan etiket de kaybolmaz.
  await page.goto('/#/yeni');
  await page.fill('.title-input', 'Bir Film Daha');
  await page.click('.tiptap');
  await page.keyboard.type('Bu da güzeldi.');
  await page.fill('.tag-input', 'FİLM');
  await page.press('.tag-input', 'Enter');
  await page.fill('.tag-input', 'Gece');
  await page.getByRole('button', { name: 'Yayınla' }).click();
  await expect(page).toHaveURL(/#\/yazi\//);
  await expect(page.locator('.article-tags .tag')).toHaveText(['Film', 'Gece']);

  const state = await repo();
  const saved = Object.values(state.files).filter((f: any) => f?.title) as any[];
  expect(saved.find((p) => p.title === 'Bir Film Daha').tags).toEqual(['Film', 'Gece']);
  expect(saved.find((p) => p.title === 'Etiketsiz Not').tags).toEqual([]);

  await page.goto('/#/');
  await expect(page.locator('.card')).toHaveCount(4);
  const filters = page.locator('.filters');

  // Etiket: birini seç, sonra ikincisini ekle ("veya"), sonra kapat
  await filters.getByRole('button', { name: /^Film/ }).click();
  await expect(page.locator('.card')).toHaveCount(2);
  await filters.getByRole('button', { name: /^Tatil/ }).click();
  await expect(page.locator('.card')).toHaveCount(3);
  await filters.getByRole('button', { name: /^Film/ }).click();
  await expect(page.locator('.card-title')).toHaveText(['Güneşli Sahil']);
  await page.getByRole('button', { name: 'Temizle', exact: true }).click();
  await expect(page.locator('.card')).toHaveCount(4);

  // Arama: Türkçe karaktersiz, büyük/küçük harfsiz; başlık ve içerik; çok kelimede hepsi
  const search = page.getByRole('searchbox');
  await search.fill('gunesli');
  await expect(page.locator('.card-title')).toHaveText(['Güneşli Sahil']);
  await expect(page.locator('.card-title mark')).toHaveText('Güneşli');
  await search.fill('GORUNTU YONETMENI');
  await expect(page.locator('.card-title')).toHaveText(['Katil Yine Komşu']);
  await expect(page.locator('.excerpt mark').first()).toHaveText('Görüntü');
  await search.fill('kahve martı');
  await expect(page.locator('.empty')).toContainText('eşleşen yazı yok');
  await search.fill('kahve');
  await expect(page.locator('.card-title')).toHaveText(['Etiketsiz Not']);

  // Filtre yazıya girip dönünce de durur
  await page.locator('.card-title').first().click();
  await expect(page).toHaveURL(/#\/yazi\//);
  await page.goBack();
  await expect(search).toHaveValue('kahve');
  await expect(page.locator('.card')).toHaveCount(1);

  // Filtrelenmiş sonuçların hepsini seç: gizli yazılar seçilmez
  await search.fill('');
  await expect(page.locator('.card')).toHaveCount(4);
  await filters.getByRole('button', { name: /^Film/ }).click();
  await expect(page.locator('.card')).toHaveCount(2);
  await page.getByRole('button', { name: 'Hepsini seç' }).click();
  await expect(page.getByRole('button', { name: /Gazete üret/ })).toContainText('2 yazı');
  await page.getByRole('button', { name: 'Seçimi temizle' }).click();

  // Aynı filtre gazete seçiminde de geçerli
  await page.getByRole('button', { name: /Gazete üret/ }).click();
  const panel = page.locator('.chooser-panel');
  await expect(panel.locator('.chooser-item')).toHaveCount(2);
  await panel.getByRole('button', { name: 'Temizle', exact: true }).click();
  await expect(panel.locator('.chooser-item')).toHaveCount(4);
  await panel.getByRole('button', { name: /^Tatil/ }).click();
  await expect(panel.locator('.chooser-item')).toHaveCount(1);
  await panel.getByRole('searchbox').fill('olmayan kelime');
  await expect(panel.locator('.chooser-empty')).toBeVisible();
  await expect(page.locator('.dock')).toContainText('Önce yazı seç');
  expect(errors).toEqual([]);
});

test('eski yazılar (etiket alanı olmayan) sorunsuz açılır ve düzenlenir', async ({ page }) => {
  const errors = watchErrors(page);
  await login(page, 'Emir');
  const now = new Date().toISOString();
  const old = {
    id: '20251001-eski',
    title: 'Eski Yazı',
    author: 'Emir',
    date: '2025-10-01',
    createdAt: now,
    updatedAt: now,
    doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Etiketten önce yazıldı.' }] }] },
    images: [],
  };
  await fetch(`${API}/__test/seed`, {
    method: 'POST',
    body: JSON.stringify({ files: { 'posts/20251001-eski.json': Buffer.from(JSON.stringify(old)).toString('base64') } }),
  });
  await page.reload();
  await expect(page.locator('.card-title')).toHaveText(['Eski Yazı']);
  await page.locator('.card-title').click();
  await page.getByRole('link', { name: 'Düzenle' }).click();
  await page.fill('.tag-input', 'Arşiv');
  await page.getByRole('button', { name: 'Kaydet' }).click();
  await expect(page.locator('.article-tags .tag')).toHaveText(['Arşiv']);
  expect(errors).toEqual([]);
});

test('karanlık mod: seçim hatırlanır, koyu yazı rengi okunur kalır, kayıt değişmez', async ({ page }) => {
  const errors = watchErrors(page);
  await login(page, 'Emir');
  await page.goto('/#/yeni');
  await page.fill('.title-input', 'Renkli');
  await page.click('.tiptap');
  await page.locator('.tool-b').click();
  await page.keyboard.type('lacivert');
  for (let i = 0; i < 8; i++) await page.keyboard.press('Shift+ArrowLeft');
  await page.getByRole('button', { name: 'Yazı rengi: Lacivert' }).click();
  await page.getByRole('button', { name: 'Yayınla' }).click();
  await expect(page).toHaveURL(/#\/yazi\//);

  const theme = () => page.evaluate(() => document.documentElement.dataset.theme);
  const colorOf = () => page.locator('.prose span[style*="color"]').evaluate((el) => getComputedStyle(el).color);
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'light';
  });
  const lightColor = await colorOf();
  expect(lightColor).toBe('rgb(29, 58, 138)');

  await page.getByRole('button', { name: 'Karanlık moda geç' }).click();
  expect(await theme()).toBe('dark');
  const darkColor = await colorOf();
  expect(darkColor).not.toBe(lightColor);
  const background = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(background).toBe('rgb(20, 18, 15)');

  // Yenileyince hatırlar
  await page.reload();
  await expect(page.locator('.prose')).toBeVisible();
  expect(await theme()).toBe('dark');
  expect(await colorOf()).toBe(darkColor);

  // Kayıtlı doküman karanlık moddan etkilenmez
  const state = await repo();
  const post = Object.values(state.files).find((f: any) => f?.title) as any;
  expect(JSON.stringify(post.doc)).toContain('#1d3a8a');
  expect(JSON.stringify(post.doc)).not.toContain('--dark');

  await page.getByRole('button', { name: 'Aydınlık moda geç' }).click();
  expect(await theme()).toBe('light');
  expect(errors).toEqual([]);
});

test('editördeki tahmin kutusu yazı ve fotoğrafla güncellenir', async ({ page }) => {
  await login(page, 'Emir');
  await page.goto('/#/yeni');
  const box = page.locator('.estimate');
  await expect(box).toContainText('Tahmini baskı: 1 sayfa');
  await expect(box).toContainText('0 karakter');

  // Uzun metni bir kerede yapıştır: 30.000 karakter birden fazla sayfa eder.
  await page.click('.tiptap');
  await page.evaluate(() => {
    const text = 'Uzun uzun anlatılan bir gün daha geçti. '.repeat(750);
    const data = new DataTransfer();
    data.setData('text/plain', text);
    document.querySelector('.tiptap')!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await expect(box).toContainText('karakter');
  await expect(box).toContainText(/baskı: [34](–\d)? sayfa/);
  const photo = await makePhoto(page, 800, 600, 30);
  await page.setInputFiles('input[type=file]', [{ name: 'a.jpg', mimeType: 'image/jpeg', buffer: photo }]);
  await expect(box).toContainText('1 fotoğraf');
});

/** ZIP'in merkez dizinini okuyup her dosyanın sağlamasını doğrular. */
function readZip(buffer: Buffer) {
  const end = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  expect(end).toBeGreaterThan(0);
  const count = buffer.readUInt16LE(end + 10);
  let at = buffer.readUInt32LE(end + 16);
  const entries: { name: string; data: Buffer }[] = [];
  for (let i = 0; i < count; i++) {
    expect(buffer.readUInt32LE(at)).toBe(0x02014b50);
    const crc = buffer.readUInt32LE(at + 16);
    const size = buffer.readUInt32LE(at + 24);
    const nameLength = buffer.readUInt16LE(at + 28);
    const offset = buffer.readUInt32LE(at + 42);
    const name = buffer.subarray(at + 46, at + 46 + nameLength).toString();
    const dataStart = offset + 30 + buffer.readUInt16LE(offset + 26);
    const data = buffer.subarray(dataStart, dataStart + size);
    expect(crc32(data)).toBe(crc);
    entries.push({ name, data });
    at += 46 + nameLength;
  }
  return entries;
}

test('uzun yazı birden çok sayfa basar; ZIP ve tek sayfa indirilir, iptal edilebilir', async ({ page }) => {
  test.slow();
  const errors = watchErrors(page);
  await login(page, 'Emir');
  const paragraph = 'O sabah uyandığımızda dışarıda ince bir yağmur vardı ve ikimiz de hiçbir yere gitmek istemiyorduk. '.repeat(4);
  const doc = { type: 'doc', content: Array.from({ length: 80 }, () => ({ type: 'paragraph', content: [{ type: 'text', text: paragraph }] })) };
  const now = new Date().toISOString();
  const post = { id: '20260101-aaaa', title: 'Çok uzun yolculuk', author: 'Emir', date: '2026-01-01', createdAt: now, updatedAt: now, doc, images: [] };
  await fetch(`${API}/__test/seed`, {
    method: 'POST',
    body: JSON.stringify({ files: { 'posts/20260101-aaaa.json': Buffer.from(JSON.stringify(post)).toString('base64') } }),
  });
  await page.reload();
  await expect(page.locator('.card')).toHaveCount(1);
  await page.locator('.card input[type=checkbox]').check();
  await expect(page.getByRole('button', { name: /Gazete üret/ })).toContainText('sayfa');
  await page.getByRole('button', { name: /Gazete üret/ }).click();

  // İptal: üretim durur, önceki durum bozulmaz
  await expect(page.getByRole('button', { name: 'İptal' })).toBeVisible();
  // Yavaş makinede üretim, gerçek tıklama sırası gelmeden bitebiliyor.
  await page.getByRole('button', { name: 'İptal' }).evaluate((button) => (button as HTMLElement).click());
  await expect(page.locator('.press-status')).toContainText('iptal edildi', { timeout: 60_000 });
  await expect(page.locator('.preview-page')).toHaveCount(0);

  await page.getByRole('button', { name: /Gazete üret/ }).click();
  await expect(page.locator('.preview-page').nth(1)).toBeAttached({ timeout: 90_000 });
  const pages = await page.locator('.preview-page').count();
  expect(pages).toBeGreaterThanOrEqual(3);

  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /ZIP indir/ }).click()]);
  expect(download.suggestedFilename()).toMatch(/^newspaper-of-us-\d+\.zip$/);
  const entries = readZip(readFileSync(await download.path()));
  expect(entries).toHaveLength(pages);
  for (const [index, entry] of entries.entries()) {
    expect(entry.name).toMatch(new RegExp(`sayfa${index + 1}\\.png$`));
    expect(pngSize(entry.data)).toEqual({ w: 2480, h: 3508 });
  }

  const [single] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: 'Bu sayfayı indir' }).nth(1).click()]);
  expect(single.suggestedFilename()).toMatch(/sayfa2\.png$/);
  expect(pngSize(readFileSync(await single.path()))).toEqual({ w: 2480, h: 3508 });
  expect(errors).toEqual([]);
});

test('150 yazı: küçük resimler tembel iner, filtre çalışır, kaydırma korunur, seçim sınırı yok', async ({ page }) => {
  test.slow();
  const errors = watchErrors(page);
  await login(page, 'Emir');
  const thumb = (await makePhoto(page, 200, 150, 90)).toString('base64');
  const files: Record<string, string> = {};
  const now = new Date().toISOString();
  for (let i = 0; i < 150; i++) {
    const month = String((i % 12) + 1).padStart(2, '0');
    const id = `2025${month}15-${String(i).padStart(4, '0')}`;
    const post = {
      id,
      title: `Anı numarası ${i}`,
      author: i % 2 ? 'Emir' : 'Sevgilim',
      date: `2025-${month}-15`,
      createdAt: now,
      updatedAt: now,
      doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: `Bu ${i} numaralı yazının içeriği. ${i === 77 ? 'Eşsiz kelime burada.' : ''}` }] }] },
      images: [{ path: `images/${id}/a.jpg`, thumb: `images/${id}/a.thumb.jpg`, w: 1600, h: 1000, caption: '' }],
      tags: i % 3 === 0 ? ['Film'] : ['Gezi'],
    };
    files[`posts/${id}.json`] = Buffer.from(JSON.stringify(post)).toString('base64');
    files[`images/${id}/a.jpg`] = thumb;
    files[`images/${id}/a.thumb.jpg`] = thumb;
  }
  await fetch(`${API}/__test/seed`, { method: 'POST', body: JSON.stringify({ files }) });
  const readsBefore = (await control('reads')).reads;
  await page.reload();
  await expect(page.locator('.card')).toHaveCount(150);
  await expect(page.locator('.month')).toHaveCount(12);

  // Yazılar + yalnızca ekrana yakın küçük resimler: 150 resim birden inmez.
  await page.waitForTimeout(800);
  const reads = (await control('reads')).reads - readsBefore;
  expect(reads).toBeLessThan(150 + 40);

  // Arama sonuç verir
  await page.getByRole('searchbox').fill('essiz');
  await expect(page.locator('.card')).toHaveCount(1);
  await expect(page.locator('.card-title')).toHaveText('Anı numarası 77');
  await page.getByRole('searchbox').fill('');
  await expect(page.locator('.card')).toHaveCount(150);

  // Yazıya girip dönünce aynı yerde
  await page.evaluate(() => window.scrollTo(0, 3000));
  await page.waitForTimeout(100);
  const y = await page.evaluate(() => window.scrollY);
  expect(y).toBeGreaterThan(1000);
  await page.locator('.card-title').nth(25).evaluate((el) => (el as HTMLElement).click());
  await expect(page).toHaveURL(/#\/yazi\//);
  await page.goBack();
  await expect(page.locator('.card')).toHaveCount(150);
  expect(await page.evaluate(() => window.scrollY)).toBe(y);

  // Sınır yok: hepsi seçilebilir, tahmin düğmede görünür
  await page.getByRole('button', { name: 'Hepsini seç' }).click();
  const generate = page.getByRole('button', { name: /Gazete üret/ });
  await expect(generate).toContainText('150 yazı');
  await expect(generate).toContainText(/tahmini \d+–\d+ sayfa/);
  expect(errors).toEqual([]);
});

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
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
  await expect(page.locator('.topbar')).toBeVisible();
}

async function newContext(browser: Browser, base: BrowserContext): Promise<BrowserContext> {
  return browser.newContext({ baseURL: 'http://localhost:4173', ...(base as any)._options });
}

async function writePost(page: Page, title: string, body: string, photos: Buffer[] = []) {
  await page.goto('/#/yeni');
  await page.fill('.title-input', title);
  await page.click('.tiptap');
  await page.keyboard.type(body);
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
  await expect(page.locator('.topbar')).toBeVisible();
  await expect(page.locator('#token')).toHaveCount(0);

  // Yeni sekme de hatırlar
  const second = await context.newPage();
  await second.goto('/');
  await expect(second.locator('.topbar')).toBeVisible();
  await second.close();

  page.on('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Çıkış' }).click();
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

  page.on('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Sil' }).click();
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
  await expect(generate).toBeDisabled();

  await page.locator('.card', { hasText: 'Şirin bir gün' }).locator('input[type=checkbox]').check();
  await page.locator('.card', { hasText: 'Film gecesi' }).locator('input[type=checkbox]').check();
  await expect(generate).toHaveText('Gazete üret (2 yazı)');
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
  await page.locator('.chooser-item', { hasText: 'Üçüncü yazı' }).locator('input').check();
  await expect(page.locator('.history-item')).toHaveCount(0);

  expect(errors).toEqual([]);
});

test('tek yazıdan doğrudan gazete', async ({ page }) => {
  test.slow();
  await login(page, 'Emir');
  await writePost(page, 'Tek başına', 'Tek bir yazıdan gazete çıkışı denemesi.');
  await page.getByRole('button', { name: 'Bu yazıdan gazete üret' }).click();
  await expect(page.locator('.preview-page')).toHaveCount(1, { timeout: 60_000 });
  const png = await downloadPng(page);
  expect(pngSize(png)).toEqual({ w: 2480, h: 3508 });
});

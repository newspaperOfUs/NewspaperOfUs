import { describe, expect, it } from 'vitest';
import { liftForDark } from '../src/color';
import {
  cleanTag,
  collectTags,
  emptyFilter,
  excerptOf,
  filterPosts,
  foldText,
  highlightParts,
  searchTerms,
  tagHue,
  tagKey,
} from '../src/filter';
import { estimateLabel, estimatePages, pagesLabel } from '../src/newspaper/estimate';
import type { Post } from '../src/store';
import { crc32, storeZip } from '../src/zip';

function post(title: string, body: string, tags: string[] = [], caption = ''): Post {
  return {
    id: title,
    title,
    author: 'Emir',
    date: '2026-01-01',
    createdAt: '',
    updatedAt: '',
    doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: body }] }] },
    images: caption ? [{ path: 'a', thumb: 'b', w: 1, h: 1, caption }] : [],
    tags,
  };
}

describe('Türkçe arama', () => {
  it.each([
    ['Güneşli Çığ', 'gunesli cig'],
    ['IŞIK', 'isik'],
    ['İĞNE', 'igne'],
    ['Kâğıt', 'kagit'],
    ['İğneada’da', "igneada'da"],
  ])('%s → %s', (input, output) => {
    expect(foldText(input)).toBe(output);
  });

  it('uzunluğu korur: eşleşme orijinal metinde doğru yeri işaretler', () => {
    const text = 'İSTANBUL’da Şüheda ve 🌊 Çağrı';
    expect(foldText(text).length).toBe(text.length);
  });

  const posts = [
    post('Güneşli Sahil', 'Martılar simidimizi kaptı.', ['Tatil']),
    post('Katil Komşu', 'Görüntü yönetmeni güzel çalışmış.', ['Film']),
    post('Etiketsiz', 'Kahve içtik.', [], 'Balıkçıda çekildi'),
  ];

  it('başlık, içerik, altyazı ve etiket içinde arar; kelimelerin hepsi geçmeli', () => {
    const search = (query: string) => filterPosts(posts, { query, tags: new Set() }).map((p) => p.title);
    expect(search('GUNESLI')).toEqual(['Güneşli Sahil']);
    expect(search('simidimizi')).toEqual(['Güneşli Sahil']);
    expect(search('balikci')).toEqual(['Etiketsiz']);
    expect(search('film')).toEqual(['Katil Komşu']);
    expect(search('goruntu calismis')).toEqual(['Katil Komşu']);
    expect(search('goruntu kahve')).toEqual([]);
    expect(search('   ')).toHaveLength(3);
  });

  it('etiketler "veya" ile, arama "ve" ile bağlanır', () => {
    const tags = new Set(['film', 'tatil']);
    expect(filterPosts(posts, { query: '', tags }).map((p) => p.title)).toEqual(['Güneşli Sahil', 'Katil Komşu']);
    expect(filterPosts(posts, { query: 'marti', tags }).map((p) => p.title)).toEqual(['Güneşli Sahil']);
    expect(filterPosts(posts, emptyFilter())).toHaveLength(3);
  });

  it('işaretlenen parçalar orijinal yazımı korur', () => {
    const parts = highlightParts('Güneşli Çay, güneş!', searchTerms('gunes'));
    expect(parts).toEqual([
      { text: 'Güneş', hit: true },
      { text: 'li Çay, ', hit: false },
      { text: 'güneş', hit: true },
      { text: '!', hit: false },
    ]);
    expect(highlightParts('metin', [])).toEqual([{ text: 'metin', hit: false }]);
  });

  it('özet aranan kelimenin geçtiği yeri gösterir', () => {
    const long = `${'lorem ipsum dolor '.repeat(60)}aranan kelime burada ${'sit amet '.repeat(60)}`;
    const item = post('Uzun', long);
    expect(excerptOf(item, [])).toMatch(/^lorem/);
    const found = excerptOf(item, searchTerms('aranan'));
    expect(found.startsWith('…')).toBe(true);
    expect(found).toContain('aranan kelime');
    expect(found.endsWith('…')).toBe(true);
  });
});

describe('etiketler', () => {
  it('temizlenir, sınırlanır', () => {
    expect(cleanTag('  #Yaz   Tatili ')).toBe('Yaz Tatili');
    expect(cleanTag('x'.repeat(60))).toHaveLength(32);
    expect(cleanTag('###')).toBe('');
  });

  it('aynı etiketin farklı yazılışları tek etiket sayılır', () => {
    expect(tagKey('FİLM')).toBe(tagKey('film'));
    expect(tagKey('Anı')).toBe(tagKey('ani'));
    const tags = collectTags([post('a', '', ['Film']), post('b', '', ['film']), post('c', '', ['Film', 'Gezi'])]);
    expect(tags).toEqual([
      { key: 'film', name: 'Film', count: 3 },
      { key: 'gezi', name: 'Gezi', count: 1 },
    ]);
  });

  it('renk tonu addan türer, her cihazda aynıdır', () => {
    expect(tagHue('film')).toBe(tagHue('film'));
    expect(tagHue('film')).toBeGreaterThanOrEqual(0);
    expect(tagHue('film')).toBeLessThan(360);
  });
});

describe('karanlık mod rengi', () => {
  const channel = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const luminance = (hex: string) => {
    const n = parseInt(hex.slice(1), 16);
    return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
  };
  const contrast = (a: string, b: string) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };

  it.each(['#a3201a', '#c2601a', '#1d3a8a', '#1f6b3a', '#6b2a84', '#7a5a2a', '#000000', '#000080'])(
    '%s karanlık zeminde okunur',
    (color) => {
      expect(contrast(liftForDark(color), '#1e1b17')).toBeGreaterThanOrEqual(4.5);
    },
  );

  it('zaten açık rengi ve anlamadığı biçimi olduğu gibi bırakır', () => {
    expect(liftForDark('#ffe680')).toBe('#ffe680');
    expect(liftForDark('red')).toBe('red');
    expect(liftForDark('rgb(0, 0, 0)')).toBe('#bfbfbf');
  });
});

describe('sayfa tahmini', () => {
  const story = (chars: number, photos = 0) => ({ chars, photos });

  it('kısa yazı tek sayfa, uzun yazı çok sayfa', () => {
    expect(estimatePages([story(500)])).toEqual({ min: 1, max: 1 });
    expect(estimatePages([story(60000)]).max).toBeGreaterThanOrEqual(6);
    expect(estimatePages([story(100000)]).min).toBeGreaterThanOrEqual(9);
  });

  it('yazı ve fotoğraf arttıkça azalmaz', () => {
    let previous = 0;
    for (let chars = 0; chars <= 60000; chars += 2000) {
      const pages = estimatePages([story(chars, 2)]).max;
      expect(pages).toBeGreaterThanOrEqual(previous);
      previous = pages;
    }
    previous = 0;
    for (let count = 1; count <= 150; count += 5) {
      const pages = estimatePages(Array.from({ length: count }, () => story(1000, 1))).max;
      expect(pages).toBeGreaterThanOrEqual(previous);
      previous = pages;
    }
  });

  it('sayfada en fazla yedi yazı olur', () => {
    expect(estimatePages(Array.from({ length: 50 }, () => story(100))).min).toBeGreaterThanOrEqual(7);
  });

  it('boş seçim ve etiket metni', () => {
    expect(estimatePages([])).toEqual({ min: 0, max: 0 });
    expect(estimateLabel({ min: 2, max: 2 })).toBe('tahmini 2 sayfa');
    expect(estimateLabel({ min: 2, max: 3 })).toBe('tahmini 2–3 sayfa');
    expect(pagesLabel({ min: 1, max: 1 })).toBe('1 sayfa');
  });
});

describe('ZIP', () => {
  it('CRC-32 bilinen değeri verir', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });

  it('yapı geçerli, Türkçe ad ve içerik korunur', async () => {
    const files = [
      { name: 'sayfa-1.png', blob: new Blob(['birinci']) },
      { name: 'şirin-2.png', blob: new Blob(['ikinci içerik']) },
    ];
    const zip = await storeZip(files, new Date(2026, 10, 2, 12, 30, 10));
    const bytes = new Uint8Array(await zip.arrayBuffer());
    const view = new DataView(bytes.buffer);
    const end = bytes.length - 22;
    expect(view.getUint32(end, true)).toBe(0x06054b50);
    expect(view.getUint16(end + 10, true)).toBe(2);

    let at = view.getUint32(end + 16, true);
    const decoder = new TextDecoder();
    for (const file of files) {
      expect(view.getUint32(at, true)).toBe(0x02014b50);
      const size = view.getUint32(at + 24, true);
      const nameLength = view.getUint16(at + 28, true);
      const offset = view.getUint32(at + 42, true);
      expect(decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength))).toBe(file.name);
      expect(view.getUint16(at + 8, true)).toBe(0x0800);
      const start = offset + 30 + view.getUint16(offset + 26, true);
      const data = bytes.subarray(start, start + size);
      expect(decoder.decode(data)).toBe(await file.blob.text());
      expect(view.getUint32(at + 16, true)).toBe(crc32(data));
      at += 46 + nameLength;
    }
  });
});

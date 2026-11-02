import { describe, expect, it } from 'vitest';
import { blocksToPlainText, countChars, docToBlocks, splitBlocks } from '../src/newspaper/doc';
import { hyphenPoints } from '../src/newspaper/hyphenate';
import { toRoman } from '../src/newspaper/masthead';
import { Rng } from '../src/newspaper/rng';
import { breakLines, tokenize, typesetBlocks, type Face, type WidthFn } from '../src/newspaper/typeset';

const face: Face = { family: 'Test', regular: 400, bold: 700, sizeAdj: 1 };
/** Her karakter 0.5em: dizgiciyi fonttan bağımsız test etmek için. */
const width: WidthFn = (_f, _s, text, size) => [...text].length * size * 0.5;

function syllables(word: string) {
  const parts: string[] = [];
  let last = 0;
  for (const p of hyphenPoints(word)) {
    parts.push(word.slice(last, p));
    last = p;
  }
  parts.push(word.slice(last));
  return parts.join('-');
}

describe('bozuk doküman', () => {
  it.each([
    ['null', null],
    ['metin içerik', { type: 'doc', content: 'metin' }],
    ['null çocuk', { type: 'doc', content: [null, 5, 'x'] }],
    ['sayı paragraf içeriği', { type: 'doc', content: [{ type: 'paragraph', content: 7 }] }],
    ['liste metin', { type: 'doc', content: [{ type: 'orderedList', content: 'x' }, { type: 'blockquote', content: 9 }] }],
  ])('%s boş sonuç verir, düşmez', (_name, doc) => {
    expect(docToBlocks(doc)).toEqual([]);
  });

  it('metin olmayan yazı ve bozuk işaretler yok sayılır', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 42 },
            { type: 'text', text: 'kalan', marks: [null, { type: 'bold' }] },
            { type: 'text', text: ' yazı', marks: 3 },
          ],
        },
      ],
    };
    const [block] = docToBlocks(doc);
    expect(blocksToPlainText([block])).toBe('kalan yazı');
    expect(block.runs[1].b).toBe(true);
  });

  it('yığını taşıran derinlikte bile düşmez', () => {
    let node: unknown = { type: 'paragraph', content: [{ type: 'text', text: 'dip' }] };
    for (let i = 0; i < 200_000; i++) node = { type: 'blockquote', content: [node] };
    expect(() => docToBlocks({ type: 'doc', content: [node] })).not.toThrow();
  });
});

describe('Türkçe heceleme', () => {
  it.each([
    ['gazete', 'ga-ze-te'],
    ['kitaplık', 'ki-tap-lık'],
    ['korktu', 'kork-tu'],
    ['saat', 'sa-at'],
    ['Türkçe', 'Türk-çe'],
    ['İstanbul', 'İs-tan-bul'],
    ['çiçekçi', 'çi-çek-çi'],
    ['şişeler', 'şi-şe-ler'],
  ])('%s → %s', (word, expected) => {
    expect(syllables(word)).toBe(expected);
  });

  it('tek harf kırıntısı bırakmaz', () => {
    expect(syllables('ama')).toBe('ama');
    expect(syllables('aile')).toBe('ai-le');
  });

  it('kesme işareti ve rakamlarda bölmez', () => {
    expect(hyphenPoints("2026'da")).toEqual([]);
    expect(syllables("Emir'in")).toBe("Emir'in");
  });
});

describe('editör dokümanı', () => {
  const doc = {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Ara başlık' }] },
      {
        type: 'paragraph',
        attrs: { textAlign: 'center' },
        content: [
          { type: 'text', text: 'kalın ', marks: [{ type: 'bold' }] },
          { type: 'text', text: 'kırmızı', marks: [{ type: 'textStyle', attrs: { color: '#ff0000' } }, { type: 'italic' }] },
          { type: 'hardBreak' },
          { type: 'text', text: 'alt satır' },
        ],
      },
      { type: 'paragraph' },
      { type: 'blockquote', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'alıntı' }] }] },
      {
        type: 'orderedList',
        attrs: { start: 3 },
        content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'madde' }] }] }],
      },
      { type: 'horizontalRule' },
    ],
  };

  it('biçimleri ve blok türlerini korur, boş paragrafı atar', () => {
    const blocks = docToBlocks(doc);
    expect(blocks.map((b) => b.kind)).toEqual(['h2', 'p', 'quote', 'li', 'hr']);
    expect(blocks[1].align).toBe('center');
    expect(blocks[1].runs[0]).toMatchObject({ text: 'kalın ', b: true });
    expect(blocks[1].runs[1]).toMatchObject({ text: 'kırmızı', i: true, color: '#ff0000' });
    expect(blocks[1].runs[2].text).toBe('\n');
    expect(blocks[3].marker).toBe('3.');
  });

  it('hatalı/boş dokümanda patlamaz', () => {
    expect(docToBlocks(null)).toEqual([]);
    expect(docToBlocks({ type: 'doc' })).toEqual([]);
  });
});

describe('yazı bölme', () => {
  const blocks = docToBlocks({
    type: 'doc',
    content: Array.from({ length: 5 }, (_, i) => ({
      type: 'paragraph',
      content: [
        { type: 'text', text: `Paragraf ${i} birinci bölüm `, marks: [{ type: 'bold' }] },
        { type: 'text', text: 've onun devamı olan bir miktar daha uzun cümle.' },
      ],
    })),
  });

  it('hiç metin kaybetmez', () => {
    const total = blocksToPlainText(blocks);
    for (const limit of [0, 45, 100, 170, 1000]) {
      const [a, b] = splitBlocks(blocks, limit);
      expect(countChars(a) + countChars(b)).toBe(countChars(blocks));
      expect(`${blocksToPlainText(a)} ${blocksToPlainText(b)}`.replace(/\s+/g, ' ').trim()).toBe(total);
    }
  });

  it('kelimenin ortasından bölmez, stili korur', () => {
    // Her paragraf 72 karakter: 120 limiti ikinci paragrafın ortasına denk gelir.
    const [a, b] = splitBlocks(blocks, 120);
    expect(a.length).toBe(2);
    const lastHead = a[a.length - 1].runs.at(-1)!.text;
    expect(lastHead.endsWith(' ')).toBe(true);
    expect(b[0].runs.length).toBeGreaterThan(0);
    expect(a[0].runs[0].b).toBe(true);
  });
});

describe('dizgi', () => {
  const opts = { face, size: 20, width, align: 'justify' as const };

  it('satır genişliğini aşmaz, tüm metni korur', () => {
    const text = 'Eski gazetelerin dar sütunlarında kelimeler hecelerinden bölünerek dizilirdi ve okunurdu.';
    const lines = breakLines(tokenize([{ text }]), { ...opts, lineBox: () => ({ avail: 150, indent: 0 }) });
    expect(lines.length).toBeGreaterThan(3);
    for (const line of lines) expect(line.natural).toBeLessThanOrEqual(150 + 0.001);

    const joined = lines
      .map((l) => l.words.map((w) => w.frags.map((f) => f.text).join('')).join(' '))
      .join(' ')
      .replace(/- /g, '');
    expect(joined).toBe(text);
  });

  it('son satır iki yana yaslanmaz', () => {
    const lines = breakLines(tokenize([{ text: 'bir iki üç dört beş altı yedi sekiz dokuz on' }]), {
      ...opts,
      lineBox: () => ({ avail: 150, indent: 0 }),
    });
    expect(lines.at(-1)!.align).toBe('left');
    expect(lines[0].align).toBe('justify');
  });

  it('satırdan uzun kelimeyi zorla böler, sonsuz döngüye girmez', () => {
    const url = 'https://ornek.com/cokuzunbiradres/seklindedevamediyor0123456789';
    const lines = breakLines(tokenize([{ text: url }]), { ...opts, lineBox: () => ({ avail: 120, indent: 0 }) });
    const joined = lines.flatMap((l) => l.words.flatMap((w) => w.frags.map((f) => f.text))).join('');
    expect(joined.replace(/-/g, '')).toContain('0123456789');
    for (const line of lines) expect(line.natural).toBeLessThanOrEqual(120 + 0.001);
  });

  it('elle satır sonu yeni satır açar', () => {
    const lines = breakLines(tokenize([{ text: 'üst\nalt' }]), { ...opts, lineBox: () => ({ avail: 500, indent: 0 }) });
    expect(lines.length).toBe(2);
  });

  it('büyük başlangıç harfi Türkçe büyütülür ve metinden düşülür', () => {
    const items = typesetBlocks(docToBlocks({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'iyi akşamlar sevgili okur, bu uzun bir cümledir.' }] }],
    }), {
      face,
      size: 20,
      leading: 1.2,
      width: 200,
      paragraph: 'indent',
      dropCap: { lines: 2, capRatio: 0.7 },
      measure: width,
    });
    const first = items[0];
    expect(first.kind === 'line' && first.drop?.letter).toBe('İ');
    expect(first.kind === 'line' && first.line.words[0].frags[0].text).toBe('yi');
  });
});

describe('seed', () => {
  it('aynı seed aynı diziyi üretir, farklı seed farklı', () => {
    const seq = (seed: number) => {
      const rng = new Rng(seed);
      return Array.from({ length: 8 }, () => rng.next());
    };
    expect(seq(42)).toEqual(seq(42));
    expect(seq(42)).not.toEqual(seq(43));
  });
});

describe('roma rakamı', () => {
  it.each([
    [1, 'I'],
    [4, 'IV'],
    [14, 'XIV'],
    [2026, 'MMXXVI'],
  ])('%i → %s', (n, s) => expect(toRoman(n)).toBe(s));
});

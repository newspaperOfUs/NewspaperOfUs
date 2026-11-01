const VOWELS = new Set('aâeıiîoöuûüAÂEIİÎOÖUÛÜ');
const LETTER = /\p{L}/u;

/**
 * Türkçe hecelemeye göre satır sonunda bölünebilecek konumlar.
 * Türkçede her hecede tek ünlü vardır ve yeni hece, ünlüden hemen önceki ünsüzle başlar:
 * "ga-ze-te", "kork-tu", "sa-at". Yabancı kelimelerde de makul sonuç verir.
 */
export function hyphenPoints(word: string): number[] {
  const chars = [...word];
  const points: number[] = [];
  let previousVowel = -1;

  for (let i = 0; i < chars.length; i++) {
    if (!VOWELS.has(chars[i])) continue;
    if (previousVowel >= 0) {
      const consonants = i - previousVowel - 1;
      const point = consonants === 0 ? i : i - 1;
      if (isValidBreak(chars, point)) points.push(point);
    }
    previousVowel = i;
  }

  return points.map((point) => chars.slice(0, point).join('').length);
}

function isValidBreak(chars: string[], point: number): boolean {
  // Her iki tarafta en az iki harf kalsın, tek harflik "a-" gibi kırıntılar olmasın.
  const before = chars.slice(0, point).filter((c) => LETTER.test(c)).length;
  const after = chars.slice(point).filter((c) => LETTER.test(c)).length;
  if (before < 2 || after < 2) return false;
  // Sadece iki harf arasında bölünür: "Emir'in", "2026'da", "alış-veriş" bozulmaz.
  return LETTER.test(chars[point - 1]) && LETTER.test(chars[point]);
}

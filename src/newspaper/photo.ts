import type { Rng } from './rng';

export type FxKind = 'halftone' | 'linescreen' | 'engrave' | 'dither' | 'gravure' | 'faded';

export interface PhotoFx {
  kind: FxKind;
  /** Baskı ızgarasının adımı (piksel). */
  cell: number;
  angle: number;
  contrast: number;
  gamma: number;
  /** Eski baskıda siyah tam siyah, beyaz tam beyaz olmaz: tonların sıkıştırılma miktarı. */
  fade: number;
  tint?: string;
}

export interface SourcePhoto {
  w: number;
  h: number;
  /** Fotoğraf yalnızca basılacağı sayfa hazırlanırken belleğe alınır. */
  load: () => Promise<CanvasImageSource>;
  source?: CanvasImageSource;
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function createCanvas(w: number, h: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w));
  canvas.height = Math.max(1, Math.round(h));
  return canvas;
}

/** Yüzler genelde üst-ortada olduğu için kırpma merkezi hafif yukarıda. */
function coverCrop(photo: SourcePhoto, w: number, h: number) {
  // Kayıtlı ölçü yanlışsa görselin dışından okunup siyah bant çıkmasın: gerçek ölçü esas alınır.
  const { width, height } = photo.source as ImageBitmap;
  const scale = Math.max(w / width, h / height);
  const sw = w / scale;
  const sh = h / scale;
  return { sx: (width - sw) / 2, sy: (height - sh) * 0.42, sw, sh };
}

/**
 * Fotoğrafı seçilen baskı tekniğiyle işler. Sonuç saydam zemin üstüne mürekkeptir:
 * sayfaya "multiply" ile basıldığında kâğıt dokusu fotoğrafın içinden görünür.
 */
export function renderPhoto(photo: SourcePhoto, w: number, h: number, fx: PhotoFx, ink: string, rng: Rng): HTMLCanvasElement {
  const canvas = createCanvas(w, h);
  const width = canvas.width;
  const height = canvas.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const crop = coverCrop(photo, width, height);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(photo.source!, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, width, height);

  const image = ctx.getImageData(0, 0, width, height);
  const data = image.data;
  const lum = toneCurve(luminance(data), fx);
  applyVignette(lum, width, height, rng.range(0.1, 0.3));

  const inkColor = hexToRgb(fx.tint ?? ink);
  switch (fx.kind) {
    case 'halftone':
      screen(lum, data, width, height, inkColor, fx.cell, fx.angle, dotScreen);
      break;
    case 'linescreen':
      screen(lum, data, width, height, inkColor, fx.cell, fx.angle, lineScreen);
      break;
    case 'engrave':
      engrave(lum, data, width, height, inkColor, fx);
      break;
    case 'dither':
      dither(lum, data, width, height, inkColor, Math.max(1, Math.round(fx.cell)));
      break;
    case 'gravure':
      gravure(lum, data, inkColor, rng);
      break;
    case 'faded':
      faded(lum, data, fx, rng);
      break;
  }

  addDust(data, width, height, rng);
  ctx.putImageData(image, 0, 0);
  return canvas;
}

function luminance(data: Uint8ClampedArray): Float32Array {
  const lum = new Float32Array(data.length / 4);
  for (let i = 0, p = 0; i < lum.length; i++, p += 4) {
    lum[i] = (0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2]) / 255;
  }
  return lum;
}

/** Fotoğrafın karanlık/aydınlık halinden bağımsız sonuç için oto-seviye + kontrast eğrisi. */
function toneCurve(lum: Float32Array, fx: PhotoFx): Float32Array {
  const histogram = new Uint32Array(256);
  for (let i = 0; i < lum.length; i++) histogram[Math.min(255, Math.floor(lum[i] * 255))]++;

  const clip = lum.length * 0.01;
  let low = 0;
  let high = 255;
  for (let c = 0; low < 255 && c + histogram[low] < clip; low++) c += histogram[low];
  for (let c = 0; high > 0 && c + histogram[high] < clip; high--) c += histogram[high];
  const span = Math.max(0.1, (high - low) / 255);
  const base = low / 255;

  const lut = new Float32Array(1024);
  for (let i = 0; i < lut.length; i++) {
    let v = Math.min(1, Math.max(0, (i / (lut.length - 1) - base) / span));
    v = Math.pow(v, fx.gamma);
    v = Math.min(1, Math.max(0, 0.5 + (v - 0.5) * fx.contrast));
    // Yumuşak S eğrisi
    v = v * v * (3 - 2 * v) * 0.5 + v * 0.5;
    lut[i] = fx.fade + v * (1 - fx.fade * 1.4);
  }
  for (let i = 0; i < lum.length; i++) lum[i] = lut[Math.min(1023, Math.floor(lum[i] * 1023))];
  return lum;
}

function applyVignette(lum: Float32Array, w: number, h: number, strength: number) {
  const cx = w / 2;
  const cy = h / 2;
  const norm = 1 / (cx * cx + cy * cy);
  for (let y = 0, i = 0; y < h; y++) {
    const dy = y - cy;
    for (let x = 0; x < w; x++, i++) {
      const dx = x - cx;
      const d = (dx * dx + dy * dy) * norm;
      lum[i] *= 1 - strength * d * d;
    }
  }
}

function setInk(data: Uint8ClampedArray, p: number, ink: number[], alpha: number) {
  data[p] = ink[0];
  data[p + 1] = ink[1];
  data[p + 2] = ink[2];
  data[p + 3] = alpha;
}

type ScreenFn = (u: number, v: number) => number;

/** Klasik gazete noktası: ton koyulaştıkça nokta büyür. */
const dotScreen: ScreenFn = (u, v) => 0.5 + 0.25 * (Math.cos(2 * Math.PI * u) + Math.cos(2 * Math.PI * v));
const lineScreen: ScreenFn = (_u, v) => 0.5 + 0.5 * Math.cos(2 * Math.PI * v);

function screen(
  lum: Float32Array,
  data: Uint8ClampedArray,
  w: number,
  h: number,
  ink: number[],
  cell: number,
  angleDeg: number,
  fn: ScreenFn,
) {
  const angle = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(angle) / cell;
  const sin = Math.sin(angle) / cell;
  // Kenar yumuşatma genişliği: nokta kenarları piksel piksel testere olmasın.
  const aa = 0.9 / cell;
  for (let y = 0, i = 0, p = 0; y < h; y++) {
    for (let x = 0; x < w; x++, i++, p += 4) {
      const u = x * cos + y * sin;
      const v = -x * sin + y * cos;
      const threshold = fn(u, v);
      const darkness = 1 - lum[i];
      const alpha = Math.min(1, Math.max(0, (darkness - threshold) / aa + 0.5));
      setInk(data, p, ink, alpha * 255);
    }
  }
}

/** Gravür: tona göre kalınlaşan, hafif dalgalı çizgiler; koyu bölgelerde çapraz tarama. */
function engrave(lum: Float32Array, data: Uint8ClampedArray, w: number, h: number, ink: number[], fx: PhotoFx) {
  const angle = (fx.angle * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const cell = fx.cell;
  const aa = 1 / cell;
  for (let y = 0, i = 0, p = 0; y < h; y++) {
    for (let x = 0; x < w; x++, i++, p += 4) {
      const along = x * cos + y * sin;
      const across = -x * sin + y * cos;
      const wobble = Math.sin(along / 60) * 1.6 + Math.sin(along / 23 + across / 90) * 0.6;
      const darkness = Math.min(1, (1 - lum[i]) * 1.1);
      const main = 0.5 + 0.5 * Math.cos((2 * Math.PI * (across + wobble)) / cell);
      let alpha = Math.min(1, Math.max(0, (darkness - main) / aa + 0.5));
      if (darkness > 0.58) {
        const cross = 0.5 + 0.5 * Math.cos((2 * Math.PI * (along + across * 0.35)) / (cell * 1.1));
        const extra = (darkness - 0.58) * 1.6;
        alpha = Math.max(alpha, Math.min(1, Math.max(0, (extra - cross) / aa + 0.5)));
      }
      setInk(data, p, ink, alpha * 255);
    }
  }
}

/** Atkinson titreşimi: erken dönem fotoğraf baskısına benzer sert benekli doku. */
function dither(lum: Float32Array, data: Uint8ClampedArray, w: number, h: number, ink: number[], block: number) {
  const bw = Math.ceil(w / block);
  const bh = Math.ceil(h / block);
  const small = new Float32Array(bw * bh);
  const counts = new Uint16Array(bw * bh);
  for (let y = 0, i = 0; y < h; y++) {
    const by = Math.floor(y / block);
    for (let x = 0; x < w; x++, i++) {
      const idx = by * bw + Math.floor(x / block);
      small[idx] += lum[i];
      counts[idx]++;
    }
  }
  for (let i = 0; i < small.length; i++) small[i] /= counts[i] || 1;

  const spread: [number, number][] = [
    [1, 0],
    [2, 0],
    [-1, 1],
    [0, 1],
    [1, 1],
    [0, 2],
  ];
  for (let y = 0, i = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++, i++) {
      const old = small[i];
      const value = old < 0.5 ? 0 : 1;
      const error = (old - value) / 8;
      small[i] = value;
      for (const [dx, dy] of spread) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && nx < bw && ny < bh) small[ny * bw + nx] += error;
      }
    }
  }
  for (let y = 0, p = 0; y < h; y++) {
    const by = Math.floor(y / block);
    for (let x = 0; x < w; x++, p += 4) {
      const on = small[by * bw + Math.floor(x / block)] === 0;
      setInk(data, p, ink, on ? 255 : 0);
    }
  }
}

/** Gravür baskı: sürekli ton, tek renk mürekkep ve ince gren. */
function gravure(lum: Float32Array, data: Uint8ClampedArray, ink: number[], rng: Rng) {
  for (let i = 0, p = 0; i < lum.length; i++, p += 4) {
    const grain = (rng.next() - 0.5) * 0.09;
    setInk(data, p, ink, Math.min(1, Math.max(0, 1 - lum[i] + grain)) * 255);
  }
}

/** Solmuş renkli baskı: renk korunur ama doygunluk düşer, sıcak bir sepya örter. */
function faded(lum: Float32Array, data: Uint8ClampedArray, fx: PhotoFx, rng: Rng) {
  const keep = 0.5;
  for (let i = 0, p = 0; i < lum.length; i++, p += 4) {
    const l = lum[i] * 255;
    const grain = (rng.next() - 0.5) * 14;
    const shade = 1 - fx.fade * 0.3;
    data[p] = (data[p] * keep + (l * 1.04 + 8) * (1 - keep) + grain) * shade + 14;
    data[p + 1] = (data[p + 1] * keep + (l * 0.96 + 4) * (1 - keep) + grain) * shade + 10;
    data[p + 2] = (data[p + 2] * keep + (l * 0.78) * (1 - keep) + grain) * shade + 2;
    data[p + 3] = 255;
  }
}

function addDust(data: Uint8ClampedArray, w: number, h: number, rng: Rng) {
  const specks = Math.round((w * h) / 45000);
  for (let n = 0; n < specks; n++) {
    const radius = rng.int(1, 3);
    const cx = rng.int(0, w - 1);
    const cy = rng.int(0, h - 1);
    for (let y = Math.max(0, cy - radius); y < Math.min(h, cy + radius); y++) {
      for (let x = Math.max(0, cx - radius); x < Math.min(w, cx + radius); x++) {
        data[(y * w + x) * 4 + 3] *= 0.15;
      }
    }
  }
}

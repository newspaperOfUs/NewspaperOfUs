import { createCanvas } from './photo';
import type { Rng } from './rng';
import type { Style } from './styles';

/** Değişken saydamlıkta siyah piksellerden oluşan gürültü dokusu. */
function noiseCanvas(w: number, h: number, rng: Rng, alphaMax = 255): HTMLCanvasElement {
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const image = ctx.createImageData(w, h);
  for (let p = 0; p < image.data.length; p += 4) {
    image.data[p + 3] = rng.next() * alphaMax;
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

function blotches(ctx: CanvasRenderingContext2D, W: number, H: number, cells: number, alpha: number, rng: Rng) {
  const noise = noiseCanvas(cells, Math.ceil((cells * H) / W), rng);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(noise, 0, 0, W, H);
  ctx.restore();
}

/** Yıpranmış kâğıt zemini: ton, lif, leke, kenar kararması. */
export function makePaper(W: number, H: number, style: Style, rng: Rng): HTMLCanvasElement {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d')!;
  const [r, g, b] = style.paper;
  const age = style.age;

  ctx.fillStyle = `rgb(${r},${g},${b})`;
  ctx.fillRect(0, 0, W, H);

  // Büyük ve küçük ölçekli renk dalgalanması
  ctx.globalCompositeOperation = 'multiply';
  blotchTint(ctx, W, H, 14, 0.04 + age * 0.05, rng);
  blotchTint(ctx, W, H, 60, 0.02 + age * 0.03, rng);
  blotchTint(ctx, W, H, 260, 0.018, rng);

  // İnce gren
  const grain = noiseCanvas(512, 512, rng, 20);
  const pattern = ctx.createPattern(grain, 'repeat')!;
  ctx.fillStyle = pattern;
  ctx.fillRect(0, 0, W, H);

  // Kâğıt lifleri
  ctx.lineWidth = 1;
  const fibers = Math.round(2200 + age * 2200);
  for (let i = 0; i < fibers; i++) {
    const x = rng.range(0, W);
    const y = rng.range(0, H);
    const angle = rng.range(0, Math.PI * 2);
    const length = rng.range(8, 42);
    ctx.strokeStyle = `rgba(90,66,36,${rng.range(0.04, 0.16)})`;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(
      x + Math.cos(angle) * length * 0.5 + rng.range(-5, 5),
      y + Math.sin(angle) * length * 0.5 + rng.range(-5, 5),
      x + Math.cos(angle) * length,
      y + Math.sin(angle) * length,
    );
    ctx.stroke();
  }

  // Yaşlılık benekleri
  const foxing = Math.round(age * rng.range(30, 90));
  for (let i = 0; i < foxing; i++) {
    const x = rng.range(0, W);
    const y = rng.range(0, H);
    const radius = rng.range(4, 26);
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
    const alpha = rng.range(0.08, 0.28);
    gradient.addColorStop(0, `rgba(135,90,45,${alpha})`);
    gradient.addColorStop(1, 'rgba(135,90,45,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }

  edgeBurn(ctx, W, H, age, rng);
  if (rng.chance(0.2 + age * 0.3)) coffeeRing(ctx, W, H, rng);

  ctx.globalCompositeOperation = 'source-over';
  return canvas;
}

function blotchTint(ctx: CanvasRenderingContext2D, W: number, H: number, cells: number, alpha: number, rng: Rng) {
  // Saydam gürültü kahverengiye boyanıp yumuşakça büyütülür.
  const noise = noiseCanvas(cells, Math.ceil((cells * H) / W), rng);
  const noiseCtx = noise.getContext('2d')!;
  noiseCtx.globalCompositeOperation = 'source-in';
  noiseCtx.fillStyle = 'rgb(120,88,48)';
  noiseCtx.fillRect(0, 0, noise.width, noise.height);
  ctx.save();
  ctx.globalAlpha = alpha * 2;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(noise, 0, 0, W, H);
  ctx.restore();
}

function edgeBurn(ctx: CanvasRenderingContext2D, W: number, H: number, age: number, rng: Rng) {
  const color = (a: number) => `rgba(112,76,36,${a})`;
  const depth = (0.05 + age * 0.05) * W;
  const strength = 0.14 + age * 0.26;
  const edges: [number, number, number, number, number, number, number, number][] = [
    [0, 0, 0, depth, 0, 0, W, depth],
    [0, H, 0, H - depth, 0, H - depth, W, depth],
    [0, 0, depth, 0, 0, 0, depth, H],
    [W, 0, W - depth, 0, W - depth, 0, depth, H],
  ];
  for (const [x0, y0, x1, y1, rx, ry, rw, rh] of edges) {
    const gradient = ctx.createLinearGradient(x0, y0, x1, y1);
    gradient.addColorStop(0, color(strength * rng.range(0.7, 1.1)));
    gradient.addColorStop(0.25, color(strength * 0.35));
    gradient.addColorStop(1, color(0));
    ctx.fillStyle = gradient;
    ctx.fillRect(rx, ry, rw, rh);
  }
}

function coffeeRing(ctx: CanvasRenderingContext2D, W: number, H: number, rng: Rng) {
  const radius = rng.range(170, 260);
  const cx = rng.pick([rng.range(radius, W * 0.3), rng.range(W * 0.7, W - radius)]);
  const cy = rng.range(H * 0.25, H - radius * 1.2);
  const wash = ctx.createRadialGradient(cx, cy, radius * 0.7, cx, cy, radius);
  wash.addColorStop(0, 'rgba(120,80,40,0.02)');
  wash.addColorStop(1, 'rgba(120,80,40,0.09)');
  ctx.fillStyle = wash;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();

  // Halka her yerde aynı koyulukta olmaz; kesik kesik yaylar çiziyoruz.
  const start = rng.range(0, Math.PI * 2);
  for (let i = 0; i < 80; i++) {
    const a0 = start + (i / 80) * Math.PI * 2;
    ctx.strokeStyle = `rgba(100,62,28,${rng.range(0.05, 0.3)})`;
    ctx.lineWidth = rng.range(3, 11);
    ctx.beginPath();
    ctx.arc(cx, cy, radius + rng.range(-3, 3), a0, a0 + (Math.PI * 2) / 78);
    ctx.stroke();
  }
}

/** Baskı kusurları: mürekkep her yere eşit oturmaz, yer yer açılır ve minik boşluklar kalır. */
export function distressInk(ink: HTMLCanvasElement, style: Style, rng: Rng) {
  const ctx = ink.getContext('2d')!;
  const W = ink.width;
  const H = ink.height;
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';

  // Sayfa boyunca dalgalanan mürekkep yoğunluğu
  blotches(ctx, W, H, 26, 0.05 + style.age * 0.06, rng);
  blotches(ctx, W, H, 180, 0.04 + style.age * 0.04, rng);

  // Mürekkebin tutmadığı minik noktalar
  const speck = noiseCanvas(600, 600, rng, 255);
  const speckCtx = speck.getContext('2d', { willReadFrequently: true })!;
  const image = speckCtx.getImageData(0, 0, 600, 600);
  for (let p = 3; p < image.data.length; p += 4) {
    image.data[p] = image.data[p] > 238 ? 200 : image.data[p] * 0.1;
  }
  speckCtx.putImageData(image, 0, 0);
  ctx.fillStyle = ctx.createPattern(speck, 'repeat')!;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

/** Arka sayfanın silik yansıması: ince gazete kâğıdının en karakteristik özelliği. */
export function showThrough(paper: HTMLCanvasElement, ink: HTMLCanvasElement, style: Style) {
  const W = paper.width;
  const H = paper.height;
  // Küçültüp büyütmek bulanıklık verir; ctx.filter Safari'de yok.
  const small = createCanvas(W / 6, H / 6);
  const smallCtx = small.getContext('2d')!;
  smallCtx.imageSmoothingQuality = 'high';
  smallCtx.drawImage(ink, 0, 0, small.width, small.height);

  const ctx = paper.getContext('2d')!;
  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  ctx.globalAlpha = 0.035 + style.age * 0.05;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.translate(W, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(small, 0, 16, W, H);
  ctx.restore();
}

/** Katlama izi: kâğıt yıllarca ortadan katlı durmuş gibi. Mürekkebin üstüne uygulanır. */
export function foldMarks(canvas: HTMLCanvasElement, style: Style, rng: Rng) {
  const ctx = canvas.getContext('2d')!;
  const W = canvas.width;
  const H = canvas.height;
  const folds: { y: number; strength: number }[] = [{ y: H * rng.range(0.495, 0.505), strength: 0.5 + style.age * 0.5 }];
  if (rng.chance(style.age * 0.5)) {
    folds.push({ y: H * rng.range(0.245, 0.255), strength: 0.3 + style.age * 0.2 });
  }

  for (const fold of folds) {
    const y = fold.y;
    const band = 34;
    const shade = ctx.createLinearGradient(0, y - band, 0, y + band);
    shade.addColorStop(0, 'rgba(80,55,28,0)');
    shade.addColorStop(0.48, `rgba(80,55,28,${0.16 * fold.strength})`);
    shade.addColorStop(0.5, `rgba(60,40,20,${0.34 * fold.strength})`);
    shade.addColorStop(0.53, `rgba(255,248,230,${0.34 * fold.strength})`);
    shade.addColorStop(1, 'rgba(255,248,230,0)');
    ctx.fillStyle = shade;
    ctx.fillRect(0, y - band, W, band * 2);

    // Kat yerinde mürekkebin dökülmesi: kâğıt renginde küçük sıyrıklar
    const [r, g, b] = style.paper;
    const scuffs = Math.round(240 * fold.strength);
    for (let i = 0; i < scuffs; i++) {
      ctx.fillStyle = `rgba(${r},${g},${b},${rng.range(0.25, 0.85)})`;
      ctx.fillRect(rng.range(0, W), y + rng.range(-3.5, 3.5), rng.range(2, 24), rng.range(0.8, 2.6));
    }
  }
}

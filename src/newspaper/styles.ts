import type { PhotoFx } from './photo';
import type { Rng } from './rng';
import type { Face } from './typeset';

export interface DisplayFont {
  family: string;
  weight: number;
  /** Kalın ve dar fontlarda satır aralığı. */
  lead: number;
  /** Küçük harfi olmayan veya büyük harfle daha iyi duran fontlar. */
  caps?: boolean;
  /** Gotik yazı: büyük harfle okunmaz, asla caps yapılmaz. */
  blackletter?: boolean;
  /** Harf genişliği: başlık boyutu seçiminde kullanılır. */
  condensed?: boolean;
}

export type RuleKind = 'hair' | 'thin' | 'medium' | 'thick' | 'double' | 'scotch' | 'oxford' | 'dots' | 'diamond' | 'wave';
export type MastKind = 'classic' | 'banner' | 'emblem' | 'left';

export interface Style {
  id: string;
  name: string;
  cols: number;
  gutter: number;
  margin: number;
  fPref: number;
  fMin: number;
  fMax: number;
  leading: number;
  mast: DisplayFont;
  head: DisplayFont;
  headAlt: DisplayFont;
  body: Face;
  label: Face;
  headCaps: boolean;
  headAlign: 'center' | 'left';
  /** Başlık hedef boyutu = blok genişliği x bu oran. */
  headScale: number;
  stackFit: boolean;
  columnRule: 'hair' | 'thin' | 'none';
  storyRule: RuleKind;
  mastRule: RuleKind;
  paragraph: 'indent' | 'gap';
  dropCap: number;
  deck: number;
  kicker: number;
  ink: string;
  spot: string | null;
  paper: [number, number, number];
  age: number;
  fx: PhotoFx;
  mastKind: MastKind;
  stamp: boolean;
  ears: boolean;
}

// --- Font kataloğu (hepsinde Türkçe karakter doğrulandı; Unifraktur sadece logoda) ---

const D = {
  unifCook: { family: 'UnifrakturCook', weight: 700, lead: 1, blackletter: true },
  unifMag: { family: 'UnifrakturMaguntia', weight: 400, lead: 1, blackletter: true },
  pirata: { family: 'Pirata One', weight: 400, lead: 1.02, blackletter: true },
  grenze: { family: 'Grenze Gotisch', weight: 800, lead: 1, blackletter: true },
  rocker: { family: 'New Rocker', weight: 400, lead: 1.05, blackletter: true },
  sancreek: { family: 'Sancreek', weight: 400, lead: 1.08, caps: true },
  abril: { family: 'Abril Fatface', weight: 400, lead: 1.06 },
  playfair: { family: 'Playfair Display', weight: 900, lead: 1.08 },
  playfair7: { family: 'Playfair Display', weight: 700, lead: 1.1 },
  oldStd: { family: 'Old Standard TT', weight: 700, lead: 1.1 },
  alfa: { family: 'Alfa Slab One', weight: 400, lead: 1.12 },
  league: { family: 'League Gothic', weight: 400, lead: 0.98, caps: true, condensed: true },
  oswald: { family: 'Oswald', weight: 700, lead: 1.14, caps: true, condensed: true },
  anton: { family: 'Anton', weight: 400, lead: 1.16, caps: true, condensed: true },
  bebas: { family: 'Bebas Neue', weight: 400, lead: 0.98, caps: true, condensed: true },
  bodoni: { family: 'Bodoni Moda', weight: 800, lead: 1.1 },
  caslon: { family: 'Libre Caslon Text', weight: 700, lead: 1.14 },
  caslonD: { family: 'Libre Caslon Display', weight: 400, lead: 1.06 },
  rozha: { family: 'Rozha One', weight: 400, lead: 1.08 },
  gloock: { family: 'Gloock', weight: 400, lead: 1.1 },
  ultra: { family: 'Ultra', weight: 400, lead: 1.14 },
  fjalla: { family: 'Fjalla One', weight: 400, lead: 1.16, caps: true, condensed: true },
} satisfies Record<string, DisplayFont>;

const F = {
  oldStd: { family: 'Old Standard TT', regular: 400, bold: 700, sizeAdj: 1.04 },
  ptSerif: { family: 'PT Serif', regular: 400, bold: 700, sizeAdj: 0.96 },
  crimson: { family: 'Crimson Text', regular: 400, bold: 700, sizeAdj: 1.1 },
  garamond: { family: 'EB Garamond', regular: 400, bold: 700, sizeAdj: 1.12 },
  caslon: { family: 'Libre Caslon Text', regular: 400, bold: 700, sizeAdj: 0.94 },
  gelasio: { family: 'Gelasio', regular: 400, bold: 700, sizeAdj: 0.98 },
  vollkorn: { family: 'Vollkorn', regular: 400, bold: 700, sizeAdj: 1 },
  source: { family: 'Source Serif 4', regular: 400, bold: 700, sizeAdj: 0.97 },
  archivo: { family: 'Archivo Narrow', regular: 400, bold: 700, sizeAdj: 1 },
} satisfies Record<string, Face>;

const INK = { black: '#17130e', warm: '#241a10', cool: '#14171c', brown: '#3a2616' };
const RED = '#a3201a';
const NAVY = '#1d3a63';

interface Era {
  id: string;
  name: string;
  cols: readonly number[];
  f: readonly [number, number];
  leading: readonly [number, number];
  mast: readonly DisplayFont[];
  head: readonly DisplayFont[];
  body: readonly Face[];
  label: readonly Face[];
  caps: number;
  headAlign: readonly ('center' | 'left')[];
  headScale: readonly [number, number];
  stackFit: number;
  columnRule: readonly Style['columnRule'][];
  storyRule: readonly RuleKind[];
  mastRule: readonly RuleKind[];
  paragraph: readonly Style['paragraph'][];
  dropCap: number;
  deck: number;
  kicker: number;
  ink: readonly string[];
  spot: readonly (string | null)[];
  paper: readonly (readonly [number, number, number])[];
  age: readonly [number, number];
  fx: (rng: Rng) => PhotoFx;
  mastKind: readonly MastKind[];
  ears: number;
}

const ERAS: readonly Era[] = [
  {
    id: 'victorian',
    name: "1880'ler · Viktorya dönemi",
    cols: [6, 7],
    f: [29, 31],
    leading: [1.15, 1.2],
    mast: [D.unifCook, D.unifMag, D.pirata, D.grenze],
    head: [D.oldStd, D.caslon, D.league, D.caslonD],
    body: [F.oldStd, F.caslon, F.crimson],
    label: [F.oldStd, F.caslon],
    caps: 0.8,
    headAlign: ['center'],
    headScale: [0.055, 0.085],
    stackFit: 0,
    columnRule: ['hair', 'thin'],
    storyRule: ['oxford', 'double', 'diamond', 'thin'],
    mastRule: ['oxford', 'double', 'scotch'],
    paragraph: ['indent'],
    dropCap: 0.25,
    deck: 0.7,
    kicker: 0.1,
    ink: [INK.warm, INK.black, INK.brown],
    spot: [null, null, null, RED],
    paper: [
      [232, 218, 184],
      [226, 208, 170],
      [236, 224, 194],
    ],
    age: [0.55, 1],
    fx: (rng) =>
      rng.pick<PhotoFx>([
        { kind: 'engrave', cell: rng.range(7, 10), angle: rng.pick([0, 18, 30]), contrast: rng.range(1.15, 1.35), gamma: 1.05, fade: 0.06 },
        { kind: 'linescreen', cell: rng.range(6, 9), angle: rng.pick([0, 45, 90]), contrast: rng.range(1.15, 1.35), gamma: 1.05, fade: 0.06 },
        { kind: 'dither', cell: rng.pick([2, 3]), angle: 0, contrast: rng.range(1.1, 1.3), gamma: 1.05, fade: 0.05 },
      ]),
    mastKind: ['classic', 'classic', 'emblem'],
    ears: 0.75,
  },
  {
    id: 'edwardian',
    name: "1910'lar · Eski basın",
    cols: [5, 6],
    f: [30, 33],
    leading: [1.17, 1.22],
    mast: [D.unifCook, D.oldStd, D.caslonD, D.playfair, D.grenze],
    head: [D.playfair7, D.caslon, D.oldStd, D.gloock],
    body: [F.oldStd, F.garamond, F.caslon, F.crimson],
    label: [F.oldStd, F.garamond],
    caps: 0.45,
    headAlign: ['center'],
    headScale: [0.07, 0.1],
    stackFit: 0,
    columnRule: ['hair', 'thin'],
    storyRule: ['double', 'scotch', 'diamond'],
    mastRule: ['scotch', 'double', 'oxford'],
    paragraph: ['indent'],
    dropCap: 0.45,
    deck: 0.5,
    kicker: 0.15,
    ink: [INK.warm, INK.black],
    spot: [null, null, RED],
    paper: [
      [236, 225, 197],
      [231, 216, 184],
    ],
    age: [0.4, 0.85],
    fx: (rng) =>
      rng.pick<PhotoFx>([
        { kind: 'halftone', cell: rng.range(7, 10), angle: 45, contrast: rng.range(1.1, 1.3), gamma: 1, fade: 0.08 },
        { kind: 'gravure', cell: 1, angle: 0, contrast: rng.range(1.1, 1.3), gamma: 1.05, fade: 0.1, tint: INK.brown },
        { kind: 'linescreen', cell: rng.range(6, 8), angle: 45, contrast: 1.2, gamma: 1, fade: 0.07 },
      ]),
    mastKind: ['classic', 'classic', 'emblem'],
    ears: 0.6,
  },
  {
    id: 'twenties',
    name: "1920'ler · Çılgın yıllar",
    cols: [5, 6],
    f: [31, 34],
    leading: [1.18, 1.24],
    mast: [D.abril, D.bodoni, D.rozha, D.playfair, D.gloock],
    head: [D.abril, D.bodoni, D.rozha, D.playfair],
    body: [F.garamond, F.crimson, F.gelasio, F.source],
    label: [F.gelasio, F.garamond],
    caps: 0.25,
    headAlign: ['center', 'left'],
    headScale: [0.085, 0.125],
    stackFit: 0.2,
    columnRule: ['hair', 'thin', 'none'],
    storyRule: ['scotch', 'thick', 'double'],
    mastRule: ['scotch', 'thick', 'double'],
    paragraph: ['indent', 'gap'],
    dropCap: 0.75,
    deck: 0.45,
    kicker: 0.2,
    ink: [INK.black, INK.brown, INK.warm],
    spot: [null, RED, NAVY],
    paper: [
      [240, 230, 205],
      [234, 221, 192],
    ],
    age: [0.3, 0.7],
    fx: (rng) =>
      rng.pick<PhotoFx>([
        { kind: 'gravure', cell: 1, angle: 0, contrast: rng.range(1.15, 1.35), gamma: 1, fade: 0.08, tint: rng.pick([INK.brown, '#4a2c17', '#2c2a33']) },
        { kind: 'halftone', cell: rng.range(6, 9), angle: 45, contrast: 1.25, gamma: 0.98, fade: 0.06 },
        { kind: 'faded', cell: 1, angle: 0, contrast: 1.05, gamma: 1.02, fade: 0.14 },
      ]),
    mastKind: ['classic', 'banner', 'left', 'emblem'],
    ears: 0.4,
  },
  {
    id: 'wartime',
    name: "1940'lar · Son dakika",
    cols: [5, 6],
    f: [30, 33],
    leading: [1.14, 1.2],
    mast: [D.unifCook, D.league, D.oldStd, D.anton, D.playfair],
    head: [D.league, D.anton, D.oswald, D.bebas],
    body: [F.ptSerif, F.source, F.vollkorn],
    label: [F.archivo, F.ptSerif],
    caps: 1,
    headAlign: ['center'],
    headScale: [0.12, 0.17],
    stackFit: 0.7,
    columnRule: ['thin', 'hair'],
    storyRule: ['thick', 'scotch', 'medium'],
    mastRule: ['thick', 'scotch', 'double'],
    paragraph: ['indent'],
    dropCap: 0.1,
    deck: 0.35,
    kicker: 0.55,
    ink: [INK.black, INK.cool],
    spot: [null, RED, RED],
    paper: [
      [226, 220, 203],
      [219, 212, 194],
      [230, 224, 206],
    ],
    age: [0.35, 0.8],
    fx: (rng) => ({
      kind: 'halftone',
      cell: rng.range(9, 14),
      angle: rng.pick([45, 15]),
      contrast: rng.range(1.25, 1.55),
      gamma: rng.range(0.95, 1.05),
      fade: 0.04,
    }),
    mastKind: ['classic', 'banner', 'banner'],
    ears: 0.45,
  },
  {
    id: 'midcentury',
    name: "1960'lar · Yeni çağ",
    cols: [4, 5],
    f: [33, 36],
    leading: [1.2, 1.28],
    mast: [D.playfair, D.alfa, D.oswald, D.gloock, D.bodoni],
    head: [D.oswald, D.fjalla, D.alfa, D.gloock, D.playfair],
    body: [F.source, F.ptSerif, F.gelasio],
    label: [F.archivo],
    caps: 0.3,
    headAlign: ['left'],
    headScale: [0.085, 0.12],
    stackFit: 0.1,
    columnRule: ['hair', 'none'],
    storyRule: ['medium', 'thick', 'thin'],
    mastRule: ['medium', 'thick'],
    paragraph: ['gap', 'indent'],
    dropCap: 0.2,
    deck: 0.6,
    kicker: 0.5,
    ink: [INK.black, INK.cool],
    spot: [RED, RED, NAVY, null],
    paper: [
      [240, 235, 220],
      [236, 230, 213],
    ],
    age: [0.2, 0.55],
    fx: (rng) =>
      rng.pick<PhotoFx>([
        { kind: 'halftone', cell: rng.range(6, 9), angle: 45, contrast: rng.range(1.2, 1.4), gamma: 1, fade: 0.05 },
        { kind: 'gravure', cell: 1, angle: 0, contrast: rng.range(1.15, 1.3), gamma: 1, fade: 0.06, tint: INK.black },
        { kind: 'faded', cell: 1, angle: 0, contrast: 1.08, gamma: 1, fade: 0.12 },
      ]),
    mastKind: ['left', 'banner', 'classic'],
    ears: 0.2,
  },
  {
    id: 'frontier',
    name: 'Kasaba gazetesi · Ahşap harf',
    cols: [4, 5, 6],
    f: [31, 34],
    leading: [1.16, 1.22],
    mast: [D.sancreek, D.ultra, D.alfa, D.rocker],
    head: [D.ultra, D.alfa, D.league, D.oldStd],
    body: [F.vollkorn, F.oldStd, F.crimson],
    label: [F.oldStd, F.vollkorn],
    caps: 0.7,
    headAlign: ['center'],
    headScale: [0.075, 0.11],
    stackFit: 0.3,
    columnRule: ['thin'],
    storyRule: ['diamond', 'oxford', 'wave', 'dots'],
    mastRule: ['oxford', 'double'],
    paragraph: ['indent'],
    dropCap: 0.4,
    deck: 0.5,
    kicker: 0.25,
    ink: [INK.brown, INK.warm, INK.black],
    spot: [null, null, RED],
    paper: [
      [233, 215, 176],
      [228, 208, 165],
    ],
    age: [0.6, 1],
    fx: (rng) =>
      rng.pick<PhotoFx>([
        { kind: 'engrave', cell: rng.range(8, 12), angle: rng.pick([0, 25, 45]), contrast: rng.range(1.25, 1.5), gamma: 1.05, fade: 0.04 },
        { kind: 'dither', cell: rng.pick([3, 4]), angle: 0, contrast: rng.range(1.2, 1.45), gamma: 1.05, fade: 0.04 },
      ]),
    mastKind: ['classic', 'emblem', 'banner'],
    ears: 0.5,
  },
];

export const ERA_IDS = ERAS.map((e) => e.id);

export function resolveStyle(rng: Rng, forcedEra?: string): Style {
  const era = ERAS.find((e) => e.id === forcedEra) ?? rng.pick(ERAS);
  const fPref = Math.round(rng.range(era.f[0], era.f[1]));
  const head = rng.pick(era.head);
  const alternatives = era.head.filter((h) => h !== head);
  const caps = !head.blackletter && (head.caps || rng.chance(era.caps));

  return {
    id: era.id,
    name: era.name,
    cols: rng.pick(era.cols),
    gutter: rng.range(30, 40),
    margin: rng.range(96, 128),
    fPref,
    fMin: 27,
    fMax: Math.round(fPref * 1.9),
    leading: rng.range(era.leading[0], era.leading[1]),
    mast: rng.pick(era.mast),
    head,
    headAlt: alternatives.length ? rng.pick(alternatives) : head,
    body: rng.pick(era.body),
    label: rng.pick(era.label),
    headCaps: caps,
    headAlign: rng.pick(era.headAlign),
    headScale: rng.range(era.headScale[0], era.headScale[1]),
    stackFit: rng.chance(era.stackFit),
    columnRule: rng.pick(era.columnRule),
    storyRule: rng.pick(era.storyRule),
    mastRule: rng.pick(era.mastRule),
    paragraph: rng.pick(era.paragraph),
    dropCap: era.dropCap,
    deck: era.deck,
    kicker: era.kicker,
    ink: rng.pick(era.ink),
    spot: rng.pick(era.spot),
    paper: rng.pick(era.paper) as [number, number, number],
    age: rng.range(era.age[0], era.age[1]),
    fx: era.fx(rng),
    mastKind: rng.pick(era.mastKind),
    stamp: rng.chance(0.14),
    ears: rng.chance(era.ears),
  };
}

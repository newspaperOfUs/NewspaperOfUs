/**
 * Yazılar ve fotoğraflar bu PRIVATE repoda durur. Site kodu public olsa da içeriğe
 * ancak bu repoya yetkili token ile ulaşılır; kontrolü tarayıcı değil GitHub yapar.
 */
export const DATA_REPO = {
  owner: import.meta.env.VITE_DATA_OWNER || 'emirhankskn',
  repo: import.meta.env.VITE_DATA_REPO || 'NewspaperOfUs-data',
};

export const API_BASE: string = import.meta.env.VITE_GITHUB_API || 'https://api.github.com';

/** Gazetenin logosunda yazan isim. */
export const PAPER_NAME = 'The Newspaper of Us';

/** Yüklenen fotoğrafların uzun kenarı; A4 300 DPI tam sayfa baskıya yeter. */
export const MAX_IMAGE_EDGE = 2400;
export const THUMB_EDGE = 520;

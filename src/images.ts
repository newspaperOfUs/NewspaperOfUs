import { MAX_IMAGE_EDGE, THUMB_EDGE } from './config';
import type { NewImage } from './store';

/** Blob'dan çizilebilir resim üretir; EXIF yönü tarayıcı tarafından uygulanır. */
export async function blobToImage(blob: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(blob);
  const image = new Image();
  try {
    image.src = url;
    await image.decode();
    return image;
  } finally {
    // decode() sonrası piksel verisi img üzerinde kalır; canvas'a çizim için URL gerekmez.
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
}

function resize(image: HTMLImageElement, maxEdge: number, quality: number): Promise<{ blob: Blob; w: number; h: number }> {
  const scale = Math.min(1, maxEdge / Math.max(image.naturalWidth, image.naturalHeight));
  const w = Math.max(1, Math.round(image.naturalWidth * scale));
  const h = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, 0, 0, w, h);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        canvas.width = 0;
        if (blob) resolve({ blob, w, h });
        else reject(new Error('Fotoğraf işlenemedi.'));
      },
      'image/jpeg',
      quality,
    );
  });
}

/**
 * Fotoğrafı yüklemeye hazırlar: küçültür, JPEG'e çevirir ve küçük önizleme üretir.
 * Yeniden kodlama EXIF'i (GPS konumu dahil) de siler.
 */
export async function prepareImage(file: File): Promise<NewImage> {
  let image: HTMLImageElement;
  try {
    image = await blobToImage(file);
  } catch {
    throw new Error(`“${file.name}” açılamadı. Bu tarayıcı dosya biçimini (örn. HEIC) desteklemiyor olabilir.`);
  }
  const full = await resize(image, MAX_IMAGE_EDGE, 0.86);
  const thumb = await resize(image, THUMB_EDGE, 0.72);
  return { full: full.blob, thumb: thumb.blob, w: full.w, h: full.h, caption: '' };
}

import type { Equipment } from './types';

export function equipmentImages(e: Pick<Equipment, 'image_url' | 'image_urls'>): string[] {
  return e.image_urls ?? (e.image_url ? [e.image_url] : []);
}

export function imageExtension(file: File, maxMB: number) {
  if (
    !['image/png', 'image/jpeg', 'image/webp'].includes(file.type) ||
    !file.size ||
    file.size > maxMB * 1048576
  )
    throw new Error(`仅支持 ${maxMB} MB 以内的 JPG、PNG、WebP 图片`);
  return file.type === 'image/jpeg' ? 'jpg' : file.type === 'image/png' ? 'png' : 'webp';
}

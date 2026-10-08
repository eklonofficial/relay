// Stamp images (the imported decals), decoded once each. stampImage() answers at once with the image
// or null while it loads; loadStamp() resolves when it is ready, so a shell can be repainted then.
import { ASSETS } from './asset-catalog.js?v=muziihfj';
import { fetchAssetBlob } from '../util/asset.js?v=muziihfj';

const images = new Map(), pending = new Map();
export const stampImage = id => images.get(id) || null;
export function loadStamp(id) {
  const url = ASSETS[`stamps/${id}.webp`];
  if (!url) return Promise.resolve(null);
  if (!pending.has(id)) pending.set(id, fetchAssetBlob(url, 'image/webp').then(createImageBitmap).then(img => { images.set(id, img); return img; }));
  return pending.get(id);
}

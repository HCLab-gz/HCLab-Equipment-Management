import { useState } from 'react';
import type { Equipment } from '../lib/types';
import { equipmentImages } from '../lib/images';
import { EquipmentArt } from './ui';

export function EquipmentGallery({ equipment }: { equipment: Equipment }) {
  const images = equipmentImages(equipment);
  const [chosen, setChosen] = useState('');
  const current = images.includes(chosen) ? chosen : (images[0] ?? '');
  return (
    <div className="equipment-gallery">
      <EquipmentArt equipment={{ ...equipment, image_url: current }} large />
      {images.length > 1 && (
        <div className="equipment-thumbnails" aria-label="设备图片">
          {images.map((url, i) => (
            <button
              key={`${url}-${i}`}
              aria-label={`查看设备图片 ${i + 1}${i === 0 ? '（封面）' : ''}`}
              aria-pressed={current === url}
              onClick={() => setChosen(url)}
            >
              <img src={url} alt={`设备图片 ${i + 1}`} />
              <span>{i === 0 ? '封面' : i + 1}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

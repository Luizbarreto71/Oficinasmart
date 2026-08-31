import { cn } from '@/lib/cn';
import { ImagePlus, X } from 'lucide-react';
import { useRef, useState } from 'react';

/** Reduz a imagem para no máximo 1200px antes de virar data URL. */
async function reduzir(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const escala = Math.min(1, 1200 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * escala);
  canvas.height = Math.round(bitmap.height * escala);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.8);
}

interface PhotoUploaderProps {
  photos: string[];
  onChange: (photos: string[]) => void;
  max?: number;
}

export function PhotoUploader({ photos, onChange, max = 6 }: PhotoUploaderProps) {
  const input = useRef<HTMLInputElement>(null);
  const [carregando, setCarregando] = useState(false);

  const adicionar = async (files: FileList | null) => {
    if (!files?.length) return;
    setCarregando(true);
    try {
      const novas: string[] = [];
      for (const f of Array.from(files).slice(0, max - photos.length)) {
        novas.push(await reduzir(f));
      }
      onChange([...photos, ...novas]);
    } finally {
      setCarregando(false);
      if (input.current) input.current.value = '';
    }
  };

  return (
    <div className="flex flex-wrap gap-2">
      {photos.map((src, i) => (
        <div key={i} className="group relative h-20 w-20 overflow-hidden rounded-lg border border-slate-200 dark:border-navy-700">
          <img src={src} alt="" className="h-full w-full object-cover" />
          <button
            type="button"
            onClick={() => onChange(photos.filter((_, j) => j !== i))}
            className="absolute right-1 top-1 rounded-full bg-navy-900/70 p-0.5 text-white opacity-0 transition group-hover:opacity-100"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ))}
      {photos.length < max && (
        <button
          type="button"
          onClick={() => input.current?.click()}
          disabled={carregando}
          className={cn(
            'flex h-20 w-20 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-slate-300 text-xs text-slate-400 transition hover:border-accent hover:text-accent dark:border-navy-600',
            carregando && 'opacity-50',
          )}
        >
          <ImagePlus className="h-5 w-5" />
          {carregando ? '...' : 'Foto'}
        </button>
      )}
      <input ref={input} type="file" accept="image/*" multiple hidden onChange={(e) => adicionar(e.target.files)} />
    </div>
  );
}

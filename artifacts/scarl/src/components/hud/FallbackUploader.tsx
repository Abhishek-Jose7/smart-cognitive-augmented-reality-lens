import React, { useRef } from 'react';

interface FallbackUploaderProps {
  onImageSelected: (base64: string) => void;
}

export function FallbackUploader({ onImageSelected }: FallbackUploaderProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string;
      if (dataUrl) {
        // remove data:image/jpeg;base64,
        const base64 = dataUrl.split(',')[1];
        onImageSelected(base64);
      }
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center pointer-events-auto bg-black/80 backdrop-blur-sm">
      <div className="hud-glass p-8 flex flex-col items-center gap-4 max-w-xs text-center">
        <div className="text-red-hud border border-red-hud/30 bg-red-hud/10 px-3 py-1 text-[10px] tracking-widest font-bold">
          CAMERA FEED UNAVAILABLE
        </div>
        <p className="text-xs text-cyan/70 mb-4">
          Please allow camera access or provide a static tactical scan for analysis.
        </p>
        <button 
          onClick={() => fileInputRef.current?.click()}
          className="hud-glass-solid px-6 py-2 border border-cyan text-cyan uppercase text-sm tracking-widest hover:bg-cyan/10 transition-colors"
        >
          UPLOAD SCENE
        </button>
        <input 
          type="file" 
          accept="image/*" 
          className="hidden" 
          ref={fileInputRef}
          onChange={handleFileChange}
        />
      </div>
    </div>
  );
}

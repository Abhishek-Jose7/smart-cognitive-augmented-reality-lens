import React from 'react';

export function ScanlineOverlay() {
  return (
    <div className="absolute inset-0 pointer-events-none z-50 overflow-hidden mix-blend-overlay opacity-20">
      <div className="w-full h-1 bg-cyan/50 animate-scanline shadow-[0_0_20px_rgba(92,246,255,0.5)]" />
      <div className="absolute inset-0 bg-[linear-gradient(transparent_50%,rgba(0,0,0,0.25)_50%)] bg-[length:100%_4px]" />
    </div>
  );
}

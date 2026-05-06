import React from 'react';
import { motion } from 'framer-motion';
import type { Overlay } from '@workspace/api-client-react';

interface TargetBoxProps {
  overlay: Overlay;
  index: number;
}

function styleForOverlay(overlay: Overlay) {
  const sev = overlay.severity ?? 'low';
  const kind = overlay.kind ?? 'object';

  if (kind === 'threat' || sev === 'critical') {
    return {
      border: 'border-[rgba(255,90,110,0.9)]',
      text: 'text-[rgba(255,160,170,0.95)]',
      label: 'text-[rgba(255,220,225,0.98)]',
      pulse: true,
      icon: '!',
    };
  }

  if (kind === 'warning' || sev === 'high') {
    return {
      border: 'border-[rgba(255,181,71,0.85)]',
      text: 'text-[rgba(255,205,140,0.95)]',
      label: 'text-[rgba(255,225,175,0.98)]',
      pulse: false,
      icon: '!',
    };
  }

  if (kind === 'navigation') {
    return {
      border: 'border-[rgba(140,255,200,0.75)]',
      text: 'text-[rgba(190,255,220,0.95)]',
      label: 'text-[rgba(190,255,220,0.95)]',
      pulse: false,
      icon: null,
    };
  }

  if (kind === 'text') {
    return {
      border: 'border-[rgba(125,220,255,0.8)]',
      text: 'text-[rgba(190,235,255,0.95)]',
      label: 'text-[rgba(210,245,255,0.95)]',
      pulse: false,
      icon: null,
    };
  }

  if (kind === 'person') {
    return {
      border: 'border-[rgba(255,255,255,0.7)]',
      text: 'text-white/85',
      label: 'text-white/95',
      pulse: false,
      icon: null,
    };
  }

  return {
    border: 'border-[rgba(255,255,255,0.6)]',
    text: 'text-white/80',
    label: 'text-white/90',
    pulse: false,
    icon: null,
  };
}

function clampBoxSize(value: number | undefined, fallback: number) {
  if (typeof value !== 'number' || Number.isNaN(value)) return fallback;
  return Math.min(Math.max(value, 0.06), 0.55);
}

export function TargetBox({ overlay, index }: TargetBoxProps) {
  const x = overlay.x ?? 0.5;
  const y = overlay.y ?? 0.5;
  const w = clampBoxSize(overlay.w, 0.2);
  const h = clampBoxSize(overlay.h, 0.2);

  const left = `${x * 100}%`;
  const top = `${y * 100}%`;
  const width = `${w * 100}%`;
  const height = `${h * 100}%`;

  const s = styleForOverlay(overlay);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2, delay: Math.min(index * 0.03, 0.18) }}
      className="absolute -translate-x-1/2 -translate-y-1/2"
      style={{ left, top, width, height }}
    >
      <div
        className={`relative w-full h-full border ${s.border} bg-black/[0.03] shadow-[0_0_10px_rgba(0,0,0,0.35)]`}
      >
        <div className={`absolute top-0 left-0 w-3 h-3 border-t-2 border-l-2 ${s.border}`} />
        <div className={`absolute top-0 right-0 w-3 h-3 border-t-2 border-r-2 ${s.border}`} />
        <div className={`absolute bottom-0 left-0 w-3 h-3 border-b-2 border-l-2 ${s.border}`} />
        <div className={`absolute bottom-0 right-0 w-3 h-3 border-b-2 border-r-2 ${s.border}`} />

        {s.pulse && (
          <motion.div
            animate={{ opacity: [0.0, 0.18, 0.0] }}
            transition={{ duration: 1.4, repeat: Infinity }}
            className="absolute inset-0 bg-[rgba(255,90,110,1)]"
          />
        )}

        <div className="absolute -top-4 left-0 pointer-events-none max-w-[52vw]">
          <div
            className={`flex items-baseline gap-1 px-1 text-[10px] tracking-wider whitespace-nowrap ${s.label}`}
            style={{
              textShadow: '0 1px 2px rgba(0,0,0,0.9), 0 0 1px rgba(0,0,0,0.9)',
              fontVariantCaps: 'all-small-caps',
              letterSpacing: '0.08em',
            }}
          >
            {s.icon && <span className="opacity-90">{s.icon}</span>}
            <span className="font-semibold truncate">{overlay.label}</span>
            {overlay.detail && (
              <span className={`${s.text} opacity-80 truncate`}>- {overlay.detail}</span>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

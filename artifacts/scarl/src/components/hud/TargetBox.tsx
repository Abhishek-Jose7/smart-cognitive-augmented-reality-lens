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
      border: 'border-[rgba(255,90,110,0.85)]',
      text: 'text-[rgba(255,160,170,0.95)]',
      label: 'text-[rgba(255,200,205,0.95)]',
      pulse: true,
      icon: '⚠',
    };
  }
  if (kind === 'warning' || sev === 'high') {
    return {
      border: 'border-[rgba(255,181,71,0.75)]',
      text: 'text-[rgba(255,205,140,0.95)]',
      label: 'text-[rgba(255,215,160,0.95)]',
      pulse: false,
      icon: '⚠',
    };
  }
  if (kind === 'navigation') {
    return {
      border: 'border-[rgba(140,255,200,0.55)]',
      text: 'text-[rgba(190,255,220,0.95)]',
      label: 'text-[rgba(190,255,220,0.95)]',
      pulse: false,
      icon: '↑',
    };
  }
  if (kind === 'person') {
    return {
      border: 'border-[rgba(255,255,255,0.55)]',
      text: 'text-white/85',
      label: 'text-white/90',
      pulse: false,
      icon: null,
    };
  }
  // object / text / info / suggestion / reminder — minimal white
  return {
    border: 'border-[rgba(255,255,255,0.45)]',
    text: 'text-white/80',
    label: 'text-white/85',
    pulse: false,
    icon: null,
  };
}

export function TargetBox({ overlay, index }: TargetBoxProps) {
  const x = overlay.x ?? 0.5;
  const y = overlay.y ?? 0.5;
  const w = overlay.w ?? 0.2;
  const h = overlay.h ?? 0.2;

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
      transition={{ duration: 0.25, delay: Math.min(index * 0.03, 0.3) }}
      className="absolute -translate-x-1/2 -translate-y-1/2"
      style={{ left, top, width, height }}
    >
      {/* Bracket-only frame (no full border, keeps view clear) */}
      <div className={`relative w-full h-full ${s.border}`}>
        <div className={`absolute top-0 left-0 w-2.5 h-2.5 border-t border-l ${s.border}`} />
        <div className={`absolute top-0 right-0 w-2.5 h-2.5 border-t border-r ${s.border}`} />
        <div className={`absolute bottom-0 left-0 w-2.5 h-2.5 border-b border-l ${s.border}`} />
        <div className={`absolute bottom-0 right-0 w-2.5 h-2.5 border-b border-r ${s.border}`} />

        {s.pulse && (
          <motion.div
            animate={{ opacity: [0.0, 0.18, 0.0] }}
            transition={{ duration: 1.4, repeat: Infinity }}
            className="absolute inset-0 bg-[rgba(255,90,110,1)]"
          />
        )}

        {/* Minimal floating label */}
        <div className="absolute -top-4 left-0 pointer-events-none">
          <div
            className={`flex items-baseline gap-1 px-1 text-[10px] tracking-wider whitespace-nowrap ${s.label}`}
            style={{
              textShadow: '0 1px 2px rgba(0,0,0,0.85), 0 0 1px rgba(0,0,0,0.85)',
              fontVariantCaps: 'all-small-caps',
              letterSpacing: '0.08em',
            }}
          >
            {s.icon && <span className="opacity-90">{s.icon}</span>}
            <span className="font-semibold">{overlay.label}</span>
            {overlay.detail && (
              <span className={`${s.text} opacity-75 max-w-[40vw] truncate`}>· {overlay.detail}</span>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

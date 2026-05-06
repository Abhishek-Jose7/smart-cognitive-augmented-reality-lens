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
      borderColor: 'rgba(255,90,110,0.9)',
      textColor: 'rgba(255,160,170,0.95)',
      labelColor: 'rgba(255,220,225,0.98)',
      glowColor: 'rgba(255,90,110,0.3)',
      pulse: true,
      icon: '⚠',
    };
  }

  if (kind === 'warning' || sev === 'high') {
    return {
      borderColor: 'rgba(255,181,71,0.85)',
      textColor: 'rgba(255,205,140,0.95)',
      labelColor: 'rgba(255,225,175,0.98)',
      glowColor: 'rgba(255,181,71,0.15)',
      pulse: false,
      icon: '!',
    };
  }

  if (kind === 'navigation') {
    return {
      borderColor: 'rgba(140,255,200,0.75)',
      textColor: 'rgba(190,255,220,0.95)',
      labelColor: 'rgba(190,255,220,0.95)',
      glowColor: 'rgba(140,255,200,0.1)',
      pulse: false,
      icon: null,
    };
  }

  if (kind === 'text') {
    return {
      borderColor: 'rgba(125,220,255,0.8)',
      textColor: 'rgba(190,235,255,0.95)',
      labelColor: 'rgba(210,245,255,0.95)',
      glowColor: 'rgba(125,220,255,0.1)',
      pulse: false,
      icon: null,
    };
  }

  if (kind === 'person') {
    return {
      borderColor: 'rgba(180,140,255,0.75)',
      textColor: 'rgba(210,190,255,0.9)',
      labelColor: 'rgba(230,215,255,0.95)',
      glowColor: 'rgba(180,140,255,0.08)',
      pulse: false,
      icon: null,
    };
  }

  // Default — objects
  return {
    borderColor: 'rgba(92,246,255,0.6)',
    textColor: 'rgba(160,235,245,0.85)',
    labelColor: 'rgba(200,248,255,0.92)',
    glowColor: 'rgba(92,246,255,0.06)',
    pulse: false,
    icon: null,
  };
}

function clampBoxSize(value: number | undefined, fallback: number) {
  if (typeof value !== 'number' || Number.isNaN(value)) return fallback;
  return Math.min(Math.max(value, 0.04), 0.65);
}

export function TargetBox({ overlay, index }: TargetBoxProps) {
  const x = overlay.x ?? 0.5;
  const y = overlay.y ?? 0.5;
  const w = clampBoxSize(overlay.w, 0.15);
  const h = clampBoxSize(overlay.h, 0.15);

  const left = `${x * 100}%`;
  const top = `${y * 100}%`;
  const width = `${w * 100}%`;
  const height = `${h * 100}%`;

  const s = styleForOverlay(overlay);
  const isLocal = overlay.id.startsWith('local-');
  const cornerSize = Math.max(6, Math.min(12, w * 80));

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.92 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{
        duration: isLocal ? 0.15 : 0.25,
        delay: Math.min(index * 0.02, 0.12),
        // Smooth position transitions for tracking
        left: { type: 'spring', stiffness: 120, damping: 20 },
        top: { type: 'spring', stiffness: 120, damping: 20 },
        width: { type: 'spring', stiffness: 100, damping: 18 },
        height: { type: 'spring', stiffness: 100, damping: 18 },
      }}
      className="absolute -translate-x-1/2 -translate-y-1/2"
      style={{
        left,
        top,
        width,
        height,
        willChange: 'left, top, width, height',
      }}
    >
      {/* Main box border */}
      <div
        className="relative w-full h-full"
        style={{
          border: `1px solid ${s.borderColor}`,
          background: s.glowColor,
          boxShadow: `0 0 8px ${s.glowColor}, inset 0 0 4px ${s.glowColor}`,
        }}
      >
        {/* Corner brackets */}
        <div
          className="absolute top-0 left-0"
          style={{
            width: `${cornerSize}px`,
            height: `${cornerSize}px`,
            borderTop: `2px solid ${s.borderColor}`,
            borderLeft: `2px solid ${s.borderColor}`,
          }}
        />
        <div
          className="absolute top-0 right-0"
          style={{
            width: `${cornerSize}px`,
            height: `${cornerSize}px`,
            borderTop: `2px solid ${s.borderColor}`,
            borderRight: `2px solid ${s.borderColor}`,
          }}
        />
        <div
          className="absolute bottom-0 left-0"
          style={{
            width: `${cornerSize}px`,
            height: `${cornerSize}px`,
            borderBottom: `2px solid ${s.borderColor}`,
            borderLeft: `2px solid ${s.borderColor}`,
          }}
        />
        <div
          className="absolute bottom-0 right-0"
          style={{
            width: `${cornerSize}px`,
            height: `${cornerSize}px`,
            borderBottom: `2px solid ${s.borderColor}`,
            borderRight: `2px solid ${s.borderColor}`,
          }}
        />

        {/* Pulse overlay for critical items */}
        {s.pulse && (
          <motion.div
            animate={{ opacity: [0.0, 0.2, 0.0] }}
            transition={{ duration: 1.2, repeat: Infinity }}
            className="absolute inset-0"
            style={{ background: s.borderColor }}
          />
        )}

        {/* Center crosshair for important items */}
        {(overlay.severity === 'high' || overlay.severity === 'critical') && (
          <>
            <div
              className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
              style={{
                width: '8px',
                height: '1px',
                background: s.borderColor,
                opacity: 0.6,
              }}
            />
            <div
              className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
              style={{
                width: '1px',
                height: '8px',
                background: s.borderColor,
                opacity: 0.6,
              }}
            />
          </>
        )}

        {/* Label above the box */}
        <div className="absolute -top-[18px] left-0 pointer-events-none max-w-[52vw]">
          <div
            className="flex items-baseline gap-1 px-1.5 py-0.5"
            style={{
              background: 'rgba(0,0,0,0.7)',
              borderLeft: `2px solid ${s.borderColor}`,
              fontSize: '10px',
              letterSpacing: '0.08em',
              fontVariantCaps: 'all-small-caps',
              color: s.labelColor,
              textShadow: '0 1px 2px rgba(0,0,0,0.9)',
            }}
          >
            {s.icon && <span style={{ opacity: 0.9 }}>{s.icon}</span>}
            <span className="font-semibold truncate">{overlay.label}</span>
            {overlay.detail && (
              <span
                className="opacity-75 truncate"
                style={{ color: s.textColor }}
              >
                · {overlay.detail}
              </span>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { Overlay } from '@workspace/api-client-react';

interface InsightPanelProps {
  overlays: Overlay[];
}

const INSIGHT_KINDS = new Set(['warning', 'threat', 'suggestion', 'reminder', 'navigation']);

function tone(o: Overlay) {
  if (o.kind === 'threat' || o.severity === 'critical') {
    return { dot: 'bg-[rgba(255,90,110,0.95)]', text: 'text-[rgba(255,205,210,0.95)]', label: 'ALERT' };
  }
  if (o.kind === 'warning' || o.severity === 'high') {
    return { dot: 'bg-[rgba(255,181,71,0.95)]', text: 'text-[rgba(255,215,160,0.95)]', label: 'CAUTION' };
  }
  if (o.kind === 'navigation') {
    return { dot: 'bg-[rgba(140,255,200,0.95)]', text: 'text-[rgba(200,255,220,0.95)]', label: 'NAV' };
  }
  return { dot: 'bg-[rgba(140,220,255,0.95)]', text: 'text-white/85', label: 'NOTE' };
}

export function InsightPanel({ overlays }: InsightPanelProps) {
  const insights = overlays.filter((o) => INSIGHT_KINDS.has(o.kind ?? '')).slice(0, 3);
  return (
    <div
      className="absolute top-[env(safe-area-inset-top,8px)] right-[env(safe-area-inset-right,8px)] m-3 z-20 pointer-events-none flex flex-col gap-1.5 max-w-[42vw]"
      style={{ textShadow: '0 1px 2px rgba(0,0,0,0.85)' }}
    >
      <AnimatePresence>
        {insights.map((o) => {
          const t = tone(o);
          return (
            <motion.div
              key={o.id}
              initial={{ opacity: 0, x: 6 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 6 }}
              transition={{ duration: 0.25 }}
              className="flex items-start gap-2 text-[10px] tracking-wider"
            >
              <span className={`mt-1 inline-block w-1.5 h-1.5 rounded-full ${t.dot}`} />
              <div className="flex flex-col leading-tight">
                <span className="text-white/55 text-[9px]">{t.label}</span>
                <span className={`${t.text} font-semibold`}>{o.label}</span>
                {o.detail && <span className="text-white/65">{o.detail}</span>}
              </div>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

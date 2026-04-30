import React from 'react';
import { motion } from 'framer-motion';

interface TickerBarProps {
  summary: string | null;
}

export function TickerBar({ summary }: TickerBarProps) {
  if (!summary) return null;

  return (
    <div className="absolute top-safe left-1/2 -translate-x-1/2 mt-4 w-64 max-w-[80vw] h-6 hud-glass flex items-center overflow-hidden z-20 pointer-events-none">
      <div className="absolute left-0 top-0 bottom-0 w-2 bg-cyan" />
      <div className="px-2 text-[10px] text-cyan tracking-widest whitespace-nowrap truncate w-full pl-4 font-bold flex items-center">
        <span className="mr-2 opacity-50">SCENE:</span>
        <motion.div
          initial={{ x: 20, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          key={summary}
          className="truncate text-glow"
        >
          {summary}
        </motion.div>
      </div>
    </div>
  );
}

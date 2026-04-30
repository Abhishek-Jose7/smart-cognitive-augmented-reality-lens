import React from 'react';
import { motion } from 'framer-motion';

interface VoiceStripProps {
  state: 'idle' | 'listening' | 'analyzing' | 'speaking';
}

const LABELS: Record<VoiceStripProps['state'], string> = {
  idle: '',
  listening: 'Listening',
  analyzing: 'Analyzing',
  speaking: 'Responding',
};

export function VoiceStrip({ state }: VoiceStripProps) {
  if (state === 'idle') {
    return <div className="h-4" />;
  }
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex items-center gap-2 text-[10px] text-white/85"
      style={{ textShadow: '0 1px 2px rgba(0,0,0,0.85)', letterSpacing: '0.12em' }}
    >
      <motion.span
        className="inline-block w-1 h-1 rounded-full bg-[rgba(140,220,255,0.95)]"
        animate={{ opacity: [0.3, 1, 0.3] }}
        transition={{ duration: 1.2, repeat: Infinity }}
      />
      <span>{LABELS[state]}…</span>
    </motion.div>
  );
}

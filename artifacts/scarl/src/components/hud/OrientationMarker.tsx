import React from 'react';
import { motion } from 'framer-motion';

export function OrientationMarker() {
  return (
    <div className="absolute top-safe right-safe m-4 z-20 pointer-events-none w-12 h-12 flex items-center justify-center">
      {/* Outer ring */}
      <motion.div 
        animate={{ rotate: 360 }}
        transition={{ duration: 20, ease: "linear", repeat: Infinity }}
        className="absolute inset-0 rounded-full border border-dashed border-cyan/40"
      />
      {/* Inner ring */}
      <motion.div 
        animate={{ rotate: -360 }}
        transition={{ duration: 15, ease: "linear", repeat: Infinity }}
        className="absolute inset-1 rounded-full border border-dotted border-cyan/60"
      />
      {/* Center cross */}
      <div className="w-4 h-4 relative">
        <div className="absolute top-1/2 left-0 w-full h-[1px] bg-cyan/80 -translate-y-1/2" />
        <div className="absolute left-1/2 top-0 h-full w-[1px] bg-cyan/80 -translate-x-1/2" />
      </div>
      <div className="absolute -top-3 text-[8px] text-cyan font-bold tracking-widest text-glow">N</div>
    </div>
  );
}

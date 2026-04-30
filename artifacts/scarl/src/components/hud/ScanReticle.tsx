import React from 'react';
import { motion } from 'framer-motion';

interface ScanReticleProps {
  isScanning: boolean;
}

export function ScanReticle({ isScanning }: ScanReticleProps) {
  return (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
      <motion.div 
        animate={{ 
          rotate: isScanning ? 360 : 0,
          scale: isScanning ? [1, 1.1, 1] : 1
        }}
        transition={{ 
          rotate: { duration: 4, ease: "linear", repeat: Infinity },
          scale: { duration: 2, ease: "easeInOut", repeat: Infinity }
        }}
        className="relative w-32 h-32"
      >
        {/* Reticle Lines */}
        <div className="absolute top-1/2 left-0 w-4 h-[1px] bg-cyan -translate-y-1/2 opacity-70" />
        <div className="absolute top-1/2 right-0 w-4 h-[1px] bg-cyan -translate-y-1/2 opacity-70" />
        <div className="absolute left-1/2 top-0 w-[1px] h-4 bg-cyan -translate-x-1/2 opacity-70" />
        <div className="absolute left-1/2 bottom-0 w-[1px] h-4 bg-cyan -translate-x-1/2 opacity-70" />

        {/* Center dot */}
        <div className="absolute top-1/2 left-1/2 w-1 h-1 bg-cyan rounded-full -translate-x-1/2 -translate-y-1/2 shadow-[0_0_8px_var(--color-cyan)]" />
        
        {/* Corner Brackets */}
        <div className="absolute top-0 left-0 w-3 h-3 border-t border-l border-cyan opacity-50" />
        <div className="absolute top-0 right-0 w-3 h-3 border-t border-r border-cyan opacity-50" />
        <div className="absolute bottom-0 left-0 w-3 h-3 border-b border-l border-cyan opacity-50" />
        <div className="absolute bottom-0 right-0 w-3 h-3 border-b border-r border-cyan opacity-50" />

        {/* Scan ring */}
        {isScanning && (
          <motion.div 
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{ opacity: [0, 0.5, 0], scale: 1.5 }}
            transition={{ duration: 1.5, repeat: Infinity, ease: "easeOut" }}
            className="absolute inset-0 rounded-full border border-cyan"
          />
        )}
      </motion.div>
    </div>
  );
}

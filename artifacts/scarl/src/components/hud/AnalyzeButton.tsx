import React from 'react';
import { motion } from 'framer-motion';

interface AnalyzeButtonProps {
  onClick: () => void;
  isAnalyzing: boolean;
}

export function AnalyzeButton({ onClick, isAnalyzing }: AnalyzeButtonProps) {
  return (
    <button 
      onClick={onClick}
      disabled={isAnalyzing}
      className="relative group focus:outline-none pointer-events-auto"
    >
      {/* Outer Pulse */}
      <motion.div 
        animate={{ 
          scale: isAnalyzing ? [1, 1.2, 1] : 1,
          opacity: isAnalyzing ? [0.5, 0, 0.5] : 0.5
        }}
        transition={{ duration: 1.5, repeat: Infinity }}
        className="absolute inset-0 border border-cyan rounded-sm opacity-50"
      />
      
      <div className="hud-glass-solid relative px-8 py-4 border border-cyan text-cyan uppercase tracking-[0.2em] text-sm font-bold transition-colors group-hover:bg-cyan/10 group-active:bg-cyan/20">
        {/* Corner decor */}
        <div className="absolute top-0 left-0 w-2 h-2 border-t border-l border-cyan" />
        <div className="absolute bottom-0 right-0 w-2 h-2 border-b border-r border-cyan" />
        
        {isAnalyzing ? (
          <span className="flex items-center gap-2">
            <motion.span 
              animate={{ rotate: 360 }}
              transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
              className="inline-block"
            >
              ◉
            </motion.span>
            ANALYZING...
          </span>
        ) : (
          <span className="flex items-center gap-2">
            <span className="text-cyan opacity-80">▶</span>
            ANALYZE SCENE
          </span>
        )}
      </div>
    </button>
  );
}

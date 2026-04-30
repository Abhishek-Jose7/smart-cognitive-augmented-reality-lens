import React from 'react';
import { RefreshCw, Upload, Mic, MicOff, Activity, Pause } from 'lucide-react';

interface SecondaryControlsProps {
  isVoiceMuted: boolean;
  onToggleMute: () => void;
  onSwitchCamera: () => void;
  onUploadFallback: () => void;
  autoMode: boolean;
  onToggleAuto: () => void;
}

export function SecondaryControls({
  isVoiceMuted,
  onToggleMute,
  onSwitchCamera,
  onUploadFallback,
  autoMode,
  onToggleAuto,
}: SecondaryControlsProps) {
  const btn =
    'w-7 h-7 flex items-center justify-center text-white/55 hover:text-white/90 transition-colors active:scale-95';

  return (
    <div
      className="absolute bottom-[env(safe-area-inset-bottom,8px)] right-[env(safe-area-inset-right,8px)] m-3 z-20 flex items-center gap-1 pointer-events-auto"
      style={{ textShadow: '0 1px 2px rgba(0,0,0,0.85)' }}
    >
      <button
        onClick={onToggleAuto}
        className={btn}
        title={autoMode ? 'Pause monitoring' : 'Resume monitoring'}
      >
        {autoMode ? <Activity size={14} /> : <Pause size={14} />}
      </button>
      <button onClick={onToggleMute} className={btn} title="Toggle voice">
        {isVoiceMuted ? <MicOff size={14} /> : <Mic size={14} />}
      </button>
      <button onClick={onSwitchCamera} className={btn} title="Switch camera">
        <RefreshCw size={14} />
      </button>
      <button onClick={onUploadFallback} className={btn} title="Upload image">
        <Upload size={14} />
      </button>
    </div>
  );
}

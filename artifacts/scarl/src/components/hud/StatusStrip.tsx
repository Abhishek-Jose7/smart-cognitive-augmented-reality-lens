import React from 'react';
import { useSystemStatus, getSystemStatusQueryKey } from '@workspace/api-client-react';

interface StatusStripProps {
  autoMode: boolean;
}

export function StatusStrip({ autoMode }: StatusStripProps) {
  const { data: status } = useSystemStatus({
    query: {
      queryKey: getSystemStatusQueryKey(),
      refetchInterval: 5000,
    },
  });

  if (!status) return null;

  const mode = autoMode ? 'ASSIST' : (status.mode || 'STANDBY').toUpperCase();

  return (
    <div
      className="absolute top-[env(safe-area-inset-top,8px)] left-[env(safe-area-inset-left,8px)] m-3 z-20 pointer-events-none text-[10px] text-white/80 flex items-center gap-2"
      style={{ textShadow: '0 1px 2px rgba(0,0,0,0.85)', letterSpacing: '0.08em' }}
    >
      <span
        className={`inline-block w-1.5 h-1.5 rounded-full ${
          status.aiOnline ? 'bg-[rgba(140,255,210,0.95)]' : 'bg-[rgba(255,90,110,0.95)]'
        }`}
      />
      <span className="opacity-90">{status.aiOnline ? 'ONLINE' : 'OFFLINE'}</span>
      <span className="opacity-30">·</span>
      <span className="opacity-90">{(status.connection || 'NET').toUpperCase()}</span>
      <span className="opacity-30">·</span>
      <span className="opacity-90">BAT {Math.round(Number(status.battery ?? 0))}%</span>
      <span className="opacity-30">·</span>
      <span className="opacity-90">{mode}</span>
    </div>
  );
}

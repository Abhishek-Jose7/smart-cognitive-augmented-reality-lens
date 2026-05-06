import React from 'react';
import { motion } from 'framer-motion';
import { useSystemStatus, getSystemStatusQueryKey } from '@workspace/api-client-react';

interface StatusStripProps {
  autoMode: boolean;
  apiHealth?: 'unknown' | 'ok' | 'error' | 'pending';
  apiResponseTime?: number | null;
}

export function StatusStrip({ autoMode, apiHealth = 'unknown', apiResponseTime }: StatusStripProps) {
  const { data: status } = useSystemStatus({
    query: {
      queryKey: getSystemStatusQueryKey(),
      refetchInterval: 5000,
    },
  });

  if (!status) return null;

  const mode = autoMode ? 'ASSIST' : (status.mode || 'STANDBY').toUpperCase();

  // API health indicator
  const healthColor =
    apiHealth === 'ok' ? 'rgba(140,255,210,0.95)' :
    apiHealth === 'error' ? 'rgba(255,90,110,0.95)' :
    apiHealth === 'pending' ? 'rgba(255,181,71,0.95)' :
    'rgba(255,255,255,0.3)';

  const healthLabel =
    apiHealth === 'ok' ? 'API OK' :
    apiHealth === 'error' ? 'API ERR' :
    apiHealth === 'pending' ? 'API...' :
    'API ?';

  return (
    <div
      className="absolute top-[env(safe-area-inset-top,8px)] left-[env(safe-area-inset-left,8px)] m-3 z-20 pointer-events-none text-[9px] text-white/75 flex items-center gap-1.5"
      style={{ textShadow: '0 1px 2px rgba(0,0,0,0.85)', letterSpacing: '0.08em' }}
    >
      {/* System online dot */}
      <span
        className={`inline-block w-1.5 h-1.5 rounded-full ${
          status.aiOnline ? 'bg-[rgba(140,255,210,0.95)]' : 'bg-[rgba(255,90,110,0.95)]'
        }`}
      />
      <span className="opacity-85">{status.aiOnline ? 'ON' : 'OFF'}</span>
      <span className="opacity-25">·</span>

      {/* API health indicator */}
      {apiHealth === 'pending' ? (
        <motion.span
          className="inline-block w-1.5 h-1.5 rounded-full"
          style={{ background: healthColor }}
          animate={{ opacity: [0.3, 1, 0.3] }}
          transition={{ duration: 0.8, repeat: Infinity }}
        />
      ) : (
        <span
          className="inline-block w-1.5 h-1.5 rounded-full"
          style={{ background: healthColor }}
        />
      )}
      <span className="opacity-85">{healthLabel}</span>
      {apiHealth === 'ok' && apiResponseTime && (
        <span className="opacity-50">{Math.round(apiResponseTime / 1000)}s</span>
      )}
      <span className="opacity-25">·</span>

      <span className="opacity-85">{mode}</span>
    </div>
  );
}

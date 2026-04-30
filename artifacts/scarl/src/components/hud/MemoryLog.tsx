import React, { useState } from 'react';
import { useGetMemory, getGetMemoryQueryKey } from '@workspace/api-client-react';

export function MemoryLog() {
  const { data: memory } = useGetMemory({
    query: {
      queryKey: getGetMemoryQueryKey(),
      refetchInterval: 10000
    }
  });

  const [expanded, setExpanded] = useState(false);

  const entries = memory?.entries?.slice(0, 3) || [];

  if (entries.length === 0) return null;

  return (
    <div className="absolute bottom-safe left-safe m-4 z-20 pointer-events-auto">
      <div 
        className="text-[10px] text-cyan/70 flex flex-col gap-1 w-48 hud-glass p-2 cursor-pointer transition-colors hover:bg-cyan/5"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex justify-between items-center border-b border-cyan/20 pb-1 mb-1">
          <span className="font-bold tracking-wider">MEM.LOG</span>
          <span>{expanded ? '▼' : '▲'}</span>
        </div>
        
        {expanded ? (
          <div className="flex flex-col gap-2">
            {entries.map(entry => (
              <div key={entry.id} className="flex flex-col gap-0.5">
                <span className="text-[8px] opacity-50">{new Date(entry.timestamp).toLocaleTimeString()}</span>
                <span className="leading-tight">{entry.summary}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="truncate opacity-80">
            {entries[0]?.summary}
          </div>
        )}
      </div>
    </div>
  );
}

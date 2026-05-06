import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import type { Overlay } from '@workspace/api-client-react';
import { TargetBox } from './TargetBox';

interface OverlayLayerProps {
  overlays: Overlay[];
  autoMode?: boolean;
}

interface TrackedOverlay extends Overlay {
  _key: string;
  _firstSeenAt: number;
  _lastSeenAt: number;
  _hideAt: number; // timestamp when this should disappear from view
}

const ALWAYS_SHOW_KINDS = new Set(['warning', 'threat', 'navigation', 'text', 'reminder', 'suggestion']);
const HIGH_SEVERITIES = new Set(['high', 'critical']);
const MAX_VISIBLE_OVERLAYS = 4;

// How long a label stays visible after first/last appearance.
// Important things linger longer; mundane objects fade fast.
const NEW_OBJECT_DISPLAY_MS = 3500;
const KNOWN_OBJECT_DISPLAY_MS = 1200;
const IMPORTANT_DISPLAY_MS = 9000;

function fingerprint(o: Overlay): string {
  return `${(o.kind || 'object').toLowerCase()}::${(o.label || '').toLowerCase().trim()}`;
}

function detailFingerprint(o: Overlay): string {
  return `${fingerprint(o)}::${(o.detail || '').toLowerCase().trim()}`;
}

function isImportant(o: Overlay): boolean {
  return ALWAYS_SHOW_KINDS.has((o.kind || '').toLowerCase()) || HIGH_SEVERITIES.has((o.severity || '').toLowerCase());
}

function overlayScore(o: Overlay): number {
  const kind = (o.kind || 'object').toLowerCase();
  const severity = (o.severity || 'low').toLowerCase();
  let score = 0;
  if (severity === 'critical') score += 100;
  if (severity === 'high') score += 80;
  if (severity === 'medium') score += 30;
  if (kind === 'threat') score += 100;
  if (kind === 'warning') score += 80;
  if (kind === 'text') score += 70;
  if (kind === 'navigation') score += 60;
  if (kind === 'person') score += 45;
  if (kind === 'suggestion' || kind === 'reminder') score += 40;
  if (o.detail) score += 8;
  return score;
}

function limitVisible<T extends TrackedOverlay>(items: T[]): T[] {
  return [...items]
    .sort((a, b) => {
      const priority = overlayScore(b) - overlayScore(a);
      if (priority !== 0) return priority;
      return b._lastSeenAt - a._lastSeenAt;
    })
    .slice(0, MAX_VISIBLE_OVERLAYS);
}

export function OverlayLayer({ overlays }: OverlayLayerProps) {
  const knownRef = useRef<Map<string, { detailFp: string }>>(new Map());
  const [tracked, setTracked] = useState<TrackedOverlay[]>([]);

  // Reconcile incoming overlays against the "already known" set.
  useEffect(() => {
    const now = Date.now();
    const incomingByKey = new Map<string, Overlay>();
    overlays.forEach((o) => incomingByKey.set(fingerprint(o), o));

    // Detect a context shift: more than half of incoming items are new
    let newCount = 0;
    incomingByKey.forEach((_o, key) => {
      if (!knownRef.current.has(key)) newCount += 1;
    });
    const contextShift = incomingByKey.size > 0 && newCount / incomingByKey.size > 0.55;

    setTracked((prev) => {
      const prevByKey = new Map(prev.map((p) => [p._key, p] as const));
      const next: TrackedOverlay[] = [];

      incomingByKey.forEach((o, key) => {
        const wasKnown = knownRef.current.has(key);
        const knownDetailFp = knownRef.current.get(key)?.detailFp;
        const detailChanged = wasKnown && knownDetailFp !== detailFingerprint(o);
        const important = isImportant(o);
        const existingTracked = prevByKey.get(key);

        // Decide whether to surface this box right now
        let shouldSurface = false;
        let displayMs = KNOWN_OBJECT_DISPLAY_MS;

        if (!wasKnown) {
          shouldSurface = true;
          displayMs = NEW_OBJECT_DISPLAY_MS;
        } else if (important) {
          shouldSurface = true;
          displayMs = IMPORTANT_DISPLAY_MS;
        } else if (detailChanged) {
          shouldSurface = true;
          displayMs = NEW_OBJECT_DISPLAY_MS;
        } else if (contextShift) {
          shouldSurface = true;
          displayMs = NEW_OBJECT_DISPLAY_MS;
        } else if (existingTracked && existingTracked._hideAt > now) {
          // It's still within its display window from an earlier surfacing — keep showing
          shouldSurface = true;
          displayMs = Math.max(0, existingTracked._hideAt - now);
        }

        if (shouldSurface) {
          const firstSeenAt = existingTracked?._firstSeenAt ?? now;
          next.push({
            ...o,
            _key: key,
            _firstSeenAt: firstSeenAt,
            _lastSeenAt: now,
            _hideAt: now + displayMs,
          });
        }
      });

      // Carry forward any still-visible overlays that are no longer in the latest frame
      prev.forEach((p) => {
        if (incomingByKey.has(p._key)) return;
        if (p._hideAt > now) next.push(p);
      });

      return limitVisible(next);
    });

    // Update the "known" memory AFTER reconciling
    incomingByKey.forEach((o, key) => {
      knownRef.current.set(key, { detailFp: detailFingerprint(o) });
    });
  }, [overlays]);

  // Tick: drop overlays whose hideAt has passed
  useEffect(() => {
    const id = setInterval(() => {
      const now = Date.now();
      setTracked((prev) => {
        const filtered = limitVisible(prev.filter((p) => p._hideAt > now));
        return filtered.length === prev.length ? prev : filtered;
      });
    }, 500);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="absolute inset-0 z-20 pointer-events-none">
      <AnimatePresence>
        {tracked.map((overlay, idx) => (
          <TargetBox key={overlay._key} overlay={overlay} index={idx} />
        ))}
      </AnimatePresence>
    </div>
  );
}

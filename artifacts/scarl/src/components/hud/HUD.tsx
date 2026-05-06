import React, { useState, useRef, useCallback, useEffect } from 'react';
import { CameraStage } from './CameraStage';
import { StatusStrip } from './StatusStrip';
import { OverlayLayer } from './OverlayLayer';
import { VoiceStrip } from './VoiceStrip';
import { InsightPanel } from './InsightPanel';
import { FallbackUploader } from './FallbackUploader';
import { SecondaryControls } from './SecondaryControls';
import { useAnalyzeScene } from '@workspace/api-client-react';
import type { Overlay } from '@workspace/api-client-react';

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const AUTO_INTERVAL_MS = 4000;
const WAKE_WORD = 'hey friday';

export function HUD() {
  const [latestFrame, setLatestFrame] = useState<string | null>(null);
  const [fallbackImage, setFallbackImage] = useState<string | null>(null);
  const [showUploader, setShowUploader] = useState(false);

  const [isFrontCamera, setIsFrontCamera] = useState(false);
  // API overlays (from server analysis — rich context)
  const [apiOverlays, setApiOverlays] = useState<Overlay[]>([]);
  // Local detections (from COCO-SSD — instant, continuous)
  const [localOverlays, setLocalOverlays] = useState<Overlay[]>([]);
  // Scene analysis text that appears as overlay instead of being spoken
  const [sceneText, setSceneText] = useState<string>('');
  const [sceneSummary, setSceneSummary] = useState<string>('');

  const [voiceState, setVoiceState] = useState<'idle' | 'listening' | 'analyzing' | 'speaking'>('idle');
  const [isVoiceMuted, setIsVoiceMuted] = useState(false);
  const [autoMode, setAutoMode] = useState(true);

  const [isPortrait, setIsPortrait] = useState(false);

  const analyzeScene = useAnalyzeScene();
  const recognitionRef = useRef<any>(null);
  const latestFrameRef = useRef<string | null>(null);
  const lastAnalyzeAtRef = useRef<number>(0);
  // Track whether the user used the wake word
  const pendingWakeWordPromptRef = useRef<string | null>(null);

  useEffect(() => {
    latestFrameRef.current = latestFrame;
  }, [latestFrame]);

  useEffect(() => {
    const update = () => {
      const portrait = window.matchMedia('(orientation: portrait)').matches;
      setIsPortrait(portrait);
      const so: any = (window.screen as any)?.orientation;
      if (so?.lock && !portrait) {
        try { so.lock('landscape').catch(() => {}); } catch (_) {}
      }
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
    };
  }, []);

  // Speech recognition — only listens for "hey friday" wake word
  useEffect(() => {
    if (!SpeechRecognition || isVoiceMuted) {
      if (recognitionRef.current) {
        try { recognitionRef.current.stop(); } catch (_) {}
        recognitionRef.current = null;
      }
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = 'en-US';

    recognition.onstart = () => {
      setVoiceState((prev) =>
        prev === 'analyzing' || prev === 'speaking' ? prev : 'listening'
      );
    };

    recognition.onresult = (event: any) => {
      const transcript = event.results[event.results.length - 1][0].transcript;
      if (transcript && transcript.trim().length > 0) {
        const text = transcript.trim().toLowerCase();
        // Only trigger voice response when wake word is detected
        if (text.startsWith(WAKE_WORD) || text.startsWith('hey friday') || text.startsWith('hey, friday')) {
          // Extract the message after the wake word
          const message = text
            .replace(/^hey,?\s*friday\s*/i, '')
            .trim();
          if (message.length > 0) {
            pendingWakeWordPromptRef.current = message;
            triggerAnalyze(message, true);
          }
        }
        // All other speech is ignored — no audio response
      }
    };

    recognition.onend = () => {
      if (!isVoiceMuted && recognitionRef.current) {
        try { recognition.start(); } catch (_) {}
      }
    };

    recognitionRef.current = recognition;
    try { recognition.start(); } catch (_) {}

    return () => {
      try { recognition.stop(); } catch (_) {}
      recognitionRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isVoiceMuted]);

  const handleFrameCapture = useCallback((base64: string) => {
    setLatestFrame(base64);
  }, []);

  const handleLocalDetections = useCallback((detections: Overlay[]) => {
    setLocalOverlays(detections);
  }, []);

  const triggerAnalyze = (prompt?: string, speakResponse = false) => {
    const frame = latestFrameRef.current;
    if (!frame) {
      if (!fallbackImage) setShowUploader(true);
      return;
    }
    if (analyzeScene.isPending) return;

    lastAnalyzeAtRef.current = Date.now();
    setVoiceState('analyzing');

    analyzeScene.mutate(
      {
        data: {
          imageBase64: frame,
          mimeType: 'image/jpeg',
          mode: autoMode ? 'monitor' : 'scan',
          prompt: prompt || undefined,
        },
      },
      {
        onSuccess: (data) => {
          setApiOverlays(data.overlays || []);

          // Always show analysis as text overlay
          const reply = (data.spokenReply || '').trim();
          const summary = (data.sceneSummary || '').trim();

          if (reply) {
            setSceneText(reply);
          }
          if (summary) {
            setSceneSummary(summary);
          }

          // Only speak aloud if wake word was used
          const shouldSpeak = speakResponse && !!reply && !isVoiceMuted;

          if (shouldSpeak && window.speechSynthesis) {
            setVoiceState('speaking');
            try { window.speechSynthesis.cancel(); } catch (_) {}
            const utterance = new SpeechSynthesisUtterance(reply);
            utterance.rate = 1.05;
            utterance.pitch = 0.95;
            const voices = window.speechSynthesis.getVoices();
            const preferred = voices.find(
              (v) =>
                v.name.includes('Google UK English Male') ||
                v.name.includes('Daniel') ||
                v.name.includes('Google') ||
                v.name.includes('Samantha')
            );
            if (preferred) utterance.voice = preferred;
            utterance.onend = () =>
              setVoiceState(isVoiceMuted ? 'idle' : 'listening');
            window.speechSynthesis.speak(utterance);
          } else {
            setVoiceState(isVoiceMuted ? 'idle' : 'listening');
          }

          pendingWakeWordPromptRef.current = null;
        },
        onError: (err) => {
          console.error('[SCARL] API error:', err);
          setSceneText(err instanceof Error ? err.message.slice(0, 60) : 'API request failed');
          setApiOverlays([{
            id: 'error-overlay',
            kind: 'warning',
            label: 'API Error',
            detail: err instanceof Error ? err.message.slice(0, 60) : 'Request failed',
            severity: 'high',
            x: 0.5,
            y: 0.5,
            w: 0.4,
            h: 0.15,
          }]);
          setVoiceState(isVoiceMuted ? 'idle' : 'listening');
        },
      }
    );
  };

  // Auto-analyze at intervals (no voice response — text overlays only)
  useEffect(() => {
    if (!autoMode) return;
    if (analyzeScene.isPending) return;
    if (voiceState === 'speaking') return;
    
    if (Date.now() - lastAnalyzeAtRef.current < AUTO_INTERVAL_MS - 500) return;
    if (!latestFrameRef.current) return;
    
    // Never speak for auto-analysis, only text overlay
    triggerAnalyze(undefined, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latestFrame, autoMode, voiceState, analyzeScene.isPending]);

  const handleToggleAuto = () => setAutoMode((v) => !v);

  // Merge local detections with API overlays.
  // Local detections are shown immediately and continuously.
  // API overlays are enriched (have detail, kind, etc) but slower.
  const mergedOverlays = React.useMemo(() => {
    const apiMap = new Map<string, Overlay>();
    for (const o of apiOverlays) {
      apiMap.set(o.label.toLowerCase(), o);
    }

    const merged: Overlay[] = [];
    const usedApiLabels = new Set<string>();

    // Start with local detections — they have accurate bounding boxes
    for (const local of localOverlays) {
      const labelKey = local.label.toLowerCase();
      const apiMatch = apiMap.get(labelKey);
      if (apiMatch) {
        // Use local bbox + API detail/kind enrichment
        merged.push({
          ...local,
          kind: apiMatch.kind || local.kind,
          detail: apiMatch.detail || local.detail,
          severity: apiMatch.severity || local.severity,
        });
        usedApiLabels.add(labelKey);
      } else {
        merged.push(local);
      }
    }

    // Add any API-only overlays (text, warnings, suggestions, etc.)
    for (const api of apiOverlays) {
      const labelKey = api.label.toLowerCase();
      if (!usedApiLabels.has(labelKey)) {
        merged.push(api);
      }
    }

    return merged;
  }, [localOverlays, apiOverlays]);

  return (
    <div className="relative w-full h-[100dvh] bg-black text-white overflow-hidden font-sans selection:bg-transparent">
      <CameraStage
        onFrameCapture={handleFrameCapture}
        onLocalDetections={handleLocalDetections}
        isFrontCamera={isFrontCamera}
        fallbackImage={fallbackImage}
      />

      {showUploader && !fallbackImage && (
        <FallbackUploader
          onImageSelected={(base64) => {
            setFallbackImage(`data:image/jpeg;base64,${base64}`);
            setLatestFrame(base64);
            setShowUploader(false);
          }}
        />
      )}

      {/* Top-left: minimal status */}
      <StatusStrip autoMode={autoMode} />

      {/* Top-right: contextual insights only when relevant */}
      <InsightPanel overlays={mergedOverlays} />

      {/* Bounding boxes & labels — uses merged local+API overlays */}
      <OverlayLayer overlays={mergedOverlays} autoMode={autoMode} />

      {/* Scene analysis text overlay — shown instead of spoken */}
      {(sceneText || sceneSummary) && (
        <div className="absolute bottom-14 left-1/2 -translate-x-1/2 z-30 pointer-events-none max-w-[80vw]">
          <div
            className="px-3 py-2 rounded-sm"
            style={{
              background: 'rgba(0,0,0,0.65)',
              backdropFilter: 'blur(4px)',
              border: '1px solid rgba(92, 246, 255, 0.25)',
              boxShadow: '0 0 12px rgba(92, 246, 255, 0.08)',
            }}
          >
            {sceneSummary && (
              <div
                className="text-[9px] text-white/50 tracking-widest mb-0.5"
                style={{ fontVariantCaps: 'all-small-caps', letterSpacing: '0.12em' }}
              >
                {sceneSummary}
              </div>
            )}
            {sceneText && (
              <div
                className="text-[11px] text-[rgba(180,240,255,0.92)] leading-tight"
                style={{
                  textShadow: '0 1px 2px rgba(0,0,0,0.9)',
                  letterSpacing: '0.04em',
                }}
              >
                {sceneText}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Bottom-right: tiny controls */}
      <SecondaryControls
        isVoiceMuted={isVoiceMuted}
        onToggleMute={() => setIsVoiceMuted((v) => !v)}
        onSwitchCamera={() => setIsFrontCamera((v) => !v)}
        onUploadFallback={() => setShowUploader(true)}
        autoMode={autoMode}
        onToggleAuto={handleToggleAuto}
      />

      {/* Bottom-center: voice state only when active */}
      <div className="absolute left-1/2 -translate-x-1/2 bottom-[env(safe-area-inset-bottom,8px)] mb-3 z-20 pointer-events-none">
        <VoiceStrip state={voiceState} />
      </div>

      {/* Portrait warning */}
      {isPortrait && (
        <div className="absolute inset-0 z-50 bg-black/95 flex flex-col items-center justify-center text-center p-8">
          <div className="text-white/85 text-xs tracking-widest mb-4">ROTATE TO LANDSCAPE</div>
          <div className="w-12 h-20 border border-white/60 rounded-md mb-2 relative">
            <div className="absolute -right-6 top-1/2 -translate-y-1/2 text-white/70 text-xl">→</div>
          </div>
          <div className="text-white/45 text-[10px] tracking-widest max-w-xs">
            Scarl is designed for a horizontal field of view.
          </div>
        </div>
      )}
    </div>
  );
}

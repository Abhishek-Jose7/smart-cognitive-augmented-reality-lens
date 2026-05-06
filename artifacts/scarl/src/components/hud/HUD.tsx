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
const AUTO_INTERVAL_MS = 5000;
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

  // API health tracking
  const [apiHealth, setApiHealth] = useState<'unknown' | 'ok' | 'error' | 'pending'>('unknown');
  const apiSuccessCountRef = useRef(0);
  const apiFailCountRef = useRef(0);
  const lastApiTimeRef = useRef<number | null>(null);

  const [voiceState, setVoiceState] = useState<'idle' | 'listening' | 'analyzing' | 'speaking'>('idle');
  const [isVoiceMuted, setIsVoiceMuted] = useState(false);
  const [autoMode, setAutoMode] = useState(true);

  const [isPortrait, setIsPortrait] = useState(false);

  const analyzeScene = useAnalyzeScene();
  const recognitionRef = useRef<any>(null);
  const latestFrameRef = useRef<string | null>(null);
  const lastAnalyzeAtRef = useRef<number>(0);
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
        if (text.startsWith(WAKE_WORD) || text.startsWith('hey friday') || text.startsWith('hey, friday')) {
          const message = text
            .replace(/^hey,?\s*friday\s*/i, '')
            .trim();
          if (message.length > 0) {
            pendingWakeWordPromptRef.current = message;
            triggerAnalyze(message, true);
          }
        }
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
    setApiHealth('pending');

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
          const elapsed = Date.now() - lastAnalyzeAtRef.current;
          lastApiTimeRef.current = elapsed;
          apiSuccessCountRef.current += 1;
          setApiHealth('ok');

          setApiOverlays(data.overlays || []);

          // Show analysis as text overlay — filter out error messages
          const reply = (data.spokenReply || '').trim();
          const summary = (data.sceneSummary || '').trim();

          // Don't show error/fallback text as analysis
          const isErrorText = (t: string) =>
            t.toLowerCase().includes('timed out') ||
            t.toLowerCase().includes('vision offline') ||
            t.toLowerCase().includes('could not be identified') ||
            t.toLowerCase().includes('api key') ||
            t.toLowerCase().includes('vision error') ||
            t.length === 0;

          if (reply && !isErrorText(reply)) {
            setSceneText(reply);
          }
          if (summary && !isErrorText(summary)) {
            setSceneSummary(summary);
          }

          // Only speak aloud if wake word was used
          const shouldSpeak = speakResponse && !!reply && !isVoiceMuted && !isErrorText(reply);

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
          apiFailCountRef.current += 1;
          setApiHealth('error');
          // Don't spam the overlay with error messages — just log it
          // The local COCO-SSD detections will continue showing bounding boxes
          setVoiceState(isVoiceMuted ? 'idle' : 'listening');
        },
      }
    );
  };

  // Auto-analyze at intervals
  useEffect(() => {
    if (!autoMode) return;
    if (analyzeScene.isPending) return;
    if (voiceState === 'speaking') return;
    
    if (Date.now() - lastAnalyzeAtRef.current < AUTO_INTERVAL_MS - 500) return;
    if (!latestFrameRef.current) return;
    
    triggerAnalyze(undefined, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latestFrame, autoMode, voiceState, analyzeScene.isPending]);

  const handleToggleAuto = () => setAutoMode((v) => !v);

  // Merge local detections with API overlays
  const mergedOverlays = React.useMemo(() => {
    const apiMap = new Map<string, Overlay>();
    for (const o of apiOverlays) {
      apiMap.set(o.label.toLowerCase(), o);
    }

    const merged: Overlay[] = [];
    const usedApiLabels = new Set<string>();

    for (const local of localOverlays) {
      const labelKey = local.label.toLowerCase();
      const apiMatch = apiMap.get(labelKey);
      if (apiMatch) {
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

    // Add API-only overlays (text, warnings, etc) — skip error fallbacks
    for (const api of apiOverlays) {
      const labelKey = api.label.toLowerCase();
      if (!usedApiLabels.has(labelKey) && !labelKey.includes('error') && !labelKey.includes('vision offline') && labelKey !== 'scene') {
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

      {/* Top-left: status + API health */}
      <StatusStrip autoMode={autoMode} apiHealth={apiHealth} apiResponseTime={lastApiTimeRef.current} />

      {/* Top-right: contextual insights */}
      <InsightPanel overlays={mergedOverlays} />

      {/* Bounding boxes & labels */}
      <OverlayLayer overlays={mergedOverlays} autoMode={autoMode} />

      {/* Scene analysis text overlay — only show valid analysis, not errors */}
      {sceneText && (
        <div className="absolute bottom-14 left-1/2 -translate-x-1/2 z-30 pointer-events-none max-w-[75vw]">
          <div
            className="px-3 py-1.5"
            style={{
              background: 'rgba(0,0,0,0.55)',
              backdropFilter: 'blur(4px)',
              borderLeft: '2px solid rgba(92, 246, 255, 0.4)',
            }}
          >
            {sceneSummary && (
              <div
                className="text-[8px] text-white/40 tracking-widest mb-0.5"
                style={{ fontVariantCaps: 'all-small-caps', letterSpacing: '0.12em' }}
              >
                {sceneSummary}
              </div>
            )}
            <div
              className="text-[10px] text-[rgba(180,240,255,0.88)] leading-tight"
              style={{
                textShadow: '0 1px 2px rgba(0,0,0,0.9)',
                letterSpacing: '0.03em',
              }}
            >
              {sceneText}
            </div>
          </div>
        </div>
      )}

      {/* Bottom-right: controls */}
      <SecondaryControls
        isVoiceMuted={isVoiceMuted}
        onToggleMute={() => setIsVoiceMuted((v) => !v)}
        onSwitchCamera={() => setIsFrontCamera((v) => !v)}
        onUploadFallback={() => setShowUploader(true)}
        autoMode={autoMode}
        onToggleAuto={handleToggleAuto}
      />

      {/* Bottom-center: voice state */}
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

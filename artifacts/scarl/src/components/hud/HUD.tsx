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
const AUTO_INTERVAL_MS = 6000;

export function HUD() {
  const [latestFrame, setLatestFrame] = useState<string | null>(null);
  const [fallbackImage, setFallbackImage] = useState<string | null>(null);
  const [showUploader, setShowUploader] = useState(false);

  const [isFrontCamera, setIsFrontCamera] = useState(false);
  const [overlays, setOverlays] = useState<Overlay[]>([]);

  const [voiceState, setVoiceState] = useState<'idle' | 'listening' | 'analyzing' | 'speaking'>('idle');
  const [isVoiceMuted, setIsVoiceMuted] = useState(false);
  const [autoMode, setAutoMode] = useState(true);

  const [isPortrait, setIsPortrait] = useState(false);

  const analyzeScene = useAnalyzeScene();
  const recognitionRef = useRef<any>(null);
  const latestFrameRef = useRef<string | null>(null);
  const lastAnalyzeAtRef = useRef<number>(0);

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
        triggerAnalyze(transcript);
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

  const triggerAnalyze = (prompt?: string) => {
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
          setOverlays(data.overlays || []);

          // Server now returns "" when nothing useful to say. Trust it: speak whenever the
          // model gave us a non-empty spokenReply (it has already filtered for hazards,
          // text/Q&A, reminders, or direct user prompts).
          const reply = (data.spokenReply || '').trim();
          const shouldSpeak = !!reply && !isVoiceMuted;

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
        },
        onError: (err) => {
          console.error('[SCARL] API error:', err);
          setOverlays([{
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

  // Event-based monitoring trigger
  useEffect(() => {
    if (!autoMode) return;
    if (analyzeScene.isPending) return;
    if (voiceState === 'speaking') return;
    
    // Throttle repeated calls (e.g. max 1 request every AUTO_INTERVAL_MS - 500)
    // Wait, since we want to be responsive to motion, we could reduce the timeout
    // but the instruction says "throttle requests, queue, debounce repeated calls".
    if (Date.now() - lastAnalyzeAtRef.current < AUTO_INTERVAL_MS - 500) return;
    if (!latestFrameRef.current) return;
    
    triggerAnalyze();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latestFrame, autoMode, voiceState, analyzeScene.isPending]);

  const handleToggleAuto = () => setAutoMode((v) => !v);

  return (
    <div className="relative w-full h-[100dvh] bg-black text-white overflow-hidden font-sans selection:bg-transparent">
      <CameraStage
        onFrameCapture={handleFrameCapture}
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
      <InsightPanel overlays={overlays} />

      {/* Bounding boxes & labels */}
      <OverlayLayer overlays={overlays} autoMode={autoMode} />

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

import React, { useRef, useEffect } from 'react';
import type { Overlay } from '@workspace/api-client-react';
import { ObjectDetector, FilesetResolver } from '@mediapipe/tasks-vision';

interface CameraStageProps {
  onFrameCapture: (base64: string) => void;
  onLocalDetections: (overlays: Overlay[]) => void;
  isFrontCamera: boolean;
  fallbackImage: string | null;
}

// Faster detection — 200ms for near-realtime bounding
const LOCAL_DETECTION_INTERVAL_MS = 200;
const LOCAL_DETECTION_SCORE = 0.45;
const LOCAL_DETECTION_MAX = 10;

function labelFor(className: string) {
  return className
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function mapVideoBoxToViewport(
  video: HTMLVideoElement,
  bbox: { originX: number, originY: number, width: number, height: number },
  className: string,
  score: number
): Overlay | null {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const cw = video.clientWidth;
  const ch = video.clientHeight;

  if (!vw || !vh || !cw || !ch) return null;

  const scale = Math.max(cw / vw, ch / vh);
  const renderedW = vw * scale;
  const renderedH = vh * scale;
  const offsetX = (cw - renderedW) / 2;
  const offsetY = (ch - renderedH) / 2;

  const left = (bbox.originX * scale + offsetX) / cw;
  const top = (bbox.originY * scale + offsetY) / ch;
  const width = (bbox.width * scale) / cw;
  const height = (bbox.height * scale) / ch;

  const x = left + width / 2;
  const y = top + height / 2;

  if (x < -0.1 || x > 1.1 || y < -0.1 || y > 1.1) return null;

  return {
    id: `local-${className}-${Math.random()}`,
    kind: className.toLowerCase() === 'person' ? 'person' : 'object',
    label: labelFor(className),
    detail: `${Math.round(score * 100)}%`,
    severity: 'low',
    x: Math.min(Math.max(x, 0), 1),
    y: Math.min(Math.max(y, 0), 1),
    w: Math.min(Math.max(width, 0.03), 0.9),
    h: Math.min(Math.max(height, 0.03), 0.9),
  };
}

export function CameraStage({ onFrameCapture, onLocalDetections, isFrontCamera, fallbackImage }: CameraStageProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const detectorRef = useRef<ObjectDetector | null>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    if (fallbackImage) {
      onLocalDetections([]);
      return;
    }

    async function startCamera() {
      try {
        const constraints: MediaStreamConstraints = {
          video: {
            facingMode: isFrontCamera ? 'user' : 'environment',
            width: { ideal: 1920 }, // High res for OCR
            height: { ideal: 1080 },
            ...(navigator.mediaDevices && {
              advanced: [
                { zoom: 1.0 } as any, 
              ],
            }),
          },
        };
        stream = await navigator.mediaDevices.getUserMedia(constraints);

        const videoTrack = stream.getVideoTracks()[0];
        if (videoTrack) {
          try {
            const capabilities = videoTrack.getCapabilities?.() as any;
            if (capabilities?.zoom?.min) {
              await videoTrack.applyConstraints({
                advanced: [{ zoom: capabilities.zoom.min } as any],
              } as any);
            }
          } catch (_) {}
        }

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      } catch (err) {
        console.error('Camera access failed', err);
      }
    }

    startCamera();
    return () => {
      if (stream) stream.getTracks().forEach((track) => track.stop());
    };
  }, [isFrontCamera, fallbackImage, onLocalDetections]);

  // Local MediaPipe detector
  useEffect(() => {
    let cancelled = false;
    let running = false;
    let rafId: number | undefined;
    let lastDetectTime = 0;

    async function loadDetector() {
      try {
        const vision = await FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
        );
        const detector = await ObjectDetector.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: "https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/int8/1/efficientdet_lite0.tflite",
            delegate: "GPU"
          },
          scoreThreshold: LOCAL_DETECTION_SCORE,
          runningMode: "VIDEO"
        });
        
        if (cancelled) return;
        detectorRef.current = detector;
        console.log('[SCARL] MediaPipe EfficientDet Loaded on GPU');
        scheduleDetection();
      } catch (err) {
        console.error('[SCARL] Local detector failed to load', err);
      }
    }

    function scheduleDetection() {
      if (cancelled) return;
      rafId = requestAnimationFrame(detectLoop);
    }

    async function detectLoop(timestamp: number) {
      if (cancelled) return;

      if (timestamp - lastDetectTime >= LOCAL_DETECTION_INTERVAL_MS && !running) {
        lastDetectTime = timestamp;
        await detect();
      }

      scheduleDetection();
    }

    async function detect() {
      const video = videoRef.current;
      const detector = detectorRef.current;
      if (!video || !detector || fallbackImage || running) return;
      if (video.readyState < video.HAVE_ENOUGH_DATA) return;

      running = true;
      try {
        const detections = detector.detectForVideo(video, performance.now());
        const overlays = detections.detections
          .filter(d => d.categories && d.categories.length > 0 && d.categories[0].score >= LOCAL_DETECTION_SCORE)
          .sort((a, b) => b.categories[0].score - a.categories[0].score)
          .slice(0, LOCAL_DETECTION_MAX)
          .map(d => {
            const cat = d.categories[0];
            const bbox = d.boundingBox;
            if (!bbox) return null;
            return mapVideoBoxToViewport(video, bbox, cat.categoryName, cat.score);
          })
          .filter(Boolean) as Overlay[];

        onLocalDetections(overlays);
      } catch (err) {
        console.warn('[SCARL] Local detection failed', err);
      } finally {
        running = false;
      }
    }

    loadDetector();

    return () => {
      cancelled = true;
      if (rafId) cancelAnimationFrame(rafId);
      if (detectorRef.current) {
        detectorRef.current.close();
      }
    };
  }, [fallbackImage, onLocalDetections]);

  // Frame capture for API analysis
  const motionCanvasRef = useRef<HTMLCanvasElement>(null);
  const prevImageDataRef = useRef<Uint8ClampedArray | null>(null);
  const frameCapturedRef = useRef(false);

  useEffect(() => {
    const MOTION_W = 64;
    const MOTION_H = 64;
    const MSE_THRESHOLD = 300; 

    const captureInterval = setInterval(() => {
      if (!videoRef.current || !canvasRef.current || fallbackImage) return;
      const video = videoRef.current;
      const canvas = canvasRef.current;
      const motionCanvas = motionCanvasRef.current;
      
      if (video.readyState === video.HAVE_ENOUGH_DATA) {
        let hasMotion = false;

        if (motionCanvas) {
          motionCanvas.width = MOTION_W;
          motionCanvas.height = MOTION_H;
          const mCtx = motionCanvas.getContext('2d', { willReadFrequently: true });
          if (mCtx) {
            mCtx.drawImage(video, 0, 0, MOTION_W, MOTION_H);
            const currentData = mCtx.getImageData(0, 0, MOTION_W, MOTION_H).data;
            const prevData = prevImageDataRef.current;
            
            if (prevData) {
              let diff = 0;
              for (let i = 0; i < currentData.length; i += 4) {
                const diffR = currentData[i] - prevData[i];
                diff += (diffR * diffR);
              }
              const mse = diff / (MOTION_W * MOTION_H);
              if (mse > MSE_THRESHOLD) {
                hasMotion = true;
              }
            } else {
              hasMotion = true; 
            }
            
            prevImageDataRef.current = new Uint8ClampedArray(currentData);
          }
        }

        if (hasMotion || !frameCapturedRef.current) {
          frameCapturedRef.current = true;
          // High resolution for OCR.space
          const MAX_W = 1280; 
          const ratio = video.videoWidth > MAX_W ? MAX_W / video.videoWidth : 1;
          canvas.width = Math.round(video.videoWidth * ratio);
          canvas.height = Math.round(video.videoHeight * ratio);
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            
            let quality = 0.8;
            let dataUrl = canvas.toDataURL('image/jpeg', quality);
            // Limit to ~900KB base64 string to fit OCR.space free tier limit (1MB)
            while (dataUrl.length > 1200000 && quality > 0.1) {
              quality -= 0.1;
              dataUrl = canvas.toDataURL('image/jpeg', quality);
            }
            
            const base64 = dataUrl.split(',')[1];
            onFrameCapture(base64);
          }
        }
      }
    }, 600);
    return () => clearInterval(captureInterval);
  }, [onFrameCapture, fallbackImage]);

  return (
    <div className="absolute inset-0 z-0 bg-black overflow-hidden flex items-center justify-center">
      {fallbackImage ? (
        <img src={fallbackImage} className="w-full h-full object-cover" alt="Fallback" />
      ) : (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="w-full h-full object-cover"
        />
      )}
      <canvas ref={canvasRef} className="hidden" />
      <canvas ref={motionCanvasRef} className="hidden" />
    </div>
  );
}

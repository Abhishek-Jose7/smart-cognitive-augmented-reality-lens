import React, { useRef, useEffect } from 'react';
import type { Overlay } from '@workspace/api-client-react';

interface CameraStageProps {
  onFrameCapture: (base64: string) => void;
  onLocalDetections: (overlays: Overlay[]) => void;
  isFrontCamera: boolean;
  fallbackImage: string | null;
}

type CocoModel = {
  detect: (input: HTMLVideoElement) => Promise<Array<{
    bbox: [number, number, number, number];
    class: string;
    score: number;
  }>>;
};

// Faster detection — 200ms for near-realtime bounding
const LOCAL_DETECTION_INTERVAL_MS = 200;
const LOCAL_DETECTION_SCORE = 0.25;
const LOCAL_DETECTION_MAX = 10;

const LABEL_MAP: Record<string, string> = {
  tv: 'TV',
  laptop: 'Laptop',
  'cell phone': 'Phone',
  'potted plant': 'Plant',
  'dining table': 'Table',
  couch: 'Sofa',
  chair: 'Chair',
  person: 'Person',
  keyboard: 'Keyboard',
  mouse: 'Mouse',
  book: 'Book',
  cup: 'Cup',
  bottle: 'Bottle',
  clock: 'Clock',
  vase: 'Vase',
  scissors: 'Scissors',
  remote: 'Remote',
  microwave: 'Microwave',
  oven: 'Oven',
  toaster: 'Toaster',
  refrigerator: 'Fridge',
  sink: 'Sink',
  car: 'Car',
  bicycle: 'Bicycle',
  dog: 'Dog',
  cat: 'Cat',
  backpack: 'Backpack',
  handbag: 'Handbag',
  umbrella: 'Umbrella',
  tie: 'Tie',
  suitcase: 'Suitcase',
  bowl: 'Bowl',
  banana: 'Banana',
  apple: 'Apple',
  sandwich: 'Sandwich',
  pizza: 'Pizza',
  donut: 'Donut',
  cake: 'Cake',
  bed: 'Bed',
  toilet: 'Toilet',
  surfboard: 'Surfboard',
  'sports ball': 'Ball',
  'wine glass': 'Glass',
  fork: 'Fork',
  knife: 'Knife',
  spoon: 'Spoon',
  skateboard: 'Skateboard',
  truck: 'Truck',
  bus: 'Bus',
  motorcycle: 'Motorcycle',
  airplane: 'Airplane',
  train: 'Train',
  boat: 'Boat',
  bird: 'Bird',
  horse: 'Horse',
  sheep: 'Sheep',
  cow: 'Cow',
  bear: 'Bear',
};

function labelFor(className: string) {
  return LABEL_MAP[className] ?? className
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function mapVideoBoxToViewport(
  video: HTMLVideoElement,
  bbox: [number, number, number, number],
) {
  const [bx, by, bw, bh] = bbox;
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

  const left = (bx * scale + offsetX) / cw;
  const top = (by * scale + offsetY) / ch;
  const width = (bw * scale) / cw;
  const height = (bh * scale) / ch;

  const x = left + width / 2;
  const y = top + height / 2;

  if (x < -0.1 || x > 1.1 || y < -0.1 || y > 1.1) return null;

  return {
    x: Math.min(Math.max(x, 0), 1),
    y: Math.min(Math.max(y, 0), 1),
    w: Math.min(Math.max(width, 0.03), 0.9),
    h: Math.min(Math.max(height, 0.03), 0.9),
  };
}

export function CameraStage({ onFrameCapture, onLocalDetections, isFrontCamera, fallbackImage }: CameraStageProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const detectorRef = useRef<CocoModel | null>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    if (fallbackImage) {
      onLocalDetections([]);
      return;
    }

    async function startCamera() {
      try {
        // Request wide-angle camera with lower resolution for speed
        // Lower resolution = faster COCO-SSD inference + wider FOV on many devices
        const constraints: MediaStreamConstraints = {
          video: {
            facingMode: isFrontCamera ? 'user' : 'environment',
            width: { ideal: 1280 },
            height: { ideal: 720 },
            // Request widest possible field of view
            ...(navigator.mediaDevices && {
              advanced: [
                { zoom: 1.0 } as any, // Minimum zoom = widest FOV
              ],
            }),
          },
        };
        stream = await navigator.mediaDevices.getUserMedia(constraints);

        // Try to set minimum zoom on the track for widest view
        const videoTrack = stream.getVideoTracks()[0];
        if (videoTrack) {
          try {
            const capabilities = videoTrack.getCapabilities?.() as any;
            if (capabilities?.zoom?.min) {
              await videoTrack.applyConstraints({
                advanced: [{ zoom: capabilities.zoom.min } as any],
              } as any);
            }
          } catch (_) {
            // Zoom control not supported — that's fine
          }
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

  // Local COCO-SSD detector — runs continuously for real-time bounding boxes
  useEffect(() => {
    let cancelled = false;
    let running = false;
    let rafId: number | undefined;
    let lastDetectTime = 0;

    async function loadDetector() {
      try {
        const tf = await import('@tensorflow/tfjs');
        
        // Try WebGPU acceleration first for massive speedup
        try {
          await import('@tensorflow/tfjs-backend-webgpu');
          await tf.setBackend('webgpu');
          await tf.ready();
          console.log('[SCARL] Using WebGPU backend for instant detection');
        } catch (e) {
          console.warn('[SCARL] WebGPU not supported on this device, falling back to default backend', e);
          // Default to WebGL or CPU
          await tf.ready();
        }

        const coco = await import('@tensorflow-models/coco-ssd');
        if (cancelled) return;
        // lite_mobilenet_v2 is the fastest model variant
        detectorRef.current = await coco.load({ base: 'lite_mobilenet_v2' }) as CocoModel;
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
        const predictions = await detector.detect(video);
        const overlays = predictions
          .filter((p) => p.score >= LOCAL_DETECTION_SCORE)
          .sort((a, b) => b.score - a.score)
          .slice(0, LOCAL_DETECTION_MAX)
          .map((p, index): Overlay | null => {
            const box = mapVideoBoxToViewport(video, p.bbox);
            if (!box) return null;
            const label = labelFor(p.class);
            return {
              id: `local-${p.class}-${index}`,
              kind: p.class === 'person' ? 'person' : 'object',
              label,
              detail: `${Math.round(p.score * 100)}%`,
              severity: 'low',
              ...box,
            };
          })
          .filter((o): o is Overlay => Boolean(o));

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
    };
  }, [fallbackImage, onLocalDetections]);

  // Frame capture for API analysis
  const motionCanvasRef = useRef<HTMLCanvasElement>(null);
  const prevImageDataRef = useRef<Uint8ClampedArray | null>(null);
  const frameCapturedRef = useRef(false);

  useEffect(() => {
    const MOTION_W = 64;
    const MOTION_H = 64;
    const MSE_THRESHOLD = 300; // Lower threshold = capture more frames

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

        // Always capture at least the first frame, then on motion or every capture cycle
        if (hasMotion || !frameCapturedRef.current) {
          frameCapturedRef.current = true;
          // Smaller image = faster upload + within NIM inline limit
          const MAX_W = 480;
          const ratio = video.videoWidth > MAX_W ? MAX_W / video.videoWidth : 1;
          canvas.width = Math.round(video.videoWidth * ratio);
          canvas.height = Math.round(video.videoHeight * ratio);
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            const dataUrl = canvas.toDataURL('image/jpeg', 0.4);
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

import React, { useRef, useEffect } from 'react';

interface CameraStageProps {
  onFrameCapture: (base64: string) => void;
  isFrontCamera: boolean;
  fallbackImage: string | null;
}

export function CameraStage({ onFrameCapture, isFrontCamera, fallbackImage }: CameraStageProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    if (fallbackImage) return;

    async function startCamera() {
      try {
        const constraints = {
          video: {
            facingMode: isFrontCamera ? 'user' : 'environment',
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
        };
        stream = await navigator.mediaDevices.getUserMedia(constraints);
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
  }, [isFrontCamera, fallbackImage]);

  const motionCanvasRef = useRef<HTMLCanvasElement>(null);
  const prevImageDataRef = useRef<Uint8ClampedArray | null>(null);

  useEffect(() => {
    const MOTION_W = 64;
    const MOTION_H = 64;
    const MSE_THRESHOLD = 800; // Mean squared error threshold for motion

    const captureInterval = setInterval(() => {
      if (!videoRef.current || !canvasRef.current || fallbackImage) return;
      const video = videoRef.current;
      const canvas = canvasRef.current;
      const motionCanvas = motionCanvasRef.current;
      
      if (video.readyState === video.HAVE_ENOUGH_DATA) {
        let hasMotion = false;

        // 1. Motion Detection (Local Filtering)
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
              // Only check one channel (red) for speed, assuming luma is roughly correlated
              for (let i = 0; i < currentData.length; i += 4) {
                const diffR = currentData[i] - prevData[i];
                diff += (diffR * diffR);
              }
              const mse = diff / (MOTION_W * MOTION_H);
              if (mse > MSE_THRESHOLD) {
                hasMotion = true;
              }
            } else {
              // First frame always has "motion" to trigger initial state
              hasMotion = true; 
            }
            
            prevImageDataRef.current = new Uint8ClampedArray(currentData);
          }
        }

        // 2. Only capture and bubble up if motion detected
        if (hasMotion) {
          // Downscale to keep base64 payload comfortably under NIM's inline limit
          // (~180KB). Vision model accuracy holds up well at 720px wide.
          const MAX_W = 720;
          const ratio = video.videoWidth > MAX_W ? MAX_W / video.videoWidth : 1;
          canvas.width = Math.round(video.videoWidth * ratio);
          canvas.height = Math.round(video.videoHeight * ratio);
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            const dataUrl = canvas.toDataURL('image/jpeg', 0.6);
            const base64 = dataUrl.split(',')[1];
            onFrameCapture(base64);
          }
        }
      }
    }, 1000);
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

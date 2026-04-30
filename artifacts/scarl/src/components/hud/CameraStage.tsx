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

  useEffect(() => {
    const captureInterval = setInterval(() => {
      if (!videoRef.current || !canvasRef.current || fallbackImage) return;
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (video.readyState === video.HAVE_ENOUGH_DATA) {
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
    </div>
  );
}

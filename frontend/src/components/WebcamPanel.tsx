import { useEffect, useRef, useState } from "react";
import type { ConnectionStatus } from "../lib/useGestureSocket";

interface WebcamPanelProps {
  connectionStatus: ConnectionStatus;
  onFrame: (base64Jpeg: string) => void;
  /** Milliseconds between captured frames sent to the backend. */
  captureIntervalMs?: number;
}

const CAPTURE_WIDTH = 320;
const CAPTURE_HEIGHT = 240;

export default function WebcamPanel({
  connectionStatus,
  onFrame,
  captureIntervalMs = 120,
}: WebcamPanelProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const intervalRef = useRef<number | null>(null);

  const [cameraOn, setCameraOn] = useState(false);
  const [permissionError, setPermissionError] = useState<string | null>(null);

  const stopCamera = () => {
    if (intervalRef.current !== null) {
      window.clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraOn(false);
  };

  const startCamera = async () => {
    setPermissionError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: CAPTURE_WIDTH, height: CAPTURE_HEIGHT },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraOn(true);
    } catch (err) {
      setPermissionError(
        err instanceof Error
          ? `Camera access denied or unavailable: ${err.message}`
          : "Camera access denied or unavailable."
      );
      setCameraOn(false);
    }
  };

  // Frame capture loop: draws the current video frame to an offscreen
  // canvas, encodes it as base64 JPEG, and hands it off via onFrame.
  useEffect(() => {
    if (!cameraOn) return;

    intervalRef.current = window.setInterval(() => {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || video.readyState < 2) return;

      canvas.width = CAPTURE_WIDTH;
      canvas.height = CAPTURE_HEIGHT;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      ctx.drawImage(video, 0, 0, CAPTURE_WIDTH, CAPTURE_HEIGHT);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.7);
      onFrame(dataUrl);
    }, captureIntervalMs);

    return () => {
      if (intervalRef.current !== null) {
        window.clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [cameraOn, captureIntervalMs, onFrame]);

  useEffect(() => {
    return () => stopCamera();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="webcam-panel">
      <video ref={videoRef} muted playsInline />
      <canvas ref={canvasRef} style={{ display: "none" }} />

      <div>
        <button onClick={cameraOn ? stopCamera : startCamera}>
          {cameraOn ? "Camera Off" : "Camera On"}
        </button>
      </div>

      {permissionError && <p className="error-text">{permissionError}</p>}

      <p className={`status-line ${connectionStatus === "connected" ? "connected" : connectionStatus === "reconnecting" ? "reconnecting" : "disconnected"}`}>
        Gesture backend: {connectionStatus}
      </p>
    </div>
  );
}

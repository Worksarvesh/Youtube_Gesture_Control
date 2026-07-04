/**
 * useGestureSocket.ts
 *
 * Manages the WebSocket connection to the gesture backend:
 *   - connects to /ws/gesture on mount, reconnects with backoff on drop
 *   - exposes `sendFrame(base64Jpeg)` for the webcam panel to call on its
 *     capture interval
 *   - exposes the latest gesture event + a connection status string that
 *     the UI can render (connected / disconnected / reconnecting)
 */

import { useCallback, useEffect, useRef, useState } from "react";

export type ConnectionStatus = "connecting" | "connected" | "disconnected" | "reconnecting";

export interface GestureEvent {
  gesture: string;
  confidence: number;
}

const WS_URL = (import.meta.env.VITE_GESTURE_WS_URL as string) || "ws://localhost:8000/ws/gesture";
const RECONNECT_DELAY_MS = 2000;

export function useGestureSocket() {
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [lastGesture, setLastGesture] = useState<GestureEvent | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);

  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const isUnmountedRef = useRef(false);

  const connect = useCallback(() => {
    if (isUnmountedRef.current) return;

    setStatus((prev) => (prev === "connected" ? prev : "connecting"));
    const socket = new WebSocket(WS_URL);
    socketRef.current = socket;

    socket.onopen = () => {
      setStatus("connected");
      setLastError(null);
    };

    socket.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.error) {
          setLastError(payload.error as string);
          return;
        }
        if (payload.gesture) {
          setLastGesture({
            gesture: payload.gesture as string,
            confidence: payload.confidence as number,
          });
        }
      } catch {
        // Ignore malformed messages rather than crashing the socket handler.
      }
    };

    socket.onclose = () => {
      if (isUnmountedRef.current) return;
      setStatus("reconnecting");
      reconnectTimerRef.current = window.setTimeout(connect, RECONNECT_DELAY_MS);
    };

    socket.onerror = () => {
      // onclose will fire right after this and handle reconnection.
      socket.close();
    };
  }, []);

  useEffect(() => {
    isUnmountedRef.current = false;
    connect();
    return () => {
      isUnmountedRef.current = true;
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current);
      }
      socketRef.current?.close();
    };
  }, [connect]);

  const sendFrame = useCallback((base64Jpeg: string) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({ type: "frame", data: base64Jpeg }));
  }, []);

  return { status, lastGesture, lastError, sendFrame };
}

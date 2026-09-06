"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type ApiState<T> = { url: string; data?: T; error?: string; code?: string; receivedAt?: number; loading: boolean };

/** Cookie-authenticated reads only. Abort superseded requests and never show another filter's data. */
export function usePlayerApi<T>(url: string) {
  const [state, setState] = useState<ApiState<T>>({ url, loading: true });
  const request = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const timeout = setTimeout(() => controller.abort("timeout"), 15000);
    try {
      const response = await fetch(url, { cache: "no-store", credentials: "same-origin", signal: controller.signal });
      const body: { data?: T; error?: { code: string; message: string } } = await response.json();
      if (controller.signal.aborted) return;
      if (response.status === 401) {
        window.location.replace("/login");
        return;
      }
      if (!response.ok || !body.data) {
        setState({ url, loading: false, error: body.error?.message ?? "Could not load this information. Please try again.", code: body.error?.code });
        return;
      }
      setState({ url, data: body.data, receivedAt: performance.now(), loading: false });
    } catch {
      if (!controller.signal.aborted || controller.signal.reason === "timeout") {
        setState({ url, loading: false, error: "Connection interrupted. Check your connection and try again." });
      }
    } finally {
      clearTimeout(timeout);
    }
  }, [url]);

  useEffect(() => {
    const initial = setTimeout(() => void refresh(), 0);
    const visibleRefresh = () => { if (document.visibilityState === "visible") void refresh(); };
    const interval = setInterval(visibleRefresh, 30000);
    window.addEventListener("focus", visibleRefresh);
    document.addEventListener("visibilitychange", visibleRefresh);
    return () => {
      request.current?.abort();
      clearTimeout(initial);
      clearInterval(interval);
      window.removeEventListener("focus", visibleRefresh);
      document.removeEventListener("visibilitychange", visibleRefresh);
    };
  }, [refresh]);

  return { ...(state.url === url ? state : { url, loading: true }), refresh };
}

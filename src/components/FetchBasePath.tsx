"use client";
// Next no antepone el basePath a los fetch("/api/...") manuales; se parchea una sola vez.

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

if (typeof window !== "undefined" && basePath) {
  const w = window as unknown as { __basePathFetch?: boolean };
  if (!w.__basePathFetch) {
    w.__basePathFetch = true;
    const originalFetch = window.fetch.bind(window);
    window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      if (typeof input === "string" && input.startsWith("/api/")) {
        input = basePath + input;
      }
      return originalFetch(input, init);
    };
  }
}

export default function FetchBasePath() {
  return null;
}

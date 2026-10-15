// src/lib/auth-client.ts
import { createAuthClient } from "better-auth/react";

// En el navegador se usa window.location.origin para incluir el puerto actual
// (funciona en dev en :3001 y en prod vía nginx en :80).
// En el servidor (SSR/middleware) se usa NEXT_PUBLIC_APP_URL.
export const authClient = createAuthClient({
  baseURL: typeof window !== "undefined"
    ? `${window.location.origin}${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/auth`
    : `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/auth`,
});

export const {
  signIn,
  signUp,
  signOut,
  useSession,
  getSession,
} = authClient;

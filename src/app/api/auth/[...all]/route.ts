// src/app/api/auth/[...all]/route.ts
import { auth } from "@/lib/auth";
import { toNextJsHandler } from "better-auth/next-js";

const handlers = toNextJsHandler(auth);
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

function normalize(req: Request): Request {
  if (!basePath) return req;
  const url = new URL(req.url);
  if (!url.pathname.startsWith(basePath + "/")) return req;
  url.pathname = url.pathname.slice(basePath.length);
  return new Request(url, req);
}

export const GET = (req: Request) => handlers.GET(normalize(req));
export const POST = (req: Request) => handlers.POST(normalize(req));

// src/middleware.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

const PUBLIC_ROUTES = ["/login", "/register"];
const DEFAULT_REDIRECT = "/dashboard";
const LOGIN_ROUTE = "/login";

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const sessionCookie = getSessionCookie(request);
  const isAuthenticated = !!sessionCookie;
  const isPublicRoute = PUBLIC_ROUTES.some((r) => pathname.startsWith(r));

  // Si está autenticado y va a una ruta pública, redirigir al dashboard
  if (isAuthenticated && isPublicRoute) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = DEFAULT_REDIRECT;
    return NextResponse.redirect(redirectUrl);
  }

  // Si NO está autenticado y va a una ruta protegida, redirigir al login
  if (!isAuthenticated && !isPublicRoute && pathname !== "/") {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = LOGIN_ROUTE;
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp)$).*)"],
};

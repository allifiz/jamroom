import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, sessionCookie } from "../core/identity";
import { ServiceError } from "../core/identity-service";

export const runtime = "nodejs";

export function sessionToken(request: NextRequest) {
  return request.cookies.get(request.nextUrl.protocol === "https:" ? SESSION_COOKIE : "synora-dev")?.value;
}

export function setSession(response: NextResponse, request: NextRequest, token: string) {
  response.cookies.set(sessionCookie(token, request.nextUrl.protocol === "https:"));
}

export function sameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  // Browser state mutations must carry Origin; the host is supplied by the runtime.
  if (!origin || origin !== request.nextUrl.origin || request.headers.get("sec-fetch-site") === "cross-site") {
    throw new ServiceError(403, "Invalid request origin");
  }
}

export async function jsonBody(request: NextRequest) {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    throw new ServiceError(415, "JSON request required");
  }
  if (Number(request.headers.get("content-length") ?? 0) > 8192) throw new ServiceError(413, "Request too large");
  const body = await request.text();
  if (body.length > 8192) throw new ServiceError(413, "Request too large");
  try { return JSON.parse(body) as unknown; }
  catch { throw new ServiceError(400, "Invalid JSON"); }
}

export function apiError(error: unknown) {
  if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status });
  console.error("Synora API error", error);
  return NextResponse.json({ error: "Server error" }, { status: 500 });
}

import { NextRequest, NextResponse } from "next/server";
import { bootstrapIdentity, renameIdentity } from "../../../../synora/core/identity-service";
import { listRoomsForUser } from "../../../../synora/core/room-service";
import { synoraStore } from "../../../../synora/server/database";
import { apiError, jsonBody, sameOrigin, sessionToken, setSession } from "../../../../synora/server/http";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    sameOrigin(request);
    const store=synoraStore();
    const result = await bootstrapIdentity(store, sessionToken(request));
    const rooms=request.nextUrl.searchParams.has("rooms") ? await listRoomsForUser(store,result.profile.id) : undefined;
    const response = NextResponse.json({ profile: result.profile, created: result.created, ...(rooms ? {rooms} : {}) });
    if (result.cookie) setSession(response, request, result.cookie);
    return response;
  } catch (error) { return apiError(error); }
}

export async function PATCH(request: NextRequest) {
  try {
    sameOrigin(request);
    const body = await jsonBody(request);
    const profile = await renameIdentity(synoraStore(), sessionToken(request),
      typeof body === "object" && body !== null && "name" in body ? body.name : null);
    return NextResponse.json({ profile });
  } catch (error) { return apiError(error); }
}

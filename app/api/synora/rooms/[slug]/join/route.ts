import { NextRequest, NextResponse } from "next/server";
import { joinRoom } from "../../../../../../synora/core/room-service";
import { synoraStore } from "../../../../../../synora/server/database";
import { apiError, jsonBody, sameOrigin, sessionToken } from "../../../../../../synora/server/http";

export const runtime = "nodejs";

export async function POST(request: NextRequest, context: { params: Promise<{ slug: string }> }) {
  try {
    sameOrigin(request);
    const { slug } = await context.params;
    const body = await jsonBody(request);
    const invite = typeof body === "object" && body !== null && "inviteKey" in body ? body.inviteKey : null;
    return NextResponse.json({ room: await joinRoom(synoraStore(), sessionToken(request), slug, invite) });
  } catch (error) { return apiError(error); }
}

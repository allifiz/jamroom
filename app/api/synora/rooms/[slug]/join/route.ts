import { NextRequest, NextResponse } from "next/server";
import { joinRoom } from "../../../../../../synora/core/room-service";
import { synoraStore } from "../../../../../../synora/server/database";
import { apiError, jsonBody, sameOrigin, sessionToken } from "../../../../../../synora/server/http";
import { notifyAfterCommit } from "../../../../../../synora/server/realtime";

export const runtime = "nodejs";

export async function POST(request: NextRequest, context: { params: Promise<{ slug: string }> }) {
  try {
    sameOrigin(request);
    const { slug } = await context.params;
    const body = await jsonBody(request);
    const invite = typeof body === "object" && body !== null && "inviteKey" in body ? body.inviteKey : null;
    const store=synoraStore();
    const room=await joinRoom(store,sessionToken(request),slug,invite);
    await notifyAfterCommit(store,room.id);
    return NextResponse.json({ room });
  } catch (error) { return apiError(error); }
}

import { NextRequest, NextResponse, after } from "next/server";
import { joinRoom } from "../../../../../../synora/core/room-service";
import { roomView } from "../../../../../../synora/core/room-social-service";
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
    const token=sessionToken(request);
    const room=await joinRoom(store,token,slug,invite);
    const view=await roomView(store,token,slug);
    after(() => notifyAfterCommit(store,room.id));
    return NextResponse.json({ room, view });
  } catch (error) { return apiError(error); }
}

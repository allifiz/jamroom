import { NextRequest, NextResponse } from "next/server";
import { roomListeners, updateRoomPresence } from "../../../../../../synora/core/room-social-service";
import { synoraStore } from "../../../../../../synora/server/database";
import { apiError, jsonBody, sameOrigin, sessionToken } from "../../../../../../synora/server/http";
import { notifyAfterCommit } from "../../../../../../synora/server/realtime";

export const runtime = "nodejs";

export async function GET(request: NextRequest, context: { params: Promise<{slug:string}> }) {
  try { return NextResponse.json(await roomListeners(synoraStore(),sessionToken(request),(await context.params).slug)); }
  catch(error) { return apiError(error); }
}
export async function POST(request: NextRequest, context: { params: Promise<{slug:string}> }) {
  try {
    sameOrigin(request);
    const body = await jsonBody(request);
    const input = typeof body === "object" && body !== null ? body as Record<string,unknown> : {};
    const store = synoraStore();
    const result = await updateRoomPresence(store,sessionToken(request),(await context.params).slug,input.tabId,input.action === "leave");
    await notifyAfterCommit(store,result.roomId);
    return NextResponse.json({ok:true});
  } catch(error) { return apiError(error); }
}

import { NextRequest, NextResponse } from "next/server";
import { listRoomMessages, sendRoomMessage } from "../../../../../../synora/core/room-social-service";
import { synoraStore } from "../../../../../../synora/server/database";
import { apiError, jsonBody, sameOrigin, sessionToken } from "../../../../../../synora/server/http";
import { notifyAfterCommit } from "../../../../../../synora/server/realtime";

export const runtime = "nodejs";

export async function GET(request: NextRequest, context: { params: Promise<{slug:string}> }) {
  try { return NextResponse.json(await listRoomMessages(synoraStore(),sessionToken(request),(await context.params).slug)); }
  catch(error) { return apiError(error); }
}
export async function POST(request: NextRequest, context: { params: Promise<{slug:string}> }) {
  try {
    sameOrigin(request);
    const payload = await jsonBody(request);
    const body = typeof payload === "object" && payload !== null && "body" in payload ? payload.body : null;
    const store = synoraStore();
    const result = await sendRoomMessage(store,sessionToken(request),(await context.params).slug,body);
    await notifyAfterCommit(store,result.roomId);
    return NextResponse.json({message:result.message},{status:201});
  } catch(error) { return apiError(error); }
}

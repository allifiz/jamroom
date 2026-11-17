import { NextRequest, NextResponse, after } from "next/server";
import { updateRoomSettings } from "../../../../../../synora/core/room-management-service";
import { synoraStore } from "../../../../../../synora/server/database";
import { apiError, jsonBody, sameOrigin, sessionToken } from "../../../../../../synora/server/http";
import { notifyAfterCommit } from "../../../../../../synora/server/realtime";
export const runtime="nodejs";
export async function PATCH(request:NextRequest,context:{params:Promise<{slug:string}>}) {
  try { sameOrigin(request); const store=synoraStore(); const result=await updateRoomSettings(store,sessionToken(request),(await context.params).slug,await jsonBody(request)); after(()=>notifyAfterCommit(store,result.roomId)); return NextResponse.json({ok:true}); }
  catch(error) { return apiError(error); }
}

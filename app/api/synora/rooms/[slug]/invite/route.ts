import { NextRequest, NextResponse } from "next/server";
import { rotateRoomInvite } from "../../../../../../synora/core/room-management-service";
import { synoraStore } from "../../../../../../synora/server/database";
import { apiError, sameOrigin, sessionToken } from "../../../../../../synora/server/http";
export const runtime="nodejs";
export async function POST(request:NextRequest,context:{params:Promise<{slug:string}>}) {
  try { sameOrigin(request); const result=await rotateRoomInvite(synoraStore(),sessionToken(request),(await context.params).slug); return NextResponse.json({inviteKey:result.inviteKey},{headers:{"Cache-Control":"no-store"}}); }
  catch(error) { return apiError(error); }
}

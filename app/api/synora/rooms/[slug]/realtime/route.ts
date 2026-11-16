import { NextRequest, NextResponse } from "next/server";
import { realtimeAccess } from "../../../../../../synora/core/queue-service";
import { synoraStore } from "../../../../../../synora/server/database";
import { apiError, sameOrigin, sessionToken } from "../../../../../../synora/server/http";
import { roomChannel, roomToken } from "../../../../../../synora/server/realtime";

export const runtime="nodejs";

export async function POST(request:NextRequest,context:{params:Promise<{slug:string}>}) {
  try {
    sameOrigin(request);
    const access=await realtimeAccess(synoraStore(),sessionToken(request),(await context.params).slug);
    return NextResponse.json({channel:roomChannel(access.roomId),tokenRequest:await roomToken(access.clientId,access.roomId,access.member)},
      {headers:{"Cache-Control":"no-store"}});
  }catch(error){return apiError(error)}
}

import { NextRequest, NextResponse, after } from "next/server";
import { changeMemberRole, listRoomMembers, moderateRoomMember } from "../../../../../../synora/core/room-management-service";
import { synoraStore } from "../../../../../../synora/server/database";
import { apiError, jsonBody, sameOrigin, sessionToken } from "../../../../../../synora/server/http";
import { notifyAfterCommit } from "../../../../../../synora/server/realtime";
export const runtime="nodejs";
type Context={params:Promise<{slug:string}>};
export async function GET(request:NextRequest,context:Context) {
  try { return NextResponse.json(await listRoomMembers(synoraStore(),sessionToken(request),(await context.params).slug)); }
  catch(error) { return apiError(error); }
}
export async function PATCH(request:NextRequest,context:Context) {
  try { sameOrigin(request); const store=synoraStore(); const result=await changeMemberRole(store,sessionToken(request),(await context.params).slug,await jsonBody(request)); after(()=>notifyAfterCommit(store,result.roomId)); return NextResponse.json({ok:true}); }
  catch(error) { return apiError(error); }
}
export async function POST(request:NextRequest,context:Context) {
  try { sameOrigin(request); const store=synoraStore(); const result=await moderateRoomMember(store,sessionToken(request),(await context.params).slug,await jsonBody(request)); after(()=>notifyAfterCommit(store,result.roomId)); return NextResponse.json({ok:true}); }
  catch(error) { return apiError(error); }
}

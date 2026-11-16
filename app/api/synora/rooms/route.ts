import { NextRequest, NextResponse } from "next/server";
import { createRoom, listRooms } from "../../../../synora/core/room-service";
import { synoraStore } from "../../../../synora/server/database";
import { apiError, jsonBody, sameOrigin, sessionToken } from "../../../../synora/server/http";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try { return NextResponse.json(await listRooms(synoraStore(), sessionToken(request))); }
  catch (error) { return apiError(error); }
}

export async function POST(request: NextRequest) {
  try {
    sameOrigin(request);
    return NextResponse.json(await createRoom(synoraStore(), sessionToken(request), await jsonBody(request)), { status: 201 });
  } catch (error) { return apiError(error); }
}

import { NextRequest, NextResponse } from "next/server";
import { roomView } from "../../../../../../synora/core/room-social-service";
import { synoraStore } from "../../../../../../synora/server/database";
import { apiError, sessionToken } from "../../../../../../synora/server/http";

export const runtime = "nodejs";

export async function GET(request: NextRequest, context: { params: Promise<{slug:string}> }) {
  try { return NextResponse.json(await roomView(synoraStore(),sessionToken(request),(await context.params).slug)); }
  catch(error) { return apiError(error); }
}

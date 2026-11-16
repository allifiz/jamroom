import { NextRequest, NextResponse } from "next/server";
import { recoverRoom } from "../../../../../../synora/core/room-service";
import { synoraStore } from "../../../../../../synora/server/database";
import { apiError, jsonBody, sameOrigin, sessionToken } from "../../../../../../synora/server/http";

export const runtime = "nodejs";

export async function POST(request: NextRequest, context: { params: Promise<{ slug: string }> }) {
  try {
    sameOrigin(request);
    const { slug } = await context.params;
    const body = await jsonBody(request);
    const recoveryKey = typeof body === "object" && body !== null && "recoveryKey" in body ? body.recoveryKey : null;
    return NextResponse.json(await recoverRoom(synoraStore(), sessionToken(request), slug, recoveryKey));
  } catch (error) { return apiError(error); }
}

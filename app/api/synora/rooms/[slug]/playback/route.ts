import { NextRequest, NextResponse } from "next/server";
import { controlPlayback } from "../../../../../../synora/core/playback-service";
import { synoraStore } from "../../../../../../synora/server/database";
import { apiError, jsonBody, sameOrigin, sessionToken } from "../../../../../../synora/server/http";
import { notifyAfterCommit } from "../../../../../../synora/server/realtime";

export const runtime = "nodejs";

export async function POST(request: NextRequest, context: { params: Promise<{ slug: string }> }) {
  try {
    sameOrigin(request);
    const store = synoraStore();
    const result = await controlPlayback(store, sessionToken(request), (await context.params).slug, await jsonBody(request));
    await notifyAfterCommit(store, result.roomId);
    return NextResponse.json({ state:result.state, now:result.now });
  } catch (error) { return apiError(error); }
}

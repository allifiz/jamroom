import { NextRequest, NextResponse } from "next/server";
import { addQueueItem, parseQueueRequest, queueSnapshot, requireQueueAdd } from "../../../../../../synora/core/queue-service";
import { synoraStore } from "../../../../../../synora/server/database";
import { apiError, jsonBody, sameOrigin, sessionToken } from "../../../../../../synora/server/http";
import { resolveMetadata } from "../../../../../../synora/server/metadata";
import { notifyAfterCommit } from "../../../../../../synora/server/realtime";

export const runtime = "nodejs";

export async function GET(request: NextRequest, context: { params: Promise<{ slug: string }> }) {
  try { return NextResponse.json(await queueSnapshot(synoraStore(),sessionToken(request),(await context.params).slug)); }
  catch (error) { return apiError(error); }
}

export async function POST(request: NextRequest, context: { params: Promise<{ slug: string }> }) {
  try {
    sameOrigin(request);
    const parsed = parseQueueRequest(await jsonBody(request));
    const store = synoraStore();
    const slug = (await context.params).slug;
    await requireQueueAdd(store,sessionToken(request),slug);
    const candidate = await resolveMetadata(parsed);
    const item = await addQueueItem(store,sessionToken(request),slug,candidate);
    await notifyAfterCommit(store,item.room_id);
    return NextResponse.json({ item },{ status:201 });
  } catch (error) { return apiError(error); }
}

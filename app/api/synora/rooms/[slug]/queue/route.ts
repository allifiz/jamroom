import { NextRequest, NextResponse, after } from "next/server";
import { addQueueItem, parseQueueRequest, queueSnapshot, removeQueueItem, reorderQueue, requireQueueAdd } from "../../../../../../synora/core/queue-service";
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
    after(() => notifyAfterCommit(store,item.room_id));
    return NextResponse.json({ item },{ status:201 });
  } catch (error) { return apiError(error); }
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ slug: string }> }) {
  try {
    sameOrigin(request);
    const store=synoraStore();
    const result=await reorderQueue(store,sessionToken(request),(await context.params).slug,await jsonBody(request));
    after(() => notifyAfterCommit(store,result.roomId));
    return NextResponse.json({items:result.items});
  } catch(error) { return apiError(error); }
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ slug: string }> }) {
  try {
    sameOrigin(request);
    const payload=await jsonBody(request);
    const trackId=typeof payload==="object" && payload!==null && "trackId" in payload ? payload.trackId : null;
    const store=synoraStore();
    const result=await removeQueueItem(store,sessionToken(request),(await context.params).slug,trackId);
    after(() => notifyAfterCommit(store,result.roomId));
    return NextResponse.json({removedId:result.removedId,state:result.state,now:result.now});
  } catch(error) { return apiError(error); }
}

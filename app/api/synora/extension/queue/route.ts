import { NextRequest, after } from "next/server";
import { addQueueItem, parseQueueRequest, requireQueueAdd } from "../../../../../synora/core/queue-service";
import { ServiceError } from "../../../../../synora/core/identity-service";
import { synoraStore } from "../../../../../synora/server/database";
import { extensionError, extensionOptions, extensionOrigin, extensionResponse, extensionToken } from "../../../../../synora/server/extension-http";
import { jsonBody } from "../../../../../synora/server/http";
import { resolveMetadata } from "../../../../../synora/server/metadata";
import { notifyAfterCommit } from "../../../../../synora/server/realtime";
export const runtime="nodejs";
export function OPTIONS(request:NextRequest) { try { return extensionOptions(request); } catch(error) { return extensionError(request,error); } }
export async function POST(request:NextRequest) {
  try {
    extensionOrigin(request);
    const body=await jsonBody(request);
    if(!body||typeof body!=="object") throw new ServiceError(400,"Invalid queue request");
    const {slug,...input}=body as Record<string,unknown>;
    if(typeof slug!=="string"||slug.length>100) throw new ServiceError(400,"Invalid room");
    const parsed=parseQueueRequest(input);
    const store=synoraStore(),token=extensionToken(request);
    await requireQueueAdd(store,token,slug,Date.now(),"extension");
    const candidate=await resolveMetadata(parsed);
    const item=await addQueueItem(store,token,slug,candidate,Date.now(),"extension");
    after(()=>notifyAfterCommit(store,item.room_id));
    return extensionResponse(request,{item},201);
  } catch(error) { return extensionError(request,error); }
}

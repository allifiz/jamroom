import { NextRequest } from "next/server";
import { authenticateExtension, revokeExtension } from "../../../../../synora/core/extension-service";
import { listRoomsForUser } from "../../../../../synora/core/room-service";
import { synoraStore } from "../../../../../synora/server/database";
import { extensionError, extensionOptions, extensionOrigin, extensionResponse, extensionToken } from "../../../../../synora/server/extension-http";
export const runtime="nodejs";
export function OPTIONS(request:NextRequest) { try { return extensionOptions(request); } catch(error) { return extensionError(request,error); } }
export async function GET(request:NextRequest) {
  try {
    extensionOrigin(request);
    const store=synoraStore();
    const profile=await authenticateExtension(store,extensionToken(request));
    const rooms=await listRoomsForUser(store,profile.id);
    return extensionResponse(request,{profile,rooms:{owned:rooms.owned,recent:rooms.recent}});
  } catch(error) { return extensionError(request,error); }
}
export async function DELETE(request:NextRequest) {
  try { extensionOrigin(request);return extensionResponse(request,await revokeExtension(synoraStore(),extensionToken(request))); }
  catch(error) { return extensionError(request,error); }
}

import { NextRequest } from "next/server";
import { claimExtensionPairing, startExtensionPairing } from "../../../../../synora/core/extension-service";
import { synoraStore } from "../../../../../synora/server/database";
import { extensionError, extensionOptions, extensionOrigin, extensionResponse } from "../../../../../synora/server/extension-http";
import { jsonBody } from "../../../../../synora/server/http";
export const runtime="nodejs";
export function OPTIONS(request:NextRequest) { try { return extensionOptions(request); } catch(error) { return extensionError(request,error); } }
export async function POST(request:NextRequest) {
  try {
    extensionOrigin(request);
    const body=await jsonBody(request);
    if(!body||typeof body!=="object") return extensionResponse(request,{error:"Invalid pairing request"},400);
    const input=body as Record<string,unknown>;
    const result=input.action==="start"?await startExtensionPairing(synoraStore(),input.verifierHash):
      input.action==="claim"?await claimExtensionPairing(synoraStore(),input.code,input.verifier):null;
    return result?extensionResponse(request,result):extensionResponse(request,{error:"Invalid pairing action"},400);
  } catch(error) { return extensionError(request,error); }
}

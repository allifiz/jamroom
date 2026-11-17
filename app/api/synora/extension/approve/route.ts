import { NextRequest, NextResponse } from "next/server";
import { approveExtensionPairing } from "../../../../../synora/core/extension-service";
import { synoraStore } from "../../../../../synora/server/database";
import { apiError, jsonBody, sameOrigin, sessionToken } from "../../../../../synora/server/http";
export const runtime="nodejs";
export async function POST(request:NextRequest) {
  try {
    sameOrigin(request);
    const body=await jsonBody(request);
    const code=body&&typeof body==="object"&&"code" in body?body.code:null;
    return NextResponse.json(await approveExtensionPairing(synoraStore(),sessionToken(request),code),{headers:{"Cache-Control":"no-store"}});
  } catch(error) { return apiError(error); }
}

import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { ServiceError } from "../core/identity-service";
import { apiError } from "./http";

export function extensionOrigin(request:NextRequest) {
  const origin=request.headers.get("origin");
  if(!origin||!/^chrome-extension:\/\/[a-p]{32}$/.test(origin)) throw new ServiceError(403,"Extension origin required");
  return origin;
}
export function extensionToken(request:NextRequest) {
  const authorization=request.headers.get("authorization");
  return authorization?.startsWith("Bearer ")?authorization.slice(7):null;
}
export function extensionResponse(request:NextRequest,result:unknown,status=200) {
  const origin=extensionOrigin(request);
  return NextResponse.json(result,{status,headers:{"Access-Control-Allow-Origin":origin,"Access-Control-Allow-Credentials":"true","Vary":"Origin","Cache-Control":"no-store"}});
}
export function extensionError(request:NextRequest,error:unknown) {
  const response=apiError(error);
  try { response.headers.set("Access-Control-Allow-Origin",extensionOrigin(request));response.headers.set("Access-Control-Allow-Credentials","true");response.headers.set("Vary","Origin"); }
  catch { /* An invalid origin receives no CORS permission. */ }
  response.headers.set("Cache-Control","no-store");
  return response;
}
export function extensionOptions(request:NextRequest) {
  const origin=extensionOrigin(request);
  return new NextResponse(null,{status:204,headers:{"Access-Control-Allow-Origin":origin,"Access-Control-Allow-Credentials":"true","Access-Control-Allow-Methods":"GET,POST,DELETE,OPTIONS","Access-Control-Allow-Headers":"Authorization,Content-Type","Access-Control-Max-Age":"600","Vary":"Origin"}});
}

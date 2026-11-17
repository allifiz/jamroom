import { createClient } from "@libsql/client";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { sameOrigin } from "../synora/server/http";
import { hashSecret, issueSecret } from "../synora/core/identity";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/server", async importOriginal => ({
  ...await importOriginal<typeof import("next/server")>(),
  after:vi.fn(),
}));

const dir = mkdtempSync(join(tmpdir(), "synora-api-"));
process.env.TURSO_DATABASE_URL = "file:" + join(dir, "test.db");
const origin = "http://localhost:3000";
let cookie = "";

function request(path: string, method: string, body?: unknown, requestOrigin = origin, sessionCookie = cookie) {
  return new NextRequest(origin + path, {
    method,
    headers: {
      ...(method !== "GET" ? { Origin: requestOrigin } : {}),
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(sessionCookie ? { Cookie: sessionCookie } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

beforeAll(async () => {
  const db = createClient({ url: process.env.TURSO_DATABASE_URL! });
  await db.executeMultiple(readFileSync("synora/migrations/0001_initial.sql", "utf8"));
  db.close();
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("Synora HTTP boundary backed by real libSQL", () => {
  it("accepts the browser host even if the server binds to another address", () => {
    const local = new NextRequest("http://0.0.0.0:3107/api/synora/session", {
      method:"POST", headers:{ Host:"localhost:3107", Origin:"http://localhost:3107" },
    });
    expect(() => sameOrigin(local)).not.toThrow();
    const other = new NextRequest("http://0.0.0.0:3107/api/synora/session", {
      method:"POST", headers:{ Host:"localhost:3107", Origin:"https://evil.example" },
    });
    expect(() => sameOrigin(other)).toThrow();
  });
  it("rejects cross-site bootstrap and creates a durable anonymous session", async () => {
    const { POST } = await import("../app/api/synora/session/route");
    expect((await POST(request("/api/synora/session", "POST", undefined, "https://evil.example"))).status).toBe(403);
    const created = await POST(request("/api/synora/session", "POST"));
    expect(created.status).toBe(200);
    expect((await created.json()).created).toBe(true);
    expect(created.headers.get("set-cookie")).toContain("HttpOnly");
    cookie = created.headers.get("set-cookie")!.split(";")[0];
    const restored = await POST(request("/api/synora/session", "POST"));
    expect((await restored.json()).created).toBe(false);
  });

  it("creates a room and enforces session and Origin for mutations", async () => {
    const { POST, GET } = await import("../app/api/synora/rooms/route");
    const data = { name: "Test Room", visibility: "private" };
    const forbidden = await POST(request("/api/synora/rooms", "POST", data, "https://evil.example"));
    expect(forbidden.status).toBe(403);
    const created = await POST(request("/api/synora/rooms", "POST", data));
    expect(created.status).toBe(201);
    const result = await created.json();
    expect(result.recoveryKey).toMatch(/^[\w-]{43}$/);
    expect(JSON.stringify(result.room)).not.toContain("recovery_hash");
    expect((await (await GET(request("/api/synora/rooms", "GET"))).json()).owned).toHaveLength(1);
    const {POST:session}=await import("../app/api/synora/session/route");
    const home=await session(request("/api/synora/session?rooms=1","POST"));
    expect((await home.json()).rooms.owned).toHaveLength(1);
    expect((await GET(new NextRequest(origin + "/api/synora/rooms"))).status).toBe(401);
  });

  it("returns the initial room view in one authorized response",async()=>{
    const rooms=await import("../app/api/synora/rooms/route");
    const created=await rooms.POST(request("/api/synora/rooms","POST",{name:"Room View Test",visibility:"private"}));
    const {room}=await created.json();
    const path="/api/synora/rooms/"+room.slug+"/view";
    const {GET}=await import("../app/api/synora/rooms/[slug]/view/route");
    const context={params:Promise.resolve({slug:room.slug})};
    expect((await GET(new NextRequest(origin+path),context)).status).toBe(401);
    const response=await GET(request(path,"GET"),context);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({items:[],messages:[],listeners:[],canControl:true,canManage:true,state:{status:"stopped"}});
  });

  it("issues a short-lived Ably token only for an accessible room",async()=>{
    process.env.ABLY_API_KEY="abcd.12345:abcde";
    const rooms=await import("../app/api/synora/rooms/route");
    const created=await rooms.POST(request("/api/synora/rooms","POST",{name:"Realtime Test",visibility:"private"}));
    const {room}=await created.json();
    const path="/api/synora/rooms/"+room.slug+"/realtime";
    const {POST}=await import("../app/api/synora/rooms/[slug]/realtime/route");
    const context={params:Promise.resolve({slug:room.slug})};
    expect((await POST(new NextRequest(origin+path,{method:"POST",headers:{Origin:origin}}),context)).status).toBe(401);
    const response=await POST(request(path,"POST"),context);
    expect(response.status).toBe(200);
    const data=await response.json();
    expect(data.channel).toBe("synora:room:"+room.id);
    expect(data.tokenRequest.clientId).toBeTruthy();
    expect(data.tokenRequest.ttl).toBe(60_000);
    expect(JSON.parse(data.tokenRequest.capability)).toEqual({[data.channel]:["presence","subscribe"]});
    expect(JSON.stringify(data)).not.toContain(process.env.ABLY_API_KEY);
    delete process.env.ABLY_API_KEY;
  });
  it("guards room management routes and never exposes invite hashes",async()=>{
    const rooms=await import("../app/api/synora/rooms/route");
    const session=await import("../app/api/synora/session/route");
    const settings=await import("../app/api/synora/rooms/[slug]/settings/route");
    const members=await import("../app/api/synora/rooms/[slug]/members/route");
    const invites=await import("../app/api/synora/rooms/[slug]/invite/route");
    const created=await rooms.POST(request("/api/synora/rooms","POST",{name:"Manage Test",visibility:"private"}));
    const {room,inviteKey}=await created.json();
    const guestSession=await session.POST(request("/api/synora/session","POST",undefined,origin,""));
    const guestCookie=guestSession.headers.get("set-cookie")!.split(";")[0];
    const context={params:Promise.resolve({slug:room.slug})};
    const base="/api/synora/rooms/"+room.slug;
    expect((await members.GET(request(base+"/members","GET",undefined,origin,guestCookie),context)).status).toBe(404);
    expect((await settings.PATCH(request(base+"/settings","PATCH",{allow_add:false},"https://evil.example"),context)).status).toBe(403);
    const changed=await settings.PATCH(request(base+"/settings","PATCH",{allow_add:false}),context);
    expect(changed.status).toBe(200);
    const list=await members.GET(request(base+"/members","GET"),context);
    expect((await list.json()).ownerId).toBe(room.owner_id);
    const rotated=await invites.POST(request(base+"/invite","POST"),context);
    expect(rotated.status).toBe(200);
    expect(rotated.headers.get("cache-control")).toBe("no-store");
    const newKey=(await rotated.json()).inviteKey;
    expect(newKey).not.toBe(inviteKey);
    expect(JSON.stringify(await (await rooms.GET(request("/api/synora/rooms","GET"))).json())).not.toContain(newKey);
    expect((await invites.POST(request(base+"/invite","POST",undefined,origin,guestCookie),context)).status).toBe(404);
  });
  it("pairs an extension through the website and checks CORS and bearer access",async()=>{
    const pair=await import("../app/api/synora/extension/pair/route");
    const approve=await import("../app/api/synora/extension/approve/route");
    const extensionSession=await import("../app/api/synora/extension/session/route");
    const extOrigin="chrome-extension://abcdefghijklmnopabcdefghijklmnop";
    const ext=(path:string,method:string,body?:unknown,token?:string)=>new NextRequest(origin+path,{
      method,headers:{Origin:extOrigin,...(body!==undefined?{"Content-Type":"application/json"}:{}),...(token?{Authorization:"Bearer "+token}:{})},
      ...(body!==undefined?{body:JSON.stringify(body)}:{}),
    });
    const path="/api/synora/extension/pair";
    expect((await pair.OPTIONS(ext(path,"OPTIONS"))).headers.get("access-control-allow-origin")).toBe(extOrigin);
    expect((await pair.POST(request(path,"POST",{action:"start",verifierHash:hashSecret(issueSecret().token)}))).status).toBe(403);
    const verifier=issueSecret().token;
    const started=await pair.POST(ext(path,"POST",{action:"start",verifierHash:hashSecret(verifier)}));
    expect(started.status).toBe(200);
    const {code}=await started.json();
    expect((await approve.POST(request("/api/synora/extension/approve","POST",{code}))).status).toBe(200);
    const claimed=await pair.POST(ext(path,"POST",{action:"claim",code,verifier}));
    const {token}=await claimed.json();
    expect(token).toMatch(/^[\w-]{43}$/);
    const sessionPath="/api/synora/extension/session";
    expect((await extensionSession.GET(ext(sessionPath,"GET",undefined,token))).status).toBe(200);
    expect((await extensionSession.GET(ext(sessionPath,"GET"))).status).toBe(401);
    const rooms=await import("../app/api/synora/rooms/route");
    const created=await rooms.POST(request("/api/synora/rooms","POST",{name:"Extension HTTP Test"}));
    const {room}=await created.json();
    const queue=await import("../app/api/synora/extension/queue/route");
    const track={slug:room.slug,url:"https://www.youtube.com/watch?v=dQw4w9WgXcQ"};
    expect((await queue.POST(ext("/api/synora/extension/queue","POST",track))).status).toBe(401);
    vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify({title:"Matched song",author_name:"Artist"}),{status:200})));
    try {
      const added=await queue.POST(ext("/api/synora/extension/queue","POST",track,token));
      expect(added.status).toBe(201);
      expect(await added.json()).toMatchObject({item:{title:"Matched song",room_id:room.id}});
    } finally { vi.unstubAllGlobals(); }
    expect((await extensionSession.DELETE(ext(sessionPath,"DELETE",undefined,token))).status).toBe(200);
    expect((await extensionSession.GET(ext(sessionPath,"GET",undefined,token))).status).toBe(401);
  });
});

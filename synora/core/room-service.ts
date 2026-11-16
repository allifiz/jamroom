import { randomUUID } from "node:crypto";
import { z } from "zod";
import { hashSecret, issueSecret, roomPermissions, validSecret, type MemberRole } from "./identity";
import { authenticate, ServiceError } from "./identity-service";
import type { SqlExecutor, SynoraStore } from "./store";

const inputSchema = z.object({
  name:z.string().trim().min(1).max(80),
  description:z.string().max(500).default(""),
  visibility:z.enum(["public","private"]).default("public"),
  cover:z.enum(["pink","yellow","blue","mint","lavender"]).default("pink"),
});
type RoomRow = {
  id:string; owner_id:string; slug:string; name:string; description:string;
  visibility:"public"|"private"; cover:string; allow_add:number; allow_manage:number; allow_control:number;
  enhancements_enabled:number; created_at:number; updated_at:number;
};
type SecretRoom = RoomRow & { invite_hash:string; recovery_hash:string };
type Membership = { role:MemberRole; can_manage:number; can_control:number };
const publicColumns = "id,owner_id,slug,name,description,visibility,cover,allow_add,allow_manage,allow_control,enhancements_enabled,created_at,updated_at";
const publicRoom = (r:SecretRoom):RoomRow => ({
  id:r.id,owner_id:r.owner_id,slug:r.slug,name:r.name,description:r.description,visibility:r.visibility,cover:r.cover,
  allow_add:r.allow_add,allow_manage:r.allow_manage,allow_control:r.allow_control,enhancements_enabled:r.enhancements_enabled,
  created_at:r.created_at,updated_at:r.updated_at,
});
async function readRoom(tx:SqlExecutor,slug:string) {
  const [row] = await tx.query<SecretRoom>("SELECT "+publicColumns+",invite_hash,recovery_hash FROM rooms WHERE slug=?", [slug]);
  return row;
}
async function notify(tx:SqlExecutor,roomId:string,at:number,event:"refresh"|"access_changed"="refresh") {
  await tx.execute("INSERT INTO realtime_outbox(id,room_id,event,created_at) VALUES(?,?,?,?)",[randomUUID(),roomId,event,at]);
}
async function access(tx:SqlExecutor,r:RoomRow,userId:string,now:number) {
  const [members,restrictions]=await Promise.all([
    tx.query<Membership>("SELECT role,can_manage,can_control FROM room_members WHERE room_id=? AND user_id=?",[r.id,userId]),
    tx.query<{expires_at:number|null}>("SELECT expires_at FROM room_restrictions WHERE room_id=? AND user_id=?",[r.id,userId]),
  ]);
  const [m]=members,[b]=restrictions;
  return roomPermissions({ownerId:r.owner_id,visibility:r.visibility,allowAdd:!!r.allow_add,allowManage:!!r.allow_manage,allowControl:!!r.allow_control},userId,
    m?{role:m.role,canManage:!!m.can_manage,canControl:!!m.can_control}:undefined,
    b?{expiresAt:b.expires_at}:undefined,now);
}
export async function createRoom(db:SynoraStore, token:unknown, raw:unknown, now=Date.now()) {
  const parsed=inputSchema.safeParse(raw);
  if(!parsed.success) throw new ServiceError(400,"Invalid room settings");
  const input=parsed.data;
  return db.write(async tx=>{
    const user=await authenticate(tx,token,now);
    const id=randomUUID(), invite=issueSecret(), recovery=issueSecret();
    const slug=(input.name.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,50)||"room")+"-"+id;
    await tx.execute("INSERT INTO rooms(id,owner_id,slug,name,description,visibility,cover,invite_hash,recovery_hash,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
      [id,user.id,slug,input.name,input.description,input.visibility,input.cover,invite.hash,recovery.hash,now,now]);
    await tx.execute("INSERT INTO room_members(room_id,user_id,role,joined_at) VALUES(?,?,'MEMBER',?)",[id,user.id,now]);
    await tx.execute("INSERT INTO room_playback_states(room_id,updated_at) VALUES(?,?)",[id,now]);
    const created=await readRoom(tx,slug);
    if(!created) throw new Error("Room insert not visible in transaction");
    return {room:publicRoom(created),inviteKey:invite.token,recoveryKey:recovery.token};
  });
}

export async function joinRoom(db:SynoraStore,token:unknown,slug:string,invite:unknown,now=Date.now()) {
  const [user,existing]=await Promise.all([authenticate(db,token,now),readRoom(db,slug)]);
  if(existing && (await access(db,existing,user.id,now)).member) return publicRoom(existing);
  return db.write(async tx=>{
    const user=await authenticate(tx,token,now);
    const r=await readRoom(tx,slug);
    if(!r) throw new ServiceError(404,"Room unavailable or invitation required");
    const [restriction]=await tx.query<{expires_at:number|null}>("SELECT expires_at FROM room_restrictions WHERE room_id=? AND user_id=?",[r.id,user.id]);
    if(user.id!==r.owner_id && restriction && (restriction.expires_at===null||restriction.expires_at>now)){
      throw new ServiceError(403,"Room unavailable or invitation required");
    }
    const p=await access(tx,r,user.id,now);
    if(!p.read&&(!validSecret(invite)||hashSecret(invite)!==r.invite_hash)) throw new ServiceError(404,"Room unavailable or invitation required");
    const added=await tx.execute("INSERT INTO room_members(room_id,user_id,role,joined_at) VALUES(?,?,'MEMBER',?) ON CONFLICT(room_id,user_id) DO NOTHING",[r.id,user.id,now]);
    if(added) await notify(tx,r.id,now);
    return publicRoom(r);
  });
}
export async function listRooms(db:SynoraStore,token:unknown,now=Date.now()) {
  const user=await authenticate(db,token,now);
  const columns=publicColumns.split(",").map(c=>"r."+c).join(",");
  const visible="NOT EXISTS(SELECT 1 FROM room_restrictions b WHERE b.room_id=r.id AND b.user_id=? AND (b.expires_at IS NULL OR b.expires_at>?))";
  const [discover,owned,recent]=await Promise.all([
    db.query<RoomRow>("SELECT "+columns+" FROM rooms r WHERE r.visibility='public' AND (r.owner_id=? OR "+visible+") ORDER BY r.updated_at DESC LIMIT 100",[user.id,user.id,now]),
    db.query<RoomRow>("SELECT "+columns+" FROM rooms r WHERE r.owner_id=? ORDER BY r.updated_at DESC LIMIT 100",[user.id]),
    db.query<RoomRow>("SELECT "+columns+" FROM rooms r JOIN room_members m ON m.room_id=r.id WHERE m.user_id=? AND (r.owner_id=? OR "+visible+") ORDER BY m.joined_at DESC LIMIT 100",[user.id,user.id,user.id,now]),
  ]);
  return {discover,owned,recent};
}

// Limit attempts by identity and room within a persisted window. The HTTP layer
// must also enforce request/IP limits before anonymous session creation.
export async function recoverRoom(db:SynoraStore,token:unknown,slug:string,key:unknown,now=Date.now()) {
  if(!validSecret(key)) throw new ServiceError(400,"Invalid recovery key");
  const result=await db.write(async tx=>{
    const user=await authenticate(tx,token,now);
    const r=await readRoom(tx,slug);
    if(!r) return {error:404 as const};
    const bucket="room-recovery:"+r.id+":"+user.id;
    await tx.execute("INSERT INTO rate_limits(bucket,count,expires_at) VALUES(?,1,?) ON CONFLICT(bucket) DO UPDATE SET count=CASE WHEN expires_at<=? THEN 1 ELSE count+1 END,expires_at=CASE WHEN expires_at<=? THEN excluded.expires_at ELSE expires_at END",
      [bucket,now+15*60*1000,now,now]);
    const [attempt]=await tx.query<{count:number}>("SELECT count FROM rate_limits WHERE bucket=?",[bucket]);
    if(attempt.count>5) return {error:429 as const};
    if(hashSecret(key)!==r.recovery_hash) return {error:404 as const};
    const next=issueSecret();
    const changed=await tx.execute("UPDATE rooms SET owner_id=?,recovery_hash=?,updated_at=? WHERE id=? AND recovery_hash=?",[user.id,next.hash,now,r.id,r.recovery_hash]);
    if(changed!==1) return {error:404 as const};
    // Old owner loses any explicit elevated grants, even if they had been an admin before ownership.
    await tx.execute("UPDATE room_members SET role='MEMBER',can_manage=0,can_control=0 WHERE room_id=? AND user_id=?",[r.id,r.owner_id]);
    await tx.execute("INSERT INTO room_members(room_id,user_id,role,joined_at) VALUES(?,?,'MEMBER',?) ON CONFLICT(room_id,user_id) DO UPDATE SET role='MEMBER',can_manage=0,can_control=0",[r.id,user.id,now]);
    await tx.execute("DELETE FROM room_restrictions WHERE room_id=? AND user_id=?",[r.id,user.id]);
    await tx.execute("DELETE FROM rate_limits WHERE bucket=?",[bucket]);
    await notify(tx,r.id,now,"access_changed");
    return {room:publicRoom({...r,owner_id:user.id,updated_at:now}),recoveryKey:next.token};
  });
  if("error" in result) throw new ServiceError(result.error??500,result.error===429?"Too many recovery attempts":"Room unavailable or invalid recovery key");
  return result;
}

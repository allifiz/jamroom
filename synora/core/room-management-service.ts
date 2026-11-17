import { randomUUID } from "node:crypto";
import { z } from "zod";
import { issueSecret } from "./identity";
import { ServiceError } from "./identity-service";
import { roomAccess } from "./queue-service";
import type { SqlExecutor, SynoraStore } from "./store";

const settingsSchema = z.object({
  name:z.string().trim().min(1).max(80).optional(),
  description:z.string().max(500).optional(),
  visibility:z.enum(["public","private"]).optional(),
  allow_add:z.boolean().optional(),
  allow_manage:z.boolean().optional(),
  allow_control:z.boolean().optional(),
}).strict().refine(value=>Object.keys(value).length>0);
const memberSchema = z.object({ userId:z.string().uuid(), role:z.enum(["ADMIN","DJ","MEMBER"]) }).strict();
const moderationSchema = z.object({ userId:z.string().uuid(), action:z.enum(["kick","ban","unban"]) }).strict();

type MemberRow = { user_id:string; display_name:string; role:"ADMIN"|"DJ"|"MEMBER"; can_manage:number; can_control:number; joined_at:number };
type RestrictionRow = { user_id:string; display_name:string; action:"kick"|"ban"; expires_at:number|null };
async function notify(tx:SqlExecutor,roomId:string,now:number) {
  await tx.execute("INSERT INTO realtime_outbox(id,room_id,event,created_at) VALUES(?,?,'access_changed',?)",[randomUUID(),roomId,now]);
}

export async function updateRoomSettings(db:SynoraStore,token:unknown,slug:string,raw:unknown,now=Date.now()) {
  const parsed=settingsSchema.safeParse(raw);
  if(!parsed.success) throw new ServiceError(400,"Invalid room settings");
  return db.write(async tx=>{
    const {room,permissions}=await roomAccess(tx,slug,token,now);
    if(!permissions.configure) throw new ServiceError(403,"Only room admins can change settings");
    const entries=Object.entries(parsed.data).map(([key,value])=>[key,typeof value==="boolean"?Number(value):value] as const);
    await tx.execute(`UPDATE rooms SET ${entries.map(([key])=>`${key}=?`).join(",")},updated_at=? WHERE id=?`,[...entries.map(([,value])=>value),now,room.id]);
    await notify(tx,room.id,now);
    return {roomId:room.id};
  });
}

export async function listRoomMembers(db:SynoraStore,token:unknown,slug:string,now=Date.now()) {
  const {room,permissions}=await roomAccess(db,slug,token,now);
  if(!permissions.moderate) throw new ServiceError(403,"Only room admins can manage members");
  const [members,restrictions]=await Promise.all([
    db.query<MemberRow>("SELECT m.user_id,p.display_name,m.role,m.can_manage,m.can_control,m.joined_at FROM room_members m JOIN profiles p ON p.id=m.user_id WHERE m.room_id=? ORDER BY CASE WHEN p.id=? THEN 0 WHEN m.role='ADMIN' THEN 1 WHEN m.role='DJ' THEN 2 ELSE 3 END,m.joined_at",[room.id,room.owner_id]),
    db.query<RestrictionRow>("SELECT b.user_id,p.display_name,b.action,b.expires_at FROM room_restrictions b JOIN profiles p ON p.id=b.user_id WHERE b.room_id=? AND (b.expires_at IS NULL OR b.expires_at>?) ORDER BY b.created_at DESC",[room.id,now]),
  ]);
  return {members,restrictions,ownerId:room.owner_id};
}

export async function changeMemberRole(db:SynoraStore,token:unknown,slug:string,raw:unknown,now=Date.now()) {
  const parsed=memberSchema.safeParse(raw);
  if(!parsed.success) throw new ServiceError(400,"Invalid member role");
  return db.write(async tx=>{
    const {user,room,permissions}=await roomAccess(tx,slug,token,now);
    if(!permissions.moderate) throw new ServiceError(403,"Only room admins can manage members");
    const {userId,role}=parsed.data;
    if(userId===room.owner_id||userId===user.id) throw new ServiceError(403,"Cannot change this member's role");
    const [target]=await tx.query<{role:string}>("SELECT role FROM room_members WHERE room_id=? AND user_id=?",[room.id,userId]);
    if(!target) throw new ServiceError(404,"Member not found");
    if(!permissions.assignAdmin && (role==="ADMIN"||target.role==="ADMIN")) throw new ServiceError(403,"Only the host can manage admins");
    await tx.execute("UPDATE room_members SET role=?,can_manage=0,can_control=0 WHERE room_id=? AND user_id=?",[role,room.id,userId]);
    await notify(tx,room.id,now);
    return {roomId:room.id};
  });
}

export async function moderateRoomMember(db:SynoraStore,token:unknown,slug:string,raw:unknown,now=Date.now()) {
  const parsed=moderationSchema.safeParse(raw);
  if(!parsed.success) throw new ServiceError(400,"Invalid moderation action");
  return db.write(async tx=>{
    const {user,room,permissions}=await roomAccess(tx,slug,token,now);
    if(!permissions.moderate) throw new ServiceError(403,"Only room admins can moderate");
    const {userId,action}=parsed.data;
    if(userId===room.owner_id||userId===user.id) throw new ServiceError(403,"Cannot moderate this member");
    const [target]=await tx.query<{role:string}>("SELECT role FROM room_members WHERE room_id=? AND user_id=?",[room.id,userId]);
    if(target?.role==="ADMIN"&&!permissions.owner) throw new ServiceError(403,"Only the host can moderate admins");
    if(action==="unban") {
      const removed=await tx.execute("DELETE FROM room_restrictions WHERE room_id=? AND user_id=?",[room.id,userId]);
      if(!removed) throw new ServiceError(404,"Restriction not found");
    } else {
      if(!target) throw new ServiceError(404,"Member not found");
      await tx.execute("INSERT INTO room_restrictions(room_id,user_id,action,expires_at,created_at) VALUES(?,?,?,?,?) ON CONFLICT(room_id,user_id) DO UPDATE SET action=excluded.action,expires_at=excluded.expires_at,created_at=excluded.created_at",
        [room.id,userId,action,action==="kick"?now+10*60_000:null,now]);
      await tx.execute("DELETE FROM room_listener_leases WHERE room_id=? AND user_id=?",[room.id,userId]);
      await tx.execute("DELETE FROM room_members WHERE room_id=? AND user_id=?",[room.id,userId]);
    }
    await notify(tx,room.id,now);
    return {roomId:room.id};
  });
}

export async function rotateRoomInvite(db:SynoraStore,token:unknown,slug:string,now=Date.now()) {
  return db.write(async tx=>{
    const {room,permissions}=await roomAccess(tx,slug,token,now);
    if(!permissions.configure) throw new ServiceError(403,"Only room admins can create invitations");
    const invite=issueSecret();
    await tx.execute("UPDATE rooms SET invite_hash=?,updated_at=? WHERE id=?",[invite.hash,now,room.id]);
    return {roomId:room.id,inviteKey:invite.token};
  });
}

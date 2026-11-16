import "server-only";
import { createHttpClient } from "@ably/pubsub-server";
import type { SynoraStore } from "../core/store";

export const roomChannel = (roomId:string) => `synora:room:${roomId}`;

function ably() {
  const key=process.env.ABLY_API_KEY;
  if(!key) throw new Error("ABLY_API_KEY is required");
  return createHttpClient({key});
}

export async function roomToken(clientId:string,roomId:string,member:boolean) {
  const channel=roomChannel(roomId);
  return ably().auth.createTokenRequest({
    clientId,
    ttl:60_000,
    capability:{[channel]:member?["subscribe","presence"]:["subscribe"]},
  });
}

// Events are committed in SQLite first. A failed publish stays in the outbox
// and can be retried on the next room write; clients always re-read snapshots.
export async function flushRoomOutbox(db:SynoraStore,roomId:string) {
  const events=await db.query<{id:string;event:string}>(
    "SELECT id,event FROM realtime_outbox WHERE room_id=? AND sent_at IS NULL ORDER BY created_at LIMIT 20",[roomId]);
  if(!events.length)return;
  const channel=ably().channels.get(roomChannel(roomId));
  for(const event of events) {
    await channel.publish(event.event,{id:event.id});
    await db.execute("UPDATE realtime_outbox SET sent_at=? WHERE id=? AND sent_at IS NULL",[Date.now(),event.id]);
  }
}

export async function notifyAfterCommit(db:SynoraStore,roomId:string) {
  try { await flushRoomOutbox(db,roomId); }
  catch(error) { console.error("Synora realtime notification pending",error); }
}

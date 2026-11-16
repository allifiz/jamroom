import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bootstrapIdentity, renameIdentity, authenticate } from "../synora/core/identity-service";
import { createRoom, joinRoom, listRooms, recoverRoom } from "../synora/core/room-service";
import { issueSecret } from "../synora/core/identity";
import { addQueueItem, parseQueueRequest, queueSnapshot, removeQueueItem, reorderQueue } from "../synora/core/queue-service";
import { controlPlayback } from "../synora/core/playback-service";
import { listRoomMessages, roomListeners, roomView, sendRoomMessage, updateRoomPresence } from "../synora/core/room-social-service";
import type { SqlExecutor, SynoraStore, SqlValue } from "../synora/core/store";

let db:DatabaseSync;
let store:SynoraStore;
beforeEach(()=>{
  db=new DatabaseSync(":memory:");
  db.exec(readFileSync("synora/migrations/0001_initial.sql","utf8"));
  const executor:SqlExecutor={
    async query<T>(sql:string,args:SqlValue[]=[]){return db.prepare(sql).all(...args) as T[];},
    async execute(sql:string,args:SqlValue[]=[]){return Number(db.prepare(sql).run(...args).changes);},
  };
  store={...executor,async write<T>(callback:(tx:SqlExecutor)=>Promise<T>){
    db.exec("BEGIN IMMEDIATE");
    try{const value=await callback(executor);db.exec("COMMIT");return value;}
    catch(error){db.exec("ROLLBACK");throw error;}
  }};
});
afterEach(()=>db.close());

describe("SYNORA transactions (real SQLite, not Turso integration)",()=>{
  it("preserves anonymous identity and renamed nickname across visits",async()=>{
    const a=await bootstrapIdentity(store,null);
    expect(a.created).toBe(true);
    expect(a.cookie).toBeTruthy();
    await renameIdentity(store,a.cookie,"CosmicTrex");
    const again=await bootstrapIdentity(store,a.cookie);
    expect(again).toMatchObject({created:false,cookie:null,profile:{id:a.profile.id,display_name:"CosmicTrex"}});
    await expect(authenticate(store,issueSecret().token)).rejects.toMatchObject({status:401});
    expect(db.prepare("SELECT count(*) as n FROM profiles").get()?.n).toBe(1);
  });
  it("creates a persistent owner, rejects uninvited private users, and handles recovery",async()=>{
    const a=await bootstrapIdentity(store,null),b=await bootstrapIdentity(store,null),c=await bootstrapIdentity(store,null);
    const created=await createRoom(store,a.cookie,{name:"Dino Club",visibility:"private"});
    expect(created.room.owner_id).toBe(a.profile.id);
    expect(JSON.stringify(created.room)).not.toContain("hash");
    await expect(joinRoom(store,b.cookie,created.room.slug,null)).rejects.toMatchObject({status:404});
    expect((await listRooms(store,b.cookie)).discover).toHaveLength(0);
    await joinRoom(store,b.cookie,created.room.slug,created.inviteKey);
    expect((await listRooms(store,b.cookie)).recent).toHaveLength(1);
    const recovered=await recoverRoom(store,c.cookie,created.room.slug,created.recoveryKey);
    expect(recovered.room.owner_id).toBe(c.profile.id);
    expect(recovered.recoveryKey).not.toBe(created.recoveryKey);
    await expect(recoverRoom(store,a.cookie,created.room.slug,created.recoveryKey)).rejects.toMatchObject({status:404});
    expect((await listRooms(store,a.cookie)).owned).toHaveLength(0);
    expect((await listRooms(store,c.cookie)).owned).toHaveLength(1);
    expect(db.prepare("SELECT count(*) as n FROM room_playback_states").get()?.n).toBe(1);
  });
  it("persists recovery attempt limits even when attempts fail",async()=>{
    const a=await bootstrapIdentity(store,null),b=await bootstrapIdentity(store,null);
    const created=await createRoom(store,a.cookie,{name:"Quiet Raptor"});
    for(let i=0;i<5;i++) await expect(recoverRoom(store,b.cookie,created.room.slug,issueSecret().token)).rejects.toMatchObject({status:404});
    await expect(recoverRoom(store,b.cookie,created.room.slug,created.recoveryKey)).rejects.toMatchObject({status:429});
  });
  it("enforces same-room selected track and unique queue positions",async()=>{
    const a=await bootstrapIdentity(store,null);
    const r1=await createRoom(store,a.cookie,{name:"One"}),r2=await createRoom(store,a.cookie,{name:"Two"});
    db.prepare("INSERT INTO playlist_items(id,room_id,source_provider,source_external_id,source_url,playback_provider,playback_external_id,playback_url,title,position,added_by,added_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)")
      .run("track",r1.room.id,"youtube","id","https://example.com","youtube","id","https://example.com","Track",0,a.profile.id,0);
    expect(()=>db.prepare("UPDATE room_playback_states SET current_track_id=? WHERE room_id=?").run("track",r2.room.id)).toThrow();
  });
  it("adds a confirmed playable match while preserving its original Spotify source",async()=>{
    const a=await bootstrapIdentity(store,null);
    const room=await createRoom(store,a.cookie,{name:"Match Room"});
    const parsed=parseQueueRequest({url:"https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT",matchUrl:"https://www.youtube.com/watch?v=dQw4w9WgXcQ"});
    const candidate={...parsed,title:"Confirmed match",artist:"Artist",thumbnail:null,durationSeconds:null};
    const item=await addQueueItem(store,a.cookie,room.room.slug,candidate);
    expect(item.source_provider).toBe("spotify");
    expect(item.playback_provider).toBe("youtube");
    expect((await queueSnapshot(store,a.cookie,room.room.slug)).state).toMatchObject({current_track_id:item.id,status:"paused"});
    await expect(addQueueItem(store,a.cookie,room.room.slug,candidate)).rejects.toMatchObject({status:409});
    expect((await queueSnapshot(store,a.cookie,room.room.slug)).items).toHaveLength(1);
    await expect(queueSnapshot(store,issueSecret().token,room.room.slug)).rejects.toMatchObject({status:401});
    expect(()=>parseQueueRequest({url:"https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT"})).toThrowError(/match/);
  });
  it("synchronizes playback through versioned transactions and advances on track end",async()=>{
    const a=await bootstrapIdentity(store,null),b=await bootstrapIdentity(store,null);
    const room=await createRoom(store,a.cookie,{name:"Listening Room"});
    await joinRoom(store,b.cookie,room.room.slug,null);
    const source=parseQueueRequest({url:"https://www.youtube.com/watch?v=dQw4w9WgXcQ"});
    const first=await addQueueItem(store,a.cookie,room.room.slug,{...source,title:"First",artist:null,thumbnail:null,durationSeconds:null},1000);
    const nextSource=parseQueueRequest({url:"https://www.youtube.com/watch?v=M7lc1UVf-VE"});
    const second=await addQueueItem(store,a.cookie,room.room.slug,{...nextSource,title:"Second",artist:null,thumbnail:null,durationSeconds:null},1000);
    const slug=room.room.slug;
    expect((await queueSnapshot(store,b.cookie,slug,2000)).canControl).toBe(true);
    const playing=await controlPlayback(store,a.cookie,slug,{action:"play",expectedVersion:1},2000);
    expect(playing.state).toMatchObject({current_track_id:first.id,status:"playing",playback_started_at:2000,state_version:2});
    await expect(controlPlayback(store,b.cookie,slug,{action:"pause",expectedVersion:1},4000)).rejects.toMatchObject({status:409});
    const paused=await controlPlayback(store,b.cookie,slug,{action:"pause",expectedVersion:2},7000);
    expect(paused.state).toMatchObject({position_seconds:5,status:"paused",state_version:3});
    const sought=await controlPlayback(store,a.cookie,slug,{action:"seek",expectedVersion:3,positionSeconds:20},8000);
    expect(sought.state.position_seconds).toBe(20);
    await controlPlayback(store,a.cookie,slug,{action:"play",expectedVersion:4},9000);
    const advanced=await controlPlayback(store,b.cookie,slug,{action:"ended",trackId:first.id,expectedVersion:5},12000);
    expect(advanced.state).toMatchObject({current_track_id:second.id,status:"playing",position_seconds:0,state_version:6});
    await expect(controlPlayback(store,a.cookie,slug,{action:"ended",trackId:first.id,expectedVersion:6},13000)).rejects.toMatchObject({status:409});
    const stopped=await controlPlayback(store,a.cookie,slug,{action:"next",expectedVersion:6},14000);
    expect(stopped.state).toMatchObject({current_track_id:null,status:"stopped"});
    expect((await queueSnapshot(store,b.cookie,slug,15000)).state).toMatchObject({status:"stopped",state_version:7});
  });
  it("reorders uniquely and removes a playing track without leaving a dangling selection",async()=>{
    const a=await bootstrapIdentity(store,null),b=await bootstrapIdentity(store,null);
    const room=await createRoom(store,a.cookie,{name:"Queue Controls"});
    await joinRoom(store,b.cookie,room.room.slug,null);
    const ids=["dQw4w9WgXcQ","M7lc1UVf-VE","9bZkp7q19f0"];
    const tracks=[];
    for(const id of ids){
      const source=parseQueueRequest({url:`https://www.youtube.com/watch?v=${id}`});
      tracks.push(await addQueueItem(store,a.cookie,room.room.slug,{...source,title:id,artist:null,thumbnail:null,durationSeconds:null}));
    }
    const slug=room.room.slug;
    const original=tracks.map(item=>item.id),ordered=[original[2],original[0],original[1]];
    await expect(reorderQueue(store,b.cookie,slug,{orderedIds:ordered,expectedIds:original})).rejects.toMatchObject({status:403});
    const changed=await reorderQueue(store,a.cookie,slug,{orderedIds:ordered,expectedIds:original});
    expect(changed.items.map(item=>item.position)).toEqual([0,1,2]);
    expect((await queueSnapshot(store,a.cookie,slug)).items.map(item=>item.id)).toEqual(ordered);
    await expect(reorderQueue(store,a.cookie,slug,{orderedIds:original,expectedIds:original})).rejects.toMatchObject({status:409});
    await expect(reorderQueue(store,a.cookie,slug,{orderedIds:[original[0],original[0],original[1]],expectedIds:ordered})).rejects.toMatchObject({status:400});
    await expect(removeQueueItem(store,b.cookie,slug,original[0])).rejects.toMatchObject({status:403});
    await controlPlayback(store,a.cookie,slug,{action:"play",expectedVersion:1},1000);
    const removed=await removeQueueItem(store,a.cookie,slug,original[0],2000);
    expect(removed.state).toMatchObject({current_track_id:original[1],status:"playing",state_version:3,playback_started_at:2000});
    expect((await queueSnapshot(store,a.cookie,slug,3000)).items.map(item=>item.id)).toEqual([original[2],original[1]]);
    await expect(removeQueueItem(store,a.cookie,slug,original[0])).rejects.toMatchObject({status:404});
    await removeQueueItem(store,a.cookie,slug,original[1],4000);
    const last=await removeQueueItem(store,a.cookie,slug,original[2],5000);
    expect(last.state).toMatchObject({current_track_id:null,status:"stopped"});
  });
  it("enforces control permission and rejects a selected track from another room",async()=>{
    const a=await bootstrapIdentity(store,null),b=await bootstrapIdentity(store,null);
    const room=await createRoom(store,a.cookie,{name:"Only DJ"});
    const other=await createRoom(store,a.cookie,{name:"Other"});
    await joinRoom(store,b.cookie,room.room.slug,null);
    db.prepare("UPDATE rooms SET allow_control=0 WHERE id=?").run(room.room.id);
    const candidate=parseQueueRequest({url:"https://www.youtube.com/watch?v=dQw4w9WgXcQ"});
    const item=await addQueueItem(store,a.cookie,other.room.slug,{...candidate,title:"Other track",artist:null,thumbnail:null,durationSeconds:null});
    await expect(controlPlayback(store,b.cookie,room.room.slug,{action:"play",expectedVersion:0})).rejects.toMatchObject({status:403});
    await expect(controlPlayback(store,a.cookie,room.room.slug,{action:"select",expectedVersion:0,trackId:item.id})).rejects.toMatchObject({status:404});
  });
  it("persists chat, checks membership, and tracks separate browser tabs",async()=>{
    const a=await bootstrapIdentity(store,null),b=await bootstrapIdentity(store,null);
    const room=await createRoom(store,a.cookie,{name:"Social Room",visibility:"private"});
    await expect(sendRoomMessage(store,b.cookie,room.room.slug,"hello")).rejects.toMatchObject({status:404});
    await joinRoom(store,b.cookie,room.room.slug,room.inviteKey);
    await sendRoomMessage(store,b.cookie,room.room.slug,"  Halo room!  ",1000);
    expect((await listRoomMessages(store,a.cookie,room.room.slug,2000)).messages).toMatchObject([{body:"Halo room!",display_name:b.profile.display_name}]);
    const tab1="11111111-1111-4111-8111-111111111111",tab2="22222222-2222-4222-8222-222222222222";
    await updateRoomPresence(store,a.cookie,room.room.slug,tab1,false,3000);
    await updateRoomPresence(store,a.cookie,room.room.slug,tab2,false,3001);
    expect((await roomListeners(store,b.cookie,room.room.slug,3002)).listeners).toMatchObject([{id:a.profile.id,is_owner:1}]);
    await updateRoomPresence(store,a.cookie,room.room.slug,tab1,true,3003);
    expect((await roomListeners(store,b.cookie,room.room.slug,3004)).listeners).toHaveLength(1);
    await updateRoomPresence(store,a.cookie,room.room.slug,tab2,true,3005);
    expect((await roomListeners(store,b.cookie,room.room.slug,3006)).listeners).toHaveLength(0);
    await updateRoomPresence(store,b.cookie,room.room.slug,tab1,false,4000);
    expect((await roomListeners(store,a.cookie,room.room.slug,50000)).listeners).toHaveLength(0);
    await expect(sendRoomMessage(store,b.cookie,room.room.slug,"\u0000oops",5000)).rejects.toMatchObject({status:400});
  });
  it("loads the complete room through one access check without opening a write transaction for returning users",async()=>{
    const a=await bootstrapIdentity(store,null);
    const created=await createRoom(store,a.cookie,{name:"Fast Room"});
    let writes=0,reads=0;
    const measured:SynoraStore={...store,
      async query<T>(sql:string,args:SqlValue[]=[]){reads++;return store.query<T>(sql,args);},
      async write<T>(callback:(tx:SqlExecutor)=>Promise<T>){writes++;return store.write(callback);}};
    expect((await bootstrapIdentity(measured,a.cookie)).profile.id).toBe(a.profile.id);
    expect((await joinRoom(measured,a.cookie,created.room.slug,null)).id).toBe(created.room.id);
    reads=0;
    const view=await roomView(measured,a.cookie,created.room.slug);
    expect(view).toMatchObject({items:[],messages:[],listeners:[],canManage:true,canControl:true});
    expect(view.state).toMatchObject({status:"stopped"});
    expect(writes).toBe(0);
    expect(reads).toBe(5);
    await expect(roomView(measured,issueSecret().token,created.room.slug)).rejects.toMatchObject({status:401});
  });
});

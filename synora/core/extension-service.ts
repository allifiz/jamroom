import { randomBytes } from "node:crypto";
import { hashSecret, issueSecret, validSecret } from "./identity";
import { authenticate, ServiceError, type Profile } from "./identity-service";
import type { SqlExecutor, SynoraStore } from "./store";

const PAIR_TTL=10*60_000;
const EXTENSION_TTL=30*24*60*60_000;
const codeValid=(code:unknown):code is string=>typeof code==="string"&&/^[A-Za-z0-9_-]{22}$/.test(code);

export async function startExtensionPairing(db:SynoraStore,verifierHash:unknown,now=Date.now()) {
  if(typeof verifierHash!=="string"||!/^[a-f0-9]{64}$/.test(verifierHash)) throw new ServiceError(400,"Invalid pairing verifier");
  return db.write(async tx=>{
    const code=randomBytes(16).toString("base64url");
    await tx.execute("DELETE FROM extension_pairings WHERE expires_at<? OR consumed_at IS NOT NULL",[now-24*60*60_000]);
    await tx.execute("INSERT INTO extension_pairings(code_hash,verifier_hash,expires_at) VALUES(?,?,?)",[hashSecret(code),verifierHash,now+PAIR_TTL]);
    return {code,expiresAt:now+PAIR_TTL};
  });
}

export async function approveExtensionPairing(db:SynoraStore,session:unknown,code:unknown,now=Date.now()) {
  if(!codeValid(code)) throw new ServiceError(400,"Invalid pairing code");
  return db.write(async tx=>{
    const user=await authenticate(tx,session,now);
    const changed=await tx.execute("UPDATE extension_pairings SET user_id=? WHERE code_hash=? AND user_id IS NULL AND consumed_at IS NULL AND expires_at>?",[user.id,hashSecret(code),now]);
    if(!changed) throw new ServiceError(404,"Pairing code expired or already used");
    return {approved:true};
  });
}

export async function claimExtensionPairing(db:SynoraStore,code:unknown,verifier:unknown,now=Date.now()) {
  if(!codeValid(code)||!validSecret(verifier)) throw new ServiceError(400,"Invalid pairing credentials");
  const codeHash=hashSecret(code),verifierHash=hashSecret(verifier);
  const [existing]=await db.query<{user_id:string|null}>("SELECT user_id FROM extension_pairings WHERE code_hash=? AND verifier_hash=? AND expires_at>? AND consumed_at IS NULL",[codeHash,verifierHash,now]);
  if(!existing) throw new ServiceError(410,"Pairing expired or already claimed");
  if(!existing.user_id) return {pending:true as const};
  return db.write(async tx=>{
    const [pair]=await tx.query<{user_id:string|null}>("SELECT user_id FROM extension_pairings WHERE code_hash=? AND verifier_hash=? AND expires_at>? AND consumed_at IS NULL",[codeHash,verifierHash,now]);
    if(!pair) throw new ServiceError(410,"Pairing expired or already claimed");
    if(!pair.user_id) return {pending:true as const};
    const changed=await tx.execute("UPDATE extension_pairings SET consumed_at=? WHERE code_hash=? AND consumed_at IS NULL AND user_id=?",[now,codeHash,pair.user_id]);
    if(!changed) throw new ServiceError(410,"Pairing already claimed");
    const token=issueSecret();
    await tx.execute("INSERT INTO extension_sessions(token_hash,user_id,created_at,expires_at) VALUES(?,?,?,?)",[token.hash,pair.user_id,now,now+EXTENSION_TTL]);
    return {pending:false as const,token:token.token,expiresAt:now+EXTENSION_TTL};
  });
}

export async function authenticateExtension(db:SqlExecutor,token:unknown,now=Date.now()):Promise<Profile> {
  if(!validSecret(token)) throw new ServiceError(401,"Extension session required");
  const [profile]=await db.query<Profile>("SELECT p.id,p.display_name,p.avatar_seed,p.avatar_url FROM extension_sessions s JOIN profiles p ON p.id=s.user_id WHERE s.token_hash=? AND s.revoked_at IS NULL AND s.expires_at>?",[hashSecret(token),now]);
  if(!profile) throw new ServiceError(401,"Extension session expired");
  return profile;
}

export async function revokeExtension(db:SynoraStore,token:unknown,now=Date.now()) {
  if(!validSecret(token)) throw new ServiceError(401,"Extension session required");
  await authenticateExtension(db,token,now);
  await db.write(tx=>tx.execute("UPDATE extension_sessions SET revoked_at=? WHERE token_hash=? AND revoked_at IS NULL",[now,hashSecret(token)]));
  return {revoked:true};
}

import { hashSecret, newIdentity, SESSION_TTL_MS, validSecret } from "./identity";
import type { SynoraStore, SqlExecutor } from "./store";

export type Profile = {
  id: string;
  display_name: string;
  avatar_seed: string;
  avatar_url: string | null;
};
type SessionRow = Profile & { expires_at: number };
export class ServiceError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "ServiceError";
  }
}
export async function authenticate(db: SqlExecutor, token: unknown, now = Date.now()): Promise<Profile> {
  if (!validSecret(token)) throw new ServiceError(401, "Session required");
  const [row] = await db.query<Profile>(
    "SELECT p.id,p.display_name,p.avatar_seed,p.avatar_url FROM sessions s JOIN profiles p ON p.id=s.user_id WHERE s.token_hash=? AND s.revoked_at IS NULL AND s.expires_at>?",
    [hashSecret(token), now],
  );
  if (!row) throw new ServiceError(401, "Session expired");
  return row;
}

// Call ONLY from the anonymous bootstrap endpoint. Mutations call authenticate instead.
// Cookie value is returned to the HTTP adapter, never serialized into the profile response.
export async function bootstrapIdentity(db: SynoraStore, token: unknown, now = Date.now()) {
  return db.write(async tx => {
    if (validSecret(token)) {
      const hash = hashSecret(token);
      const [row] = await tx.query<SessionRow>(
        "SELECT p.id,p.display_name,p.avatar_seed,p.avatar_url,s.expires_at FROM sessions s JOIN profiles p ON p.id=s.user_id WHERE s.token_hash=? AND s.revoked_at IS NULL AND s.expires_at>?",
        [hash, now],
      );
      if (row) {
        const { expires_at, ...profile } = row;
        const renew = expires_at - now < 30 * 24 * 3600 * 1000;
        if (renew) await tx.execute("UPDATE sessions SET expires_at=? WHERE token_hash=?", [now + SESSION_TTL_MS, hash]);
        return { profile, cookie: renew ? token : null, created: false };
      }
    }
    const identity = newIdentity(now);
    const p = identity.profile, s = identity.session;
    await tx.execute("INSERT INTO profiles(id,display_name,avatar_seed,created_at,updated_at) VALUES(?,?,?,?,?)",
      [p.id,p.display_name,p.avatar_seed,p.created_at,p.updated_at]);
    await tx.execute("INSERT INTO sessions(token_hash,user_id,created_at,expires_at) VALUES(?,?,?,?)",
      [s.token_hash,s.user_id,s.created_at,s.expires_at]);
    return { profile: { id:p.id, display_name:p.display_name, avatar_seed:p.avatar_seed, avatar_url:null }, cookie:identity.cookie, created:true };
  });
}

export async function renameIdentity(db: SynoraStore, token: unknown, name: unknown, now = Date.now()) {
  if (typeof name !== "string" || !name.trim() || name.trim().length > 40 || /[\p{Cc}]/u.test(name)) {
    throw new ServiceError(400, "Nickname must be 1–40 characters");
  }
  const nickname = name.trim();
  return db.write(async tx => {
    const p = await authenticate(tx,token,now);
    await tx.execute("UPDATE profiles SET display_name=?,updated_at=? WHERE id=?", [nickname,now,p.id]);
    return { ...p, display_name:nickname };
  });
}

import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";

export const SESSION_COOKIE = "__Host-synora";
export const SESSION_TTL_MS = 180 * 24 * 60 * 60 * 1000;
const adjectives = ["Sleepy", "Cosmic", "Neon", "Tiny", "Funky", "Silent", "Wobbly", "Curious", "Velvet", "Midnight", "Dancing", "Mellow"];
const nouns = ["Raptor", "Triceratops", "Stegosaurus", "Penguin", "Toaster", "Noodle", "Moon", "Comet", "Goblin", "Potato", "Axolotl", "Mushroom"];

export function randomNickname() {
  return adjectives[randomInt(adjectives.length)] + nouns[randomInt(nouns.length)];
}

export function hashSecret(secret: string) {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

export function issueSecret() {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashSecret(token) };
}

export function validSecret(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
}

export function newIdentity(now = Date.now()) {
  const id = randomUUID();
  const session = issueSecret();
  return {
    profile: { id, display_name: randomNickname(), avatar_seed: id, created_at: now, updated_at: now },
    session: { token_hash: session.hash, user_id: id, created_at: now, expires_at: now + SESSION_TTL_MS },
    // Only the HTTP layer receives the raw token, never a public profile.
    cookie: session.token,
  };
}

export function sessionCookie(token: string, secure: boolean) {
  if (!validSecret(token)) throw new Error("Invalid session token");
  return {
    name: secure ? SESSION_COOKIE : "synora-dev",
    value: token,
    httpOnly: true,
    secure,
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  };
}

// OWNER is derived from rooms.owner_id, never accepted as a member role.
export type MemberRole = "ADMIN" | "DJ" | "MEMBER";
export type RoomAccess = {
  ownerId: string;
  visibility: "public" | "private";
  allowAdd: boolean;
  allowManage: boolean;
  allowControl: boolean;
};
export type Membership = { role: MemberRole; canManage?: boolean; canControl?: boolean };
export type Restriction = { expiresAt: number | null };

export function roomPermissions(
  room: RoomAccess,
  userId: string | null,
  membership?: Membership,
  restriction?: Restriction,
  now = Date.now(),
) {
  const owner = userId !== null && userId === room.ownerId;
  const blocked = !owner && !!restriction &&
    (restriction.expiresAt === null || restriction.expiresAt > now);
  const member = !!userId && !blocked && (owner || !!membership);
  const admin = member && (owner || membership?.role === "ADMIN");
  const dj = member && (admin || membership?.role === "DJ");
  return {
    owner,
    read: !!userId && !blocked && (room.visibility === "public" || member),
    joinPublic: !!userId && !blocked && room.visibility === "public",
    member,
    add: member && (dj || room.allowAdd),
    manage: member && (dj || room.allowManage || !!membership?.canManage),
    control: member && (dj || room.allowControl || !!membership?.canControl),
    chat: member,
    moderate: admin,
    configure: admin,
    assignAdmin: owner,
    transfer: owner,
    delete: owner,
  };
}

import { randomBytes, createHmac } from "node:crypto";
import { existsSync, writeFileSync, readFileSync } from "node:fs";
const path = "dev/.env";
if (!existsSync(path)) {
  const secret = randomBytes(32).toString("hex");
  const encode = (v) => Buffer.from(JSON.stringify(v)).toString("base64url");
  const body =
    encode({ alg: "HS256", typ: "JWT" }) +
    "." +
    encode({
      role: "anon",
      iss: "supabase",
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 315360000,
    });
  const key =
    body + "." + createHmac("sha256", secret).update(body).digest("base64url");
  writeFileSync(
    path,
    `DEV_DB_PASSWORD=${randomBytes(20).toString("hex")}\nDEV_JWT_SECRET=${secret}\nDEV_SECRET_KEY_BASE=${randomBytes(64).toString("hex")}\nNEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321\nNEXT_PUBLIC_SUPABASE_ANON_KEY=${key}\n`,
    { mode: 0o600 },
  );
}
if (!existsSync(".env.local")) {
  const lines = readFileSync(path, "utf8")
    .split("\n")
    .filter((v) => v.startsWith("NEXT_PUBLIC_"));
  writeFileSync(".env.local", lines.join("\n") + "\n", { mode: 0o600 });
  console.log("Created .env.local for the real, local development backend.");
} else console.log("Preserved existing .env.local.");

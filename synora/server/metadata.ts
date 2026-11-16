import "server-only";
import { ServiceError } from "../core/identity-service";
import type { QueueCandidate } from "../core/queue-service";

// Only a canonical, known provider URL reaches this fetch. A source link never
// instructs the server to fetch an arbitrary host or an audio stream.
export async function resolveMetadata(input: Pick<QueueCandidate,"source"|"playback">): Promise<QueueCandidate> {
  if (input.playback.provider !== "youtube") throw new ServiceError(422,"Playback provider not ready");
  const id = input.playback.externalId;
  const url = new URL("https://www.youtube.com/oembed");
  url.search = new URLSearchParams({url:`https://www.youtube.com/watch?v=${id}`,format:"json"}).toString();
  let response: Response;
  try { response = await fetch(url,{signal:AbortSignal.timeout(4000)}); }
  catch { throw new ServiceError(503,"Music metadata is temporarily unavailable"); }
  if (!response.ok) throw new ServiceError(422,"YouTube match is not available");
  const data = await response.json();
  if (typeof data.title !== "string" || !data.title.trim()) throw new ServiceError(422,"Music metadata unavailable");
  return { ...input, title:data.title.slice(0,200), artist:typeof data.author_name === "string"?data.author_name.slice(0,200):null,
    thumbnail:`https://i.ytimg.com/vi/${id}/hqdefault.jpg`,durationSeconds:null };
}

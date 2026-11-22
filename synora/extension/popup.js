const ORIGIN="https://jamroom-nine.vercel.app";
const $=id=>document.getElementById(id);
const status=(text,kind="")=>{ $("status").textContent=text;$("status").className=kind; };
let current={};
let pendingTimer;

function provider(url) {
  try {
    const u=new URL(url),host=u.hostname.toLowerCase();
    if(u.protocol!=="https:")return null;
    if(["youtube.com","www.youtube.com","m.youtube.com","music.youtube.com","youtu.be"].includes(host))return "YouTube";
    if(host==="open.spotify.com")return "Spotify";
    if(["soundcloud.com","www.soundcloud.com"].includes(host))return "SoundCloud";
    if(host==="music.apple.com")return "Apple Music";
    if(["deezer.com","www.deezer.com"].includes(host))return "Deezer";
    if(host.endsWith(".bandcamp.com"))return "Bandcamp";
  } catch { /* Tab is not a music page. */ }
  return null;
}
function updateSource() {
  const source=provider($("url").value);
  const needsMatch=!!source&&source!=="YouTube";
  $("matchWrap").hidden=!needsMatch;
  $("match").required=needsMatch;
  $("hint").textContent=needsMatch?"Sumber ini disimpan sebagai referensi; pilih video YouTube yang sesuai untuk pemutaran bersama.":source?"Tautan dari "+source+" siap ditambahkan.":"Buka halaman lagu atau tempel tautan musik yang didukung.";
}
async function call(path,body,token) {
  const response=await fetch(ORIGIN+"/api/synora/extension/"+path,{
    method:"POST",credentials:"include",headers:{"Content-Type":"application/json","X-Synora-Extension-Id":chrome.runtime.id,...(token?{Authorization:"Bearer "+token}:{})},body:JSON.stringify(body),
  });
  const data=await response.json();
  if(!response.ok)throw Object.assign(new Error(data.error||"Permintaan gagal"),{status:response.status});
  return data;
}
async function rooms(token) {
  const response=await fetch(ORIGIN+"/api/synora/extension/session",{credentials:"include",headers:{"X-Synora-Extension-Id":chrome.runtime.id,Authorization:"Bearer "+token}});
  const data=await response.json();
  if(!response.ok)throw Object.assign(new Error(data.error||"Koneksi berakhir"),{status:response.status});
  return data;
}
function randomVerifier() {
  const bytes=crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"");
}
async function hash(value) {
  const bytes=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,"0")).join("");
}
async function showConnected(token) {
  const data=await rooms(token);
  current.token=token;
  $("pair").hidden=true;$("send").hidden=false;
  const list=[...data.rooms.owned,...data.rooms.recent];
  const unique=[...new Map(list.map(room=>[room.id,room])).values()];
  $("room").replaceChildren(...unique.map(room=>new Option(room.name+(room.visibility==="private"?" 🔒":""),room.slug)));
  $("submit").disabled=!unique.length;
  status(unique.length?"Terhubung sebagai "+data.profile.display_name:"Terhubung. Gabung ke room terlebih dahulu.",unique.length?"success":"");
  updateSource();
}
async function claim() {
  if(!current.pending)return;
  if(Date.now()>current.pending.expiresAt){await chrome.storage.local.remove("pending");current.pending=null;clearInterval(pendingTimer);status("Kode kedaluwarsa. Hubungkan ulang.","error");$("code").hidden=true;$("retry").hidden=true;return;}
  try {
    const result=await call("pair",{action:"claim",code:current.pending.code,verifier:current.pending.verifier});
    if(result.pending){status("Menunggu persetujuan di halaman Synora…");return;}
    clearInterval(pendingTimer);
    await chrome.storage.local.set({token:result.token,expiresAt:result.expiresAt});
    await chrome.storage.local.remove("pending");current.pending=null;
    await showConnected(result.token);
  } catch(error) {clearInterval(pendingTimer);status(error.message,"error");}
}
async function start() {
  $("connect").disabled=true;status("Membuat kode koneksi…");
  try {
    if(!current.pending) {
      const verifier=randomVerifier();
      const result=await call("pair",{action:"start",verifierHash:await hash(verifier)});
      current.pending={code:result.code,verifier,expiresAt:result.expiresAt};
      await chrome.storage.local.set({pending:current.pending});
    }
    $("code").hidden=false;$("code").textContent=current.pending.code;
    $("retry").hidden=false;
    await chrome.tabs.create({url:ORIGIN+"/synora/connect?code="+encodeURIComponent(current.pending.code)});
    status("Setujui kode di tab Synora, lalu buka popup lagi.");
  } catch(error) {status(error.message,"error");}
  finally {$("connect").disabled=false;}
}
async function init() {
  const [saved,tabs]=await Promise.all([chrome.storage.local.get(["token","expiresAt","pending"]),chrome.tabs.query({active:true,currentWindow:true})]);
  const active=tabs[0]?.url;
  if(active&&provider(active))$("url").value=active;
  updateSource();
  current.pending=saved.pending||null;
  if(saved.token&&saved.expiresAt>Date.now()) {
    try {await showConnected(saved.token);return;}
    catch(error) {
      if(error.status!==401) {status(error.message,"error");return;}
      await chrome.storage.local.remove(["token","expiresAt"]);
    }
  }
  $("pair").hidden=false;
  if(current.pending){$("code").hidden=false;$("code").textContent=current.pending.code;$("retry").hidden=false;await claim();pendingTimer=setInterval(()=>void claim(),4000);}
  else status("Belum terhubung ke Synora.");
}
$("connect").addEventListener("click",()=>void start());
$("retry").addEventListener("click",()=>void claim());
$("url").addEventListener("input",updateSource);
$("send").addEventListener("submit",async event=>{
  event.preventDefault();$("submit").disabled=true;status("Menambahkan lagu…");
  try {
    const result=await call("queue",{slug:$("room").value,url:$("url").value,...($("match").value?{matchUrl:$("match").value}:{})},current.token);
    status("Masuk antrean: "+result.item.title,"success");
  } catch(error) {status(error.message,"error");}
  finally {$("submit").disabled=false;}
});
$("disconnect").addEventListener("click",async()=>{
  try {await fetch(ORIGIN+"/api/synora/extension/session",{method:"DELETE",credentials:"include",headers:{"X-Synora-Extension-Id":chrome.runtime.id,Authorization:"Bearer "+current.token}});}
  finally {await chrome.storage.local.remove(["token","expiresAt","pending"]);current={};$("send").hidden=true;$("pair").hidden=false;status("Koneksi diputus.");}
});
void init().catch(error=>status(error.message,"error"));

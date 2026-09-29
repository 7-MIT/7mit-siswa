// telkom/email server runtime V53 — Cloudflare Pages advanced mode.
// Required secret: HOSTINGER_MAIL_API_KEY
// Frontend JavaScript remains inline in index.html; this file executes server-side only.

const SUPABASE_URL="https://lajzrempjyoqkubkumhb.supabase.co";
const SUPABASE_ANON_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxhanpyZW1wanlvcWt1Ymt1bWhiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ4ODUzNDQsImV4cCI6MjEwMDQ2MTM0NH0.qM1qzhIPin7U1StnPP5n_0xEMRYTdl3Isy1HHahK8dQ";
const HOSTINGER_BASE="https://api.mail.hostinger.com";
const TARGET_MAILBOX="7mit@republikindomaret.com";

const json=(body,status=200)=>new Response(JSON.stringify(body),{
  status,
  headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}
});

const clean=(v,n=12000)=>String(v??"").replace(/\u0000/g,"").trim().slice(0,n);
const normalize=(v)=>clean(v,500).toLowerCase().replace(/\s+/g," ").trim();
const normalizeSubject=(v)=>normalize(v).replace(/^((re|fw|fwd):\s*)+/i,"");
const emailOk=(v)=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean(v,320));

async function supabaseProfile(sessionToken){
  if(!sessionToken)throw Object.assign(new Error("Sesi akun tidak tersedia. Login ulang."),{status:401});
  const r=await fetch(`${SUPABASE_URL}/rest/v1/rpc/email_api_authorized`,{
    method:"POST",
    headers:{
      "Content-Type":"application/json",
      "apikey":SUPABASE_ANON_KEY,
      "Authorization":`Bearer ${SUPABASE_ANON_KEY}`
    },
    body:JSON.stringify({
      p_session_token:sessionToken,
      p_action:"profile",
      p_payload:{}
    })
  });
  const text=await r.text();let data={};
  try{data=text?JSON.parse(text):{}}catch{}
  if(!r.ok||data?.ok===false){
    throw Object.assign(new Error(data?.message||data?.error||"Sesi 7 MIT tidak valid."),{status:r.status||401});
  }
  return data;
}

async function consumeEmailQuota(sessionToken){
  const r=await fetch(`${SUPABASE_URL}/rest/v1/rpc/email_api_authorized`,{
    method:"POST",
    headers:{
      "Content-Type":"application/json",
      "apikey":SUPABASE_ANON_KEY,
      "Authorization":`Bearer ${SUPABASE_ANON_KEY}`
    },
    body:JSON.stringify({
      p_session_token:sessionToken,
      p_action:"consume_external_send",
      p_payload:{}
    })
  });
  const text=await r.text();let data={};
  try{data=text?JSON.parse(text):{}}catch{}
  if(!r.ok||data?.ok===false){
    throw Object.assign(new Error(data?.message||data?.error||text||"Limit Email plan sudah tercapai."),{status:r.status||429});
  }
  return data;
}

async function hostingerFetch(env,path,options={}){
  const token=clean(env.HOSTINGER_MAIL_API_KEY,500);
  if(!token)throw Object.assign(new Error("HOSTINGER_MAIL_API_KEY belum dikonfigurasi sebagai secret di Cloudflare."),{status:503});
  const headers=new Headers(options.headers||{});
  headers.set("Authorization",`Bearer ${token}`);
  headers.set("Accept","application/json");
  if(options.body&&!headers.has("Content-Type"))headers.set("Content-Type","application/json");
  const r=await fetch(HOSTINGER_BASE+path,{...options,headers});
  const text=await r.text();
  let data={};
  try{data=text?JSON.parse(text):{}}catch{data={raw:text.slice(0,1200)}}
  if(!r.ok){
    const message=data?.error||data?.message||`Hostinger Mail API HTTP ${r.status}`;
    throw Object.assign(new Error(message),{status:r.status});
  }
  return {status:r.status,data};
}

async function mailbox(env){
  const me=await hostingerFetch(env,"/api/v1/me");
  const boxes=Array.isArray(me.data?.data?.mailboxes)?me.data.data.mailboxes:[];
  if(!boxes.length)throw Object.assign(new Error("API key Hostinger tidak memiliki mailbox."),{status:503});
  return boxes.find(x=>normalize(x.address)===TARGET_MAILBOX)||boxes[0];
}

async function listFolder(env,box,folder,perPage=60){
  const encoded=encodeURIComponent(folder);
  const r=await hostingerFetch(env,`/api/v1/mailboxes/${encodeURIComponent(box.resourceId)}/folders/${encoded}/messages?page=1&perPage=${perPage}&sort=-uid`);
  return Array.isArray(r.data?.data)?r.data.data:[];
}

function mineSent(messages,profile){
  const name=normalize(profile?.me?.display_name||profile?.me?.displayName||"");
  if(!name)return [];
  return messages.filter(m=>normalize(m?.from?.name)===name);
}

function incomingForMine(inbox,sentMine){
  const messageIds=new Set(sentMine.map(m=>clean(m?.messageId,500)).filter(Boolean));
  const fallback=new Set();
  for(const s of sentMine){
    const recipient=normalize(s?.to?.[0]?.address||"");
    const subject=normalizeSubject(s?.subject||"");
    if(recipient&&subject)fallback.add(`${recipient}|${subject}`);
  }
  return inbox.filter(m=>{
    const inReply=clean(m?.inReplyTo,500);
    if(inReply&&messageIds.has(inReply))return true;
    const sender=normalize(m?.from?.address||"");
    const subject=normalizeSubject(m?.subject||"");
    return Boolean(sender&&subject&&fallback.has(`${sender}|${subject}`));
  });
}

function asUiMessage(m,folder,direction,box){
  const incoming=direction==="external_in";
  const uid=Number(m?.uid)||0;
  const from=clean(m?.from?.address,320);
  const to=clean(m?.to?.[0]?.address,320);
  const unseen=Boolean(m?.unseen);
  return {
    id:`hostinger:${folder}:${uid}`,
    message_key:`hostinger:${folder}:${uid}`,
    thread_key:clean(m?.inReplyTo||m?.messageId||`hostinger-thread-${uid}`,500),
    direction,
    sender_email:incoming?from:(box.address||from),
    recipient_email:incoming?(box.address||to):to,
    subject:clean(m?.subject,300),
    body_text:"",
    source_account_id:null,
    smtp_message_id:clean(m?.messageId,500)||null,
    in_reply_to:clean(m?.inReplyTo,500)||null,
    status:incoming?"received":"sent",
    read_at:incoming&&!unseen?(m?.date||new Date().toISOString()):null,
    received_at:m?.date||new Date().toISOString(),
    ai_category:"External",
    ai_priority:unseen?58:40,
    ai_summary:incoming?"Email eksternal via Hostinger Mail API":"Email terkirim via Hostinger Mail API",
    ai_sort_score:unseen?580:400,
    ai_processed_at:null,
    metadata:{
      transport:"hostinger_mail_api",
      hostinger_folder:folder,
      hostinger_uid:uid,
      body_loaded:false,
      attachments:Array.isArray(m?.attachments)?m.attachments:[]
    }
  };
}

async function ownedExternal(env,profile,folderMode="inbox"){
  const box=await mailbox(env);
  const [sent,inbox]=await Promise.all([
    listFolder(env,box,"INBOX.Sent",80).catch(()=>[]),
    listFolder(env,box,"INBOX",80).catch(()=>[])
  ]);
  const sentMine=mineSent(sent,profile);
  const inboxMine=incomingForMine(inbox,sentMine);

  const rows=[];
  if(folderMode==="sent"||folderMode==="all"){
    rows.push(...sentMine.map(m=>asUiMessage(m,"INBOX.Sent","external_out",box)));
  }
  if(folderMode==="inbox"||folderMode==="all"){
    rows.push(...inboxMine.map(m=>asUiMessage(m,"INBOX","external_in",box)));
  }
  rows.sort((a,b)=>new Date(b.received_at||0).getTime()-new Date(a.received_at||0).getTime());
  return {box,rows,sentMine,inboxMine};
}

async function authorizeRead(env,profile,folder,uid){
  const owned=await ownedExternal(env,profile,"all");
  const id=`hostinger:${folder}:${Number(uid)||0}`;
  const found=owned.rows.find(x=>x.id===id);
  if(!found)throw Object.assign(new Error("Email eksternal ini tidak terkait dengan akun 7 MIT kamu."),{status:403});
  return {...owned,found};
}

async function handleMail(request,env){
  if(request.method!=="POST")return json({ok:false,message:"Metode tidak didukung."},405);
  let body={};
  try{body=await request.json()}catch{}
  const action=clean(body.action,40);
  const session=clean(request.headers.get("x-7mit-session"),100);
  const profile=await supabaseProfile(session);

  if(action==="status"){
    if(!env.HOSTINGER_MAIL_API_KEY){
      return json({ok:true,configured:false,message:"Secret HOSTINGER_MAIL_API_KEY belum dipasang di Cloudflare."});
    }
    try{
      const box=await mailbox(env);
      return json({ok:true,configured:true,mailbox_address:box.address,mailbox_resource_id:box.resourceId});
    }catch(error){
      return json({ok:true,configured:false,message:error.message||"Hostinger Mail API belum siap."});
    }
  }

  if(action==="send"){
    const to=normalize(body.to);
    if(!emailOk(to))throw Object.assign(new Error("Alamat Email eksternal tidak valid."),{status:400});
    const subject=clean(body.subject,300);
    const text=clean(body.body,12000);
    if(!subject&&!text)throw Object.assign(new Error("Subjek dan isi Email tidak boleh sama-sama kosong."),{status:400});

    const box=await mailbox(env);
    const planUsage=await consumeEmailQuota(session);
    const payload={
      to:[to],
      displayName:clean(profile?.me?.display_name||"7 MIT",200),
      subject:subject||"(Tanpa subjek)",
      text
    };

    const ref=body.reply_hostinger;
    if(ref&&Number(ref.uid)>0&&clean(ref.folder,100)){
      payload.inReplyTo={uid:Number(ref.uid),folder:clean(ref.folder,100)};
    }

    const sent=await hostingerFetch(env,`/api/v1/mailboxes/${encodeURIComponent(box.resourceId)}/send`,{
      method:"POST",
      body:JSON.stringify(payload)
    });

    if(sent.status!==204){
      throw Object.assign(new Error(`Hostinger mengembalikan status ${sent.status} saat mengirim.`),{status:502});
    }
    return json({ok:true,transport:"hostinger_mail_api",recipient:to,mailbox_address:box.address,plan_usage:planUsage});
  }

  if(action==="list"||action==="sync"){
    const mode=["inbox","sent","all"].includes(clean(body.folder,20))?clean(body.folder,20):"inbox";
    const owned=await ownedExternal(env,profile,mode);
    return json({
      ok:true,
      configured:true,
      messages:owned.rows,
      imported:owned.inboxMine.length,
      mailbox_address:owned.box.address
    });
  }

  if(action==="read"){
    const folder=clean(body.folder,100);
    const uid=Number(body.uid)||0;
    if(!uid||!["INBOX","INBOX.Sent"].includes(folder)){
      throw Object.assign(new Error("Referensi Email Hostinger tidak valid."),{status:400});
    }
    const owned=await authorizeRead(env,profile,folder,uid);
    const r=await hostingerFetch(env,`/api/v1/mailboxes/${encodeURIComponent(owned.box.resourceId)}/folders/${encodeURIComponent(folder)}/messages/${uid}/text`);
    return json({
      ok:true,
      body_text:clean(r.data?.data?.text,12000),
      body_html:clean(r.data?.data?.html,30000)
    });
  }

  return json({ok:false,message:"Aksi Hostinger Mail API tidak dikenal."},400);
}


async function handleCalendarHolidays(request){
  if(request.method!=="GET"&&request.method!=="HEAD"){
    return new Response("Method Not Allowed",{status:405,headers:{"Allow":"GET, HEAD"}});
  }
  const upstream=await fetch("https://ics.calendarlabs.com/50/009bc6c5/Indonesia_Holidays.ics",{
    headers:{"Accept":"text/calendar,text/plain;q=0.9,*/*;q=0.8"},
    cf:{cacheTtl:21600,cacheEverything:true}
  });
  if(!upstream.ok){
    return new Response("Calendar temporarily unavailable",{status:502,headers:{"Cache-Control":"no-store"}});
  }
  const body=request.method==="HEAD"?null:await upstream.text();
  return new Response(body,{
    status:200,
    headers:{
      "Content-Type":"text/calendar; charset=utf-8",
      "Cache-Control":"public, max-age=21600, stale-while-revalidate=86400",
      "X-Content-Type-Options":"nosniff"
    }
  });
}

export default {
  async fetch(request,env){
    const url=new URL(request.url);
    try{
      if(url.pathname==="/api/hostinger-mail"){
        return await handleMail(request,env);
      }
      if(url.pathname==="/api/calendar-holidays"){
        return await handleCalendarHolidays(request);
      }
      const asset=await env.ASSETS.fetch(request);
      const contentType=String(asset.headers.get("content-type")||"");
      if(contentType.includes("text/html")||url.pathname==="/"||url.pathname.endsWith(".html")){
        const headers=new Headers(asset.headers);
        headers.set("Cache-Control","public, max-age=60, stale-while-revalidate=300");
        headers.delete("Pragma");
        headers.delete("Expires");
        return new Response(asset.body,{status:asset.status,statusText:asset.statusText,headers});
      }
      return asset;
    }catch(error){
      return json({
        ok:false,
        message:clean(error?.message||"Hostinger Mail API mengalami masalah.",500)
      },Number(error?.status||500));
    }
  }
};

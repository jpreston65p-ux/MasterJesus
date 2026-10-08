/* Mensajes integrados de Mi Maestro Jesús. Versión 1.0. */
(function () {
  "use strict";
  const SUPABASE_URL = "https://tysbnwvzbtolgydceovl.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_eqCVCuxR3NgD3wZFtiZHyQ_ndREcQPO";
  const $ = (id) => document.getElementById(id);
  const authCard = $("mjAuth");
  const chatApp = $("mjApp");
  const statusAuth = $("mjAuthFeedback");
  const statusChat = $("mjStatus");
  if (!authCard || !chatApp) return;
  if (!window.supabase || typeof window.supabase.createClient !== "function") {
    showAuthMessage("No se pudo cargar la conexión de mensajería. Comprueba tu Internet y recarga la página.", true);
    return;
  }
  const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: "masterjesus-auth-v1" }
  });
  const state = { me: null, profile: null, contact: null, people: [], latest: new Map(),
    blocked: new Set(), blockedBy: new Set(), messageIds: new Set(), voiceIds:new Set(), voiceChannel:null, channel: null, oldestId: null,
    loadNumber: 0, signedIn: false, searchId: 0 };

  function showAuthMessage(message, error) {
    statusAuth.textContent = message || "";
    statusAuth.classList.toggle("is-error", !!error);
  }
  function showChatMessage(message, error) {
    statusChat.textContent = message || "";
    statusChat.classList.toggle("is-error", !!error);
  }
  function explain(error) {
    const message = String((error && error.message) || error || "");
    if (/invalid login credentials/i.test(message)) return "Apodo o contraseña incorrectos.";
    
    
    if (/password should be at least|password.*6 characters/i.test(message)) return "La contraseña debe contener al menos 6 caracteres.";
    if (/rate limit|too many requests|email rate/i.test(message)) return "Se realizaron demasiados intentos. Prueba más tarde.";
    if (/duplicate key|unique constraint|23505/i.test(message)) return "El nombre de usuario está ocupado. Elige otro.";
    if (/network|failed to fetch|load failed/i.test(message)) return "No hay conexión con el servidor. Revisa Internet.";
    if (/row.level.security|permission denied|42501/i.test(message)) return "No se pudo guardar por los permisos de la cuenta. Prueba cerrar sesión y volver a entrar.";
    return message || "Ocurrió un problema inesperado.";
  }
  function initials(name) { return (name || "?").trim().charAt(0).toUpperCase(); }
  function avatar(name) {
    const el = document.createElement("span"); el.className = "mj-avatar";
    const p=typeof name==="string" ? {display_name:name} : (name||{});
    el.textContent = initials(p.display_name);
    if (!p.avatar_url && !p.theme_color) {const palette=["#176c4b","#7655a2","#d8754e","#286ba0","#aa4f85","#b48b2a","#248580","#ae5260"];let hash=0;for(const c of String(p.id||p.display_name||""))hash=(hash*31+c.charCodeAt(0))>>>0;el.style.background=palette[hash%palette.length];}
    if(p.theme_color && /^#[0-9a-f]{6}$/i.test(p.theme_color))el.style.background=p.theme_color;
    if(p.avatar_url && p.avatar_url.startsWith(SUPABASE_URL+"/storage/v1/object/public/mj-avatars/")){const img=document.createElement("img");img.src=p.avatar_url;img.alt="";img.loading="lazy";el.replaceChildren(img);}
    return el;
  }
  function timeOf(date) {
    try { return new Date(date).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" }); }
    catch (_) { return ""; }
  }
  function dateOf(date) {
    try { return new Date(date).toLocaleDateString("es", { day:"numeric", month:"short" }); }
    catch (_) { return ""; }
  }

  const GUEST_ENDPOINT=SUPABASE_URL+"/functions/v1/mj-guest-entry";
  const guestForm=$("mjGuestForm");
  guestForm.addEventListener("submit",async event=>{
    event.preventDefault();
    const nickname=$("mjGuestNickname").value.trim();
    if(nickname.length<2||nickname.length>40){showAuthMessage("Escribe un apodo de 2 a 40 caracteres.",true);return;}
    const btn=guestForm.querySelector('button[type="submit"]');btn.disabled=true;
    showAuthMessage("Preparando tu chat…");
    try{
      const response=await fetch(GUEST_ENDPOINT,{method:"POST",headers:{"Content-Type":"application/json","apikey":SUPABASE_PUBLISHABLE_KEY},body:JSON.stringify({nickname})});
      const data=await response.json().catch(()=>({error:"Error de conexión con el servidor."}));
      if(!response.ok||!data.email||!data.password)throw Error(data.error||"No se pudo entrar.");
      const {error}=await client.auth.signInWithPassword({email:data.email,password:data.password});
      if(error)throw error;
      guestForm.reset();
      await loadSession();
    }catch(error){showAuthMessage(explain(error),true);}
    finally{btn.disabled=false;}
  });
  $("mjLogout").addEventListener("click", async () => {
    try { await client.auth.signOut(); await clearSession(); } catch(error){showChatMessage(explain(error),true);}
  });
  function signedOutUI() {
    authCard.hidden=false; chatApp.hidden=true;
    $("mjAuth").scrollIntoView({block:"nearest",behavior:"smooth"});
  }
  async function clearSession() {
    state.me=null; state.profile=null; state.contact=null; state.latest.clear();
    if(recorder)stopRecording(true);
    state.people=[]; readState.clear();unreadCounts.clear();updateUnreadUI(); state.signedIn=false; state.blocked.clear(); state.blockedBy.clear();
    if(state.channel) { await client.removeChannel(state.channel); state.channel=null; }
    if(state.voiceChannel){await client.removeChannel(state.voiceChannel);state.voiceChannel=null;}
    signedOutUI();
  }
  async function ensureProfile(user) {
    const {data: existing,error: readError}=await client.from("mj_profiles")
      .select("id,username,display_name,avatar_url,theme_color,bubble_style").eq("id",user.id).maybeSingle();
    if(readError) throw readError;
    if(existing) return existing;
    const meta=user.user_metadata||{};
    const suggested=String(meta.username||"").toLowerCase().replace(/[^a-z0-9_]/g,"").slice(0,24);
    const username=/^[a-z0-9_]{3,24}$/.test(suggested) ? suggested : "usuario_"+user.id.replace(/-/g,"").slice(0,12);
    const display_name=String(meta.display_name||"").trim().slice(0,40)||"Mi perfil";
    let result=await client.from("mj_profiles").insert({id:user.id,username,display_name})
      .select("id,username,display_name,avatar_url,theme_color,bubble_style").single();
    if(result.error && result.error.code==="23505") {
      result=await client.from("mj_profiles").insert({
        id:user.id, username:"usuario_"+user.id.replace(/-/g,"").slice(0,12),display_name
      }).select("id,username,display_name,avatar_url,theme_color,bubble_style").single();
    }
    if(result.error) throw result.error;
    return result.data;
  }
  async function loadSession() {
    const {data,error}=await client.auth.getUser();
    if(error || !data.user) { if(!state.signedIn) signedOutUI(); return; }
    const id=data.user.id;
    if(state.signedIn && state.me===id) return;
    state.me=id; state.signedIn=false;
    try {
      state.profile=await ensureProfile(data.user);
      state.signedIn=true; authCard.hidden=true; chatApp.hidden=false;
      $("mjMeAvatar").replaceChildren(avatar(state.profile));
      $("mjMeName").textContent=state.profile.display_name;
      $("mjMeHandle").textContent="@"+state.profile.username;
      applyTheme(state.profile.theme_color||"#176c4b");
      applyBubbleStyle(state.profile.bubble_style||"rounded");
      await Promise.all([loadBlocks(),loadPeople(),refreshReadState()]);
      subscribeToMessages();
      showChatMessage("");
    } catch(error) {
      showAuthMessage("No se pudo iniciar el chat: "+explain(error),true);
      authCard.hidden=false; chatApp.hidden=true; state.signedIn=false;
    }
  }

  function applyTheme(color){
    const c=/^#[0-9a-fA-F]{6}$/.test(color||"")?color:"#176c4b";
    chatApp.style.setProperty("--mj-accent",c);
    $("mjMyColor").value=c;
    $("mjMeAvatar").replaceChildren(avatar(state.profile));
  }
  $("mjProfileSettings").addEventListener("click",()=>{
    $("mjProfilePanel").hidden=!$("mjProfilePanel").hidden;
    if(!$("mjProfilePanel").hidden){$("mjMyColor").value=state.profile?.theme_color||"#176c4b";$("mjMyNickname").value=state.profile?.display_name||"";$("mjBubbleStyle").value=state.profile?.bubble_style||"rounded";}
  });
  $("mjMyColor").addEventListener("change",async(e)=>{
    if(!state.me||!state.profile)return;
    const color=e.target.value;
    if(!/^#[0-9a-fA-F]{6}$/.test(color))return;
    const {error}=await client.from("mj_profiles").update({theme_color:color}).eq("id",state.me);
    if(error){showChatMessage("No se guardó el color: "+explain(error),true);return;}
    state.profile.theme_color=color;applyTheme(color);showChatMessage("Color guardado.");
  });

  const BUBBLES=["rounded","cloud","comic","pill","glass"];
  function applyBubbleStyle(style){
    const chosen=BUBBLES.includes(style)?style:"rounded";
    chatApp.dataset.bubble=chosen;
    $("mjBubbleStyle").value=chosen;
  }
  $("mjBubbleStyle").addEventListener("change",async e=>{
    const style=e.target.value;
    if(!state.me||!BUBBLES.includes(style))return;
    const {error}=await client.from("mj_profiles").update({bubble_style:style}).eq("id",state.me);
    if(error){showChatMessage("No se guardó el estilo: "+explain(error),true);return;}
    state.profile.bubble_style=style;
    applyBubbleStyle(style);
    showChatMessage("Estilo de burbujas actualizado.");
  });
  $("mjMyPhoto").addEventListener("change",async(e)=>{
    const file=e.target.files?.[0];if(!file||!state.me||!state.profile)return;
    if(!["image/jpeg","image/png","image/webp"].includes(file.type)||file.size>2097152){
      showChatMessage("Selecciona una foto JPG, PNG o WebP de máximo 2 MB.",true);e.target.value="";return;
    }
    const btn=$("mjProfileSettings");btn.disabled=true;showChatMessage("Guardando foto de perfil…");
    try{
      const ext={"image/jpeg":"jpg","image/png":"png","image/webp":"webp"}[file.type];
      const path=state.me+"/avatar-"+crypto.randomUUID()+"."+ext;
      const {error:uploadError}=await client.storage.from("mj-avatars").upload(path,file,{contentType:file.type,upsert:false});
      if(uploadError)throw uploadError;
      const {data}=client.storage.from("mj-avatars").getPublicUrl(path);
      const {error:saveError}=await client.from("mj_profiles").update({avatar_url:data.publicUrl}).eq("id",state.me);
      if(saveError)throw saveError;
      state.profile.avatar_url=data.publicUrl;applyTheme(state.profile.theme_color);
      showChatMessage("Foto de perfil guardada.");
    }catch(error){showChatMessage("No se pudo guardar la foto: "+explain(error),true);}
    finally{btn.disabled=false;e.target.value="";}
  });

  const readState = new Map();
  const unreadCounts = new Map();
  let notificationsEnabled = false;
  function updateUnreadUI(){
    let total=0;unreadCounts.forEach(n=>total+=n);
    $("mjUnreadTotal").textContent=total?total+" sin leer":"Al día";
    document.title=(total?"("+total+") ":"")+"Mi Maestro Jesús";
  }
  async function refreshReadState(){
    if(!state.me)return;
    const {data,error}=await client.from("mj_read_state").select("peer_id,last_read_id").eq("user_id",state.me);
    if(!error){readState.clear();(data||[]).forEach(x=>readState.set(x.peer_id,Number(x.last_read_id)));await refreshUnread();}
  }
  async function refreshUnread(){
    if(!state.me)return;
    const {data,error}=await client.from("mj_messages").select("id,sender_id").eq("recipient_id",state.me).order("id",{ascending:false}).limit(500);
    if(error)return;
    unreadCounts.clear();
    (data||[]).forEach(x=>{if(Number(x.id)>(readState.get(x.sender_id)||0))unreadCounts.set(x.sender_id,(unreadCounts.get(x.sender_id)||0)+1)});
    if(state.contact)unreadCounts.delete(state.contact.id);
    updateUnreadUI();renderPeople();
  }
  async function markRead(contactId){
    if(!state.me||!contactId)return;
    const {data,error}=await client.from("mj_messages").select("id").eq("recipient_id",state.me).eq("sender_id",contactId).order("id",{ascending:false}).limit(1);
    if(error||!data?.length)return;
    const last=Number(data[0].id);
    if(last<=(readState.get(contactId)||0))return;
    const {error:saveError}=await client.from("mj_read_state").upsert({user_id:state.me,peer_id:contactId,last_read_id:last,updated_at:new Date().toISOString()},{onConflict:"user_id,peer_id"});
    if(!saveError){readState.set(contactId,last);unreadCounts.delete(contactId);updateUnreadUI();renderPeople();}
  }
  $("mjNotify").addEventListener("click",async()=>{
    if(!("Notification" in window)){showChatMessage("Este navegador no permite notificaciones.",true);return;}
    const result=await Notification.requestPermission();
    notificationsEnabled=result==="granted";
    $("mjNotify").textContent=notificationsEnabled?"🔔 ✓":"🔕";
    showChatMessage(notificationsEnabled?"Avisos del navegador activados.":"No se han activado los avisos.",!notificationsEnabled);
  });
  $("mjSaveNickname").addEventListener("click",async()=>{
    if(!state.me||!state.profile)return;
    const name=$("mjMyNickname").value.trim();
    if(name.length<2||name.length>40){showChatMessage("El apodo debe tener entre 2 y 40 caracteres.",true);return;}
    const {error}=await client.from("mj_profiles").update({display_name:name}).eq("id",state.me);
    if(error){showChatMessage("No se pudo guardar el apodo: "+explain(error),true);return;}
    state.profile.display_name=name;
    $("mjMeName").textContent=name;
    $("mjMeAvatar").replaceChildren(avatar(state.profile));
    showChatMessage("Apodo actualizado.");
  });
  async function loadBlocks() {
    if(!state.me)return;
    const id=state.me;
    const {data,error}=await client.from("mj_blocks")
      .select("blocker_id,blocked_id")
      .or("blocker_id.eq."+id+",blocked_id.eq."+id);
    if(error) { showChatMessage(explain(error),true); return; }
    state.blocked=new Set(data.filter(x=>x.blocker_id===id).map(x=>x.blocked_id));
    state.blockedBy=new Set(data.filter(x=>x.blocked_id===id).map(x=>x.blocker_id));
    updateComposer();
  }
  async function loadPeople(filter="") {
    if(!state.me) return;
    const token=++state.searchId;
    const id=state.me;
    const {data: recent,error: errRecent}=await client.from("mj_messages")
      .select("id,sender_id,recipient_id,body,created_at")
      .or("sender_id.eq."+id+",recipient_id.eq."+id)
      .order("id",{ascending:false}).limit(300);
    if(token!==state.searchId || state.me!==id)return;
    if(errRecent){showChatMessage(explain(errRecent),true);return;}
    const unique=new Set(); state.latest.clear();
    (recent||[]).forEach(row=>{
      const other=row.sender_id===id?row.recipient_id:row.sender_id;
      if(!unique.has(other)){unique.add(other);state.latest.set(other,row);}
    });
    let query=client.from("mj_profiles").select("id,username,display_name,avatar_url,theme_color,bubble_style").neq("id",id).order("username").limit(80);
    const clean=filter.trim().toLowerCase().replace(/[^a-z0-9_]/g,"").slice(0,24);
    if(clean.length>=2)query=query.ilike("username","%"+clean+"%");
    const {data:people,error}=await query;
    if(token!==state.searchId || state.me!==id)return;
    if(error){showChatMessage(explain(error),true);return;}
    const lookup=new Map((people||[]).map(p=>[p.id,p]));
    if(unique.size) {
      const {data:past}=await client.from("mj_profiles").select("id,username,display_name,avatar_url,theme_color,bubble_style").in("id",[...unique].slice(0,300));
      (past||[]).forEach(p=>lookup.set(p.id,p));
    }
    let list=[...lookup.values()];
    if(clean.length>=2)list=list.filter(p=>p.username.includes(clean) || p.display_name.toLowerCase().includes(filter.trim().toLowerCase()));
    list.sort((a,b)=>{
      const ma=state.latest.get(a.id),mb=state.latest.get(b.id);
      return (mb?.id||0)-(ma?.id||0)||a.username.localeCompare(b.username);
    });
    state.people=list;
    renderPeople();
    if(state.contact) {
      const renewed=lookup.get(state.contact.id);
      if(renewed)state.contact=renewed;
    }
  }
  function renderPeople() {
    const list=$("mjPeople");list.replaceChildren();
    if(!state.people.length){
      const empty=document.createElement("p");empty.className="mj-empty-people";
      empty.textContent=$("mjFind").value.trim()
        ?"No encontramos usuarios con esa búsqueda."
        :"Aún no hay otros perfiles. Invita a alguien a crear su cuenta para conversar.";
      list.append(empty);return;
    }
    state.people.forEach(person=>{
      const btn=document.createElement("button");btn.type="button";btn.className="mj-person";
      if(state.contact?.id===person.id)btn.classList.add("is-selected");
      btn.append(avatar(person));
      const texts=document.createElement("span");texts.className="mj-person-copy";
      const name=document.createElement("strong");name.textContent=person.display_name;
      const preview=document.createElement("small");const latest=state.latest.get(person.id);
      preview.textContent=latest?(latest.sender_id===state.me?"Tú: ":"")+latest.body:"@"+person.username;
      texts.append(name,preview);btn.append(texts);
      if(latest){const at=document.createElement("time");at.className="mj-person-time";
        at.textContent=dateOf(latest.created_at);btn.append(at);}
      const unread=unreadCounts.get(person.id)||0;
      if(unread){const pill=document.createElement("span");pill.className="mj-unread-badge";pill.textContent=unread>99?"99+":String(unread);btn.append(pill);}
      btn.addEventListener("click",()=>selectContact(person));list.append(btn);
    });
  }
  $("mjFind").addEventListener("input",()=>{
    clearTimeout($("mjFind")._mjTimer);
    $("mjFind")._mjTimer=setTimeout(()=>loadPeople($("mjFind").value),300);
  });
  $("mjRefreshPeople").addEventListener("click",()=>loadPeople($("mjFind").value));
  $("mjBack").addEventListener("click",()=>chatApp.classList.remove("mj-show-thread"));
  async function selectContact(person) {
    if(recorder)stopRecording(true);
    state.contact=person; state.loadNumber++;
    chatApp.classList.add("mj-show-thread");
    $("mjPartnerAvatar").replaceChildren(avatar(person));
    $("mjPartnerName").textContent=person.display_name;
    $("mjPartnerHandle").textContent="@"+person.username;
    if ($("mjThreadHint")) $("mjThreadHint").hidden=true;
    $("mjThreadActions").hidden=false;
    $("mjCompose").hidden=false;
    $("mjSafetyNote").hidden=false;
    $("mjMessages").replaceChildren();
    state.messageIds.clear();state.voiceIds.clear();state.oldestId=null;
    renderPeople();updateComposer();
    await loadConversation();
    await loadVoices(person.id,state.loadNumber);
    await markRead(person.id);
  }
  function updateComposer() {
    const contact=state.contact, blocked=contact && state.blocked.has(contact.id);
    const blockedBy=contact && state.blockedBy.has(contact.id);
    const disabled=!contact||blocked||blockedBy||!state.signedIn;
    $("mjText").disabled=!!disabled;
    $("mjSend").disabled=!!disabled;
    $("mjVoiceButton").disabled=!!disabled;
    $("mjVoiceCancel").hidden=!recorder;
    $("mjBlock").textContent=blocked?"Desbloquear":"Bloquear";
    $("mjText").placeholder=blocked?"Has bloqueado a esta persona":blockedBy?
      "Esta persona no puede recibir tus mensajes":"Escribe un mensaje…";
  }
  function msgNode(item){
    const mine=item.sender_id===state.me;
    const wrap=document.createElement("div");wrap.className="mj-msg"+(mine?" is-mine":"");
    const bubble=document.createElement("div");bubble.className="mj-bubble";bubble.textContent=item.body;
    const time=document.createElement("time");time.dateTime=item.created_at;time.textContent=timeOf(item.created_at);
    wrap.dataset.at=item.created_at;
    wrap.append(bubble,time);return wrap;
  }
  function emptyThread(message) {
    const el=document.createElement("div");el.className="mj-thread-empty";
    el.textContent=message;return el;
  }
  async function loadConversation(beforeId=null) {
    const contact=state.contact, me=state.me, ticket=state.loadNumber;
    if(!contact||!me)return;
    const myId=me,other=contact.id;
    let query=client.from("mj_messages").select("id,sender_id,recipient_id,body,created_at")
      .or("and(sender_id.eq."+myId+",recipient_id.eq."+other+"),and(sender_id.eq."+other+",recipient_id.eq."+myId+")")
      .order("id",{ascending:false}).limit(75);
    if(beforeId)query=query.lt("id",beforeId);
    const {data,error}=await query;
    if(ticket!==state.loadNumber||state.contact?.id!==other)return;
    if(error){showChatMessage(explain(error),true);return;}
    const rows=(data||[]).reverse();
    const parent=$("mjMessages");
    if(!beforeId){parent.replaceChildren();state.messageIds.clear();}
    const prevHeight=parent.scrollHeight;
    const oldScroll=parent.scrollTop;
    const fragment=document.createDocumentFragment();
    rows.forEach(row=>{if(!state.messageIds.has(row.id)){
      state.messageIds.add(row.id);fragment.append(msgNode(row));
    }});
    const previousMore=$("mjLoadOlder");
    if(previousMore)previousMore.remove();
    if(beforeId)parent.prepend(fragment);else parent.append(fragment);
    state.oldestId=rows.length?rows[0].id:beforeId;
    if((data||[]).length===75&&state.oldestId){
      const more=document.createElement("button");more.type="button";
      more.id="mjLoadOlder";more.className="mj-muted-btn";more.textContent="Mostrar mensajes anteriores";
      more.addEventListener("click",()=>loadConversation(state.oldestId));parent.prepend(more);
    }
    if(!parent.querySelector(".mj-msg")&&!beforeId)parent.append(emptyThread("Todavía no hay mensajes. ¡Empieza saludando!"));
    if(beforeId){parent.scrollTop=oldScroll+(parent.scrollHeight-prevHeight);}
    else {parent.scrollTop=parent.scrollHeight;}
  }
  function addMessage(row) {
    if(!row||state.messageIds.has(row.id)||!state.contact)return;
    const id=state.contact.id;
    if(!((row.sender_id===state.me&&row.recipient_id===id)||
      (row.sender_id===id&&row.recipient_id===state.me)))return;
    const parent=$("mjMessages"), empty=parent.querySelector(".mj-thread-empty");
    if(empty)empty.remove();
    state.messageIds.add(row.id);parent.append(msgNode(row));parent.scrollTop=parent.scrollHeight;
  }

  let recorder=null,recordStream=null,recordChunks=[],recordStart=0,recordTimer=null;
  const voiceStorage=client.storage.from("mj-voice");
  const VOICE_MAX_SECONDS=60;
  const VOICE_MAX_BYTES=6291456;
  function secondsText(n){const x=Math.max(0,Math.round(n));return Math.floor(x/60)+":"+String(x%60).padStart(2,"0");}
  function stopRecording(cancel=false){
    if(!recorder)return;
    recorder._cancel=cancel;
    if(recorder.state!=="inactive")recorder.stop();
  }
  async function showVoice(item){
    if(state.voiceIds.has(item.id)||!state.contact)return;
    const other=state.contact.id;
    if(!((item.sender_id===state.me&&item.recipient_id===other)||(item.sender_id===other&&item.recipient_id===state.me)))return;
    state.voiceIds.add(item.id);
    const wrap=document.createElement("div");
    wrap.className="mj-msg mj-voice-msg"+(item.sender_id===state.me?" is-mine":"");
    wrap.dataset.at=item.created_at;
    const bubble=document.createElement("div");bubble.className="mj-bubble mj-voice-bubble";
    const play=document.createElement("button");play.type="button";play.className="mj-voice-play";play.textContent="▶";
    const duration=document.createElement("span");duration.textContent="🎤 "+secondsText(item.duration_seconds);
    const audio=document.createElement("audio");audio.preload="none";audio.controls=true;audio.hidden=true;
    play.addEventListener("click",async()=>{
      if(!audio.src){
        play.disabled=true;
        const {data,error}=await voiceStorage.createSignedUrl(item.storage_path,300);
        play.disabled=false;
        if(error){showChatMessage("No se pudo abrir el audio: "+explain(error),true);return;}
        audio.src=data.signedUrl;
      }
      audio.hidden=false;play.hidden=true;
      audio.play().catch(()=>{showChatMessage("Pulsa reproducir en el control de audio.",true);});
    });
    bubble.append(play,duration,audio);wrap.append(bubble);
    const t=document.createElement("time");t.textContent=timeOf(item.created_at);wrap.append(t);
    $("mjMessages").querySelector(".mj-thread-empty")?.remove();
    $("mjMessages").append(wrap);
  }
  async function loadVoices(peer,ticket){
    const {data,error}=await client.from("mj_voice_messages")
      .select("id,sender_id,recipient_id,storage_path,duration_seconds,created_at")
      .or("and(sender_id.eq."+state.me+",recipient_id.eq."+peer+"),and(sender_id.eq."+peer+",recipient_id.eq."+state.me+")")
      .order("created_at",{ascending:false}).limit(75);
    if(error){showChatMessage("No se pudieron cargar los audios: "+explain(error),true);return;}
    if(ticket!==state.loadNumber||state.contact?.id!==peer)return;
    for(const item of (data||[]).reverse())await showVoice(item);
    const root=$("mjMessages");
    const list=Array.from(root.querySelectorAll(".mj-msg")).sort((a,b)=>String(a.dataset.at).localeCompare(String(b.dataset.at)));
    list.forEach(node=>root.append(node));root.scrollTop=root.scrollHeight;
  }
  $("mjVoiceCancel").addEventListener("click",()=>stopRecording(true));
  $("mjVoiceButton").addEventListener("click",async()=>{
    if(recorder){stopRecording();return;}
    if(!state.contact||!state.me||state.blocked.has(state.contact.id)||state.blockedBy.has(state.contact.id))return;
    if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder){showChatMessage("Este navegador no permite grabar audio.",true);return;}
    const formats=["audio/webm;codecs=opus","audio/webm","audio/mp4","audio/ogg"];
    const mime=formats.find(x=>MediaRecorder.isTypeSupported(x));
    if(!mime){showChatMessage("Tu navegador no ofrece un formato de audio compatible.",true);return;}
    const recipient=state.contact.id;
    try{
      recordStream=await navigator.mediaDevices.getUserMedia({audio:true});
      recordChunks=[];recordStart=Date.now();
      recorder=new MediaRecorder(recordStream,{mimeType:mime,audioBitsPerSecond:64000});
      const active=recorder;
      active.ondataavailable=e=>{if(e.data?.size)recordChunks.push(e.data);};
      active.onstop=async()=>{
        clearInterval(recordTimer);recordTimer=null;
        recordStream?.getTracks().forEach(x=>x.stop());recordStream=null;
        const cancelled=active._cancel;
        const seconds=Math.max(1,Math.min(VOICE_MAX_SECONDS,Math.ceil((Date.now()-recordStart)/1000)));
        recorder=null;$("mjVoiceButton").textContent="🎙️";$("mjVoiceTimer").hidden=true;$("mjVoiceCancel").hidden=true;
        if(cancelled){recordChunks=[];updateComposer();return;}
        const file=new Blob(recordChunks,{type:mime.split(";")[0]});recordChunks=[];
        if(file.size<100||file.size>VOICE_MAX_BYTES){showChatMessage("El audio debe durar menos de 60 s y pesar menos de 6 MB.",true);updateComposer();return;}
        const ext=mime.includes("webm")?"webm":mime.includes("mp4")?"mp4":"ogg";
        const path=state.me+"/"+crypto.randomUUID()+"."+ext;
        showChatMessage("Enviando audio…");
        try{
          const {error:uploadError}=await voiceStorage.upload(path,file,{contentType:file.type,upsert:false});
          if(uploadError)throw uploadError;
          const {data,error}=await client.from("mj_voice_messages")
            .insert({sender_id:state.me,recipient_id:recipient,storage_path:path,duration_seconds:seconds})
            .select("id,sender_id,recipient_id,storage_path,duration_seconds,created_at").single();
          if(error)throw error;
          if(state.contact?.id===recipient){await showVoice(data);$("mjMessages").scrollTop=$("mjMessages").scrollHeight;}
          showChatMessage("Audio enviado.");
        }catch(error){showChatMessage("No se pudo enviar el audio: "+explain(error),true);}
        updateComposer();
      };
      active.onerror=()=>{showChatMessage("Error al grabar el audio.",true);stopRecording(true);};
      active.start(250);
      $("mjVoiceButton").textContent="■";$("mjVoiceCancel").hidden=false;
      $("mjVoiceTimer").hidden=false;
      $("mjVoiceTimer").textContent="🔴 0:00";
      recordTimer=setInterval(()=>{
        const elapsed=Math.floor((Date.now()-recordStart)/1000);
        $("mjVoiceTimer").textContent="🔴 "+secondsText(elapsed);
        if(elapsed>=VOICE_MAX_SECONDS)stopRecording();
      },300);
    }catch(error){recordStream?.getTracks().forEach(x=>x.stop());recordStream=null;showChatMessage("No se pudo acceder al micrófono: "+explain(error),true);}
  });
  $("mjCompose").addEventListener("submit",async(event)=>{
    event.preventDefault();
    const text=$("mjText").value.trim(), other=state.contact,me=state.me;
    if(!text||!other||!me||state.blocked.has(other.id)||state.blockedBy.has(other.id))return;
    if(text.length>2000){showChatMessage("El mensaje supera los 2000 caracteres.",true);return;}
    $("mjSend").disabled=true;showChatMessage("");
    try{
      const {data,error}=await client.from("mj_messages")
        .insert({sender_id:me,recipient_id:other.id,body:text})
        .select("id,sender_id,recipient_id,body,created_at").single();
      if(error)throw error;
      if(state.contact?.id===other.id){addMessage(data);$("mjText").value="";}
      state.latest.set(other.id,data);
      renderPeople();
    }catch(error){showChatMessage(explain(error),true);}
    finally{updateComposer();}
  });
  $("mjText").addEventListener("keydown",(event)=>{
    if(event.key==="Enter"&&!event.shiftKey&&!event.isComposing){
      event.preventDefault();$("mjCompose").requestSubmit();
    }
  });
  $("mjBlock").addEventListener("click",async()=>{
    const other=state.contact;if(!other||!state.me)return;
    const blocked=state.blocked.has(other.id);
    const answer=window.confirm(blocked?
      "¿Quieres desbloquear a "+other.display_name+"?":
      "¿Bloquear a "+other.display_name+"? No podrán enviarse mensajes mientras exista el bloqueo.");
    if(!answer)return;
    try{
      const req=blocked
        ?client.from("mj_blocks").delete().eq("blocker_id",state.me).eq("blocked_id",other.id)
        :client.from("mj_blocks").insert({blocker_id:state.me,blocked_id:other.id});
      const {error}=await req;if(error)throw error;
      await loadBlocks();
      showChatMessage(blocked?"Persona desbloqueada.":"Persona bloqueada.");
    }catch(error){showChatMessage(explain(error),true);}
  });
  $("mjReport").addEventListener("click",async()=>{
    const other=state.contact;if(!other||!state.me)return;
    const reason=window.prompt("Explica por qué deseas reportar a esta persona (5 a 500 caracteres):");
    if(reason===null)return;
    const value=reason.trim();
    if(value.length<5||value.length>500){showChatMessage("El reporte debe tener entre 5 y 500 caracteres.",true);return;}
    try{
      const {error}=await client.from("mj_reports").insert({reporter_id:state.me,reported_id:other.id,reason:value});
      if(error)throw error;
      showChatMessage("Reporte recibido. Será necesario revisarlo desde la administración.");
    }catch(error){showChatMessage(explain(error),true);}
  });
  function subscribeToMessages() {
    if(state.channel)client.removeChannel(state.channel);
    if(state.voiceChannel)client.removeChannel(state.voiceChannel);
    state.voiceChannel=client.channel("mj-voices-"+state.me).on("postgres_changes",{event:"INSERT",schema:"public",table:"mj_voice_messages"},async payload=>{
      const v=payload.new;
      if(v&&(v.sender_id===state.me||v.recipient_id===state.me)){await showVoice(v);if(v.recipient_id===state.me)showChatMessage("Nuevo mensaje de voz.");}
    }).subscribe();
    state.channel=client.channel("mj-direct-messages-"+state.me)
      .on("postgres_changes",{event:"INSERT",schema:"public",table:"mj_messages"},(payload)=>{
        const row=payload.new;if(!row)return;
        if(row.sender_id!==state.me&&row.recipient_id!==state.me)return;
        addMessage(row);
        const id=row.sender_id===state.me?row.recipient_id:row.sender_id;
        if(row.recipient_id===state.me){
          if(state.contact?.id===id && !document.hidden)markRead(id);
          else {unreadCounts.set(id,(unreadCounts.get(id)||0)+1);updateUnreadUI();}
          if(notificationsEnabled && (document.hidden||state.contact?.id!==id) && Notification.permission==="granted"){
            const person=state.people.find(p=>p.id===id);
            const n=new Notification("Nuevo mensaje · "+(person?.display_name||"Mi Maestro Jesús"),{body:"Tienes un mensaje nuevo.",tag:"mj-message-"+id});
            n.onclick=()=>{window.focus();document.getElementById("mensajes")?.scrollIntoView();if(person)selectContact(person);n.close();};
          }
        }
        const prior=state.latest.get(id);
        if(!prior||Number(row.id)>Number(prior.id))state.latest.set(id,row);
        renderPeople();
        // Restore history if the other participant is not in the current search results.
        if(!state.people.some(person=>person.id===id))loadPeople($("mjFind").value);
      })
      .subscribe((status)=>{
        if(status==="CHANNEL_ERROR"||status==="TIMED_OUT")showChatMessage(
          "La conexión en tiempo real se interrumpió. Los mensajes seguirán guardándose; actualiza para reconectar.",true);
      });
  }
  client.auth.onAuthStateChange((event)=>{
    if(event==="SIGNED_OUT") {
      queueMicrotask(()=>clearSession());
    } else if(event==="SIGNED_IN"||event==="TOKEN_REFRESHED") {
      queueMicrotask(()=>loadSession());
    }
  });
  loadSession().catch(error=>showAuthMessage(explain(error),true));
}());
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
    blocked: new Set(), blockedBy: new Set(), messageIds: new Set(), channel: null, oldestId: null,
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
    el.textContent = initials(name); return el;
  }
  function timeOf(date) {
    try { return new Date(date).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" }); }
    catch (_) { return ""; }
  }
  function dateOf(date) {
    try { return new Date(date).toLocaleDateString("es", { day:"numeric", month:"short" }); }
    catch (_) { return ""; }
  }

  const NICKNAME_DOMAIN="users.masterjesus.invalid";
  const REGISTER_ENDPOINT=SUPABASE_URL+"/functions/v1/mj-register-nickname";
  function setMode(mode) {
    $("mjLoginTab").setAttribute("aria-selected",String(mode==="login"));
    $("mjSignupTab").setAttribute("aria-selected",String(mode==="signup"));
    $("mjLoginForm").hidden=mode!=="login";
    $("mjSignupForm").hidden=mode!=="signup";
    showAuthMessage("");
  }
  $("mjLoginTab").addEventListener("click",()=>setMode("login"));
  $("mjSignupTab").addEventListener("click",()=>setMode("signup"));
  function buttonBusy(form,busy){
    const btn=form.querySelector('button[type="submit"]');
    if(btn)btn.disabled=busy;
  }
  $("mjLoginForm").addEventListener("submit",async event=>{
    event.preventDefault();
    const form=event.currentTarget; buttonBusy(form,true);
    showAuthMessage("Iniciando sesión…");
    try{
      const nickname=$("mjLoginNickname").value.trim().toLowerCase();
      if(!/^[a-z0-9_]{3,24}$/.test(nickname))throw Error("Escribe un apodo válido.");
      const password=$("mjLoginPassword").value;
      const {error}=await client.auth.signInWithPassword({email:nickname+"@"+NICKNAME_DOMAIN,password});
      if(error)throw Error("Apodo o contraseña incorrectos.");
      await loadSession();
    }catch(error){showAuthMessage(explain(error),true);}
    finally{buttonBusy(form,false);}
  });
  $("mjSignupForm").addEventListener("submit",async event=>{
    event.preventDefault(); const form=event.currentTarget;
    buttonBusy(form,true); showAuthMessage("Creando tu cuenta…");
    try{
      const username=$("mjSignupUsername").value.trim().toLowerCase();
      const display_name=$("mjSignupName").value.trim();
      const password=$("mjSignupPassword").value;
      if(!/^[a-z0-9_]{3,24}$/.test(username))throw Error("El apodo debe tener entre 3 y 24 letras, números o guiones bajos.");
      if(display_name.length<2||display_name.length>40)throw Error("El nombre visible debe tener entre 2 y 40 caracteres.");
      if(password.length<10||password.length>128)throw Error("Utiliza una contraseña de 10 a 128 caracteres.");
      const response=await fetch(REGISTER_ENDPOINT,{
        method:"POST",headers:{"Content-Type":"application/json","apikey":SUPABASE_PUBLISHABLE_KEY},
        body:JSON.stringify({username,display_name,password})
      });
      const result=await response.json().catch(()=>({error:"Respuesta inválida del servidor."}));
      if(!response.ok||!result.ok)throw Error(result.error||"No se pudo crear tu cuenta.");
      const {error}=await client.auth.signInWithPassword({
        email:username+"@"+NICKNAME_DOMAIN,password
      });
      if(error)throw Error("Cuenta creada. Entra con tu apodo y contraseña.");
      $("mjSignupPassword").value="";
      await loadSession();
    }catch(error){showAuthMessage(explain(error),true);}
    finally{buttonBusy(form,false);}
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
    state.people=[]; state.signedIn=false; state.blocked.clear(); state.blockedBy.clear();
    if(state.channel) { await client.removeChannel(state.channel); state.channel=null; }
    signedOutUI();
  }
  async function ensureProfile(user) {
    const {data: existing,error: readError}=await client.from("mj_profiles")
      .select("id,username,display_name").eq("id",user.id).maybeSingle();
    if(readError) throw readError;
    if(existing) return existing;
    const meta=user.user_metadata||{};
    const suggested=String(meta.username||"").toLowerCase().replace(/[^a-z0-9_]/g,"").slice(0,24);
    const username=/^[a-z0-9_]{3,24}$/.test(suggested) ? suggested : "usuario_"+user.id.replace(/-/g,"").slice(0,12);
    const display_name=String(meta.display_name||"").trim().slice(0,40)||"Mi perfil";
    let result=await client.from("mj_profiles").insert({id:user.id,username,display_name})
      .select("id,username,display_name").single();
    if(result.error && result.error.code==="23505") {
      result=await client.from("mj_profiles").insert({
        id:user.id, username:"usuario_"+user.id.replace(/-/g,"").slice(0,12),display_name
      }).select("id,username,display_name").single();
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
      $("mjMeAvatar").replaceChildren(avatar(state.profile.display_name));
      $("mjMeName").textContent=state.profile.display_name;
      $("mjMeHandle").textContent="@"+state.profile.username;
      await Promise.all([loadBlocks(),loadPeople()]);
      subscribeToMessages();
      showChatMessage("");
    } catch(error) {
      showAuthMessage("No se pudo iniciar el chat: "+explain(error),true);
      authCard.hidden=false; chatApp.hidden=true; state.signedIn=false;
    }
  }
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
    let query=client.from("mj_profiles").select("id,username,display_name").neq("id",id).order("username").limit(80);
    const clean=filter.trim().toLowerCase().replace(/[^a-z0-9_]/g,"").slice(0,24);
    if(clean.length>=2)query=query.ilike("username","%"+clean+"%");
    const {data:people,error}=await query;
    if(token!==state.searchId || state.me!==id)return;
    if(error){showChatMessage(explain(error),true);return;}
    const lookup=new Map((people||[]).map(p=>[p.id,p]));
    if(unique.size) {
      const {data:past}=await client.from("mj_profiles").select("id,username,display_name").in("id",[...unique].slice(0,300));
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
      btn.append(avatar(person.display_name));
      const texts=document.createElement("span");texts.className="mj-person-copy";
      const name=document.createElement("strong");name.textContent=person.display_name;
      const preview=document.createElement("small");const latest=state.latest.get(person.id);
      preview.textContent=latest?(latest.sender_id===state.me?"Tú: ":"")+latest.body:"@"+person.username;
      texts.append(name,preview);btn.append(texts);
      if(latest){const at=document.createElement("time");at.className="mj-person-time";
        at.textContent=dateOf(latest.created_at);btn.append(at);}
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
    state.contact=person; state.loadNumber++;
    chatApp.classList.add("mj-show-thread");
    $("mjPartnerAvatar").replaceChildren(avatar(person.display_name));
    $("mjPartnerName").textContent=person.display_name;
    $("mjPartnerHandle").textContent="@"+person.username;
    if ($("mjThreadHint")) $("mjThreadHint").hidden=true;
    $("mjThreadActions").hidden=false;
    $("mjCompose").hidden=false;
    $("mjSafetyNote").hidden=false;
    $("mjMessages").replaceChildren();
    state.messageIds.clear();state.oldestId=null;
    renderPeople();updateComposer();
    await loadConversation();
  }
  function updateComposer() {
    const contact=state.contact, blocked=contact && state.blocked.has(contact.id);
    const blockedBy=contact && state.blockedBy.has(contact.id);
    const disabled=!contact||blocked||blockedBy||!state.signedIn;
    $("mjText").disabled=!!disabled;
    $("mjSend").disabled=!!disabled;
    $("mjBlock").textContent=blocked?"Desbloquear":"Bloquear";
    $("mjText").placeholder=blocked?"Has bloqueado a esta persona":blockedBy?
      "Esta persona no puede recibir tus mensajes":"Escribe un mensaje…";
  }
  function msgNode(item){
    const mine=item.sender_id===state.me;
    const wrap=document.createElement("div");wrap.className="mj-msg"+(mine?" is-mine":"");
    const bubble=document.createElement("div");bubble.className="mj-bubble";bubble.textContent=item.body;
    const time=document.createElement("time");time.dateTime=item.created_at;time.textContent=timeOf(item.created_at);
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
    state.channel=client.channel("mj-direct-messages-"+state.me)
      .on("postgres_changes",{event:"INSERT",schema:"public",table:"mj_messages"},(payload)=>{
        const row=payload.new;if(!row)return;
        if(row.sender_id!==state.me&&row.recipient_id!==state.me)return;
        addMessage(row);
        const id=row.sender_id===state.me?row.recipient_id:row.sender_id;
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
  setMode("login");
  loadSession().catch(error=>showAuthMessage(explain(error),true));
}());
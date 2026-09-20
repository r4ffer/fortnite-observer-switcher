const socket=io();
const screensEl=document.getElementById('screens'),preview=document.getElementById('preview');
const selectedText=document.getElementById('selectedText'),execute=document.getElementById('execute');
const obsStatus=document.getElementById('obsStatus'),modal=document.getElementById('settingsModal');
const connectionList=document.getElementById('connectionList'),obsUrl=document.getElementById('obsUrl');
const SCREEN_COUNT=8;
const online=Object.fromEntries(Array.from({length:SCREEN_COUNT},(_,i)=>[i+1,false]));
const players={};
// seqA/seqB drive the click-cycle: 1st click -> single mode showing seqA; 2nd click -> dual mode,
// seqA on the left and seqB on the right; a 3rd click resets the cycle, becoming the new seqA (single mode).
let seqA=null,seqB=null;
let previewCleared=false;
const rtcConfig={iceServers:[{urls:'stun:stun.l.google.com:19302'},{urls:'stun:stun1.l.google.com:19302'}],iceCandidatePoolSize:10,bundlePolicy:'max-bundle',rtcpMuxPolicy:'require'};

const DEFAULT_KEYBINDS={instantModifier:'Shift',dualModifier:'Control',clearKey:'R',executeKey:'Enter',screenKeys:['1','2','3','4','5','6','7','8']};
let keybinds={...DEFAULT_KEYBINDS};
try{const saved=JSON.parse(localStorage.getItem('fos-keybinds')||'null');if(saved)keybinds={...keybinds,...saved};}catch(_){}
function saveKeybinds(){localStorage.setItem('fos-keybinds',JSON.stringify(keybinds));}
function modifierPressed(event,name){return name==='Shift'?event.shiftKey:name==='Control'?event.ctrlKey:name==='Alt'?event.altKey:false;}
function modifierLabel(name){return name==='Control'?'Ctrl':name==='Shift'?'Shift':name==='Alt'?'Alt':'なし';}

// Optional background image for 2-screen (dual) preview - same file OBS looks for (back.png / back.jpeg / back.jpg,
// any case, in public/). The server resolves the actual filename case-insensitively so this doesn't have to guess.
let dualBgUrl=null;
fetch('/api/dual-background').then(r=>r.json()).then(({file})=>{
 dualBgUrl=file;
 if(file&&seqA&&seqB)renderPreview();
}).catch(()=>{});

for(let i=1;i<=SCREEN_COUNT;i++){
 const card=document.createElement('div');card.className='screen-card';
 card.innerHTML=`<div class="thumb"><video id="thumb-${i}" autoplay muted playsinline></video><div id="offline-${i}" class="offline-card">未接続</div></div><div class="card-name">画面${i}</div>`;
 screensEl.appendChild(card);
 players[i]={id:String(i),card,video:card.querySelector('video'),pc:null,viewerId:null,source:null,remoteCandidates:[],localCandidates:[],stream:null,retryTimer:null,disconnectTimer:null,blackTimer:null,lastDecodedFrames:0,lastStatsAt:0,generation:0};
 card.onclick=(event)=>onScreenClick(String(i),event);
}

socket.on('connect',()=>{
 // A reconnect gets a brand-new socket.id. Any existing PeerConnections were negotiated
 // against the old id and are now orphaned on the signaling server, so close them here;
 // the screen-status response below will then see players[id].pc===null and reconnect fresh.
 for(let i=1;i<=SCREEN_COUNT;i++)stopViewer(String(i));
 socket.emit('screen-status-request');
});
socket.on('screen-status',list=>{
 for(const s of list){
  const id=String(s.screenId); if(!players[id])continue;
  const was=online[id]; online[id]=!!s.connected;
  document.getElementById(`offline-${id}`).style.display=s.connected?'none':'grid';
  if(s.connected && (!was || !players[id].pc)) startViewer(id);
  if(!s.connected && (was || players[id].pc)) stopViewer(id);
 }
 render();
});
socket.on('obs-status',({connected})=>{obsStatus.className=`obs-status ${connected?'online':'offline'}`;obsStatus.querySelector('.status-text').textContent=connected?'ONLINE':'OFFLINE';});

function stopViewer(id){
 const p=players[id]; if(!p)return;
 if(p.retryTimer){clearTimeout(p.retryTimer);p.retryTimer=null;}
 if(p.disconnectTimer){clearTimeout(p.disconnectTimer);p.disconnectTimer=null;}
 if(p.blackTimer){clearInterval(p.blackTimer);p.blackTimer=null;}
 p.generation++;
 try{p.pc?.close()}catch(_){}
 p.pc=null;p.viewerId=null;p.source=null;p.remoteCandidates=[];p.localCandidates=[];p.stream=null;
 if(p.video){p.video.pause();p.video.srcObject=null;}
 if(isActive(id))renderPreview();
}

function scheduleRestart(id,delay=500){
 const p=players[id]; if(!p||!online[id]||p.retryTimer)return;
 p.retryTimer=setTimeout(()=>{p.retryTimer=null;if(online[id]&&!p.pc)startViewer(id);},delay);
}

function startViewer(id){
 const p=players[id]; if(!p||!online[id])return;
 if(p.pc)return;
 const generation=++p.generation;
 const viewerId=`controller-${socket.id}-${id}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
 const pc=new RTCPeerConnection(rtcConfig);
 p.pc=pc;p.viewerId=viewerId;p.source=null;p.remoteCandidates=[];p.localCandidates=[];p.stream=new MediaStream();
 p.video.srcObject=p.stream;
 pc.addTransceiver('video',{direction:'recvonly'});
 pc.ontrack=e=>{
  if(p.pc!==pc||p.generation!==generation)return;
  if(e.track.kind!=='video')return;
  const old=p.stream.getVideoTracks();
  if(!old.some(t=>t.id===e.track.id))p.stream.addTrack(e.track);
  e.track.onunmute=()=>wakeVideo(p);
  e.track.onended=()=>{ if(p.pc===pc && online[id]) scheduleRestart(id,700); };
  wakeVideo(p);
 };
 pc.onicecandidate=e=>{
  if(!e.candidate)return;
  if(p.source)socket.emit('webrtc-ice',{to:p.source,candidate:e.candidate,screenId:id,viewerId});
  else p.localCandidates.push(e.candidate);
 };
 pc.onconnectionstatechange=()=>{
  if(p.pc!==pc)return;
  if(pc.connectionState==='connected'){
   if(p.disconnectTimer){clearTimeout(p.disconnectTimer);p.disconnectTimer=null;}
   wakeVideo(p);
  }else if(pc.connectionState==='disconnected'){
   // Often a transient blip that self-heals; avoid an immediate teardown/black flash.
   if(!p.disconnectTimer)p.disconnectTimer=setTimeout(()=>{
    p.disconnectTimer=null;
    if(p.pc===pc&&pc.connectionState!=='connected'){
     try{pc.close()}catch(_){} p.pc=null;p.source=null;p.viewerId=null;p.remoteCandidates=[];p.localCandidates=[];
     if(online[id])scheduleRestart(id,900);
    }
   },4000);
  }else if(['failed','closed'].includes(pc.connectionState)){
   if(p.disconnectTimer){clearTimeout(p.disconnectTimer);p.disconnectTimer=null;}
   if(p.pc===pc){try{pc.close()}catch(_){} p.pc=null;p.source=null;p.viewerId=null;p.remoteCandidates=[];p.localCandidates=[];}
   if(online[id])scheduleRestart(id,350);
  }
 };
 pc.oniceconnectionstatechange=()=>{
  if(p.pc!==pc)return;
  if(['failed','closed'].includes(pc.iceConnectionState)){try{pc.close()}catch(_){}p.pc=null;if(online[id])scheduleRestart(id,500);}
 };
 // Decoder watchdog: some Chromium/CEF states can report a connected WebRTC peer while
 // delivering zero decoded frames. Restart only after a sustained stall so normal startup
 // and brief network jitter do not cause black flashes.
 p.blackTimer=setInterval(async()=>{
  if(p.pc!==pc){clearInterval(p.blackTimer);p.blackTimer=null;return;}
  if(pc.connectionState!=='connected'||!online[id])return;
  try{
   const stats=await pc.getStats();
   let decoded=null,packets=0;
   stats.forEach(r=>{
    if(r.type==='inbound-rtp'&&r.kind==='video'){if(typeof r.framesDecoded==='number')decoded=r.framesDecoded;packets=r.packetsReceived||0;}
   });
   const now=Date.now();
   if(typeof decoded==='number'){
    if(p.lastStatsAt&&decoded<=p.lastDecodedFrames&&now-p.lastStatsAt>3500&&packets===0){
     try{pc.close()}catch(_){}
     if(p.pc===pc){p.pc=null;p.source=null;}
     scheduleRestart(id,250);
    }
    p.lastDecodedFrames=decoded;p.lastStatsAt=now;
   }
  }catch(_){}
 },2000);
 socket.emit('watch-screen',{screenId:id,viewerId});
}

function wakeVideo(p){
 if(!p.video)return;
 p.video.play().catch(()=>{});
 if(isActive(p.id))renderPreview();
}
function isActive(id){return id===seqA||id===seqB;}

socket.on('watch-started',({screenId,source})=>{const id=String(screenId),p=players[id];if(p){p.source=source;for(const c of p.localCandidates.splice(0))socket.emit('webrtc-ice',{to:source,candidate:c,screenId:id,viewerId:p.viewerId});}});
socket.on('watch-failed',({screenId})=>{const id=String(screenId),p=players[id];if(p){p.source=null;if(p.pc){try{p.pc.close()}catch(_){}p.pc=null;}scheduleRestart(id,700);if(isActive(id))renderPreview();}});

socket.on('webrtc-offer',async({from,offer,screenId,viewerId})=>{
 const id=String(screenId),p=players[id];if(!p||!p.pc||p.viewerId!==String(viewerId))return;
 const pc=p.pc;try{
  p.source=from;await pc.setRemoteDescription(offer);
  for(const c of p.remoteCandidates.splice(0))await pc.addIceCandidate(c).catch(()=>{});
  const answer=await pc.createAnswer();await pc.setLocalDescription(answer);
  socket.emit('webrtc-answer',{to:from,answer:pc.localDescription,screenId:id,viewerId:p.viewerId});
  for(const c of p.localCandidates.splice(0))socket.emit('webrtc-ice',{to:from,candidate:c,screenId:id,viewerId:p.viewerId});
 }catch(e){console.error('controller offer',e);if(p.pc===pc){try{pc.close()}catch(_){}p.pc=null;scheduleRestart(id,500);}}
});

socket.on('webrtc-ice',async({from,candidate,screenId,viewerId})=>{
 const id=String(screenId),p=players[id];if(!p||!p.pc||p.viewerId!==String(viewerId)||!candidate)return;
 if(p.pc.remoteDescription)await p.pc.addIceCandidate(candidate).catch(()=>{});else p.remoteCandidates.push(candidate);
});

function selectScreen(id,{dual=false,instant=false}={}){
 if(!online[id])return;
 previewCleared=false;
 if(dual){
  if(seqA===null){seqA=id;seqB=null;}
  else if(seqA!==id){seqB=id;}
 }else{
  seqA=id;seqB=null;
 }
 render();
 if(instant){
  // Shift is intentionally single-screen instant projection only.
  socket.emit('execute-layout',{mode:'single',screenId:id});
 }
}
function onScreenClick(id,event){
 if(!online[id])return;
 // Normal click = single-screen selection. Ctrl + click = add the second screen.
 // Shift + click = immediate single-screen projection (no need to press 投映).
 const dual=event.ctrlKey && !event.shiftKey;
 const instant=event.shiftKey && !event.ctrlKey;
 if(instant){ selectScreen(id,{dual:false,instant:true}); return; }
 if(event.ctrlKey && event.shiftKey){ selectScreen(id,{dual:false,instant:false}); return; }
 selectScreen(id,{dual});
}
function render(){
 document.querySelectorAll('.screen-card').forEach(c=>{
  c.classList.remove('selected','slot-left','slot-right');
  const b=c.querySelector('.slot-badge');if(b)b.remove();
 });
 if(seqA&&!seqB){
  players[seqA].card.classList.add('selected');
 }else if(seqA&&seqB){
  addBadge(seqA,'slot-left','L');
  addBadge(seqB,'slot-right','R');
 }
 renderPreview();
}
function addBadge(id,cls,label){
 const card=players[id].card;card.classList.add(cls);
 const b=document.createElement('div');b.className='slot-badge';b.textContent=label;
 card.querySelector('.thumb').appendChild(b);
}

function renderPreview(){
 if(previewCleared){
  preview.classList.remove('dual');
  preview.style.backgroundImage='';
  preview.innerHTML='<span>何も投映していません</span>';
  selectedText.textContent='未投映';
  execute.disabled=true;
  return;
 }
 if(!seqA){
  preview.classList.remove('dual');
  preview.style.backgroundImage='';
  const holder=document.getElementById('preview-layer');if(holder)holder.remove();
  preview.innerHTML='<span>画面をクリックしてください</span>';
  selectedText.textContent='未選択';execute.disabled=true;
  return;
 }
 if(!seqB)renderSinglePreview(seqA);else renderDualPreview(seqA,seqB);
}

function renderSinglePreview(id){
 preview.classList.remove('dual');
 preview.style.backgroundImage='';
 let holder=document.getElementById('preview-layer');
 if(!holder){preview.innerHTML='';holder=document.createElement('div');holder.id='preview-layer';holder.style.cssText='position:relative;width:100%;height:100%;overflow:hidden;background:#050505;';preview.appendChild(holder);}
 const p=players[id];
 if(!p?.stream||!p.stream.getVideoTracks().some(t=>t.readyState==='live')){selectedText.textContent='接続中';execute.disabled=true;return;}
 let v=document.getElementById('preview-video');
 if(!v){v=document.createElement('video');v.id='preview-video';v.autoplay=true;v.muted=true;v.playsInline=true;v.style.cssText='position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#050505;display:block;opacity:1;';holder.appendChild(v);}
 if(v.srcObject!==p.stream)v.srcObject=p.stream; // hard cut, no fade
 v.play().catch(()=>{});
 selectedText.textContent='選択中';execute.disabled=false;
}

function renderDualPreview(aId,bId){
 if(!preview.classList.contains('dual')){
  preview.classList.add('dual');preview.innerHTML='';
  const boxL=document.createElement('div');boxL.className='dual-box';boxL.id='dual-box-a';
  const boxR=document.createElement('div');boxR.className='dual-box';boxR.id='dual-box-b';
  preview.appendChild(boxL);preview.appendChild(boxR);
 }
 preview.style.backgroundImage=dualBgUrl?`url("${dualBgUrl}")`:'';
 preview.style.backgroundSize='cover';preview.style.backgroundPosition='center';
 fillDualBox('dual-box-a',aId);
 fillDualBox('dual-box-b',bId);
 const ready=[aId,bId].every(id=>players[id]?.stream?.getVideoTracks().some(t=>t.readyState==='live'));
 selectedText.textContent=ready?'選択中':'接続中';
 execute.disabled=!(ready&&online[aId]&&online[bId]);
}
function fillDualBox(boxId,id){
 const box=document.getElementById(boxId);if(!box)return;
 const p=players[id];
 if(!p?.stream||!p.stream.getVideoTracks().some(t=>t.readyState==='live')){box.classList.add('empty');box.textContent='接続中...';return;}
 box.classList.remove('empty');
 let v=box.querySelector('video');
 if(!v){box.textContent='';v=document.createElement('video');v.autoplay=true;v.muted=true;v.playsInline=true;box.appendChild(v);}
 if(v.srcObject!==p.stream)v.srcObject=p.stream; // hard cut, no fade
 v.play().catch(()=>{});
}

execute.onclick=()=>{
 if(seqA&&!seqB){
  if(!online[seqA])return;
  socket.emit('execute-layout',{mode:'single',screenId:seqA});
 }else if(seqA&&seqB){
  if(!online[seqA]||!online[seqB])return;
  socket.emit('execute-layout',{mode:'dual',left:seqA,right:seqB});
 }else return;
 execute.textContent='投映済み';setTimeout(()=>execute.textContent='投映',1000);
};
function executeProjection(){
 if(execute.disabled)return;
 execute.click();
}

document.addEventListener('keydown',event=>{
 const tag=document.activeElement?.tagName;
 if(tag==='INPUT'||tag==='TEXTAREA'||tag==='SELECT')return;
 if(event.ctrlKey||event.altKey||event.metaKey||event.shiftKey)return;
 if(event.key!==String(keybinds.executeKey||'Enter'))return;
 event.preventDefault();
 executeProjection();
});

// Number keys 1-8 select the corresponding screen.
// Ctrl + number adds it as the second screen; Shift + number immediately projects it as a single screen.
// Ctrl+Shift never performs a two-screen instant projection.
document.addEventListener('keydown',event=>{
 const tag=document.activeElement?.tagName;
 if(tag==='INPUT'||tag==='TEXTAREA'||tag==='SELECT')return;
 const key=event.key;
 const idx=keybinds.screenKeys.indexOf(key);
 if(idx<0)return;
 const id=String(idx+1);
 if(!online[id])return;
 event.preventDefault();
 // Ctrl+Shift is intentionally a no-op: it must never instantly project two screens.
 if(event.ctrlKey && event.shiftKey)return;
 const dual=event.ctrlKey;
 const instant=event.shiftKey;
 selectScreen(id,{dual,instant});
});

// R: clear the OBS projection without changing the current Preview selection.
document.addEventListener('keydown',event=>{
 const tag=document.activeElement?.tagName;
 if(tag==='INPUT'||tag==='TEXTAREA'||tag==='SELECT')return;
 if(event.key.toLowerCase()!==String(keybinds.clearKey).toLowerCase()||event.ctrlKey||event.altKey||event.metaKey||event.shiftKey)return;
 event.preventDefault();
 socket.emit('clear-layout');
 previewCleared=true;
 renderPreview();
});
document.getElementById('settingsButton').onclick=()=>modal.classList.add('open');document.getElementById('closeSettings').onclick=()=>modal.classList.remove('open');modal.onclick=e=>{if(e.target===modal)modal.classList.remove('open')};
for(let i=1;i<=SCREEN_COUNT;i++){const url=`${location.origin}/share.html?id=${i}`;const row=document.createElement('div');row.className='connection-row';row.innerHTML=`<div><b>画面共有${i}</b><div class="url">${url}</div></div><button class="copy">コピー</button>`;row.querySelector('.copy').onclick=async()=>{const btn=row.querySelector('.copy');let ok=false;try{if(navigator.clipboard&&window.isSecureContext){await navigator.clipboard.writeText(url);ok=true;}}catch(_){}if(!ok){try{const ta=document.createElement('textarea');ta.value=url;ta.setAttribute('readonly','');ta.style.position='fixed';ta.style.opacity='0';document.body.appendChild(ta);ta.focus();ta.select();ok=document.execCommand('copy');ta.remove();}catch(_){ok=false;}}if(ok){btn.textContent='コピー済み';setTimeout(()=>btn.textContent='コピー',1000)}else{btn.textContent='コピー失敗';setTimeout(()=>btn.textContent='コピー',1500);}};connectionList.appendChild(row);}const keybindsPanel=document.createElement('div');
keybindsPanel.className='keybinds-panel';
keybindsPanel.innerHTML=`<h3>キーバインド設定</h3><p class="muted">画面1～8の選択キー、2画面追加キー、投映キー、投映解除キーを変更できます。Shift＋画面キーで1画面を即時投映します。Ctrl＋Shiftでは2画面即時投映は行いません。</p>
<div id="screenBindRows"></div>
<div class="keybind-row"><span>2画面追加</span><button id="bindDual" class="bind-btn"></button></div>
<div class="keybind-row"><span>投映</span><button id="bindExecute" class="bind-btn"></button></div>
<div class="keybind-row"><span>投映解除＋Preview黒画面</span><button id="bindClear" class="bind-btn"></button></div>`;
modal.querySelector('.modal').insertBefore(keybindsPanel,modal.querySelector('.obs-info'));
const bindDual=document.getElementById('bindDual'),bindExecute=document.getElementById('bindExecute'),bindClear=document.getElementById('bindClear'),screenBindRows=document.getElementById('screenBindRows');
for(let i=1;i<=SCREEN_COUNT;i++){const row=document.createElement('div');row.className='keybind-row';row.innerHTML=`<span>画面${i}</span><button class="bind-btn screen-bind"></button>`;row.querySelector('button').onclick=()=>captureScreenKey(row.querySelector('button'),i-1);screenBindRows.appendChild(row);}
function updateBindButtons(){bindDual.textContent=`${modifierLabel(keybinds.dualModifier)} + クリック/画面キー`;bindExecute.textContent=keybinds.executeKey==='Enter'?'Enter':String(keybinds.executeKey).toUpperCase();bindClear.textContent=String(keybinds.clearKey).toUpperCase();screenBindRows.querySelectorAll('.screen-bind').forEach((b,i)=>b.textContent=String(keybinds.screenKeys[i]||'').toUpperCase());}
function captureScreenKey(button,index){
 button.textContent='キーを押してください…';
 const handler=e=>{
  e.preventDefault();e.stopPropagation();
  const k=e.key;
  if(['Shift','Control','Alt','Meta'].includes(k))return;
  if(k.length!==1)return;
  const upper=k.toUpperCase();
  if(keybinds.screenKeys.some((v,i)=>i!==index&&String(v).toUpperCase()===upper))return;
  keybinds.screenKeys[index]=k;
  saveKeybinds();updateBindButtons();window.removeEventListener('keydown',handler,true);
 };
 window.addEventListener('keydown',handler,true);
}
function captureModifier(button,field){
 button.textContent='キーを押してください…';
 const handler=e=>{
  e.preventDefault();e.stopPropagation();
  const k=e.key;
  if(k==='Shift'||k==='Control'||k==='Alt')keybinds[field]=k;
  else return;
  saveKeybinds();updateBindButtons();window.removeEventListener('keydown',handler,true);
 };
 window.addEventListener('keydown',handler,true);
}
function captureExecute(){
 bindExecute.textContent='キーを押してください…';
 const handler=e=>{
  e.preventDefault();e.stopPropagation();
  const k=e.key;
  if(['Shift','Control','Alt','Meta'].includes(k))return;
  if(k.length!==1 && k!=='Enter' && k!=='Space')return;
  keybinds.executeKey=k;
  saveKeybinds();updateBindButtons();window.removeEventListener('keydown',handler,true);
 };
 window.addEventListener('keydown',handler,true);
}
function captureClear(){
 bindClear.textContent='キーを押してください…';
 const handler=e=>{
  const k=e.key;
  if(['Shift','Control','Alt','Meta'].includes(k))return;
  e.preventDefault();e.stopPropagation();
  keybinds.clearKey=k.length===1?k.toUpperCase():k;
  saveKeybinds();updateBindButtons();window.removeEventListener('keydown',handler,true);
 };
 window.addEventListener('keydown',handler,true);
}
bindDual.onclick=()=>captureModifier(bindDual,'dualModifier');
bindExecute.onclick=captureExecute;
bindClear.onclick=captureClear;
updateBindButtons();
obsUrl.textContent=`${location.origin}/obs.html`;render();

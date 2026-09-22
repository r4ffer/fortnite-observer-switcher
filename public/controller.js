const socket=io();
const screensEl=document.getElementById('screens'),preview=document.getElementById('preview');
const selectedText=document.getElementById('selectedText'),execute=document.getElementById('execute');
const obsStatus=document.getElementById('obsStatus'),modal=document.getElementById('settingsModal');
const connectionList=document.getElementById('connectionList'),obsUrl=document.getElementById('obsUrl');
const SCREEN_COUNT=8;
const online=Object.fromEntries(Array.from({length:SCREEN_COUNT},(_,i)=>[i+1,false]));
const players={};
let seqA=null,seqB=null,previewCleared=false,dualBgUrl=null;
const rtcConfig={iceServers:[{urls:'stun:stun.l.google.com:19302'}],iceCandidatePoolSize:0,bundlePolicy:'max-bundle',rtcpMuxPolicy:'require'};
const DEFAULT_KEYBINDS={instantModifier:'Shift',dualModifier:'Control',clearKey:'R',executeKey:'Enter',screenKeys:['1','2','3','4','5','6','7','8']};
let keybinds={...DEFAULT_KEYBINDS};
try{const saved=JSON.parse(localStorage.getItem('fos-keybinds')||'null');if(saved)keybinds={...keybinds,...saved};}catch(_){ }
function saveKeybinds(){localStorage.setItem('fos-keybinds',JSON.stringify(keybinds));}
function modifierLabel(name){return name==='Control'?'Ctrl':name==='Shift'?'Shift':name==='Alt'?'Alt':'なし';}

fetch('/api/dual-background').then(r=>r.json()).then(({file})=>{dualBgUrl=file||null;if(seqA&&seqB)renderPreview();}).catch(()=>{});

for(let i=1;i<=SCREEN_COUNT;i++){
 const card=document.createElement('div');card.className='screen-card';
 card.innerHTML=`<div class="thumb"><img id="thumb-${i}" alt="画面${i}"/><video id="video-${i}" autoplay muted playsinline></video><div id="offline-${i}" class="offline-card">未接続</div></div><div class="card-name">画面${i}</div>`;
 screensEl.appendChild(card);
 players[i]={id:String(i),card,img:card.querySelector('img'),video:card.querySelector('video'),pc:null,viewerId:null,source:null,remoteCandidates:[],localCandidates:[],stream:null,retryTimer:null,disconnectTimer:null,generation:0};
 card.onclick=e=>onScreenClick(String(i),e);
}

function isActive(id){return id===seqA||id===seqB;}
function stopViewer(id){
 const p=players[id];if(!p)return;
 if(p.retryTimer){clearTimeout(p.retryTimer);p.retryTimer=null;}
 if(p.disconnectTimer){clearTimeout(p.disconnectTimer);p.disconnectTimer=null;}
 if(p.viewerId)socket.emit('stop-watching',{screenId:id});
 p.generation++;try{p.pc?.close()}catch(_){ }
 p.pc=null;p.viewerId=null;p.source=null;p.remoteCandidates=[];p.localCandidates=[];p.stream=null;
 if(p.video){p.video.pause();p.video.srcObject=null;p.video.style.display='none';}
 if(!isActive(id))p.img.style.display='block';
}
function scheduleRestart(id,delay=500){
 const p=players[id];if(!p||!online[id]||!isActive(id)||p.retryTimer)return;
 p.retryTimer=setTimeout(()=>{p.retryTimer=null;if(online[id]&&isActive(id)&&!p.pc)startViewer(id);},delay);
}
function startViewer(id){
 const p=players[id];if(!p||!online[id]||!isActive(id)||p.pc)return;
 const generation=++p.generation;
 const viewerId=`controller-${socket.id}-${id}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
 const pc=new RTCPeerConnection(rtcConfig);
 p.pc=pc;p.viewerId=viewerId;p.source=null;p.remoteCandidates=[];p.localCandidates=[];p.stream=null;
 p.img.style.display='none';p.video.style.display='block';p.video.srcObject=null;
 pc.addTransceiver('video',{direction:'recvonly'});
 pc.ontrack=e=>{
  if(p.pc!==pc||p.generation!==generation||e.track.kind!=='video')return;
  p.stream=e.streams?.[0]||new MediaStream([e.track]);
  p.video.srcObject=p.stream;e.track.onunmute=()=>wakeVideo(p);e.track.onended=()=>{if(p.pc===pc&&online[id]&&isActive(id))scheduleRestart(id,700);};wakeVideo(p);
 };
 pc.onicecandidate=e=>{if(!e.candidate)return;if(p.source)socket.emit('webrtc-ice',{to:p.source,candidate:e.candidate,screenId:id,viewerId});else p.localCandidates.push(e.candidate);};
 pc.onconnectionstatechange=()=>{
  if(p.pc!==pc)return;
  if(pc.connectionState==='connected'){if(p.disconnectTimer){clearTimeout(p.disconnectTimer);p.disconnectTimer=null;}wakeVideo(p);}
  else if(pc.connectionState==='disconnected'){
   if(!p.disconnectTimer)p.disconnectTimer=setTimeout(()=>{p.disconnectTimer=null;if(p.pc===pc&&pc.connectionState!=='connected'){try{pc.close()}catch(_){ }p.pc=null;p.source=null;p.viewerId=null;scheduleRestart(id,800);}},3500);
  }else if(['failed','closed'].includes(pc.connectionState)){
   if(p.disconnectTimer){clearTimeout(p.disconnectTimer);p.disconnectTimer=null;}
   if(p.pc===pc){try{pc.close()}catch(_){ }p.pc=null;p.source=null;p.viewerId=null;}
   scheduleRestart(id,500);
  }
 };
 pc.oniceconnectionstatechange=()=>{if(p.pc===pc&&['failed','closed'].includes(pc.iceConnectionState)){try{pc.close()}catch(_){ }p.pc=null;scheduleRestart(id,600);}};
 socket.emit('watch-screen',{screenId:id,viewerId});
}
function wakeVideo(p){if(!p.video)return;if(p.stream&&p.video.srcObject!==p.stream)p.video.srcObject=p.stream;p.video.play().catch(()=>{});if(isActive(p.id))renderPreview();}

socket.on('connect',()=>{socket.emit('register-controller');for(let i=1;i<=SCREEN_COUNT;i++)stopViewer(String(i));socket.emit('screen-status-request');});
socket.on('obs-status',({connected})=>{obsStatus.className=`obs-status ${connected?'online':'offline'}`;obsStatus.querySelector('.status-text').textContent=connected?'ONLINE':'OFFLINE';});
socket.on('screen-status',list=>{
 const seen=new Set();
 for(const s of list){const id=String(s.screenId);if(!players[id])continue;seen.add(id);online[id]=!!s.connected;document.getElementById(`offline-${id}`).style.display=s.connected?'none':'grid';if(!s.connected)stopViewer(id);else if(isActive(id)&&!players[id].pc)startViewer(id);}
 for(let i=1;i<=SCREEN_COUNT;i++)if(!seen.has(String(i))){online[i]=false;stopViewer(String(i));}
 render();
});

socket.on('screen-thumbnail',({screenId,data}={})=>{
 const id=String(screenId),p=players[id];if(!p||typeof data!=='string'||!data.startsWith('data:image/'))return;
 // Thumbnails are snapshots only. They are deliberately not WebRTC streams, so the real 1080p60
 // media connection is reserved for Preview and OBS and cannot be degraded by thumbnail decoding.
 if(!isActive(id)){p.img.src=data;p.img.style.display='block';}
});

socket.on('watch-started',({screenId,source})=>{const id=String(screenId),p=players[id];if(!p)return;p.source=source;for(const c of p.localCandidates.splice(0))socket.emit('webrtc-ice',{to:source,candidate:c,screenId:id,viewerId:p.viewerId});});
socket.on('watch-failed',({screenId})=>{const id=String(screenId),p=players[id];if(!p)return;p.source=null;try{p.pc?.close()}catch(_){ }p.pc=null;if(isActive(id))scheduleRestart(id,700);renderPreview();});
socket.on('source-stopped',({screenId})=>{const id=String(screenId);if(players[id]){online[id]=false;stopViewer(id);render();}});
socket.on('webrtc-offer',async({from,offer,screenId,viewerId})=>{
 const id=String(screenId),p=players[id];if(!p||!p.pc||p.viewerId!==String(viewerId))return;const pc=p.pc;
 try{p.source=from;await pc.setRemoteDescription(offer);for(const c of p.remoteCandidates.splice(0))await pc.addIceCandidate(c).catch(()=>{});const answer=await pc.createAnswer();await pc.setLocalDescription(answer);socket.emit('webrtc-answer',{to:from,answer:pc.localDescription,screenId:id,viewerId:p.viewerId});for(const c of p.localCandidates.splice(0))socket.emit('webrtc-ice',{to:from,candidate:c,screenId:id,viewerId:p.viewerId});}
 catch(e){console.error('controller offer',e);if(p.pc===pc){try{pc.close()}catch(_){ }p.pc=null;scheduleRestart(id,500);}}
});
socket.on('webrtc-ice',async({candidate,screenId,viewerId})=>{const id=String(screenId),p=players[id];if(!p||!p.pc||p.viewerId!==String(viewerId)||!candidate)return;if(p.pc.remoteDescription)await p.pc.addIceCandidate(candidate).catch(()=>{});else p.remoteCandidates.push(candidate);});

function selectScreen(id,{dual=false,instant=false}={}){
 if(!online[id])return;previewCleared=false;
 if(dual){if(seqA===null){seqA=id;seqB=null;}else if(seqA!==id){seqB=id;}}
 else{if(seqB===id)seqB=null;seqA=id;}
 for(let i=1;i<=SCREEN_COUNT;i++){const sid=String(i);if(isActive(sid)){if(!players[sid].pc)startViewer(sid);}else stopViewer(sid);}
 render();
 if(instant)socket.emit('execute-layout',{mode:'single',screenId:id});
}
function onScreenClick(id,event){if(!online[id])return;const dual=event.ctrlKey&&!event.shiftKey;const instant=event.shiftKey&&!event.ctrlKey;if(event.ctrlKey&&event.shiftKey)return;selectScreen(id,{dual,instant});}

function render(){
 for(let i=1;i<=SCREEN_COUNT;i++){
  const p=players[i],active=isActive(String(i));p.card.classList.toggle('selected',active);
  if(active&&p.pc){p.img.style.display='none';p.video.style.display='block';}
  else if(!active){p.video.style.display='none';p.img.style.display='block';}
 }
 renderPreview();
}
function renderPreview(){
 if(previewCleared||!seqA){preview.classList.remove('dual');preview.style.backgroundImage='';preview.innerHTML='<span>画面をクリックしてください</span>';selectedText.textContent='未選択';execute.disabled=true;return;}
 if(!seqB)renderSinglePreview(seqA);else renderDualPreview(seqA,seqB);
}
function live(id){return !!players[id]?.stream?.getVideoTracks().some(t=>t.readyState==='live');}
function renderSinglePreview(id){
 preview.classList.remove('dual');preview.style.backgroundImage='';let holder=document.getElementById('preview-layer');
 if(!holder){preview.innerHTML='';holder=document.createElement('div');holder.id='preview-layer';holder.style.cssText='position:relative;width:100%;height:100%;overflow:hidden;background:#050505;';preview.appendChild(holder);}
 const p=players[id];if(!live(id)){selectedText.textContent='接続中';execute.disabled=true;return;}
 let v=document.getElementById('preview-video');if(!v){v=document.createElement('video');v.id='preview-video';v.autoplay=true;v.muted=true;v.playsInline=true;v.style.cssText='position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#050505;display:block;';holder.appendChild(v);}
 if(v.srcObject!==p.stream)v.srcObject=p.stream;v.play().catch(()=>{});selectedText.textContent='選択中';execute.disabled=!online[id];
}
function renderDualPreview(aId,bId){
 if(!preview.classList.contains('dual')){preview.classList.add('dual');preview.innerHTML='';const a=document.createElement('div');a.className='dual-box';a.id='dual-box-a';const b=document.createElement('div');b.className='dual-box';b.id='dual-box-b';preview.append(a,b);}
 preview.style.backgroundImage=dualBgUrl?`url("${dualBgUrl}")`:'';preview.style.backgroundSize='cover';preview.style.backgroundPosition='center';fillDualBox('dual-box-a',aId);fillDualBox('dual-box-b',bId);
 const ready=live(aId)&&live(bId);selectedText.textContent=ready?'選択中':'接続中';execute.disabled=!(ready&&online[aId]&&online[bId]);
}
function fillDualBox(boxId,id){const box=document.getElementById(boxId);if(!box)return;const p=players[id];if(!live(id)){box.classList.add('empty');box.textContent='接続中...';return;}box.classList.remove('empty');let v=box.querySelector('video');if(!v){box.textContent='';v=document.createElement('video');v.autoplay=true;v.muted=true;v.playsInline=true;v.style.cssText='width:100%;height:100%;object-fit:contain;background:#000;';box.appendChild(v);}if(v.srcObject!==p.stream)v.srcObject=p.stream;v.play().catch(()=>{});}

execute.onclick=()=>{if(seqA&&!seqB&&online[seqA])socket.emit('execute-layout',{mode:'single',screenId:seqA});else if(seqA&&seqB&&online[seqA]&&online[seqB])socket.emit('execute-layout',{mode:'dual',left:seqA,right:seqB});else return;execute.textContent='投映済み';setTimeout(()=>execute.textContent='投映',1000);};
function executeProjection(){if(!execute.disabled)execute.click();}

document.addEventListener('keydown',event=>{const tag=document.activeElement?.tagName;if(['INPUT','TEXTAREA','SELECT'].includes(tag))return;if(event.ctrlKey||event.altKey||event.metaKey||event.shiftKey)return;if(event.key===String(keybinds.executeKey||'Enter')){event.preventDefault();executeProjection();}});
document.addEventListener('keydown',event=>{const tag=document.activeElement?.tagName;if(['INPUT','TEXTAREA','SELECT'].includes(tag))return;const idx=keybinds.screenKeys.indexOf(event.key);if(idx<0||!online[String(idx+1)])return;event.preventDefault();if(event.ctrlKey&&event.shiftKey)return;selectScreen(String(idx+1),{dual:event.ctrlKey,instant:event.shiftKey});});
document.addEventListener('keydown',event=>{const tag=document.activeElement?.tagName;if(['INPUT','TEXTAREA','SELECT'].includes(tag))return;if(event.key.toLowerCase()!==String(keybinds.clearKey).toLowerCase()||event.ctrlKey||event.altKey||event.metaKey||event.shiftKey)return;event.preventDefault();socket.emit('clear-layout');previewCleared=true;renderPreview();});

document.getElementById('settingsButton').onclick=()=>modal.classList.add('open');document.getElementById('closeSettings').onclick=()=>modal.classList.remove('open');modal.onclick=e=>{if(e.target===modal)modal.classList.remove('open')};
for(let i=1;i<=SCREEN_COUNT;i++){const url=`${location.origin}/share.html?id=${i}`,row=document.createElement('div');row.className='connection-row';row.innerHTML=`<div><b>画面共有${i}</b><div class="url">${url}</div></div><button class="copy">コピー</button>`;row.querySelector('.copy').onclick=async()=>{const btn=row.querySelector('.copy');let ok=false;try{if(navigator.clipboard&&window.isSecureContext){await navigator.clipboard.writeText(url);ok=true;}}catch(_){ }if(!ok)try{const ta=document.createElement('textarea');ta.value=url;ta.setAttribute('readonly','');ta.style.position='fixed';ta.style.opacity='0';document.body.appendChild(ta);ta.focus();ta.select();ok=document.execCommand('copy');ta.remove();}catch(_){ }btn.textContent=ok?'コピー済み':'コピー失敗';setTimeout(()=>btn.textContent='コピー',ok?1000:1500);};connectionList.appendChild(row);}
const keybindsPanel=document.createElement('div');keybindsPanel.className='keybinds-panel';keybindsPanel.innerHTML='<h3>キーバインド設定</h3><p class="muted">画面1～8の選択キー、2画面追加キー、投映キー、投映解除キーを変更できます。Shift＋画面キーで1画面を即時投映します。Ctrl＋Shiftでは2画面即時投映は行いません。</p><div id="screenBindRows"></div><div class="keybind-row"><span>2画面追加</span><button id="bindDual" class="bind-btn"></button></div><div class="keybind-row"><span>投映</span><button id="bindExecute" class="bind-btn"></button></div><div class="keybind-row"><span>投映解除＋Preview黒画面</span><button id="bindClear" class="bind-btn"></button></div>';
modal.querySelector('.modal').insertBefore(keybindsPanel,modal.querySelector('.obs-info'));
const bindDual=document.getElementById('bindDual'),bindExecute=document.getElementById('bindExecute'),bindClear=document.getElementById('bindClear'),screenBindRows=document.getElementById('screenBindRows');
for(let i=1;i<=SCREEN_COUNT;i++){const row=document.createElement('div');row.className='keybind-row';row.innerHTML=`<span>画面${i}</span><button class="bind-btn screen-bind"></button>`;row.querySelector('button').onclick=()=>captureScreenKey(row.querySelector('button'),i-1);screenBindRows.appendChild(row);}
function updateBindButtons(){bindDual.textContent=`${modifierLabel(keybinds.dualModifier)} + クリック/画面キー`;bindExecute.textContent=keybinds.executeKey==='Enter'?'Enter':String(keybinds.executeKey).toUpperCase();bindClear.textContent=String(keybinds.clearKey).toUpperCase();screenBindRows.querySelectorAll('.screen-bind').forEach((b,i)=>b.textContent=String(keybinds.screenKeys[i]||'').toUpperCase());}
function captureScreenKey(button,index){button.textContent='キーを押してください…';const h=e=>{e.preventDefault();e.stopPropagation();if(['Shift','Control','Alt','Meta'].includes(e.key)||e.key.length!==1)return;const k=e.key;if(keybinds.screenKeys.some((v,i)=>i!==index&&String(v).toUpperCase()===k.toUpperCase()))return;keybinds.screenKeys[index]=k;saveKeybinds();updateBindButtons();removeEventListener('keydown',h,true);};addEventListener('keydown',h,true);}
function captureModifier(button,field){button.textContent='キーを押してください…';const h=e=>{e.preventDefault();e.stopPropagation();if(['Shift','Control','Alt'].includes(e.key)){keybinds[field]=e.key;saveKeybinds();updateBindButtons();removeEventListener('keydown',h,true);}};addEventListener('keydown',h,true);}
function captureExecute(){bindExecute.textContent='キーを押してください…';const h=e=>{e.preventDefault();e.stopPropagation();if(['Shift','Control','Alt','Meta'].includes(e.key))return;if(e.key.length!==1&&e.key!=='Enter'&&e.key!=='Space')return;keybinds.executeKey=e.key;saveKeybinds();updateBindButtons();removeEventListener('keydown',h,true);};addEventListener('keydown',h,true);}
function captureClear(){bindClear.textContent='キーを押してください…';const h=e=>{if(['Shift','Control','Alt','Meta'].includes(e.key))return;e.preventDefault();e.stopPropagation();keybinds.clearKey=e.key.length===1?e.key.toUpperCase():e.key;saveKeybinds();updateBindButtons();removeEventListener('keydown',h,true);};addEventListener('keydown',h,true);}
bindDual.onclick=()=>captureModifier(bindDual,'dualModifier');bindExecute.onclick=captureExecute;bindClear.onclick=captureClear;updateBindButtons();obsUrl.textContent=`${location.origin}/obs.html`;render();

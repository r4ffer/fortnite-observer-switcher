const socket=io();
const SCREEN_COUNT=8;
const videos=Array.from({length:SCREEN_COUNT},(_,i)=>{
 const v=document.createElement('video');
 v.autoplay=true;v.muted=true;v.playsInline=true;v.preload='auto';v.dataset.screen=String(i+1);
 v.style.cssText='position:absolute;display:block;opacity:0;object-fit:contain;background:#000;pointer-events:none;will-change:opacity,transform;transition:opacity 120ms linear;';
 v.setAttribute('disablePictureInPicture','');
 document.getElementById('stage').appendChild(v); return v;
});
const stage=document.getElementById('stage');
const online=Object.fromEntries(Array.from({length:SCREEN_COUNT},(_,i)=>[i+1,false]));
const viewers={};
let layout=null;
const rtcConfig={iceServers:[{urls:'stun:stun.l.google.com:19302'},{urls:'stun:stun1.l.google.com:19302'}],iceCandidatePoolSize:10,bundlePolicy:'max-bundle',rtcpMuxPolicy:'require'};

let dualBgFile=null;
fetch('/api/dual-background').then(r=>r.json()).then(({file})=>{
 dualBgFile=file;
 if(file){stage.style.backgroundImage=`url("${file}")`;stage.style.backgroundSize='cover';stage.style.backgroundPosition='center';stage.style.backgroundRepeat='no-repeat';}
}).catch(()=>{});

function activeIds(){if(!layout)return[];return layout.mode==='dual'?[layout.left,layout.right]:[layout.id];}
function setHidden(v){v.style.opacity='0';v.style.left='0';v.style.top='0';v.style.width='100%';v.style.height='100%';v.style.zIndex='0';}
function setSingle(v){v.style.left='0';v.style.top='0';v.style.width='100%';v.style.height='100%';v.style.objectFit='contain';v.style.zIndex='2';}
function setDual(v,left){v.style.top='0';v.style.width='50%';v.style.height='100%';v.style.objectFit='contain';v.style.left=left?'0':'50%';v.style.zIndex='2';}
function applyLayout(next){
 layout=next;
 videos.forEach(setHidden);
 if(layout.mode==='single'){
  const v=videos[layout.id-1];setSingle(v);v.dataset.wantVisible='1';
  revealWhenReady(layout.id);
 }else{
  const vl=videos[layout.left-1],vr=videos[layout.right-1];
  setDual(vl,true);setDual(vr,false);vl.dataset.wantVisible='1';vr.dataset.wantVisible='1';
  revealWhenReady(layout.left);revealWhenReady(layout.right);
 }
}
function clearLayout(){layout=null;videos.forEach(v=>{setHidden(v);v.dataset.wantVisible='0';});}

function hasLiveTrack(id){return !!viewers[id]?.stream?.getVideoTracks().some(t=>t.readyState==='live');}
function revealWhenReady(id){
 const v=videos[id-1];if(!v||!activeIds().includes(id))return;
 let tries=0;
 const reveal=()=>{
  if(!activeIds().includes(id)){return false;}
  const live=hasLiveTrack(id);
  if(live && v.readyState>=2){v.dataset.wantVisible='1';v.style.opacity='1';v.play().catch(()=>{});return true;}
  v.play().catch(()=>{});return false;
 };
 if(reveal())return;
 const timer=setInterval(()=>{tries++;if(reveal()||tries>150||!activeIds().includes(id))clearInterval(timer);},100);
}

function startViewer(id){
 if(!online[id]||viewers[id])return;
 const viewerId=`obs-${socket.id}-${id}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
 const pc=new RTCPeerConnection(rtcConfig);
 const state={id,viewerId,pc,source:null,remoteCandidates:[],localCandidates:[],stream:new MediaStream(),retry:null,disconnectTimer:null,blackTimer:null,lastDecodedFrames:0,lastStatsAt:0};
 viewers[id]=state;
 const v=videos[id-1];v.srcObject=state.stream;v.style.opacity='0';
 pc.addTransceiver('video',{direction:'recvonly'});
 pc.ontrack=e=>{
  if(viewers[id]!==state||e.track.kind!=='video')return;
  if(!state.stream.getVideoTracks().some(t=>t.id===e.track.id))state.stream.addTrack(e.track);
  e.track.onunmute=()=>{v.play().catch(()=>{});if(activeIds().includes(id))revealWhenReady(id);};
  e.track.onended=()=>{if(viewers[id]===state&&online[id])restart(id);};
  v.play().catch(()=>{});if(activeIds().includes(id))revealWhenReady(id);
 };
 v.onloadedmetadata=()=>{if(activeIds().includes(id))revealWhenReady(id);};
 v.oncanplay=()=>{if(activeIds().includes(id))revealWhenReady(id);};
 pc.onicecandidate=e=>{if(!e.candidate)return;if(state.source)socket.emit('webrtc-ice',{to:state.source,candidate:e.candidate,screenId:String(id),viewerId});else state.localCandidates.push(e.candidate);};
 pc.onconnectionstatechange=()=>{
  if(viewers[id]!==state)return;
  if(pc.connectionState==='connected'){
   if(state.disconnectTimer){clearTimeout(state.disconnectTimer);state.disconnectTimer=null;}
   v.play().catch(()=>{});if(activeIds().includes(id))revealWhenReady(id);
  }else if(pc.connectionState==='disconnected'){
   if(!state.disconnectTimer)state.disconnectTimer=setTimeout(()=>{state.disconnectTimer=null;if(viewers[id]===state&&pc.connectionState!=='connected')restart(id);},5000);
  }else if(['failed','closed'].includes(pc.connectionState)){
   if(state.disconnectTimer){clearTimeout(state.disconnectTimer);state.disconnectTimer=null;}restart(id);
  }
 };
 pc.oniceconnectionstatechange=()=>{if(viewers[id]!==state)return;if(['failed','closed'].includes(pc.iceConnectionState))restart(id);};
 // Chromium/OBS CEF can occasionally keep a WebRTC connection in 'connected' while
 // the decoder stops producing frames. Restart after a sustained zero-frame stall.
 state.blackTimer=setInterval(async()=>{
  if(viewers[id]!==state){clearInterval(state.blackTimer);state.blackTimer=null;return;}
  if(pc.connectionState!=='connected'||!online[id])return;
  try{
   const stats=await pc.getStats();
   let decoded=null,packets=0;
   stats.forEach(r=>{if(r.type==='inbound-rtp'&&r.kind==='video'){if(typeof r.framesDecoded==='number')decoded=r.framesDecoded;packets=r.packetsReceived||0;}});
   const now=Date.now();
   if(typeof decoded==='number'){
    if(state.lastStatsAt&&decoded<=state.lastDecodedFrames&&now-state.lastStatsAt>3500&&packets===0)restart(id);
    state.lastDecodedFrames=decoded;state.lastStatsAt=now;
   }
  }catch(_){}
 },2000);
 socket.emit('watch-screen',{screenId:String(id),viewerId});
}
function restart(id){
 const state=viewers[id];if(!state||state.retry||!online[id])return;
 if(state.disconnectTimer){clearTimeout(state.disconnectTimer);state.disconnectTimer=null;}
 state.retry=setTimeout(()=>{if(viewers[id]!==state)return;try{state.pc.close()}catch(_){}delete viewers[id];startViewer(id);},700);
}
function stopViewer(id){
 const s=viewers[id];if(!s)return;
 try{s.pc.close()}catch(_){}if(s.retry)clearTimeout(s.retry);if(s.disconnectTimer)clearTimeout(s.disconnectTimer);if(s.blackTimer)clearInterval(s.blackTimer);
 const v=videos[id-1];v.pause();v.srcObject=null;v.style.opacity='0';delete viewers[id];
}
function wake(id){const v=videos[id-1];v.play().catch(()=>{});if(activeIds().includes(id))revealWhenReady(id);}

socket.on('connect',()=>{for(let i=1;i<=SCREEN_COUNT;i++)stopViewer(i);socket.emit('register-obs');});
socket.on('screen-status',list=>{for(const item of list){const id=Number(item.screenId);online[id]=!!item.connected;if(item.connected&&!viewers[id])startViewer(id);if(!item.connected&&viewers[id])stopViewer(id);}});
socket.on('watch-started',({screenId,source})=>{const id=Number(screenId),s=viewers[id];if(!s)return;s.source=source;for(const c of s.localCandidates.splice(0))socket.emit('webrtc-ice',{to:source,candidate:c,screenId:String(id),viewerId:s.viewerId});});
socket.on('watch-failed',({screenId})=>{const id=Number(screenId);if(viewers[id])restart(id);});
socket.on('webrtc-offer',async({from,offer,screenId,viewerId})=>{const id=Number(screenId),s=viewers[id];if(!s||s.viewerId!==String(viewerId))return;try{s.source=from;await s.pc.setRemoteDescription(offer);for(const c of s.remoteCandidates.splice(0))await s.pc.addIceCandidate(c).catch(()=>{});const answer=await s.pc.createAnswer();await s.pc.setLocalDescription(answer);socket.emit('webrtc-answer',{to:from,answer:s.pc.localDescription,screenId:String(id),viewerId:s.viewerId});for(const c of s.localCandidates.splice(0))socket.emit('webrtc-ice',{to:from,candidate:c,screenId:String(id),viewerId:s.viewerId});}catch(e){console.error('OBS offer',e);restart(id);}});
socket.on('webrtc-ice',async({candidate,screenId,viewerId})=>{const id=Number(screenId),s=viewers[id];if(!s||s.viewerId!==String(viewerId)||!candidate)return;if(s.pc.remoteDescription)await s.pc.addIceCandidate(candidate).catch(()=>{});else s.remoteCandidates.push(candidate);});
socket.on('layout-clear',clearLayout);
socket.on('layout-update',(payload={})=>{
 if(payload.mode==='dual'){
  const left=Number(payload.left),right=Number(payload.right);
  if(!Number.isInteger(left)||!Number.isInteger(right)||left<1||left>SCREEN_COUNT||right<1||right>SCREEN_COUNT||left===right)return;
  applyLayout({mode:'dual',left,right});
  for(const id of [left,right])if(online[id]&&!viewers[id])startViewer(id);
 }else{
  const id=Number(payload.screenId);if(!Number.isInteger(id)||id<1||id>SCREEN_COUNT)return;
  applyLayout({mode:'single',id});if(online[id]&&!viewers[id])startViewer(id);
 }
});

// Keep an active OBS video alive after Chromium/CEF visibility or decoder hiccups.
setInterval(()=>{
 for(const id of activeIds()){
  const v=videos[id-1];
  if(hasLiveTrack(id)){
   if(v.paused)v.play().catch(()=>{});
   if(v.readyState>=2&&v.style.opacity!=='1')v.style.opacity='1';
  }
 }
},1000);
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')for(const id of activeIds())wake(id);});

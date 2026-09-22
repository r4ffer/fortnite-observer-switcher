const socket=io();
const id=new URLSearchParams(location.search).get('id');
const start=document.getElementById('start'),stop=document.getElementById('stop'),status=document.getElementById('status'),localVideo=document.getElementById('local'),number=document.getElementById('number');
const peers=new Map(),pending=new Map();let stream=null;
const rtcConfig={iceServers:[{urls:'stun:stun.l.google.com:19302'}],iceCandidatePoolSize:0,bundlePolicy:'max-bundle',rtcpMuxPolicy:'require'};
const valid=/^[1-8]$/.test(id||'');const name=valid?`画面共有${id}`:'画面共有';document.title=name;number.textContent=name;
if(!valid)start.disabled=true;

start.onclick=async()=>{
 if(!navigator.mediaDevices||!navigator.mediaDevices.getDisplayMedia){status.textContent=location.protocol!=='https:'?'このページはHTTPSで開いてください。HTTPでは画面共有できません。':'このブラウザでは画面共有に対応していません。';return;}
 start.disabled=true;status.textContent='画面共有を準備中…';
 try{
  const nextStream=await navigator.mediaDevices.getDisplayMedia({video:{width:{ideal:1920,max:3840},height:{ideal:1080,max:2160},frameRate:{ideal:60,max:60},cursor:'always'},audio:false});
  stream=nextStream;
  const track=stream.getVideoTracks()[0];
  if(!track)throw new Error('共有トラックを取得できませんでした。');
  try{await track.applyConstraints({width:{ideal:1920},height:{ideal:1080},frameRate:{ideal:60}});}catch(_){ }
  track.addEventListener('mute',()=>{if(stream)status.textContent='画面共有中（映像を復旧しています…）';});
  track.addEventListener('unmute',()=>{if(stream)status.textContent='画面共有中';});
  localVideo.srcObject=stream;
  try{await localVideo.play();}catch(_){ }
  stop.disabled=false;status.textContent='画面共有中';
  socket.emit('register-screen',{screenId:id});
  track.addEventListener('ended',()=>{if(stream)stopSharing();},{once:true});
 }catch(e){
  start.disabled=false;stop.disabled=true;
  const n=e?.name||'';
  if(n==='NotAllowedError')status.textContent='画面共有が許可されませんでした。共有する画面を選んで「共有」を押してください。';
  else if(n==='AbortError')status.textContent='画面共有の選択がキャンセルされました。';
  else if(n==='SecurityError'||n==='TypeError')status.textContent='画面共有にはHTTPSが必要です。';
  else status.textContent='画面共有を開始できませんでした。再度「画面を共有する」を押してください。';
  console.error('getDisplayMedia failed:',e);
 }
};
stop.onclick=stopSharing;
function stopSharing(){
 stopThumbnailLoop();
 for(const pc of peers.values())try{pc.close()}catch(_){ }
 peers.clear();pending.clear();
 if(stream)stream.getTracks().forEach(t=>t.stop());
 stream=null;localVideo.srcObject=null;socket.emit('unregister-screen',{screenId:id});
 start.disabled=false;stop.disabled=true;status.textContent='';
}
socket.on('replaced',stopSharing);
socket.on('connect',()=>{
 for(const pc of peers.values())try{pc.close()}catch(_){ }
 peers.clear();pending.clear();
 if(stream){socket.emit('register-screen',{screenId:id});startThumbnailLoop();}
});
socket.on('viewer-stop',({viewerId,screenId}={})=>{
 const key=String(viewerId||'');if(String(screenId)!==String(id)||!key)return;
 const pc=peers.get(key);if(pc)try{pc.close()}catch(_){ }
 peers.delete(key);pending.delete(key);
});

// Every actual WebRTC viewer stays at the requested 1920x1080 / 60 FPS target.
// Thumbnails are JPEG snapshots and never change the real media track quality.
async function applyHighQuality(pc){
 try{
  for(const sender of pc.getSenders()){
   if(sender.track?.kind!=='video')continue;
   const p=sender.getParameters();
   p.encodings=p.encodings?.length?p.encodings:[{}];
   const e=p.encodings[0];
   e.maxBitrate=12000000;e.maxFramerate=60;e.scaleResolutionDownBy=1;e.priority='high';
   p.degradationPreference='maintain-resolution';
   await sender.setParameters(p);
  }
 }catch(_){ }
}

socket.on('viewer-request',async({viewerId,viewerSocket,screenId})=>{
 if(String(screenId)!==String(id)||!stream)return;
 const key=String(viewerId||viewerSocket);
 if(peers.has(key))try{peers.get(key).close()}catch(_){ }
 const pc=new RTCPeerConnection(rtcConfig);peers.set(key,pc);pending.set(key,[]);
 pc.onicecandidate=e=>{if(e.candidate)socket.emit('webrtc-ice',{to:viewerSocket,candidate:e.candidate,screenId:id,viewerId:key});};
 pc.onconnectionstatechange=()=>{if(['failed','closed'].includes(pc.connectionState)){if(peers.get(key)===pc)peers.delete(key);pending.delete(key);}};
 try{
  for(const track of stream.getTracks()){pc.addTrack(track,stream);try{track.contentHint='detail'}catch(_){ }}
  await applyHighQuality(pc);
  await pc.setLocalDescription(await pc.createOffer());
  socket.emit('webrtc-offer',{to:viewerSocket,offer:pc.localDescription,screenId:id,viewerId:key});
 }catch(e){console.error('share offer',e);try{pc.close()}catch(_){ }peers.delete(key);pending.delete(key);}
});
socket.on('webrtc-answer',async({from,answer,screenId,viewerId})=>{
 if(String(screenId)!==String(id))return;const pc=peers.get(String(viewerId));if(!pc)return;
 try{await pc.setRemoteDescription(answer);const q=pending.get(String(viewerId))||[];for(const c of q)await pc.addIceCandidate(c).catch(()=>{});pending.set(String(viewerId),[]);}catch(e){console.error('share answer',e);}
});
socket.on('webrtc-ice',async({candidate,screenId,viewerId})=>{
 if(String(screenId)!==String(id)||!candidate)return;const pc=peers.get(String(viewerId));if(!pc)return;const key=String(viewerId);
 if(pc.remoteDescription)await pc.addIceCandidate(candidate).catch(()=>{});else{if(!pending.has(key))pending.set(key,[]);pending.get(key).push(candidate);}
});

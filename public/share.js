const socket=io();
const id=new URLSearchParams(location.search).get('id');
const start=document.getElementById('start'),stop=document.getElementById('stop'),status=document.getElementById('status'),localVideo=document.getElementById('local'),number=document.getElementById('number');
const peers=new Map(),pending=new Map();let stream=null;
const rtcConfig={iceServers:[{urls:'stun:stun.l.google.com:19302'},{urls:'stun:stun1.l.google.com:19302'}],iceCandidatePoolSize:10,bundlePolicy:'max-bundle',rtcpMuxPolicy:'require'};
const valid=/^[1-8]$/.test(id||'');const name=valid?`画面共有${id}`:'画面共有';document.title=name;number.textContent=name;
if(!valid)start.disabled=true;
start.onclick=async()=>{
 if(!navigator.mediaDevices||!navigator.mediaDevices.getDisplayMedia){status.textContent=location.protocol!=='https:'?'このページはHTTPSで開いてください。HTTPでは画面共有できません。':'このブラウザでは画面共有に対応していません。';return;}
 start.disabled=true;status.textContent='画面共有を準備中…';
 try{
  const nextStream=await navigator.mediaDevices.getDisplayMedia({video:{width:{ideal:1920},height:{ideal:1080},frameRate:{ideal:60}},audio:false});
  stream=nextStream;
  const track=stream.getVideoTracks()[0];
  if(!track){throw new Error('共有トラックを取得できませんでした。');}
  localVideo.srcObject=stream;
  try{await localVideo.play();}catch(_){}
  stop.disabled=false;
  status.textContent='画面共有中';
  socket.emit('register-screen',{screenId:id});
  track.addEventListener('ended',()=>{if(stream)stopSharing();},{once:true});
 }catch(e){
  start.disabled=false;stop.disabled=true;
  const n=e?.name||'';
  if(n==='NotAllowedError') status.textContent='画面共有が許可されませんでした。共有する画面を選んで「共有」を押してください。';
  else if(n==='AbortError') status.textContent='画面共有の選択がキャンセルされました。';
  else if(n==='SecurityError'||n==='TypeError') status.textContent='画面共有にはHTTPSが必要です。レンタルサーバーをHTTPSで開いてください。';
  else status.textContent='画面共有を開始できませんでした。再度「画面を共有する」を押してください。';
  console.error('getDisplayMedia failed:',e);
 }
};
stop.onclick=stopSharing;
function stopSharing(){for(const pc of peers.values())try{pc.close()}catch(_){}peers.clear();pending.clear();if(stream)stream.getTracks().forEach(t=>t.stop());stream=null;localVideo.srcObject=null;socket.emit('unregister-screen',{screenId:id});start.disabled=false;stop.disabled=true;status.textContent='';}
socket.on('replaced',stopSharing);
// Socket.io reconnects with a new socket.id after any network hiccup. The server drops this
// screen from its registry on disconnect, so without re-registering here the source would stay
// "online" locally (getDisplayMedia is still running) while every viewer/OBS shows it as offline
// forever. Any peer connections negotiated with the old socket.id are also dead (the other side's
// signaling path no longer resolves), so drop them and let fresh viewer-requests recreate them.
socket.on('connect',()=>{
 for(const pc of peers.values())try{pc.close()}catch(_){}
 peers.clear();pending.clear();
 if(stream)socket.emit('register-screen',{screenId:id});
});
socket.on('viewer-request',async({viewerId,viewerSocket,screenId})=>{if(String(screenId)!==String(id)||!stream)return;const key=String(viewerId||viewerSocket);if(peers.has(key))try{peers.get(key).close()}catch(_){}const pc=new RTCPeerConnection(rtcConfig);peers.set(key,pc);pending.set(key,[]);pc.onicecandidate=e=>{if(e.candidate)socket.emit('webrtc-ice',{to:viewerSocket,candidate:e.candidate,screenId:id,viewerId:key});};pc.onconnectionstatechange=()=>{if(['failed','closed'].includes(pc.connectionState)){if(peers.get(key)===pc)peers.delete(key);pending.delete(key);}};try{for(const track of stream.getTracks()){const sender=pc.addTrack(track,stream);try{const p=sender.getParameters();p.encodings=p.encodings?.length?p.encodings:[{}];p.encodings[0].maxBitrate=12000000;p.encodings[0].maxFramerate=60;p.encodings[0].scaleResolutionDownBy=1;await sender.setParameters(p);}catch(_){}try{track.contentHint='detail'}catch(_){}}await pc.setLocalDescription(await pc.createOffer());socket.emit('webrtc-offer',{to:viewerSocket,offer:pc.localDescription,screenId:id,viewerId:key});}catch(e){console.error(e);}});
socket.on('webrtc-answer',async({from,answer,screenId,viewerId})=>{if(String(screenId)!==String(id))return;const pc=peers.get(String(viewerId));if(!pc)return;try{await pc.setRemoteDescription(answer);const q=pending.get(String(viewerId))||[];for(const c of q)await pc.addIceCandidate(c).catch(()=>{});pending.set(String(viewerId),[]);}catch(e){console.error(e);}});
socket.on('webrtc-ice',async({candidate,screenId,viewerId})=>{if(String(screenId)!==String(id)||!candidate)return;const pc=peers.get(String(viewerId));if(!pc)return;const key=String(viewerId);if(pc.remoteDescription)await pc.addIceCandidate(candidate).catch(()=>{});else{if(!pending.has(key))pending.set(key,[]);pending.get(key).push(candidate);}});

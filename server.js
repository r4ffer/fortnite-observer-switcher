const path=require('path');
const fs=require('fs');
const express=require('express');
const http=require('http');
const {Server}=require('socket.io');
const app=express();
const server=http.createServer(app);
const io=new Server(server,{maxHttpBufferSize:2*1024*1024, transports:['websocket','polling']});
const PORT=process.env.PORT||3000;
const screens=new Map(); // screenId -> broadcaster socket id
const SCREEN_COUNT=8;
const watchers=new Map(Array.from({length:SCREEN_COUNT},(_,i)=>[String(i+1),new Map()])); // screen -> viewer socket -> viewerId
const obsClients=new Set();
let currentLayout=null; // last layout sent to OBS via 投映: {mode:'single',screenId} | {mode:'dual',left,right} - kept so late/reloaded OBS clients can sync immediately
app.use(express.static(path.join(__dirname,'public'),{etag:false,lastModified:false,setHeaders:r=>r.setHeader('Cache-Control','no-store')}));
app.get('/api/dual-background',(_,r)=>{
  // Look up the optional 2-screen background image by scanning public/ case-insensitively
  // (e.g. "Back.PNG" or "BACK.jpg" should still be found) rather than guessing exact filenames
  // client-side, since Linux filesystems are case-sensitive and a mismatch would silently fail.
  r.set('Cache-Control','no-store');
  try{
    const files=fs.readdirSync(path.join(__dirname,'public'));
    const match=files.find(f=>/^back\.(png|jpe?g)$/i.test(f));
    r.json({file:match?`/${encodeURIComponent(match)}`:null});
  }catch(_){r.json({file:null});}
});
app.get('/',(_,r)=>r.sendFile(path.join(__dirname,'public/index.html')));
app.get('/share',(_,r)=>r.sendFile(path.join(__dirname,'public/share.html')));
app.get('/obs',(_,r)=>r.sendFile(path.join(__dirname,'public/obs.html')));
function status(){return Array.from({length:SCREEN_COUNT},(_,i)=>i+1).map(id=>({screenId:String(id),connected:screens.has(String(id))}));}
function broadcastStatus(){io.emit('screen-status',status());}
function removeViewer(socket,id){watchers.get(id)?.delete(socket.id); socket.data.watchIds?.delete(id);}
function layoutStillValid(l){
  if(!l)return false;
  if(l.mode==='dual')return screens.has(l.left)&&screens.has(l.right);
  return screens.has(l.screenId);
}
function forward(to,event,payload){if(to&&io.sockets.sockets.has(to))io.to(to).emit(event,payload);}
io.on('connection',socket=>{
  socket.emit('screen-status',status());
  socket.emit('obs-status',{connected:obsClients.size>0});

  socket.on('screen-status-request',()=>socket.emit('screen-status',status()));
  socket.on('register-obs',()=>{obsClients.add(socket.id);socket.data.isObs=true;io.emit('obs-status',{connected:true}); socket.emit('screen-status',status());if(currentLayout&&layoutStillValid(currentLayout))socket.emit('layout-update',currentLayout);});
  socket.on('register-screen',({screenId}={})=>{
    const id=String(screenId||''); if(!/^[1-8]$/.test(id))return;
    const old=screens.get(id);
    if(old&&old!==socket.id){io.to(old).emit('replaced');const os=io.sockets.sockets.get(old);if(os)delete os.data.screenId;}
    screens.set(id,socket.id);socket.data.screenId=id;broadcastStatus();
  });
  socket.on('unregister-screen',({screenId}={})=>{
    const id=String(screenId||socket.data.screenId||'');
    if(screens.get(id)===socket.id){
      screens.delete(id);
      // Tell all viewers that this source is gone.
      for(const viewer of watchers.get(id)?.keys()||[])io.to(viewer).emit('source-stopped',{screenId:id});
      watchers.get(id)?.clear();
      delete socket.data.screenId;broadcastStatus();
    }
  });
  socket.on('watch-screen',({screenId,viewerId}={})=>{
    const id=String(screenId||''); if(!/^[1-8]$/.test(id)||!viewerId)return;
    const source=screens.get(id); if(!source){socket.emit('watch-failed',{screenId:id,reason:'SCREEN_OFFLINE'});return;}
    // One viewer connection per viewer socket and screen. Re-watch replaces only that viewer's old connection.
    watchers.get(id).set(socket.id,String(viewerId));
    socket.data.watchIds??=new Set(); socket.data.watchIds.add(id);
    socket.emit('watch-started',{screenId:id,source});
    io.to(source).emit('viewer-request',{viewerId:String(viewerId),viewerSocket:socket.id,screenId:id});
  });
  socket.on('stop-watching',({screenId}={})=>removeViewer(socket,String(screenId||'')));

  // WebRTC signaling: always include both socket ids and viewer id so multiple screens/viewers stay isolated.
  socket.on('webrtc-offer',({to,offer,screenId,viewerId}={})=>{
    forward(to,'webrtc-offer',{from:socket.id,offer,screenId:String(screenId),viewerId:String(viewerId||'')});
  });
  socket.on('webrtc-answer',({to,answer,screenId,viewerId}={})=>{
    forward(to,'webrtc-answer',{from:socket.id,answer,screenId:String(screenId),viewerId:String(viewerId||'')});
  });
  socket.on('webrtc-ice',({to,candidate,screenId,viewerId}={})=>{
    forward(to,'webrtc-ice',{from:socket.id,candidate,screenId:String(screenId),viewerId:String(viewerId||'')});
  });
  socket.on('viewer-stop',({to,viewerId,screenId}={})=>forward(to,'viewer-stop',{viewerId,screenId}));

  socket.on('clear-layout',()=>{
    // Clear the active OBS layout. Keep the controller's local selection/Preview untouched.
    currentLayout=null;
    for(const o of obsClients)io.to(o).emit('layout-clear');
  });

  socket.on('execute-layout',(payload={})=>{
    let layout;
    if(payload.mode==='dual'){
      const left=String(payload.left||''),right=String(payload.right||'');
      if(!/^[1-8]$/.test(left)||!/^[1-8]$/.test(right)||left===right)return;
      layout={mode:'dual',left,right};
    }else{
      const id=String(payload.screenId||'');if(!/^[1-8]$/.test(id))return;
      layout={mode:'single',screenId:id};
    }
    currentLayout=layout;
    for(const o of obsClients)io.to(o).emit('layout-update',layout);
  });

  socket.on('disconnect',()=>{
    for(const id of socket.data.watchIds||[])removeViewer(socket,id);
    const id=socket.data.screenId;
    if(id&&screens.get(id)===socket.id){
      screens.delete(id);
      for(const viewer of watchers.get(id)?.keys()||[])io.to(viewer).emit('source-stopped',{screenId:id});
      watchers.get(id)?.clear();broadcastStatus();
    }
    if(obsClients.delete(socket.id))io.emit('obs-status',{connected:obsClients.size>0});
  });
});
server.listen(PORT,()=>console.log(`Fortnite Observer Switcher: http://localhost:${PORT}`));

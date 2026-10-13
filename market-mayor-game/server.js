'use strict';
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const crypto = require('crypto');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_req, res) => res.json({ ok: true, app: '시장 쟁탈전' }));
const PORT = process.env.PORT || 3000;
const rooms = new Map();

const RES = ['C', 'I', 'O', 'E'];
const RES_LABEL = { C: '시민', I: '지식인', O: '조직원', E: '상류층' };
const LOC = { plaza: { label: '광장', resource: 'C' }, shops: { label: '상가 인근', resource: 'I' }, tavern: { label: '술집', resource: 'O' }, cityhall: { label: '시청', resource: 'E' } };
const CARDS = [
 { id:'campaign', name:'지역구 유세', family:'C', timing:'day', cost:{C:3}, desc:'시민 자원 4장 획득.', effect:'gain', gain:{C:4}, copies:3 },
 { id:'public-fund', name:'공공 후원금', family:'C', timing:'day', cost:{C:2,I:1}, desc:'시민 자원 2장과 지식인 자원 2장 획득.', effect:'gain', gain:{C:2,I:2}, copies:3 },
 { id:'appeal', name:'약자 호소', family:'C', timing:'day', cost:{C:2,O:1}, desc:'현재 지지 포인트가 공동 최저라면 시민 5장, 아니면 시민 3장 획득.', effect:'appeal', copies:3 },
 { id:'fundraising', name:'선거자금 조달', family:'C', timing:'night', cost:{C:2,E:1}, desc:'시민 자원 3장과 지식인 자원 1장 획득.', effect:'gain', gain:{C:3,I:1}, copies:3 },
 { id:'policy', name:'정책 발표', family:'I', timing:'day', cost:{I:3}, desc:'시민 자원 3장과 지식인 자원 1장 획득.', effect:'gain', gain:{C:3,I:1}, copies:3 },
 { id:'shift', name:'민심 이동', family:'I', timing:'day', cost:{I:2,C:1}, desc:'상대 한 명의 시민 자원 최대 2장을 가져온다.', effect:'steal', target:true, stealTypes:['C'], stealMax:2, copies:3 },
 { id:'advice', name:'정책 자문', family:'I', timing:'day', cost:{I:2,O:1}, desc:'시민 자원 2장과 지식인 자원 2장 획득.', effect:'gain', gain:{C:2,I:2}, copies:3 },
 { id:'press', name:'언론 보호', family:'I', timing:'day', cost:{I:2}, desc:'이번 턴 밤이 끝날 때까지 상대의 자원 강탈 효과를 한 번 막는다.', effect:'protect', copies:3 },
 { id:'network', name:'전문가 네트워크', family:'I', timing:'day', cost:{I:2,E:1}, desc:'지식인 자원 2장과 조직원 자원 2장 획득.', effect:'gain', gain:{I:2,O:2}, copies:3 },
 { id:'pickpocket', name:'소매치기', family:'O', timing:'night', cost:{O:3}, desc:'상대의 권력층 자원 최대 2장을 선택해 빼앗는다.', effect:'steal', target:true, stealTypes:RES, stealMax:2, copies:3 },
 { id:'intimidate', name:'협박', family:'O', timing:'night', cost:{O:2}, desc:'상대는 선택한 권력층 자원 최대 3장을 공용 공급처로 돌려보낸다.', effect:'destroy', target:true, stealTypes:RES, stealMax:3, copies:3 },
 { id:'market-block', name:'거래 중단', family:'O', timing:'night', cost:{O:2}, desc:'공개 시장의 특수 카드 한 장을 버리고 새 카드로 교체한다.', effect:'discardMarket', marketTarget:true, copies:3 },
 { id:'rumor', name:'괴소문 유포', family:'O', timing:'night', cost:{O:2}, desc:'상대의 시민 자원 최대 2장을 제거하고, 자신은 시민 1장을 얻는다.', effect:'rumor', target:true, copies:3 },
 { id:'cityhall-block', name:'시청 봉쇄', family:'O', timing:'night', cost:{O:2,E:1}, desc:'다음 턴 낮 장소 선택에서 시청을 폐쇄한다. 시청 선택자는 시민 1장을 받는다.', effect:'closeCityhall', copies:3 },
 { id:'corporate', name:'대기업 후원회', family:'E', timing:'day', cost:{E:4}, desc:'시민 자원 5장과 지식인 자원 1장 획득.', effect:'gain', gain:{C:5,I:1}, copies:3 },
 { id:'executive', name:'행정명령', family:'E', timing:'night', cost:{E:3,O:1}, desc:'상대의 권력층 자원 최대 3장을 선택해 빼앗는다.', effect:'steal', target:true, stealTypes:RES, stealMax:3, copies:3 },
 { id:'political-network', name:'정계 인맥', family:'E', timing:'night', cost:{E:3}, desc:'시민 자원 2장과 상류층 자원 2장 획득.', effect:'gain', gain:{C:2,E:2}, copies:3 },
 { id:'backroom', name:'밀실 거래', family:'E', timing:'night', cost:{E:3,I:1}, desc:'공개 시장의 다른 특수 카드 한 장을 무료로 가져온다. 가져온 카드는 다음 턴부터 사용할 수 있다.', effect:'takeMarket', marketTarget:true, copies:3 }
];
const CARD_BY_ID = Object.fromEntries(CARDS.map(c=>[c.id,c]));
const cleanName = s => String(s || '').trim().replace(/[<>\u0000-\u001f]/g,'').slice(0,20) || '플레이어';
const makeId = (n=9) => crypto.randomBytes(n).toString('hex');
const code6 = () => crypto.randomBytes(4).toString('hex').toUpperCase().slice(0,6);
function shuffle(arr) { for(let i=arr.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[arr[i],arr[j]]=[arr[j],arr[i]];} return arr; }
function points(p){return RES.reduce((s,r)=>s+p.resources[r],0);}
function cap(room, loc){ if(loc==='plaza')return Infinity; if(room.maxPlayers>6) return ({shops:4,tavern:3,cityhall:2}[loc]); return ({shops:2,tavern:2,cityhall:1}[loc]); }
function priorityPlayers(room){ const n=room.players.length; if(!n)return []; const start=(room.turn-1)%n; return Array.from({length:n},(_,i)=>room.players[(start+i)%n]); }
function makeSpecialDeck(maxPlayers){const copies=maxPlayers>6?3:2;return shuffle(CARDS.flatMap(c=>Array.from({length:copies},()=>({instanceId:makeId(6),cardId:c.id}))));}
function refillMarket(room){const target=room.maxPlayers>6?5:4;while(room.market.length<target){if(!room.deck.length && room.discard.length){room.deck=shuffle(room.discard.splice(0));}if(!room.deck.length)break;room.market.push(room.deck.shift());}}
function newRoom(socket, name, playerId, maxPlayers){
 let code; do{code=code6();}while(rooms.has(code));
 const p={id:playerId||makeId(12),name:cleanName(name),socketId:socket.id,connected:true,resources:{C:0,I:0,O:0,E:0},hand:[],chosen:null,dayDone:false,nightBought:false,nightDone:false,protectedUntilTurn:0,protectCharges:0};
 const room={code,hostId:p.id,maxPlayers:maxPlayers===10?10:6,players:[p],turn:1,phase:'lobby',createdAt:Date.now(),deck:[],market:[],discard:[],actionOrder:[],actionIndex:0,cityhallClosedTurn:0,log:[`${p.name}님이 방을 만들었습니다.`],winner:[]};
 room.deck=makeSpecialDeck(room.maxPlayers);refillMarket(room);rooms.set(code,room);socket.join(code);p.socketId=socket.id;return room;
}
function playerById(room,id){return room.players.find(p=>p.id===id);}
function cardDef(instance){return CARD_BY_ID[instance.cardId];}
function addLog(room, s){room.log.unshift(s);room.log=room.log.slice(0,35);}
function publicState(room, viewerId){
 const me=playerById(room,viewerId); const current=room.actionOrder[room.actionIndex];
 return {code:room.code,choiceCount:room.players.filter(p=>p.chosen).length,maxPlayers:room.maxPlayers,hostId:room.hostId,turn:room.turn,phase:room.phase,started:room.phase!=='lobby',players:room.players.map(p=>({id:p.id,name:p.name,connected:p.connected,resources:{...p.resources},score:points(p),handCount:p.hand.length,isCurrent:current===p.id,chosen:p.id===viewerId?p.chosen:null,dayDone:p.dayDone,nightBought:p.nightBought,nightDone:p.nightDone,protected:p.protectCharges>0})),me:me?{id:me.id,name:me.name,resources:{...me.resources},score:points(me),hand:me.hand.map(i=>({...i,card:{...CARD_BY_ID[i.cardId]}})),isHost:room.hostId===me.id,dayDone:me.dayDone,nightBought:me.nightBought,nightDone:me.nightDone,chosen:me.chosen}:null,market:room.market.map(i=>({...i,card:{...CARD_BY_ID[i.cardId]}})),locations:Object.fromEntries(Object.entries(LOC).map(([id,l])=>[id,{...l,capacity:cap(room,id),closed: id==='cityhall' && room.phase==='dayChoose' && room.cityhallClosedTurn===room.turn}])),actionPlayer:playerById(room,current)?{id:current,name:playerById(room,current).name}:null,log:room.log,winner:room.winner.map(id=>({id,name:playerById(room,id)?.name||'플레이어',score:playerById(room,id)?points(playerById(room,id)):0}))};
}
function broadcast(room){ for(const p of room.players){if(p.socketId)io.to(p.socketId).emit('state',publicState(room,p.id));} }
function fail(socket,msg){socket.emit('notice',{type:'error',message:msg});}
function moveToNextAction(room, kind){room.actionIndex++; if(room.actionIndex>=room.actionOrder.length){room.actionIndex=0;if(kind==='day'){room.phase='nightChoose';for(const p of room.players)p.chosen=null;addLog(room,`턴 ${room.turn}: 밤 장소 선택이 시작됐습니다.`);}else{finishTurn(room);}} broadcast(room);}
function startActions(room, kind){room.actionOrder=priorityPlayers(room).map(p=>p.id);room.actionIndex=0;for(const p of room.players){if(kind==='day')p.dayDone=false;else{p.nightBought=false;p.nightDone=false;}}room.phase=kind==='day'?'dayActions':'nightActions';addLog(room,kind==='day'?'낮 특수 카드 사용 순서입니다.':'밤 구매 및 특수 카드 사용 순서입니다.');}
function resolveLocations(room, kind){
 const order=priorityPlayers(room); const selections=room.players.map(p=>({p,loc:p.chosen}));
 for(const sel of selections){ if(!sel.loc || !LOC[sel.loc])sel.loc='plaza'; }
 const grouped={}; for(const s of selections)(grouped[s.loc] ||= []).push(s.p);
 for(const [loc,arr] of Object.entries(grouped)){
   let allowed=cap(room,loc);
   if(loc==='cityhall' && kind==='day' && room.cityhallClosedTurn===room.turn)allowed=0;
   const ordered=order.filter(p=>arr.some(q=>q.id===p.id));
   ordered.forEach((p,i)=>{const resource=(i<allowed?LOC[loc].resource:'C');p.resources[resource]++;addLog(room,`${p.name}님은 ${i<allowed?LOC[loc].label+'에서 '+RES_LABEL[resource]+' 자원':'장소 경쟁에서 밀려 시민 자원'}을 얻었습니다.`);});
 }
 for(const p of room.players)p.chosen=null;
 if(kind==='day')startActions(room,'day');else startActions(room,'night');
 broadcast(room);
}
function takeResource(p,type,count){const n=Math.min(p.resources[type],count);p.resources[type]-=n;return n;}
function gainResources(p,gain){for(const [r,n] of Object.entries(gain||{}))p.resources[r]+=n;}
function canPay(p,cost){return RES.every(r=>p.resources[r]>=(cost[r]||0));}
function pay(p,cost){for(const r of RES)p.resources[r]-=(cost[r]||0);}
function currentActor(room, pid){const actor=room.actionOrder[room.actionIndex];return actor && actor===pid;}
function executeCard(room, actor, cardInst, payload){
 const c=CARD_BY_ID[cardInst.cardId]; const target=playerById(room,payload?.targetId); const rt=RES.includes(payload?.resourceType)?payload.resourceType:'C';
 switch(c.effect){
  case 'gain':gainResources(actor,c.gain);break;
  case 'appeal':{const min=Math.min(...room.players.map(p=>points(p)));gainResources(actor,{C:points(actor)===min?5:3});break;}
  case 'steal':{
    if(!target || target.id===actor.id)break;
    if(target.protectCharges>0){target.protectCharges--;addLog(room,`${target.name}님의 언론 보호가 강탈을 막았습니다.`);break;}
    let remaining=c.stealMax;const allowed=c.stealTypes||RES;const ordered=payload?.resourceType && allowed.includes(rt)?[rt,...allowed.filter(r=>r!==rt)]:allowed;
    let stolen=0;for(const r of ordered){const n=takeResource(target,r,remaining);actor.resources[r]+=n;remaining-=n;stolen+=n;if(!remaining)break;}addLog(room,`${actor.name}님이 ${target.name}님에게서 자원 ${stolen}장을 빼앗았습니다.`);break;
  }
  case 'destroy':{
    if(!target||target.id===actor.id)break;let remain=c.stealMax;const allowed=c.stealTypes||RES;const ordered=payload?.resourceType&&allowed.includes(rt)?[rt,...allowed.filter(r=>r!==rt)]:allowed;let destroyed=0;for(const r of ordered){const n=takeResource(target,r,remain);remain-=n;destroyed+=n;if(!remain)break;}addLog(room,`${target.name}님이 자원 ${destroyed}장을 잃었습니다.`);break;
  }
  case 'protect':actor.protectedUntilTurn=room.turn;actor.protectCharges=1;addLog(room,`${actor.name}님은 이번 밤 강탈 보호를 얻었습니다.`);break;
  case 'discardMarket':{
    const idx=room.market.findIndex(i=>i.instanceId===payload?.marketInstanceId);if(idx>=0){const [old]=room.market.splice(idx,1);room.discard.push(old);refillMarket(room);addLog(room,`${actor.name}님이 공개 시장의 ${CARD_BY_ID[old.cardId].name}을 교체했습니다.`);}break;
  }
  case 'rumor':{
    if(!target||target.id===actor.id)break;const n=takeResource(target,'C',2);actor.resources.C++;addLog(room,`${actor.name}님의 괴소문으로 ${target.name}님은 시민 ${n}장을 잃었습니다.`);break;
  }
  case 'closeCityhall':room.cityhallClosedTurn=room.turn+1;addLog(room,'다음 턴 낮에는 시청이 봉쇄됩니다.');break;
  case 'takeMarket':{
    const idx=room.market.findIndex(i=>i.instanceId===payload?.marketInstanceId);if(idx>=0&&actor.hand.length<4){const [taken]=room.market.splice(idx,1);actor.hand.push({...taken,usableFromTurn:room.turn+1});refillMarket(room);addLog(room,`${actor.name}님이 밀실 거래로 ${CARD_BY_ID[taken.cardId].name}을 확보했습니다.`);}else addLog(room,'밀실 거래 대상이 유효하지 않아 효과가 적용되지 않았습니다.');break;
  }
 }
 addLog(room,`${actor.name}님이 ${c.name}을(를) 사용했습니다.`);
}
function finishTurn(room){
 for(const p of room.players){p.protectCharges=0;p.protectedUntilTurn=0;}
 if(room.turn>=10){room.phase='finished';const best=Math.max(...room.players.map(points));room.winner=room.players.filter(p=>points(p)===best).map(p=>p.id);addLog(room,`게임 종료! 최종 최고 지지 포인트는 ${best}점입니다.`);}
 else {room.turn++;room.phase='dayChoose';room.cityhallClosedTurn=room.cityhallClosedTurn===room.turn?room.cityhallClosedTurn:room.cityhallClosedTurn;for(const p of room.players){p.chosen=null;p.dayDone=false;p.nightBought=false;p.nightDone=false;}addLog(room,`턴 ${room.turn} 시작: 낮 장소를 선택하세요.`);}
 broadcast(room);
}

function advanceDisconnected(room){
  for(let guard=0;guard<8;guard++){
    if(room.phase==='dayChoose'||room.phase==='nightChoose'){
      for(const p of room.players)if(!p.connected&&!p.chosen)p.chosen='plaza';
      if(room.players.every(p=>p.chosen)){resolveLocations(room,room.phase==='dayChoose'?'day':'night');continue;}
      break;
    }
    if(room.phase==='dayActions'||room.phase==='nightActions'){
      const kind=room.phase==='dayActions'?'day':'night';
      while(room.actionIndex<room.actionOrder.length){const pid=room.actionOrder[room.actionIndex];const actor=playerById(room,pid);if(actor&&actor.connected)break;if(actor){if(kind==='day')actor.dayDone=true;else{actor.nightBought=true;actor.nightDone=true;}addLog(room,`${actor.name}님의 연결이 없어 이번 행동을 건너뜁니다.`);}room.actionIndex++;}
      if(room.actionIndex>=room.actionOrder.length){room.actionIndex=0;if(kind==='day'){room.phase='nightChoose';for(const p of room.players)p.chosen=null;addLog(room,'낮 행동이 끝났습니다. 밤 장소를 선택하세요.');continue;}finishTurn(room);continue;}
      break;
    }
    break;
  }
  broadcast(room);
}

function resetRoomForGame(room){room.turn=1;room.phase='dayChoose';room.winner=[];room.log=[];room.cityhallClosedTurn=0;room.deck=makeSpecialDeck(room.maxPlayers);room.market=[];room.discard=[];refillMarket(room);room.actionOrder=[];room.actionIndex=0;room.players.forEach(p=>{p.resources={C:0,I:0,O:0,E:0};p.hand=[];p.chosen=null;p.dayDone=false;p.nightBought=false;p.nightDone=false;p.protectedUntilTurn=0;p.protectCharges=0;});addLog(room,'게임 시작! 낮에 첫 장소를 선택하세요.');}

io.on('connection',socket=>{
 socket.on('createRoom',(data={})=>{
   const maxPlayers=Number(data.maxPlayers)===10?10:6;const room=newRoom(socket,data.name,data.playerId,maxPlayers);socket.data.roomCode=room.code;socket.data.playerId=room.players[0].id;socket.emit('roomCreated',{code:room.code,playerId:room.players[0].id});broadcast(room);
 });
 socket.on('joinRoom',(data={})=>{
   const code=String(data.code||'').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,6);const room=rooms.get(code);if(!room)return fail(socket,'방을 찾을 수 없습니다. 참가 코드를 확인해 주세요.');
   const pid=String(data.playerId||makeId(12));let p=playerById(room,pid);
   if(!p){if(room.phase!=='lobby')return fail(socket,'게임이 이미 시작되어 새 참가자는 들어올 수 없습니다.');if(room.players.length>=room.maxPlayers)return fail(socket,'방이 가득 찼습니다.');p={id:pid,name:cleanName(data.name),socketId:socket.id,connected:true,resources:{C:0,I:0,O:0,E:0},hand:[],chosen:null,dayDone:false,nightBought:false,nightDone:false,protectedUntilTurn:0,protectCharges:0};room.players.push(p);addLog(room,`${p.name}님이 참가했습니다.`);}else{p.socketId=socket.id;p.connected=true;if(data.name)p.name=cleanName(data.name);addLog(room,`${p.name}님이 다시 연결했습니다.`);}
   socket.join(code);socket.data.roomCode=code;socket.data.playerId=p.id;socket.emit('roomJoined',{code,playerId:p.id});broadcast(room);
 });
 socket.on('startGame',()=>{const room=rooms.get(socket.data.roomCode);if(!room)return;const pid=socket.data.playerId;if(room.hostId!==pid)return fail(socket,'방장만 게임을 시작할 수 있습니다.');if(room.phase!=='lobby')return;if(room.players.length<2)return fail(socket,'최소 2명이 참가해야 시작할 수 있습니다.');resetRoomForGame(room);broadcast(room);});
 socket.on('chooseLocation',({location}={})=>{const room=rooms.get(socket.data.roomCode);if(!room||!['dayChoose','nightChoose'].includes(room.phase))return;const p=playerById(room,socket.data.playerId);if(!p||p.chosen)return;if(!LOC[location])return fail(socket,'올바른 장소를 선택해 주세요.');p.chosen=location;addLog(room,`${p.name}님이 장소를 선택했습니다.`);if(room.players.every(q=>q.chosen)){resolveLocations(room,room.phase==='dayChoose'?'day':'night');}else broadcast(room);});
 socket.on('dayAction',({cardInstanceId=null,targetId=null,resourceType='C',marketInstanceId=null}={})=>{const room=rooms.get(socket.data.roomCode);if(!room||room.phase!=='dayActions')return;const pid=socket.data.playerId;if(!currentActor(room,pid))return fail(socket,'현재 행동 순서가 아닙니다.');const p=playerById(room,pid);if(!p||p.dayDone)return;if(cardInstanceId){const idx=p.hand.findIndex(i=>i.instanceId===cardInstanceId);if(idx<0)return fail(socket,'카드를 찾을 수 없습니다.');const inst=p.hand[idx],c=cardDef(inst);if(c.timing!=='day'||inst.usableFromTurn>room.turn)return fail(socket,'지금은 사용할 수 없는 카드입니다.');p.hand.splice(idx,1);executeCard(room,p,inst,{targetId,resourceType,marketInstanceId});room.discard.push(inst);}else addLog(room,`${p.name}님이 낮 특수 카드 사용을 건너뛰었습니다.`);p.dayDone=true;moveToNextAction(room,'day');});
 socket.on('nightPurchase',({cardInstanceId=null}={})=>{const room=rooms.get(socket.data.roomCode);if(!room||room.phase!=='nightActions')return;const pid=socket.data.playerId;if(!currentActor(room,pid))return fail(socket,'현재 행동 순서가 아닙니다.');const p=playerById(room,pid);if(!p||p.nightBought)return;if(cardInstanceId){if(p.hand.length>=4)return fail(socket,'특수 카드는 최대 4장까지 보유할 수 있습니다.');const idx=room.market.findIndex(i=>i.instanceId===cardInstanceId);if(idx<0)return fail(socket,'해당 카드는 시장에 없습니다.');const inst=room.market[idx],c=cardDef(inst);if(!canPay(p,c.cost))return fail(socket,'구매 비용이 부족합니다.');pay(p,c.cost);room.market.splice(idx,1);p.hand.push({...inst,usableFromTurn:room.turn});addLog(room,`${p.name}님이 ${c.name}을(를) 구매했습니다.`);refillMarket(room);}else addLog(room,`${p.name}님이 특수 카드 구매를 건너뛰었습니다.`);p.nightBought=true;broadcast(room);});
 socket.on('nightAction',({cardInstanceId=null,targetId=null,resourceType='C',marketInstanceId=null}={})=>{const room=rooms.get(socket.data.roomCode);if(!room||room.phase!=='nightActions')return;const pid=socket.data.playerId;if(!currentActor(room,pid))return fail(socket,'현재 행동 순서가 아닙니다.');const p=playerById(room,pid);if(!p||!p.nightBought||p.nightDone)return;if(cardInstanceId){const idx=p.hand.findIndex(i=>i.instanceId===cardInstanceId);if(idx<0)return fail(socket,'카드를 찾을 수 없습니다.');const inst=p.hand[idx],c=cardDef(inst);if(c.timing!=='night'||inst.usableFromTurn>room.turn)return fail(socket,'지금은 사용할 수 없는 밤 카드입니다.');p.hand.splice(idx,1);executeCard(room,p,inst,{targetId,resourceType,marketInstanceId});room.discard.push(inst);}else addLog(room,`${p.name}님이 밤 특수 카드 사용을 건너뛰었습니다.`);p.nightDone=true;moveToNextAction(room,'night');});
 socket.on('leaveRoom',()=>{const room=rooms.get(socket.data.roomCode);if(!room)return;const p=playerById(room,socket.data.playerId);if(!p)return;if(room.phase==='lobby'){room.players=room.players.filter(q=>q.id!==p.id);if(room.players.length===0){rooms.delete(room.code);return;}if(room.hostId===p.id)room.hostId=room.players[0].id;addLog(room,`${p.name}님이 방을 나갔습니다.`);}else{p.connected=false;p.socketId=null;addLog(room,`${p.name}님의 연결이 끊겼습니다.`);}socket.leave(room.code);socket.data.roomCode=null;broadcast(room);});
 socket.on('disconnect',()=>{const room=rooms.get(socket.data.roomCode);if(!room)return;const p=playerById(room,socket.data.playerId);if(!p||p.socketId!==socket.id)return;p.connected=false;p.socketId=null;addLog(room,`${p.name}님의 연결이 끊겼습니다.`);if(room.phase==='lobby'&&room.hostId===p.id){const next=room.players.find(q=>q.connected);if(next)room.hostId=next.id;}if(room.phase!=='lobby')advanceDisconnected(room);else broadcast(room);});
});
server.listen(PORT,'0.0.0.0',()=>console.log(`시장 쟁탈전 서버 실행 중: ${PORT}`));

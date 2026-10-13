const { test, expect } = require('@playwright/test');
const { io } = require('socket.io-client');

test('실제 Socket.IO: 자원 획득 → 구매 → 비공개 손패 → 카드 사용', async () => {
  const sockets = [io('http://127.0.0.1:3100', { forceNew: true, reconnection: false }), io('http://127.0.0.1:3100', { forceNew: true, reconnection: false })];
  const states = [null,null], revisions = [0,0];
  sockets.forEach((s,i)=>s.on('state',state=>{states[i]=state;revisions[i]++}));
  const broadcast = async (index,event,data={}) => {
    const before=[...revisions]; sockets[index].emit(event,data);
    await expect.poll(()=>revisions.every((r,i)=>r>before[i])).toBe(true);
  };
  try {
    await Promise.all(sockets.map(s=>new Promise(resolve=>s.on('connect',resolve))));
    sockets[0].emit('createRoom',{name:'네트워크 후보',maxPlayers:6}); await expect.poll(()=>!!states[0]).toBe(true);
    sockets[1].emit('joinRoom',{code:states[0].code,name:'다른 세션'}); await expect.poll(()=>states[0]?.players.length).toBe(2);
    await expect.poll(()=>!!states[1]).toBe(true); await broadcast(0,'startGame');
    let bought=0,used=0;
    const locFor={C:'plaza',I:'shops',O:'tavern',E:'cityhall'};
    for(let guard=0;guard<160&&states[0].phase!=='finished'&&used<2;guard++) {
      const state=states[0];
      if(state.phase.endsWith('Choose')) {
        const cheapest=[...state.market].sort((a,b)=>Object.values(a.card.cost).reduce((s,n)=>s+n,0)-Object.values(b.card.cost).reduce((s,n)=>s+n,0))[0];
        const need=Object.entries(cheapest.card.cost).find(([r,n])=>state.me.resources[r]<n)?.[0]||'C';
        await broadcast(0,'chooseLocation',{location:locFor[need]});
        await broadcast(1,'chooseLocation',{location:'plaza'});
      } else {
        const i=state.actionPlayer.id===state.me.id?0:1, current=states[i];
        if(current.phase==='nightActions'&&!current.me.nightBought) {
          const card=i===0&&current.me.hand.length<4&&current.market.find(m=>Object.entries(m.card.cost).every(([r,n])=>current.me.resources[r]>=n));
          const previous={...current.me.resources};
          await broadcast(i,'nightPurchase',card?{cardInstanceId:card.instanceId}:{});
          if(card){
            bought++;
            for(const r of ['C','I','O','E'])expect(states[0].me.resources[r]).toBe(previous[r]-(card.card.cost[r]||0));
            expect(states[0].me.hand.some(c=>c.instanceId===card.instanceId)).toBe(true);
            expect(states[1].me.hand).toEqual([]);
            expect(states[1].players[0].hand).toBeUndefined();
            expect(states[1].players[0].handCount).toBe(states[0].me.hand.length);
          }
        } else {
          const timing=current.phase==='dayActions'?'day':'night';
          const card=i===0&&current.me.hand.find(c=>c.card.timing===timing&&c.usableFromTurn<=current.turn);
          const event=timing==='day'?'dayAction':'nightAction';
          await broadcast(i,event,card?{cardInstanceId:card.instanceId,targetId:states[1].me.id,resourceType:'C',marketInstanceId:current.market[0].instanceId}:{});
          if(card){used++;expect(states[0].me.hand.some(c=>c.instanceId===card.instanceId)).toBe(false)}
        }
      }
    }
    expect(bought).toBeGreaterThanOrEqual(1); expect(used).toBeGreaterThanOrEqual(1);
  } finally { sockets.forEach(s=>s.disconnect()); }
});

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHarness } = require('./server-harness.cjs');

for (const max of [6, 10]) test(`${max}인 방, 모든 장소 정원·우선권·비공개 선택`, () => {
  for (const [loc, resource, capacity] of [['plaza', 'C', max], ['shops', 'I', max === 6 ? 2 : 4], ['tavern', 'O', max === 6 ? 2 : 3], ['cityhall', 'E', max === 6 ? 1 : 2]]) {
    const h = createHarness(), { clients, room } = h.room(max, max);
    assert.equal(room.market.length, max === 6 ? 4 : 5);
    clients[0].send('startGame'); room.turn = 2;
    clients[0].send('chooseLocation', { location: loc });
    assert.equal(clients[1].state.players[0].chosen, null);
    clients.slice(1).forEach(s => s.send('chooseLocation', { location: loc }));
    assert.equal(room.phase, 'dayActions');
    assert.equal(room.actionOrder[0], room.players[1].id);
    const order = [...room.players.slice(1), room.players[0]];
    order.forEach((p, i) => {
      assert.equal(h.points(p), 1);
      assert.equal(p.resources[i < capacity ? resource : 'C'], 1);
    });
    if (loc === 'plaza') assert.equal(clients[0].state.locations.plaza.capacity, null);
  }
});

test('최소 인원, 구매 부족, 한도 4장, 중복 구매와 비공개 손패', () => {
  const h = createHarness(), { clients, room, inviteToken } = h.room(6, 1), owner = clients[0];
  owner.send('startGame'); assert.equal(room.phase, 'lobby');
  const guest = h.client(); guest.send('joinRoom', { code: room.code, inviteToken }); owner.send('startGame');
  h.startActions(room, 'night');
  const p = room.players[0], inst = room.market[0], c = h.CARDS.find(c => c.id === inst.cardId);
  owner.send('nightPurchase', { cardInstanceId: inst.instanceId });
  assert.equal(p.hand.length, 0); assert.equal(owner.messages.at(-1).event, 'notice');
  Object.assign(p.resources, { C: 20, I: 20, O: 20, E: 20 });
  owner.send('nightPurchase', { cardInstanceId: inst.instanceId });
  owner.send('nightPurchase', { cardInstanceId: inst.instanceId });
  assert.equal(p.hand.length, 1);
  for (const r of ['C','I','O','E']) assert.equal(p.resources[r], 20 - (c.cost[r] || 0));
  assert.equal(guest.state.players[0].handCount, 1); assert.equal(guest.state.players[0].hand, undefined); assert.equal(guest.state.me.hand.length, 0);
  p.hand = Array.from({ length: 4 }, (_, i) => ({ instanceId: `full-${i}`, cardId: c.id, usableFromTurn: 1 })); p.nightBought = false;
  owner.send('nightPurchase', { cardInstanceId: room.market[0].instanceId });
  assert.equal(p.hand.length, 4); assert.match(owner.messages.at(-1).data.message, /최대 4장/);
});

const definitions = createHarness().CARDS;
for (const definition of definitions) test(`특수 카드 효과·타이밍·중복 방지: ${definition.name}`, () => {
  const h = createHarness(), { clients, room } = h.room(), [actor, victim] = room.players;
  clients[0].send('startGame');
  Object.assign(actor.resources, { C: 5, I: 5, O: 5, E: 5 });
  Object.assign(victim.resources, { C: 6, I: 6, O: 6, E: 6 });
  const inst = { instanceId: 'test-card', cardId: definition.id, usableFromTurn: 1 };
  actor.hand.push(inst); h.startActions(room, definition.timing); actor.nightBought = true;
  const event = definition.timing === 'day' ? 'dayAction' : 'nightAction';
  const targetMarket = room.market[0].instanceId;
  const payload = { cardInstanceId: inst.instanceId, targetId: victim.id, resourceType: 'C', marketInstanceId: targetMarket };
  clients[0].send(event, payload);
  assert.equal(actor.hand.some(i => i.instanceId === inst.instanceId), false);
  assert.equal(room.discard.filter(i => i.instanceId === inst.instanceId).length, 1);
  assert.equal(room.actionIndex, 1);
  const after = JSON.stringify([actor.resources, victim.resources, actor.hand]);
  clients[0].send(event, payload);
  assert.equal(JSON.stringify([actor.resources, victim.resources, actor.hand]), after);
  switch (definition.effect) {
    case 'gain': for (const [r,n] of Object.entries(definition.gain)) assert.equal(actor.resources[r], 5+n); break;
    case 'appeal': assert.equal(actor.resources.C, 10); break;
    case 'steal': assert.equal(h.points(actor), 20 + definition.stealMax); assert.equal(h.points(victim), 24 - definition.stealMax); break;
    case 'destroy': assert.equal(h.points(victim), 24-definition.stealMax); break;
    case 'protect': assert.equal(actor.protectCharges, 1); break;
    case 'rumor': assert.equal(victim.resources.C, 4); assert.equal(actor.resources.C, 6); break;
    case 'closeCityhall': assert.equal(room.cityhallClosedTurn, 2); break;
    case 'discardMarket': assert.equal(room.market.some(i=>i.instanceId===targetMarket), false); assert.equal(room.market.length, 4); break;
    case 'takeMarket': assert.equal(actor.hand[0].instanceId, targetMarket); assert.equal(actor.hand[0].usableFromTurn, 2); break;
    default: assert.fail('새 효과에 대한 검증을 추가하세요');
  }
});

test('사용 시점 제한, 보호 효과, 폐쇄 시청 대체 자원', () => {
  const h = createHarness(), { clients, room } = h.room(); clients[0].send('startGame');
  const actor = room.players[0]; h.startActions(room, 'day');
  actor.hand.push({ instanceId: 'future', cardId: 'campaign', usableFromTurn: 2 });
  clients[0].send('dayAction', { cardInstanceId: 'future' }); assert.equal(actor.hand.length, 1); assert.equal(room.actionIndex, 0);
  actor.hand[0] = { instanceId: 'night', cardId: 'pickpocket', usableFromTurn: 1 };
  clients[0].send('dayAction', { cardInstanceId: 'night' }); assert.equal(actor.hand.length, 1);
  h.startActions(room, 'night'); actor.nightBought = true; room.players[1].resources.C = 5; room.players[1].protectCharges = 1;
  clients[0].send('nightAction', { cardInstanceId: 'night', targetId: room.players[1].id });
  assert.equal(room.players[1].resources.C, 5); assert.equal(room.players[1].protectCharges, 0);
  room.phase = 'dayChoose'; room.cityhallClosedTurn = 1;
  clients.forEach(s => s.send('chooseLocation', { location: 'cityhall' }));
  assert.equal(room.players[0].resources.C, 1); assert.equal(room.players[0].resources.E, 0);
});

test('10턴 낮·밤·구매 건너뛰기와 공동 승리', () => {
  const h = createHarness(), { clients, room } = h.room(); clients[0].send('startGame');
  for (let turn = 1; turn <= 10; turn++) {
    assert.equal(room.turn, turn);
    for (const kind of ['day', 'night']) {
      clients.forEach(s => s.send('chooseLocation', { location: 'plaza' }));
      for (let i = 0; i < 2; i++) {
        const s = clients.find(s => s.data.playerId === room.actionOrder[room.actionIndex]);
        if (kind === 'night') s.send('nightPurchase', {});
        s.send(kind === 'day' ? 'dayAction' : 'nightAction', {});
      }
    }
  }
  assert.equal(room.phase, 'finished'); assert.equal(room.winner.length, 2);
  room.players.forEach(p => assert.equal(h.points(p), 20));
});

test('연결 해제 자동 진행과 기존 후보로 재접속', () => {
  const h = createHarness(), { clients, room } = h.room(); clients[0].send('startGame');
  clients[0].send('disconnect'); assert.equal(room.players[0].connected, false);
  clients[1].send('chooseLocation', { location: 'plaza' });
  assert.equal(room.actionOrder[room.actionIndex], room.players[1].id);
  const { code, playerId, resumeToken } = clients[0].lastMessage('roomCreated');
  const returning = h.client(); returning.send('joinRoom', { code, playerId, resumeToken });
  assert.equal(room.players.length, 2); assert.equal(room.players[0].connected, true);
});

test('방 생성은 서버에 설정된 운영자 키가 일치할 때만 허용된다', () => {
  for (const env of [{}, { ROOM_CREATOR_KEY: '' }, { ROOM_CREATOR_KEY: 'fixture-creator-key' }]) {
    const h = createHarness({ env });
    for (const creatorKey of [undefined, '', 'different-key', []]) {
      const socket = h.client();
      socket.send('createRoom', { creatorKey });
      assert.equal(h.rooms.size, 0);
      assert.equal(socket.state, null);
      assert.equal(socket.lastMessage('roomCreated'), undefined);
      assert.equal(socket.lastMessage('notice').type, 'error');
    }
  }
});

test('방·후보별 키를 구분하고 잘못된 참가 요청에는 상태를 전송하지 않는다', () => {
  const h = createHarness();
  const first = h.room(), other = h.room(6, 1);
  const { code, playerId, resumeToken, inviteToken } = first.clients[0].lastMessage('roomCreated');
  const guest = first.clients[1].lastMessage('roomJoined');
  const otherHost = other.clients[0].lastMessage('roomCreated');
  const keys = [inviteToken, resumeToken, guest.resumeToken, otherHost.inviteToken, otherHost.resumeToken];
  for (const key of keys) assert.match(key, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(new Set(keys).size, keys.length);
  assert.equal(guest.inviteToken, undefined);
  const prior = JSON.stringify(first.room);
  const stateUpdates = first.clients[0].messages.length;
  const inputs = [
    null, { code }, { code: code + 'X', inviteToken }, { code, inviteToken: {} },
    { code, inviteToken: otherHost.inviteToken }, { code, inviteToken: resumeToken },
    { code, playerId }, { code, resumeToken }, { code, playerId, inviteToken },
    { code, playerId, resumeToken: guest.resumeToken },
    { code, playerId, resumeToken: otherHost.resumeToken },
    { code, playerId, inviteToken, resumeToken },
  ];
  for (const data of inputs) {
    const socket = h.client();
    socket.send('joinRoom', data);
    assert.equal(socket.lastMessage('notice').type, 'error');
    assert.equal(socket.lastMessage('roomJoined'), undefined);
    assert.equal(socket.state, null);
  }
  assert.equal(JSON.stringify(first.room), prior);
  assert.equal(first.clients[0].messages.length, stateUpdates);
  const sockets = [...first.clients, ...other.clients];
  const privateTokens = sockets.map(socket =>
    (socket.lastMessage('roomCreated') || socket.lastMessage('roomJoined')).resumeToken);
  for (const [index, socket] of sockets.entries()) {
    for (const { event, data } of socket.messages) {
      const serialized = JSON.stringify(data);
      for (const [owner, token] of privateTokens.entries()) {
        if (owner !== index) assert.equal(serialized.includes(token), false);
      }
      if (event !== 'state') continue;
      assert.doesNotMatch(serialized, /creatorKey|resumeToken|inviteToken|inviteHash|resumeHash/i);
      for (const key of keys) assert.equal(serialized.includes(key), false);
    }
  }
});

for (const max of [6, 10]) test(`${max}인 방의 마지막 한 자리와 만석 재접속`, () => {
  const h = createHarness();
  const { clients, room, inviteToken } = h.room(max, max - 1);
  const [accepted, waiting] = [h.client(), h.client()];
  for (const socket of [accepted, waiting]) {
    socket.send('joinRoom', { code: room.code, inviteToken });
  }
  assert.ok(accepted.lastMessage('roomJoined'));
  assert.equal(waiting.state, null);
  assert.equal(waiting.lastMessage('notice').type, 'error');
  assert.equal(room.players.length, max);

  clients[0].send('startGame');
  const { code, playerId, resumeToken } = accepted.lastMessage('roomJoined');
  accepted.disconnect();
  waiting.send('joinRoom', { code, playerId, resumeToken });
  assert.equal(waiting.state.me.id, playerId);
  assert.equal(room.players.length, max);
});

test('시작한 방은 빈자리가 있어도 새 참가가 닫히고 복귀한 연결만 후보를 움직인다', () => {
  const h = createHarness();
  const { clients, room, inviteToken } = h.room(6, 3);
  const [owner, other, offline] = clients;
  const { code, playerId, resumeToken } = owner.lastMessage('roomCreated');
  const replacement = h.client();
  replacement.send('joinRoom', { code, playerId, resumeToken });
  owner.send('startGame');
  assert.equal(room.phase, 'lobby');
  replacement.send('startGame');
  const late = h.client();
  late.send('joinRoom', { code, inviteToken });
  assert.equal(late.state, null);
  assert.equal(late.lastMessage('notice').type, 'error');
  assert.equal(room.players.length, 3);

  offline.disconnect();
  const before = replacement.messages.length;
  owner.send('chooseLocation', { location: 'shops' });
  owner.send('leaveRoom');
  owner.disconnect();
  assert.equal(replacement.messages.length, before);
  assert.equal(room.players[0].connected, true);
  assert.equal(room.players[0].chosen, null);
  replacement.send('chooseLocation', { location: 'plaza' });
  other.send('chooseLocation', { location: 'plaza' });
  assert.equal(replacement.state.phase, 'dayActions');
  assert.equal(replacement.state.me.resources.C, 1);
  room.players[0].hand.push({ instanceId: 'retained-card', cardId: 'campaign', usableFromTurn: 2 });
  h.broadcast(room);
  const reloaded = h.client();
  reloaded.send('joinRoom', { code, playerId, resumeToken });
  assert.deepEqual(reloaded.state.me, replacement.state.me);
  assert.equal(reloaded.state.me.hand[0].instanceId, 'retained-card');
  assert.equal(reloaded.state.me.isHost, true);
});

test('대기실 퇴장은 자리를 반납하고 다음 방장에게 기존 초대 링크가 계속 유효하다', () => {
  const h = createHarness();
  const { clients, room, inviteToken } = h.room(6, 3);
  const [owner, offline, nextHost] = clients;
  const offlineSeat = offline.lastMessage('roomJoined');
  offline.disconnect();
  const { code, playerId, resumeToken } = owner.lastMessage('roomCreated');
  owner.send('leaveRoom');
  assert.deepEqual(owner.lastMessage('roomLeft'), { code, playerId, removed: true });
  assert.equal(nextHost.state.me.isHost, true);
  const former = h.client();
  former.send('joinRoom', { code, playerId, resumeToken });
  assert.equal(former.state, null);
  former.send('joinRoom', { code, inviteToken });
  assert.notEqual(former.state.me.id, playerId);
  assert.equal(former.state.me.isHost, false);
  assert.equal(room.players.length, 3);
  const returning = h.client();
  returning.send('joinRoom', { code, playerId: offlineSeat.playerId, resumeToken: offlineSeat.resumeToken });
  returning.send('leaveRoom');
  nextHost.send('leaveRoom');
  former.send('leaveRoom');
  assert.equal(h.rooms.has(code), false);
  const later = h.client();
  later.send('joinRoom', { code, inviteToken });
  assert.equal(later.state, null);
});

test('첫 발급 확인 전에 연결이 끊기면 빈 방과 임시 좌석을 정리한다', () => {
  const h = createHarness({ env: { ROOM_CREATOR_KEY: 'test-operator' } });
  const unconfirmedHost = h.client('방장', { confirmGrants: false });
  unconfirmedHost.send('createRoom', { creatorKey: 'test-operator' });
  const created = unconfirmedHost.lastMessage('roomCreated');
  assert.ok(created);
  assert.equal(unconfirmedHost.state, null);
  unconfirmedHost.disconnect();
  assert.equal(h.rooms.has(created.code), false);
  unconfirmedHost.finishGrant();
  assert.equal(h.rooms.size, 0);

  const { clients, room, inviteToken } = h.room(6, 1);
  const pending = h.client('대기 중', { confirmGrants: false });
  pending.send('joinRoom', { code: room.code, inviteToken });
  assert.ok(pending.lastMessage('roomJoined'));
  assert.equal(pending.state, null);
  clients[0].send('startGame');
  assert.equal(room.phase, 'lobby');
  pending.disconnect();
  pending.finishGrant();
  assert.equal(room.players.length, 1);
  const retry = h.client();
  retry.send('joinRoom', { code: room.code, inviteToken });
  assert.equal(retry.state.players.length, 2);
  clients[0].send('startGame');
  assert.equal(room.phase, 'dayChoose');
});

test('개인 키로 재접속하면 이전 연결의 발급 확인 없이도 같은 자리를 확정한다', () => {
  const h = createHarness();
  const { clients, room, inviteToken } = h.room(6, 1);
  const pending = h.client('후보', { confirmGrants: false });
  pending.send('joinRoom', { code: room.code, inviteToken });
  const { code, playerId, resumeToken } = pending.lastMessage('roomJoined');
  const recovered = h.client();
  recovered.send('joinRoom', { code, playerId, resumeToken });
  assert.equal(recovered.state.me.id, playerId);
  const updates = recovered.messages.length;
  pending.finishGrant(new Error('Simulated delayed transport timeout'));
  pending.disconnect();
  assert.equal(recovered.messages.length, updates);
  assert.equal(room.players.length, 2);
  clients[0].send('startGame');
  assert.equal(recovered.state.phase, 'dayChoose');
});

test('발급 응답 시간이 지나면 연결 중이어도 임시 좌석을 다른 참가자가 쓸 수 있다', () => {
  const h = createHarness();
  const { clients, room, inviteToken } = h.room(6, 5);
  const stalled = h.client('응답 대기', { confirmGrants: false });
  stalled.send('joinRoom', { code: room.code, inviteToken });
  assert.ok(Number.isFinite(stalled.lastAckTimeout) && stalled.lastAckTimeout > 0);
  assert.equal(stalled.state, null);
  stalled.finishGrant(new Error('Simulated transport timeout'));
  assert.equal(room.players.length, 5);
  const next = h.client();
  next.send('joinRoom', { code: room.code, inviteToken });
  assert.equal(next.state.players.length, 6);
  clients[0].send('startGame');
  assert.equal(room.phase, 'dayChoose');
});

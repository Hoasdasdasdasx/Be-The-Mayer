import { resources, symbols, phases, escapeHtml as esc, costText, illustration, isActor, useReason, purchaseReason, cardMarkup, playerMarkup } from './ui.js';

const $ = id => document.getElementById(id);
const storage = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch { /* Private browsing may deny persistence. */ } }
};
const hasTransport = typeof window.io === 'function';
const socket = hasTransport ? window.io() : { connected: false, on() {}, emit() {}, disconnect() {}, connect() {} };
let state = null, selected = null, pending = null, pendingTimer, toastTimer;
let targets = {}, joined = false;
let playerId = storage.get('mayorPlayerId') || '';
let roomCode = new URLSearchParams(location.search).get('room')?.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) || '';
const candidateName = () => $('candidateName').value.trim() || storage.get('mayorName') || '무소속 후보';
const connected = () => socket.connected && joined;
const blocked = () => !!pending || !connected();
const inviteUrl = () => `${location.origin}${location.pathname}?room=${state?.code || roomCode}`;
const selectedCard = () => selected && (selected.source === 'hand' ? state?.me.hand : state?.market)?.find(i => i.instanceId === selected.id);
const phaseNames = { lobby: '대기실', dayChoose: '낮 · 장소 선택', dayActions: '낮 · 카드 사용', nightChoose: '밤 · 장소 선택', nightActions: '밤 · 구매 및 행동', finished: '선거 종료' };

function notify(message, error = false) {
  clearTimeout(toastTimer);
  $('toast').textContent = message;
  $('toast').className = `toast${error ? ' error' : ''}`;
  $('toast').hidden = false;
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 4500);
}
function clearPending() { clearTimeout(pendingTimer); pending = null; }
function request(event, payload = {}) {
  if (!socket.connected || pending || (state && !joined && event !== 'joinRoom')) return;
  pending = { event, payload, turn: state?.turn, phase: state?.phase, actor: state?.actionPlayer?.id };
  pendingTimer = setTimeout(() => {
    clearPending();
    notify('응답이 지연되어 상태를 다시 확인합니다. 요청을 자동으로 반복하지 않습니다.', true);
    socket.disconnect(); socket.connect();
  }, 8000);
  render();
  socket.emit(event, payload);
}
function confirmed(s, p) {
  switch (p.event) {
    case 'createRoom': case 'joinRoom': return joined;
    case 'startGame': return s.phase !== 'lobby';
    case 'chooseLocation': return !!s.me.chosen || s.phase !== p.phase || s.turn !== p.turn;
    case 'nightPurchase': return s.me.nightBought || s.phase !== p.phase || s.turn !== p.turn;
    case 'dayAction': case 'nightAction': return s.actionPlayer?.id !== p.actor || s.phase !== p.phase || s.turn !== p.turn || (p.event === 'dayAction' ? s.me.dayDone : s.me.nightDone);
    default: return false;
  }
}
function ghostCard(id) {
  const el = [...document.querySelectorAll('#hand [data-card]')].find(node => node.dataset.card === id);
  if (!el) return;
  const rect = el.getBoundingClientRect(), clone = el.cloneNode(true);
  clone.className += ' card-ghost'; clone.removeAttribute('data-card'); clone.tabIndex = -1;
  Object.assign(clone.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px`, maxWidth: 'none' });
  $('effects').append(clone);
  setTimeout(() => clone.remove(), 650);
}
function onState(next) {
  const before = state, sent = pending;
  let boughtId;
  if (sent && confirmed(next, sent)) {
    const id = sent.payload.cardInstanceId;
    if (id && sent.event === 'nightPurchase' && next.me.hand.some(i => i.instanceId === id)) {
      boughtId = id; notify('구매 완료. 비용이 반영되고 카드가 손패에 추가됐습니다.'); selected = null;
    } else if (id && ['dayAction', 'nightAction'].includes(sent.event) && !next.me.hand.some(i => i.instanceId === id)) {
      ghostCard(id); notify('카드 사용이 서버에 반영됐습니다.'); selected = null;
    }
    clearPending();
  }
  state = next;
  if (selected && !selectedCard()) { selected = null; targets = {}; }
  if (targets.targetId && !state.players.some(p => p.id === targets.targetId && p.id !== state.me.id)) targets.targetId = '';
  if (targets.marketInstanceId && !state.market.some(i => i.instanceId === targets.marketInstanceId)) targets.marketInstanceId = '';
  const night = state.phase.startsWith('night');
  const previousNight = before?.phase.startsWith('night');
  document.body.dataset.theme = night ? 'night' : 'day';
  if (before && before.started && state.started && previousNight !== night && state.phase !== 'finished') {
    $('phaseTransition').classList.remove('animate');
    void $('phaseTransition').offsetWidth;
    $('phaseTransition').classList.add('animate');
  }
  render();
  if (!before || before.phase !== state.phase || before.actionPlayer?.id !== state.actionPlayer?.id) {
    $('announcement').textContent = `${state.turn}턴, ${phaseNames[state.phase]}. ${actorText()}`;
  }
  if (boughtId) {
    [...$('hand').querySelectorAll('[data-card]')].find(el => el.dataset.card === boughtId)?.classList.add('card-arrive');
    $('myResources').classList.remove('resource-spend'); void $('myResources').offsetWidth; $('myResources').classList.add('resource-spend');
  }
}
function actorText() {
  if (!connected()) return '서버 연결을 복구하고 있습니다';
  if (/Choose$/.test(state.phase)) return state.me.chosen ? '선택 완료 · 다른 후보를 기다리는 중' : '모든 후보가 장소를 선택합니다';
  if (/Actions$/.test(state.phase)) return isActor(state) ? '당신의 차례입니다' : `${state.actionPlayer?.name || '다른 후보'}님의 차례입니다`;
  return state.phase === 'lobby' ? '후보자들이 모이고 있습니다' : '최종 개표 완료';
}
function preserveFocus(fn) {
  const active = document.activeElement;
  const id = active?.id, card = active?.dataset.card, source = active?.dataset.source, locationId = active?.dataset.location;
  fn();
  let replacement = id && $(id);
  if (card) replacement = [...document.querySelectorAll('[data-card]')].find(n => n.dataset.card === card && n.dataset.source === source);
  if (locationId) replacement = [...document.querySelectorAll('[data-location]')].find(n => n.dataset.location === locationId);
  if (replacement && replacement !== active && !replacement.disabled) replacement.focus({ preventScroll: true });
}
function render() {
  $('createBtn').disabled = $('joinBtn').disabled = !socket.connected || !!pending;
  if (!state) return;
  preserveFocus(() => {
    $('entry').hidden = true; $('game').hidden = false; $('inviteTop').hidden = false; $('leaveBtn').hidden = false;
    $('roomCode').textContent = state.code;
    $('turnStatus').innerHTML = `<div><strong>${state.turn}<small> / 10</small></strong> ${esc(phaseNames[state.phase])}</div><span class="actor ${isActor(state) ? 'my-turn' : ''}">${esc(actorText())}</span>`;
    $('myResources').innerHTML = `<span class="resource-total">내 지지도 <b>${state.me.score}</b></span>${Object.entries(resources).map(([r, label]) => `<span class="resource-item text-${r}">${symbols[r]} ${label}<b>${state.me.resources[r]}</b></span>`).join('')}`;
    $('playerCount').textContent = `${state.players.length} / ${state.maxPlayers}명`;
    $('playerList').innerHTML = state.players.map(p => playerMarkup(p, state)).join('');
    $('phaseTitle').textContent = phases[state.phase];
    $('phaseStep').textContent = state.phase === 'lobby' ? '당신의 선거 캠프' : state.phase === 'finished' ? '최종 개표 결과' : `${state.phase.startsWith('night') ? '☾ 밤의 정치' : '☀ 낮의 캠페인'} · ${state.turn}번째 턴`;
    document.querySelectorAll('[data-phase]').forEach(el => { el.classList.toggle('current', el.dataset.phase === state.phase); if (el.dataset.phase === state.phase) el.setAttribute('aria-current', 'step'); else el.removeAttribute('aria-current'); });
    $('phaseContent').innerHTML = phaseMarkup() + detailMarkup();
    $('marketCount').textContent = `${state.market.length}장`;
    $('market').innerHTML = state.market.map((inst, index) => cardMarkup(inst, { source: 'market', index, selected: selected?.source === 'market' && selected.id === inst.instanceId, reason: purchaseReason(state, inst, connected()) })).join('');
    $('handCount').textContent = `${state.me.hand.length} / 4장`;
    $('hand').innerHTML = state.me.hand.length ? state.me.hand.map((inst, index) => cardMarkup(inst, { index, total: state.me.hand.length, selected: selected?.source === 'hand' && selected.id === inst.instanceId, reason: useReason(state, inst, connected()) })).join('') : '<div class="hand-empty"><span class="card-back" aria-hidden="true">♜</span><span><b>아직 꺼내지 않은 당신의 한 수</b>밤에 공개 시장에서 특수 카드를 확보하세요.</span></div>';
    $('eventLog').innerHTML = state.log.map(line => `<li>${esc(line)}</li>`).join('');
  });
}
function phaseMarkup() {
  const disabled = blocked() ? 'disabled' : '';
  if (state.phase === 'lobby') return `<div class="lobby-content"><div><span class="eyebrow">초대 코드</span><p class="room-code">${esc(state.code)}</p><button class="btn" data-invite>후보자 초대하기 ↗</button></div><div class="lobby-start"><h3>${state.players.length}명의 후보가 모였습니다</h3><p>이 도시를 바꿀 경쟁자를 초대하세요.</p>${state.me.isHost ? `<button class="btn primary" id="startGame" ${disabled || (state.players.length < 2 ? 'disabled' : '')}>선거 시작하기 →</button><p>${state.players.length < 2 ? '최소 2명이 참가하면 시작할 수 있습니다.' : '참가자들이 준비되었다면 시작하세요.'}</p>` : '<p>방장이 선거를 시작할 때까지 기다려 주세요.</p>'}</div></div>`;
  if (/Choose$/.test(state.phase)) return `<p class="phase-note">각 장소에서 자원 1개를 얻습니다. <b>${state.choiceCount} / ${state.players.length}명 선택</b> · 선택은 비공개입니다.</p><div class="locations">${Object.entries(state.locations).map(([id, loc]) => `<button class="location family-${esc(loc.resource)} ${state.me.chosen === id ? 'chosen' : ''} ${loc.closed ? 'closed' : ''}" data-location="${esc(id)}" ${disabled || (state.me.chosen ? 'disabled' : '')} aria-pressed="${state.me.chosen === id}" aria-label="${esc(loc.label)}, ${loc.closed ? '폐쇄, 시민 자원 1개 획득' : `${resources[loc.resource]} 자원 1개`}, ${loc.capacity == null ? '정원 무제한' : `정원 ${loc.capacity}명`}">${illustration(loc.resource, id, true)}<strong>${esc(loc.label)}</strong><span class="location-resource">${loc.closed ? '봉쇄됨 · 시민 1개 획득' : `${symbols[loc.resource]} ${resources[loc.resource]} +1`}</span><span class="capacity">${loc.capacity == null || loc.capacity === Infinity ? '수용 인원 무제한' : `수용 인원 ${loc.capacity}명 · 초과 시 시민 +1`}</span></button>`).join('')}</div>${state.me.chosen ? '<p class="waiting">✓ 선택을 확정했습니다. 다른 후보의 선택을 기다립니다.</p>' : pending ? '<p class="waiting">선택을 서버에 전달하고 있습니다…</p>' : '<p class="phase-note" style="margin:10px 0 0">정원이 초과되면 이번 턴의 우선권을 적용합니다. 선택 확정 후 변경할 수 없습니다.</p>'}`;
  if (state.phase === 'finished') {
    const winners = new Set(state.winner.map(w => w.id));
    return `<div class="results"><div class="victory">♛ ${state.winner.map(w => esc(w.name)).join(' · ')} ${state.winner.length > 1 ? '공동 당선' : '당선'}</div><p class="muted small">10번째 밤이 끝났습니다. 최종 지지도는 남은 네 자원의 합계입니다.</p><ol class="ranking">${[...state.players].sort((a,b) => b.score - a.score).map(p => `<li class="${winners.has(p.id) ? 'winner' : ''}"><span>${winners.has(p.id) ? '♛ ' : ''}${esc(p.name)}${p.id === state.me.id ? ' (나)' : ''}</span><b>${p.score}점</b></li>`).join('')}</ol><button class="btn primary" id="newGame">새 방을 만들어 다시 시작</button></div>`;
  }
  const mine = isActor(state), purchasing = state.phase === 'nightActions' && !state.me.nightBought;
  const label = purchasing ? '공개 시장에서 카드를 골라보세요' : '손패에서 한 수를 선택하세요';
  const description = purchasing ? '밤마다 특수 카드 1장을 구매할 수 있습니다. 구매 비용만큼 지지도가 줄어듭니다.' : `${state.phase === 'dayActions' ? '낮' : '밤'} 카드 1장을 사용할 수 있습니다. 아래 손패에서 빛나는 카드를 선택하세요.`;
  return `<div class="action-intro"><div><span class="eyebrow">${mine ? '당신의 차례' : '다른 후보의 차례'}</span><h3>${mine ? label : `${esc(state.actionPlayer?.name || '다른 후보')}님이 행동 중입니다`}</h3><p>${mine ? description : '상대의 결정을 기다리며 공개 시장과 내 손패를 살펴보세요.'}</p></div><span class="action-symbol" aria-hidden="true">${state.phase === 'dayActions' ? '☀' : '☾'}</span></div>${mine ? `<div class="action-bottom">${pending ? '<span class="pending-label">서버 응답 확인 중…</span>' : ''}<button class="btn" id="skipAction" ${disabled}>${purchasing ? '구매 건너뛰기' : '카드 사용 건너뛰기'} →</button></div>` : ''}`;
}
function detailMarkup() {
  const inst = selectedCard(); if (!inst) return '';
  const c = inst.card, buying = selected.source === 'market';
  const reason = buying ? purchaseReason(state, inst, connected()) : useReason(state, inst, connected());
  const option = (value, label, chosen) => `<option value="${esc(value)}" ${value === chosen ? 'selected' : ''}>${esc(label)}</option>`;
  let controls = '';
  if (!buying) {
    if (c.target) controls += `<label class="field">대상 후보<select id="targetSelect" data-target="targetId"><option value="">후보를 선택하세요</option>${state.players.filter(p => p.id !== state.me.id).map(p => option(p.id, `${p.name} · ${p.score}점`, targets.targetId)).join('')}</select></label>`;
    if (c.stealTypes) controls += `<label class="field">우선 대상 자원<select id="resourceSelect" data-target="resourceType">${c.stealTypes.map(r => option(r, resources[r], targets.resourceType || c.stealTypes[0])).join('')}</select></label>`;
    if (c.marketTarget) controls += `<label class="field">공개 시장 대상<select id="marketSelect" data-target="marketInstanceId"><option value="">카드를 선택하세요</option>${state.market.map(m => option(m.instanceId, m.card.name, targets.marketInstanceId)).join('')}</select></label>`;
  }
  return `<section class="detail family-${esc(c.family)}" id="cardDetail" aria-label="선택한 카드 상세"><div class="detail-art">${illustration(c.family, c.id)}</div><div><span class="eyebrow">${resources[c.family]} 계열 · ${c.timing === 'day' ? '낮' : '밤'} 사용</span><h3>${esc(c.name)}</h3><p class="detail-description">${esc(c.desc)}</p><p class="detail-cost">구매 비용: ${esc(costText(c.cost))}${buying ? ' · 보유 자원에서 지불합니다' : ''}</p>${controls ? `<div class="detail-controls">${controls}</div>` : ''}<div class="detail-actions"><button class="btn primary" id="confirmCard" ${reason || blocked() ? 'disabled' : ''}>${pending ? '서버 응답 확인 중…' : buying ? '비용을 지불하고 구매' : '선택한 카드 사용'}</button><button class="btn" id="cancelSelection">선택 취소</button><span class="detail-reason">${esc(reason)}</span></div></div></section>`;
}
function confirmCard() {
  const inst = selectedCard(); if (!inst || blocked()) return;
  if (selected.source === 'market') {
    if (!purchaseReason(state, inst, connected())) request('nightPurchase', { cardInstanceId: inst.instanceId });
    return;
  }
  if (useReason(state, inst, connected())) return;
  const c = inst.card, payload = { cardInstanceId: inst.instanceId };
  if (c.target) { if (!targets.targetId) { notify('대상 후보를 선택해 주세요.', true); $('targetSelect').focus(); return; } payload.targetId = targets.targetId; }
  if (c.stealTypes) payload.resourceType = targets.resourceType || c.stealTypes[0];
  if (c.marketTarget) { if (!targets.marketInstanceId) { notify('대상 시장 카드를 선택해 주세요.', true); $('marketSelect').focus(); return; } payload.marketInstanceId = targets.marketInstanceId; }
  request(state.phase === 'dayActions' ? 'dayAction' : 'nightAction', payload);
}
function openInvite() { $('inviteCode').textContent = state.code; $('inviteUrl').value = inviteUrl(); $('inviteDialog').showModal(); }
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); notify('복사했습니다.'); }
  catch { if (!$('inviteDialog').open) openInvite(); $('inviteUrl').focus(); $('inviteUrl').select(); notify('링크를 선택했습니다. 복사 단축키를 이용해 주세요.', true); }
}
function leave() {
  if (!state) return;
  // An active candidate disconnects so the existing server auto-skip path runs.
  // In the lobby, leaveRoom removes the candidate and transfers the host.
  const activeGame = state.started;
  roomCode = ''; state = null; selected = null; targets = {}; joined = false; clearPending();
  if (activeGame) socket.disconnect(); else socket.emit('leaveRoom');
  history.replaceState({}, '', location.pathname);
  $('game').hidden = true; $('entry').hidden = false; $('inviteTop').hidden = $('leaveBtn').hidden = true;
  $('logPanel').hidden = true; $('logToggle').setAttribute('aria-expanded', 'false');
  $('turnStatus').innerHTML = '<span class="eyebrow">다음 선거를 준비하세요</span>';
  document.querySelectorAll('dialog[open]').forEach(d => d.close());
  document.body.dataset.theme = 'day'; $('joinCode').value = '';
  if (activeGame) socket.connect();
  $('candidateName').focus(); render();
}
document.addEventListener('click', event => {
  const button = event.target.closest('button'); if (!button || button.disabled) return;
  if (button.dataset.dialog) { $(button.dataset.dialog).showModal(); return; }
  if (button.hasAttribute('data-close')) { button.closest('dialog').close(); return; }
  if (button.hasAttribute('data-invite')) { openInvite(); return; }
  if (button.dataset.card) {
    const same = selected?.id === button.dataset.card && selected?.source === button.dataset.source;
    selected = same ? null : { id: button.dataset.card, source: button.dataset.source }; targets = {};
    render();
    if (selected) { $('cardDetail').scrollIntoView({ block: 'nearest', behavior: 'instant' }); $('cancelSelection').focus({ preventScroll: true }); }
    return;
  }
  if (button.dataset.location) { if (!blocked() && !state.me.chosen) request('chooseLocation', { location: button.dataset.location }); return; }
  switch (button.id) {
    case 'startGame': request('startGame'); break;
    case 'confirmCard': confirmCard(); break;
    case 'cancelSelection': {
      const old = selected; selected = null; targets = {}; render();
      const card = [...document.querySelectorAll('[data-card]')].find(n => n.dataset.card === old?.id && n.dataset.source === old?.source);
      card?.scrollIntoView({ block: 'center', behavior: 'instant' });
      card?.focus({ preventScroll: true }); break;
    }
    case 'skipAction': if (!blocked()) request(state.phase === 'dayActions' ? 'dayAction' : !state.me.nightBought ? 'nightPurchase' : 'nightAction'); break;
    case 'inviteTop': openInvite(); break;
    case 'copyInvite': copyText(inviteUrl()); break;
    case 'copyCode': copyText(state.code); break;
    case 'leaveBtn': case 'newGame': leave(); break;
    case 'playersToggle': { const open = $('candidates').classList.toggle('open'); button.setAttribute('aria-expanded', String(open)); break; }
    case 'logToggle': $('logPanel').hidden = !$('logPanel').hidden; button.setAttribute('aria-expanded', String(!$('logPanel').hidden)); if (!$('logPanel').hidden) $('closeLog').focus(); break;
    case 'closeLog': $('logPanel').hidden = true; $('logToggle').setAttribute('aria-expanded', 'false'); $('logToggle').focus(); break;
  }
});
document.addEventListener('change', event => { if (event.target.dataset.target) targets[event.target.dataset.target] = event.target.value; });
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape' || document.querySelector('dialog[open]')) return;
  if (!$('logPanel').hidden) { $('closeLog').click(); return; }
  if (selected) $('cancelSelection').click();
});
$('createForm').addEventListener('submit', event => { event.preventDefault(); storage.set('mayorName', candidateName()); request('createRoom', { name: candidateName(), playerId, maxPlayers: Number(document.querySelector('[name=mode]:checked').value) }); });
$('joinForm').addEventListener('submit', event => { event.preventDefault(); storage.set('mayorName', candidateName()); roomCode = $('joinCode').value.toUpperCase(); request('joinRoom', { code: roomCode, name: candidateName(), playerId }); });
$('joinCode').addEventListener('input', event => { event.target.value = event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6); });
$('reduceMotion').checked = storage.get('mayorReduceMotion') === 'true';
document.body.classList.toggle('reduce-motion', $('reduceMotion').checked);
$('reduceMotion').addEventListener('change', event => { document.body.classList.toggle('reduce-motion', event.target.checked); storage.set('mayorReduceMotion', String(event.target.checked)); });
$('entryCity').innerHTML = illustration('E', 'campaign-city');
$('candidateName').value = storage.get('mayorName') || '';
$('joinCode').value = roomCode;
socket.on('connect', () => {
  $('serverNotice').hidden = true;
  $('connection').textContent = roomCode ? '상태 확인 중' : '서버 연결됨'; $('connection').className = 'connection online';
  if (roomCode) request('joinRoom', { code: roomCode, name: candidateName(), playerId }); else render();
});
socket.on('disconnect', () => {
  joined = false; clearPending(); $('connection').textContent = '연결 끊김 · 재접속 중'; $('connection').className = 'connection'; render();
});
socket.on('connect_error', () => {
  $('connection').textContent = '서버 연결 대기'; $('connection').className = 'connection';
  $('serverNotice').textContent = '게임 서버에 연결할 수 없습니다. 게임 서버 주소와 연결 상태를 확인해 주세요.';
  $('serverNotice').hidden = false; render();
});
for (const event of ['roomCreated', 'roomJoined']) socket.on(event, data => {
  joined = true; roomCode = data.code; playerId = data.playerId;
  storage.set('mayorPlayerId', playerId); storage.set('mayorName', candidateName());
  history.replaceState({}, '', `${location.pathname}?room=${roomCode}`);
  $('connection').textContent = '서버 연결됨';
});
socket.on('state', onState);
socket.on('notice', data => {
  const joining = pending?.event === 'joinRoom'; clearPending();
  if (joining && !joined) {
    roomCode = ''; state = null; $('game').hidden = true; $('entry').hidden = false;
    $('inviteTop').hidden = $('leaveBtn').hidden = true;
    $('turnStatus').textContent = '방 코드를 확인해 주세요';
  }
  notify(data.message, data.type === 'error'); render();
});
if (!hasTransport) {
  $('connection').textContent = '화면 미리보기';
  $('serverNotice').hidden = false;
}
render();

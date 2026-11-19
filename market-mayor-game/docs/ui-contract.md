# UI와 게임 서버의 이벤트 계약

`server.js`를 게임 규칙의 기준으로 유지한다. 프론트엔드는 `state`의 카드 정의만 렌더링하며 효과, 비용, 타이밍 목록을 복제하지 않는다.

- 6/10인 방, 최소 2명 시작. 시장 4/5장, 덱은 18종 × 2/3장.
- `lobby → dayChoose → dayActions → nightChoose → nightActions`를 반복한다. 10번째 밤 종료 시 `finished`. 자원 합계가 최고인 모든 후보가 승리한다.
- 광장은 무제한 (JSON 전송 시 Infinity는 null). 상가/술집/시청 정원은 6인 방 2/2/1, 10인 방 4/3/2. 턴마다 우선권이 회전한다. 초과·폐쇄 시 시민 자원을 받는다. 장소 선택은 확정 후 변경할 수 없다.
- 낮 카드 최대 1장, 밤 구매 최대 1장 후 밤 카드 최대 1장. 손패 최대 4장. 구매 비용은 자원에서 차감된다. 밀실 거래로 받은 카드는 다음 턴부터 사용한다.
- 비공개 손패는 `me.hand`만 제공한다. 다른 후보는 `handCount`만 제공하고 장소 선택도 본인 것만 전달한다.
- 서버는 연결 해제 시 자동 진행을 처리한다. 기존 자리로 복귀할 때는 서버가 그 참가자에게 발급한 개인 재접속 키가 필요하다. 같은 자리로 두 번째 연결이 승인되면 최신 연결만 게임을 조작한다.

## 이벤트

| 클라이언트 → 서버 | 데이터 |
| --- | --- |
| createRoom | name, maxPlayers, creatorKey |
| joinRoom (새 참가) | code, name, inviteToken |
| joinRoom (기존 자리 복귀) | code, playerId, resumeToken |
| startGame / leaveRoom | 없음 |
| chooseLocation | location |
| dayAction / nightAction | cardInstanceId, targetId, resourceType, marketInstanceId (생략 시 건너뛰기) |
| nightPurchase | cardInstanceId (생략 시 건너뛰기) |

| 서버 → 클라이언트 | 데이터 |
| --- | --- |
| state | code, players, me, market, locations, phase, turn, actionPlayer, choiceCount, log, winner 등 |
| notice | type, message |
| roomCreated | code, playerId, inviteToken, resumeToken (생성자 전용) |
| roomJoined | code, playerId 및 새 참가 시 resumeToken (참가자 전용) |
| seatReplaced | code (같은 자리에 먼저 연결되어 있던 탭에 전달) |
| roomLeft | code, playerId, removed (퇴장 처리 결과) |

처음 개인 키를 받는 클라이언트는 `roomCreated` 또는 `roomJoined`의 Socket.IO 응답 콜백을 호출한다. 서버는 첫 수신을 확인하기 전에 연결이 끊긴 경우 임시 좌석을 회수한다. 공유 URL에는 방 코드와 방 초대 키가 들어간다. 운영자 키와 개인 재접속 키는 이 URL에 넣지 않는다. `state`에는 키와 검증용 해시를 싣지 않는다.

UI는 카드 검토·대상 선택만 로컬에 저장한다. 서버 `state`로 구매/사용 결과를 확인하기 전에는 손패와 자원을 변경하지 않는다. 진행 단계와 대상이 유효하면 다른 참가자의 업데이트에도 선택을 보존한다. 전송 중에는 중복 입력을 잠그고, 불확실한 요청은 자동 재전송하지 않는다.

import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createOfficeMediaSources} from './office-media-sources.mjs';

function fixture(factory = createOfficeMediaSources) {
  const forbidden = () => { throw new Error('A read-only media provider must not capture or stop media'); };
  const makeStream = () => {
    const track = {readyState: 'live', muted: false, enabled: true, stop: forbidden};
    return {track, getVideoTracks: () => [track], getTracks: forbidden, clone: forbidden};
  };
  const selfScreen = makeStream(), selfCamera = makeStream();
  const remoteScreen = makeStream(), remoteCamera = makeStream();
  const state = {data: {user: {id: 'self', name: 'Allan', status: 'available', preferences: {hideSelf: false}}}};
  const meeting = {id: 'meeting-1', phase: 'active', private: true, members: ['self', 'felipe', 'off']};
  const people = {
    self: state.data.user,
    felipe: {id: 'felipe', name: 'Felipe Queiroz', avatarUrl: '/api/office/runtime/assets/avatar/felipe.png'},
    off: {id: 'off', name: 'Sem câmera', avatarUrl: 'https://external.example/person.png'},
  };
  const peers = new Map([['felipe', {
    id: 'felipe', callId: 'remote-call', screen: remoteScreen, camera: remoteCamera,
    pc: {close: forbidden}, audio: {getAudioTracks: forbidden},
  }]]);
  const current = {meeting, roomId: meeting.id, callId: 'local-call'};
  const window = {
    location: {origin: 'https://crm.example'},
    aureonOfficeBootstrap: {active: true},
    aureonScreenStream: () => selfScreen,
    aureonCameraStream: () => selfCamera,
    aureonAudioStream: forbidden,
    aureonStopScreen: forbidden,
    aureonStopCamera: forbidden,
    fetch: forbidden,
    navigator: {mediaDevices: {getUserMedia: forbidden, getDisplayMedia: forbidden}},
  };
  const env = {window, getState: () => state, getMeeting: () => current.meeting,
    getRoomId: () => current.roomId, getCallId: () => current.callId,
    getPeer: id => peers.get(id), person: id => people[id]};
  const provider = factory(env);
  return {provider, env, window, state, meeting, current, people, peers,
    selfScreen, selfCamera, remoteScreen, remoteCamera, makeStream};
}

test('serializable factory exposes only admitted participants and borrowed video streams', () => {
  const factory = vm.runInNewContext('(' + createOfficeMediaSources.toString() + ')', {URL});
  const f = fixture(factory);
  const snapshot = f.provider.getSnapshot();
  assert.equal(snapshot.sessionId, 'meeting-1');
  assert.deepEqual(Array.from(snapshot.participants, p => p.id), ['self', 'felipe', 'off']);
  assert.equal(snapshot.participants[1].avatarUrl, '/api/office/runtime/assets/avatar/felipe.png');
  assert.equal(snapshot.participants[2].avatarUrl, null);
  assert.equal(snapshot.sources.length, 4);
  const remote = snapshot.sources.find(source => source.id === 'meeting-1:felipe:screen');
  assert.equal(remote.stream, f.remoteScreen);
  assert.equal(remote.label, 'Tela de Felipe Queiroz');
  assert.deepEqual(Object.keys(remote).sort(), ['id', 'isSelf', 'kind', 'label', 'participantId', 'stream']);
  assert.deepEqual(Object.keys(snapshot.participants[1]).sort(), ['avatarUrl', 'id', 'isSelf', 'name']);
  assert.deepEqual(Object.keys(f.provider).sort(), ['clear', 'getSnapshot', 'publish', 'subscribe']);
});

test('every read revokes cached media immediately when access or session membership disappears', () => {
  const cases = [
    f => { f.window.aureonOfficeBootstrap.active = false; },
    f => { f.state.data.user.status = 'offline'; },
    f => { f.meeting.phase = 'completed'; },
    f => { f.meeting.members = ['felipe']; },
    f => { f.current.meeting = null; },
    f => { f.state.data = null; },
    f => { f.env.getMeeting = () => { throw new Error('Unavailable session'); }; },
  ];
  for (const revoke of cases) {
    const f = fixture();
    const before = f.provider.getSnapshot();
    assert.equal(before.sources.length, 4);
    revoke(f);
    const after = f.provider.getSnapshot();
    assert.equal(after.sessionId, null);
    assert.equal(after.sources.length, 0);
    assert.equal(after.participants.length, 0);
    assert.ok(after.revision > before.revision);
    assert.equal(f.provider.getSnapshot(), after);
  }
});

test('roster changes and room/call guards exclude old, unadmitted, or incomplete peers', () => {
  const f = fixture();
  f.peers.set('intruder', {id: 'intruder', callId: 'old', screen: f.makeStream()});
  assert.equal(f.provider.getSnapshot().sources.length, 4);
  f.meeting.members = ['self', 'off'];
  assert.equal(f.provider.getSnapshot().sources.some(s => s.participantId === 'felipe'), false);
  f.meeting.members.push('felipe');
  for (const change of [
    () => { f.current.roomId = 'old-meeting'; },
    () => { f.current.roomId = f.meeting.id; f.current.callId = null; },
    () => { f.current.callId = 'local-call'; f.peers.get('felipe').callId = null; },
    () => { f.peers.get('felipe').callId = 'remote-call'; f.peers.get('felipe').id = 'wrong-person'; },
  ]) {
    change();
    const snapshot = f.provider.getSnapshot();
    assert.deepEqual(snapshot.sources.map(s => s.participantId), ['self', 'self']);
    assert.equal(snapshot.participants.length, 3);
  }
  f.current.meeting = {id: 'meeting-2', phase: 'active', members: ['self', 'felipe']};
  f.current.roomId = 'meeting-1';
  assert.equal(f.provider.getSnapshot().sources.some(s => !s.isSelf), false);
});

test('ended and muted tracks disappear, hideSelf omits only local camera, no meeting omits previews', () => {
  const f = fixture();
  f.selfScreen.track.readyState = 'ended';
  f.remoteCamera.track.muted = true;
  f.state.data.user.preferences.hideSelf = true;
  let snapshot = f.provider.getSnapshot();
  assert.deepEqual(snapshot.sources.map(s => s.id), ['meeting-1:felipe:screen']);
  assert.equal(snapshot.participants.some(p => p.isSelf), true);
  f.selfScreen.track.readyState = 'live';
  snapshot = f.provider.getSnapshot();
  assert.equal(snapshot.sources.some(s => s.isSelf && s.kind === 'screen'), true);
  f.state.data.user.preferences.hideSelf = false;
  f.remoteCamera.track.muted = false;
  assert.equal(f.provider.getSnapshot().sources.length, 4);
  f.current.meeting = null;
  assert.equal(f.provider.getSnapshot().sources.length, 0);
});

test('snapshot identity is stable until visible metadata or stream identity changes', () => {
  const f = fixture();
  const first = f.provider.getSnapshot();
  assert.equal(f.provider.getSnapshot(), first);
  assert.equal(f.provider.publish(), first);
  f.meeting.topic = 'Unrelated topic';
  f.state.view = 'map';
  f.peers.get('felipe').pc.connectionState = 'connected';
  assert.equal(f.provider.getSnapshot(), first);
  f.people.felipe.name = 'Felipe';
  const renamed = f.provider.getSnapshot();
  assert.equal(renamed.revision, first.revision + 1);
  assert.equal(renamed.sources.find(s => s.participantId === 'felipe').label, 'Tela de Felipe');
  f.peers.get('felipe').screen = f.makeStream();
  const replaced = f.provider.getSnapshot();
  assert.equal(replaced.revision, renamed.revision + 1);
  assert.equal(replaced.sources[2].id, renamed.sources[2].id);
  assert.notEqual(replaced.sources[2].stream, renamed.sources[2].stream);
  assert.equal(f.provider.getSnapshot(), replaced);
});

test('metadata is immutable without freezing, modifying, capturing, or stopping borrowed media', () => {
  const f = fixture();
  const originalState = JSON.stringify(f.state), originalMeeting = JSON.stringify(f.meeting);
  const snapshot = f.provider.getSnapshot();
  for (const value of [f.provider, snapshot, snapshot.participants, snapshot.sources,
    ...snapshot.participants, ...snapshot.sources]) assert.equal(Object.isFrozen(value), true);
  assert.throws(() => { snapshot.participants[0].name = 'Changed'; }, TypeError);
  assert.throws(() => { snapshot.sources.pop(); }, TypeError);
  assert.equal(Object.isFrozen(f.remoteScreen), false);
  assert.equal(Object.isFrozen(f.remoteScreen.track), false);
  f.remoteScreen.track.muted = true;
  f.provider.publish();
  f.provider.clear();
  assert.equal(JSON.stringify(f.state), originalState);
  assert.equal(JSON.stringify(f.meeting), originalMeeting);
  assert.equal(f.selfCamera.track.readyState, 'live');
  assert.equal(f.selfScreen.track.readyState, 'live');
  assert.equal(f.remoteCamera.track.readyState, 'live');
  assert.equal(f.remoteScreen.track.readyState, 'live');
});

test('publish isolates subscribers, handles reentry, and unsubscribe/clear release presentation state', () => {
  const f = fixture();
  let calls = 0, removedCalls = 0;
  const unsubscribeThrowing = f.provider.subscribe(() => { throw new Error('Consumer failure'); });
  const unsubscribe = f.provider.subscribe(() => { calls += 1; f.provider.publish(); });
  const unsubscribeRemoved = f.provider.subscribe(() => { removedCalls += 1; });
  unsubscribeRemoved(); unsubscribeRemoved();
  f.provider.getSnapshot();
  f.provider.publish();
  assert.equal(calls, 1);
  assert.equal(removedCalls, 0);
  f.provider.publish();
  assert.equal(calls, 1);
  unsubscribe(); unsubscribeThrowing();
  f.remoteScreen.track.muted = true;
  f.provider.publish();
  assert.equal(calls, 1);
  let latest;
  f.provider.subscribe(() => { latest = f.provider.getSnapshot(); });
  const cleared = f.provider.clear();
  assert.equal(latest, cleared);
  assert.equal(cleared.sessionId, null);
  assert.equal(cleared.sources.length, 0);
  assert.equal(f.provider.getSnapshot(), cleared);
  assert.equal(f.provider.publish().sources.length, 3);
  f.window.aureonOfficeBootstrap.active = false;
  assert.equal(f.provider.publish().sources.length, 0);
  assert.throws(() => f.provider.subscribe(null), TypeError);
});

test('avatars accept only known same-origin runtime PNGs and all other portraits use a null fallback', () => {
  const f = fixture();
  for (const value of [
    'javascript:alert(1)', 'data:image/png;base64,AA', 'blob:https://crm.example/random',
    'https://other.example/api/office/runtime/assets/person.png',
    '/api/office/runtime/assets/../person.png', '/api/office/runtime/assets/%2e%2e/person.png',
    '/api/office/runtime/assets/person.png?secret=1', '/api/office/runtime/assets/person.png#fragment',
    '/api/office/runtime/assets/person.svg', '/api/office/runtime/assets//person.png',
    'https://user:pass@crm.example/api/office/runtime/assets/person.png',
    '/api/office/runtime/assets/has space.png', '/private/person.png',
  ]) {
    f.people.felipe.avatarUrl = value;
    assert.equal(f.provider.getSnapshot().participants[1].avatarUrl, null, value);
  }
  f.people.felipe.avatarUrl = 'https://crm.example/api/office/runtime/assets/avatar/person-1.png';
  assert.equal(f.provider.getSnapshot().participants[1].avatarUrl, '/api/office/runtime/assets/avatar/person-1.png');
  f.people.felipe = undefined;
  const person = f.provider.getSnapshot().participants[1];
  assert.equal(person.name, 'Participante');
  assert.equal(person.avatarUrl, null);
});

// debate.js — Group Study "Live Debate" room.
//
// Peer-to-peer video via PeerJS (free public broker + Google STUN, no keys, no server code).
// One person CREATES a room → gets a short code → shares it. Others JOIN with the code + their
// name & ID. Everyone sees everyone (full media mesh). Control messages (roster, topic, whose
// turn, end, transcripts, verdict) travel through the host as a relay.
//
// Turn model: one speaker "takes the floor" at a time. While you hold the floor your own mic is
// recorded (locally). On "End & Analyse" each person transcribes their own speech (Groq Whisper
// via /api/stt), the host gathers all transcripts and asks the AI judge (/api/debate-analyse)
// who argued best — with key points, positives and negatives for each speaker.

(function () {
  const $ = (id) => document.getElementById(id);
  const WORDS = ['TIGER', 'COMET', 'MANGO', 'DELTA', 'RIVER', 'NOVA', 'ORBIT', 'PIXEL', 'EMBER', 'LOTUS'];

  let inited = false;
  let S = null; // room state (null when not in a room)

  function freshState() {
    return {
      peer: null,            // PeerJS Peer
      isHost: false,
      code: '',              // friendly room code
      hostConn: null,        // (joiner) data conn to host
      dataConns: new Map(),  // peerId -> DataConnection (host: all joiners; joiner: none)
      calls: new Map(),      // peerId -> MediaConnection
      roster: new Map(),     // peerId -> { name, id }
      streams: new Map(),    // peerId -> MediaStream (remote)
      localStream: null,
      recorder: null,
      chunks: [],
      hasFloor: false,
      floorHolder: null,     // peerId currently speaking
      topic: '',
      ending: false,
      transcripts: new Map(),// peerId -> { name, id, text }
      me: { peerId: '', name: '', id: '' },
      analysisTimer: null,
    };
  }

  const sanitize = (s) => (s || '').replace(/[^a-z0-9]/gi, '').toLowerCase();
  const hostPeerId = (code) => 'shub' + sanitize(code);
  const lobbyStatus = (t) => { if ($('dbtLobbyStatus')) $('dbtLobbyStatus').textContent = t || ''; };
  const roomStatus = (t) => { if ($('dbtRoomStatus')) $('dbtRoomStatus').textContent = t || ''; };


  /* ---------------- start: create or join ---------------- */
  let meetingTimerItv = null;
  let meetingSeconds = 0;

  function startMeetingTimer() {
    if (meetingTimerItv) clearInterval(meetingTimerItv);
    meetingSeconds = 0;
    meetingTimerItv = setInterval(() => {
      meetingSeconds++;
      const m = String(Math.floor(meetingSeconds / 60)).padStart(2, '0');
      const s = String(meetingSeconds % 60).padStart(2, '0');
      if ($('dbtTimer')) $('dbtTimer').textContent = `⏱️ ${m}:${s}`;
    }, 1000);
  }

  function stopMeetingTimer() {
    if (meetingTimerItv) clearInterval(meetingTimerItv);
    meetingTimerItv = null;
  }

  function createFallbackMediaStream(name, id) {
    const canvas = document.createElement('canvas');
    canvas.width = 640; canvas.height = 480;
    const ctx = canvas.getContext('2d');
    
    let hue = Math.floor(Math.random() * 360);
    function draw() {
      hue = (hue + 1) % 360;
      ctx.fillStyle = '#121624';
      ctx.fillRect(0, 0, 640, 480);

      // Radial glowing ring
      const grad = ctx.createRadialGradient(320, 240, 30, 320, 240, 180);
      grad.addColorStop(0, `hsla(${hue}, 80%, 60%, 0.35)`);
      grad.addColorStop(1, 'transparent');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 640, 480);

      // Avatar circle
      ctx.beginPath();
      ctx.arc(320, 200, 70, 0, Math.PI * 2);
      ctx.fillStyle = `hsl(${hue}, 70%, 45%)`;
      ctx.fill();
      ctx.lineWidth = 4;
      ctx.strokeStyle = '#80ffea';
      ctx.stroke();

      // Initial letter
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 54px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText((name[0] || 'U').toUpperCase(), 320, 200);

      // Name & ID Label
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.font = 'bold 22px sans-serif';
      ctx.fillText(name, 320, 310);

      ctx.fillStyle = '#80ffea';
      ctx.font = '16px sans-serif';
      ctx.fillText(id, 320, 340);

      requestAnimationFrame(draw);
    }
    draw();

    const stream = canvas.captureStream(30);
    // Add dummy silent audio track so WebRTC media mesh succeeds
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const dst = audioCtx.createMediaStreamDestination();
    osc.connect(dst);
    const audioTrack = dst.stream.getAudioTracks()[0];
    stream.addTrack(audioTrack);
    return stream;
  }

  /* ---------------- init (called when the view opens) ---------------- */
  window.initDebate = function (me) {
    if ($('dbtName') && me && !$('dbtName').value) $('dbtName').value = me.name || '';
    if (inited) return;
    inited = true;

    if ($('dbtCreate')) $('dbtCreate').onclick = () => start(true);
    if ($('dbtJoin')) $('dbtJoin').onclick = () => start(false);
    $('dbtRoom').addEventListener('keydown', (e) => { if (e.key === 'Enter') start(false); });
    $('dbtLeave').onclick = leaveRoom;
    $('dbtCodeCopy').onclick = () => {
      if (!S) return;
      navigator.clipboard?.writeText(S.code).then(() => roomStatus('Room code copied ✓'), () => {});
    };
    $('dbtTopicSet').onclick = () => {
      const v = $('dbtTopicInput').value.trim();
      if (v) announce({ type: 'topic', motion: v });
    };
    $('dbtTopicInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('dbtTopicSet').click(); });
    $('dbtTopicAI').onclick = aiTopic;
    $('dbtFloor').onclick = toggleFloor;
    $('dbtCam').onclick = () => toggleTrack('video', $('dbtCam'));
    $('dbtMic').onclick = () => toggleTrack('audio', $('dbtMic'));
    
    if ($('dbtHand')) $('dbtHand').onclick = toggleRaiseHand;
    if ($('dbtScreen')) $('dbtScreen').onclick = toggleScreenShare;
    if ($('dbtChatToggle')) $('dbtChatToggle').onclick = () => {
      if ($('dbtSidebar')) $('dbtSidebar').hidden = !$('dbtSidebar').hidden;
    };
    if ($('dbtChatClose')) $('dbtChatClose').onclick = () => {
      if ($('dbtSidebar')) $('dbtSidebar').hidden = true;
    };
    if ($('dbtChatSend')) $('dbtChatSend').onclick = sendChatMessage;
    if ($('dbtChatMsg')) $('dbtChatMsg').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') sendChatMessage();
    });

    $('dbtEnd').onclick = () => {
      if (!S) return;
      if (S.ending) return;
      if (!confirm('End the debate and let the AI analyse it?')) return;
      announce({ type: 'ending' });
    };
  };


  function leaveRoom() {
    stopMeetingTimer();
    if (S) {
      if (S.localStream) {
        try { S.localStream.getTracks().forEach(t => t.stop()); } catch {}
      }
      if (S.peer) {
        try { S.peer.destroy(); } catch {}
      }
    }
    S = null;
    const lobby = $('dbtLobby');
    const roomWrap = $('dbtRoom-wrap');
    if (lobby) {
      lobby.hidden = false;
      lobby.style.display = 'grid';
    }
    if (roomWrap) {
      roomWrap.hidden = true;
      roomWrap.style.display = 'none';
    }
    if ($('dbtGrid')) $('dbtGrid').innerHTML = '';
  }

  window.startDebateRoom = function(asHost) {
    start(asHost);
  };

  window.startAIDebate = async function() {
    const nameInput = $('dbtName');
    const idInput = $('dbtId');
    let name = nameInput ? nameInput.value.trim() : '';
    let id = idInput ? idInput.value.trim() : '';
    if (!name) name = (window.me && window.me.name) ? window.me.name : 'Student';
    if (!id) id = (window.me && window.me.email) ? window.me.email : 'STU-' + Math.floor(1000 + Math.random() * 9000);
    if (nameInput) nameInput.value = name;
    if (idInput) idInput.value = id;

    const code = 'AI-DEBATE-' + Math.floor(1000 + Math.random() * 9000);

    S = freshState();
    S.code = code;
    S.me.name = name; S.me.id = id;
    S.isHost = true;
    S.isAIDebate = true;
    S.aiHistory = [];

    const myTempId = 'usr_' + Math.random().toString(36).substring(2, 7);
    const aiPeerId = 'ai_bot_opponent';

    S.me.peerId = myTempId;
    S.roster.set(myTempId, { name, id });
    S.roster.set(aiPeerId, { name: 'AI Opponent 🤖', id: 'GROQ-AI' });

    enterRoom();
    startMeetingTimer();

    // Add user tile
    S.localStream = createFallbackMediaStream(name, id);
    addTile(myTempId, name, id, S.localStream, true);

    // Add AI Opponent tile
    const aiStream = createFallbackMediaStream('AI Opponent 🤖', 'GROQ-AI-BOT');
    addTile(aiPeerId, 'AI Opponent 🤖', 'GROQ-AI', aiStream, false);

    roomStatus('AI Debate Room ready! Pick a topic or click AI topic to begin.');

    // Attempt real camera stream for user
    navigator.mediaDevices?.getUserMedia({ video: true, audio: true }).then((realStream) => {
      if (!S) return;
      S.localStream = realStream;
      const myTile = $('tile-' + S.me.peerId);
      const myVid = myTile ? myTile.querySelector('video') : $('vid-' + S.me.peerId);
      if (myVid) {
        myVid.srcObject = realStream;
        myVid.play().catch(() => {});
        if (myTile) myTile.classList.add('has-camera');
      }
    }).catch(() => {});
  };

  /* ---------------- start: create or join ---------------- */
  async function start(asHost) {
    const nameInput = $('dbtName');
    const idInput = $('dbtId');
    let name = nameInput ? nameInput.value.trim() : '';
    let id = idInput ? idInput.value.trim() : '';

    if (!name) name = (window.me && window.me.name) ? window.me.name : 'Student';
    if (!id) id = (window.me && window.me.email) ? window.me.email : 'STU-' + Math.floor(1000 + Math.random() * 9000);

    if (nameInput) nameInput.value = name;
    if (idInput) idInput.value = id;

    let code;
    if (asHost) {
      code = 'DEBATE-ROOM-' + Math.floor(1000 + Math.random() * 9000);
    } else {
      const roomInput = $('dbtRoom');
      code = roomInput ? roomInput.value.trim().toUpperCase() : '';
      if (!code) return lobbyStatus('Enter the room code to join.');
    }

    S = freshState();
    S.code = code;
    S.me.name = name; S.me.id = id;
    S.isHost = asHost;

    const myTempId = (asHost ? hostPeerId(code) : 'usr_' + Math.random().toString(36).substring(2, 7));
    S.me.peerId = myTempId;
    S.roster.set(myTempId, { name, id });

    // 0MS INSTANT DISPLAY: Open meeting shell immediately!
    enterRoom();
    startMeetingTimer();

    // Create instant fallback avatar stream for 0ms initial video rendering
    S.localStream = createFallbackMediaStream(name, id);
    addTile(myTempId, name, id, S.localStream, true);
    roomStatus('Live video room created — code: ' + code);

    // Asynchronously acquire real camera & mic stream without blocking UI
    navigator.mediaDevices?.getUserMedia({ video: true, audio: true }).then((realStream) => {
      if (!S) return;
      S.localStream = realStream;
      // Find video element inside the tile
      const myTile = $('tile-' + S.me.peerId);
      const myVid = myTile ? myTile.querySelector('video') : $('vid-' + S.me.peerId);
      if (myVid) {
        myVid.srcObject = realStream;
        myVid.play().catch(() => {});
        // Mark tile as having real camera (for CSS selfie mirror)
        if (myTile) myTile.classList.add('has-camera');
      }
    }).catch((e) => {
      console.warn('Using avatar stream fallback for room video:', e);
    });

    if (typeof Peer === 'undefined') return;

    let peer = null;
    try {
      peer = new Peer(asHost ? myTempId : undefined, {
        config: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:global.stun.twilio.com:3478' }] },
      });
    } catch (err) {
      console.warn('PeerJS background network init warning:', err);
      return;
    }

    S.peer = peer;

    peer.on('open', (realId) => {
      S.roster.delete(myTempId);
      S.me.peerId = realId;
      S.roster.set(realId, { name, id });
      const oldTile = $('tile-' + myTempId);
      if (oldTile) oldTile.id = 'tile-' + realId;

      if (asHost) {
        peer.on('connection', onIncomingData);
        peer.on('call', onIncomingCall);
        renderRoster();
      } else {
        peer.on('call', onIncomingCall);
        connectToHost();
      }
    });

    peer.on('error', (err) => {
      console.warn('Peer error:', err.type, err);
      if (err.type === 'unavailable-id') {
        lobbyStatus('That code is taken — joining the existing room…');
        try { peer.destroy(); } catch {}
        const s = S; S = null;
        s.localStream.getTracks().forEach(t => t.stop());
        $('dbtRoom').value = code;
        start(false);
      } else if (err.type === 'peer-unavailable') {
        roomStatus('Could not reach that room — double check the code.');
      } else {
        roomStatus('Connection issue: ' + err.type);
      }
    });
  }

  function connectToHost() {
    const conn = S.peer.connect(hostPeerId(S.code), { reliable: true, metadata: { name: S.me.name, id: S.me.id } });
    S.hostConn = conn;
    let opened = false;
    conn.on('open', () => {
      opened = true;
      conn.send({ type: 'hello', origin: S.me.peerId, name: S.me.name, id: S.me.id });
      roomStatus('Connected. Waiting for others to appear…');
    });
    conn.on('data', (msg) => handleData(msg, conn));
    conn.on('close', () => roomStatus('Host left the room. You can leave and start a new one.'));
    setTimeout(() => { if (!opened) roomStatus('Room not found — double-check the code with the host.'); }, 6000);
  }

  /* ---------------- data plumbing (host = relay) ---------------- */
  function onIncomingData(conn) {
    conn.on('open', () => {
      S.dataConns.set(conn.peer, conn);
      // send the newcomer everything they need to catch up
      conn.send({ type: 'roster', peers: rosterArray() });
      if (S.topic) conn.send({ type: 'topic', motion: S.topic });
      if (S.floorHolder) conn.send({ type: 'floor', peerId: S.floorHolder, taken: true, name: S.roster.get(S.floorHolder)?.name });
    });
    conn.on('data', (msg) => handleData(msg, conn));
    conn.on('close', () => { S.dataConns.delete(conn.peer); dropPeer(conn.peer); });
  }

  // Apply a message locally; if I'm host, relay it to all other joiners.
  function handleData(msg, fromConn) {
    if (!S) return;
    if (msg.type === 'hello') {
      // host-only: register the newcomer, tell everyone, then form the media mesh
      S.roster.set(msg.origin, { name: msg.name, id: msg.id });
      announce({ type: 'roster', peers: rosterArray() });
      maybeCall(msg.origin);
      return;
    }
    applyMsg(msg);
    if (S.isHost && fromConn) {
      // relay to every other joiner
      for (const [pid, c] of S.dataConns) if (pid !== msg.origin) { try { c.send(msg); } catch {} }
    }
  }

  // Ensure everyone (including me) processes msg.
  function announce(msg) {
    if (!S) return;
    msg.origin = S.me.peerId;
    applyMsg(msg);
    if (S.isHost) { for (const [, c] of S.dataConns) { try { c.send(msg); } catch {} } }
    else if (S.hostConn && S.hostConn.open) { try { S.hostConn.send(msg); } catch {} }
  }

  function toggleRaiseHand() {
    if (!S) return;
    S.handRaised = !S.handRaised;
    if ($('dbtHand')) $('dbtHand').classList.toggle('hand-raised', S.handRaised);
    announce({ type: 'hand', peerId: S.me.peerId, name: S.me.name, raised: S.handRaised });
  }

  function sendChatMessage() {
    if (!S) return;
    const input = $('dbtChatMsg');
    if (!input) return;
    const msg = input.value.trim();
    if (!msg) return;
    input.value = '';
    announce({ type: 'chat', peerId: S.me.peerId, name: S.me.name, text: msg });
  }

  function appendChatMessage(name, text, isMe) {
    const box = $('dbtChatBox');
    if (!box) return;
    const div = document.createElement('div');
    div.className = 'dbt-chat__msg';
    div.innerHTML = `<b>${name} ${isMe ? '(You)' : ''}</b><div>${text}</div>`;
    box.appendChild(div);
    box.scrollTop = box.scrollHeight;
  }

  async function toggleScreenShare() {
    if (!S) return;
    const btn = $('dbtScreen');
    if (S.sharingScreen) {
      S.sharingScreen = false;
      if (btn) btn.classList.remove('active');
      const vTrack = S.localStream?.getVideoTracks()[0];
      if (vTrack) replaceVideoTrack(vTrack);
    } else {
      try {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        const screenTrack = screenStream.getVideoTracks()[0];
        S.sharingScreen = true;
        if (btn) btn.classList.add('active');
        replaceVideoTrack(screenTrack);
        screenTrack.onended = () => toggleScreenShare();
      } catch (e) {
        console.warn('Screen share canceled or failed:', e);
      }
    }
  }

  function replaceVideoTrack(newTrack) {
    if (!S) return;
    for (const [, call] of S.calls) {
      const sender = call.peerConnection?.getSenders().find(s => s.track && s.track.kind === 'video');
      if (sender) sender.replaceTrack(newTrack);
    }
    const myVideo = $('vid-' + S.me.peerId);
    if (myVideo && S.localStream) {
      const oldV = S.localStream.getVideoTracks()[0];
      if (oldV) S.localStream.removeTrack(oldV);
      S.localStream.addTrack(newTrack);
      myVideo.srcObject = S.localStream;
    }
  }

  function applyMsg(msg) {
    switch (msg.type) {
      case 'roster':
        for (const p of msg.peers) if (!S.roster.has(p.peerId)) S.roster.set(p.peerId, { name: p.name, id: p.id });
        renderRoster();
        for (const p of msg.peers) if (p.peerId !== S.me.peerId) maybeCall(p.peerId);
        break;
      case 'topic':
        S.topic = msg.motion; showTopic(msg.motion); roomStatus('Topic set.'); break;
      case 'floor':
        S.floorHolder = msg.taken ? msg.peerId : null;
        markFloor(); break;
      case 'chat':
        appendChatMessage(msg.name, msg.text, msg.peerId === S.me.peerId);
        break;
      case 'hand':
        roomStatus(`✋ ${msg.name} ${msg.raised ? 'raised their hand!' : 'lowered hand.'}`);
        const tile = $('tile-' + msg.peerId);
        if (tile) {
          let badge = tile.querySelector('.dbt-hand-badge');
          if (msg.raised) {
            if (!badge) {
              badge = document.createElement('div');
              badge.className = 'dbt-hand-badge';
              badge.textContent = '✋ Raised Hand';
              tile.appendChild(badge);
            }
          } else if (badge) {
            badge.remove();
          }
        }
        break;
      case 'ending':
        onEnding(); break;
      case 'transcript':
        S.transcripts.set(msg.peerId, { name: msg.name, id: msg.id, text: msg.text });
        roomStatus(`Collecting speeches… (${S.transcripts.size}/${S.roster.size})`);
        if (S.isHost) maybeAnalyse(); break;
      case 'result':
        showResults(msg.report, msg.topic); break;
    }
  }

  function rosterArray() { return [...S.roster].map(([peerId, v]) => ({ peerId, name: v.name, id: v.id })); }

  /* ---------------- media mesh ---------------- */
  // Rule: the peer with the smaller id initiates the call (dedupes to one call per pair).
  function maybeCall(otherId) {
    if (!S || otherId === S.me.peerId) return;
    if (S.calls.has(otherId)) return;
    if (S.me.peerId < otherId) {
      const call = S.peer.call(otherId, S.localStream, { metadata: { name: S.me.name, id: S.me.id } });
      wireCall(call, otherId);
    }
  }

  function onIncomingCall(call) {
    call.answer(S.localStream);
    wireCall(call, call.peer);
  }

  function wireCall(call, otherId) {
    if (!call) return;
    S.calls.set(otherId, call);
    call.on('stream', (stream) => {
      S.streams.set(otherId, stream);
      const info = S.roster.get(otherId) || {};
      addTile(otherId, info.name || 'Guest', info.id || '', stream, false);
    });
    call.on('close', () => dropPeer(otherId));
    call.on('error', () => dropPeer(otherId));
  }

  function dropPeer(peerId) {
    if (!S) return;
    S.calls.delete(peerId); S.streams.delete(peerId); S.roster.delete(peerId); S.dataConns.delete(peerId);
    const tile = $('tile-' + peerId); if (tile) tile.remove();
    if (S.floorHolder === peerId) { S.floorHolder = null; markFloor(); }
    renderRoster();
  }

  /* ---------------- turn baton + recording ---------------- */
  function toggleFloor() {
    if (!S) return;
    if (S.ending) return;
    if (S.hasFloor) { releaseFloor(); return; }
    if (S.floorHolder && S.floorHolder !== S.me.peerId) {
      const who = S.roster.get(S.floorHolder)?.name || 'Someone';
      roomStatus(`${who} has the floor — wait for them to pass it.`);
      return;
    }
    takeFloor();
  }

  function ensureRecorder() {
    if (S.recorder) return;
    try {
      const audioOnly = new MediaStream(S.localStream.getAudioTracks());
      const rec = new MediaRecorder(audioOnly, { mimeType: MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '' });
      rec.ondataavailable = (e) => { if (e.data && e.data.size) S.chunks.push(e.data); };
      S.recorder = rec;
    } catch (e) { console.warn('Recorder unavailable', e); }
  }

  function takeFloor() {
    S.hasFloor = true;
    ensureRecorder();
    if (S.recorder) {
      if (S.recorder.state === 'inactive') S.recorder.start();     // starts accumulating
      else if (S.recorder.state === 'paused') S.recorder.resume();
    }
    setFloorBtn(true);
    announce({ type: 'floor', peerId: S.me.peerId, taken: true, name: S.me.name });
  }

  function releaseFloor() {
    S.hasFloor = false;
    if (S.recorder && S.recorder.state === 'recording') S.recorder.pause();
    setFloorBtn(false);
    announce({ type: 'floor', peerId: S.me.peerId, taken: false });

    if (S.isAIDebate) {
      handleAIOpponentTurn();
    }
  }

  async function handleAIOpponentTurn() {
    roomStatus('AI Opponent 🤖 is analyzing your argument & preparing a reply…');
    const userSpeech = await transcribeMine();
    const topic = S.topic || 'General Debate Topic';

    if (userSpeech) {
      S.aiHistory = S.aiHistory || [];
      S.aiHistory.push({ speaker: S.me.name, text: userSpeech });
      appendChatMessage(S.me.name, userSpeech, true);
    }

    try {
      const res = await fetch('/api/ai-debate-reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic, history: S.aiHistory, userSpeech, language: 'English' }),
      });
      const data = await res.json();
      const replyText = data.reply || "I understand your perspective, but considering the broader evidence, there are key counterpoints we must evaluate.";
      
      S.aiHistory.push({ speaker: 'AI Opponent 🤖', text: replyText });
      appendChatMessage('AI Opponent 🤖', replyText, false);
      roomStatus('AI Opponent 🤖 is speaking now…');

      const aiTile = $('tile-ai_bot_opponent');
      if (aiTile) aiTile.classList.add('speaking');

      try {
        const ttsRes = await fetch('/api/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: replyText, language: 'English', role: 'opponent', section: 'debate' }),
        });
        if (ttsRes.ok) {
          const blob = await ttsRes.blob();
          const audio = new Audio(URL.createObjectURL(blob));
          audio.onended = () => {
            if (aiTile) aiTile.classList.remove('speaking');
            roomStatus('AI turn finished. Your turn to take the floor!');
          };
          audio.play().catch(() => {
            speakBrowserFallback(replyText, () => {
              if (aiTile) aiTile.classList.remove('speaking');
              roomStatus('AI turn finished. Your turn to take the floor!');
            });
          });
        } else {
          speakBrowserFallback(replyText, () => {
            if (aiTile) aiTile.classList.remove('speaking');
            roomStatus('AI turn finished. Your turn to take the floor!');
          });
        }
      } catch (e) {
        speakBrowserFallback(replyText, () => {
          if (aiTile) aiTile.classList.remove('speaking');
          roomStatus('AI turn finished. Your turn to take the floor!');
        });
      }
    } catch (err) {
      console.warn('AI Debate reply error:', err);
      roomStatus('AI Opponent ready for next round!');
    }
  }

  function speakBrowserFallback(text, onEnd) {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const utt = new SpeechSynthesisUtterance(text);
      utt.onend = onEnd;
      utt.onerror = onEnd;
      window.speechSynthesis.speak(utt);
    } else {
      onEnd?.();
    }
  }

  function setFloorBtn(active) {
    const b = $('dbtFloor');
    b.classList.toggle('speaking', active);
    b.querySelector('span').textContent = active ? 'Pass the floor' : 'Take the floor';
    b.querySelector('svg').innerHTML = active
      ? '<rect x="6" y="5" width="4" height="14" rx="1" fill="#fff"/><rect x="14" y="5" width="4" height="14" rx="1" fill="#fff"/>'
      : '<path d="M8 5v14l11-7z" fill="#fff"/>';
  }

  function toggleTrack(kind, btn) {
    if (!S || !S.localStream) return;
    const track = S.localStream.getTracks().find(t => t.kind === kind);
    if (!track) return;
    track.enabled = !track.enabled;
    btn.classList.toggle('off', !track.enabled);
    if (kind === 'video') {
      const tile = $('tile-' + S.me.peerId);
      const off = tile?.querySelector('.dbt-off');
      if (off) off.hidden = track.enabled;
    }
  }

  /* ---------------- topic ---------------- */
  async function aiTopic() {
    roomStatus('Asking the AI for a fresh topic…');
    try {
      const res = await fetch('/api/debate-topic', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ level: 'school', language: 'English' }),
      });
      const t = await res.json();
      if (t.motion) { $('dbtTopicInput').value = t.motion; announce({ type: 'topic', motion: t.motion }); }
      else roomStatus('Could not fetch a topic — type your own.');
    } catch { roomStatus('Could not fetch a topic — type your own.'); }
  }

  function showTopic(motion) {
    const el = $('dbtMotion');
    el.hidden = false;
    el.innerHTML = `<span class="dbt-motion__lbl">Motion</span>${escapeHtml(motion)}`;
    $('dbtTopicInput').value = motion;
  }

  /* ---------------- end & analyse ---------------- */
  async function onEnding() {
    if (S.ending) return;
    S.ending = true;
    if (S.hasFloor) releaseFloor();
    $('dbtFloor').disabled = true; $('dbtEnd').disabled = true;
    roomStatus('Debate ended — transcribing your speech…');

    // Solo mode: skip transcription wait and immediately analyse
    if (S.roster.size <= 1 && S.isHost) {
      roomStatus('Solo session — AI is analysing the debate topic…');
      const text = await transcribeMine();
      const soloSpeech = (text || '').trim() || `I debated on the topic: ${S.topic || 'general topic'}. Here are my key arguments and points.`;
      S.transcripts.set(S.me.peerId, { name: S.me.name, id: S.me.id, text: soloSpeech });
      await maybeAnalyse(true);
      return;
    }

    // Host schedules the analysis (waits for everyone, or a timeout).
    if (S.isHost) {
      S.analysisTimer = setTimeout(() => maybeAnalyse(true), 14000);
    }

    // Transcribe my own recording and share it.
    const text = await transcribeMine();
    announce({ type: 'transcript', peerId: S.me.peerId, name: S.me.name, id: S.me.id, text });
  }

  function transcribeMine() {
    return new Promise((resolve) => {
      if (!S || !S.recorder || S.chunks.length === 0) return resolve('');
      const rec = S.recorder;
      const finish = async () => {
        try {
          const blob = new Blob(S.chunks, { type: 'audio/webm' });
          if (blob.size < 1200) return resolve('');
          const fd = new FormData();
          fd.append('audio', blob, 'debate.webm');
          const res = await fetch('/api/stt', { method: 'POST', body: fd });
          const d = await res.json();
          resolve((d.text || '').trim());
        } catch { resolve(''); }
      };
      if (rec.state !== 'inactive') { rec.onstop = finish; rec.stop(); }
      else finish();
    });
  }

  async function maybeAnalyse(force) {
    if (!S || !S.isHost || S.analysisDone) return;
    const expected = S.roster.size;
    if (!force && S.transcripts.size < expected) return; // wait for more
    S.analysisDone = true;
    if (S.analysisTimer) clearTimeout(S.analysisTimer);
    roomStatus('The AI judge is analysing the debate…');
    const speakers = [...S.transcripts.values()].filter(s => (s.text || '').trim());
    if (!speakers.length) {
      // Fallback: create a placeholder speaker entry so analysis can proceed
      speakers.push({ name: S.me.name, id: S.me.id, text: `Solo debate on topic: ${S.topic || 'general'}. Provided opening arguments and key points.` });
    }
    try {
      const res = await fetch('/api/debate-analyse', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic: S.topic, speakers, language: 'Auto' }),
      });
      const d = await res.json();
      if (d.report) announce({ type: 'result', report: d.report, topic: S.topic });
      else roomStatus('Analysis failed: ' + (d.error || 'unknown error'));
    } catch (e) { roomStatus('Analysis failed: ' + (e.message || e)); }
  }

  /* ---------------- UI rendering ---------------- */
  function enterRoom() {
    const lobby = $('dbtLobby');
    const roomWrap = $('dbtRoom-wrap');
    if (lobby) {
      lobby.hidden = true;
      lobby.style.display = 'none';
    }
    if (roomWrap) {
      roomWrap.hidden = false;
      roomWrap.style.display = 'flex';
      setTimeout(() => {
        roomWrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 50);
    }
    if ($('dbtCodeText') && S) $('dbtCodeText').textContent = S.code || 'DEBATE-ROOM';
    if ($('dbtGrid')) $('dbtGrid').innerHTML = '';
    if ($('dbtResults')) $('dbtResults').hidden = true;
    updateCount();
  }

  function setupAudioMeter(stream, peerId) {
    try {
      if (!stream.getAudioTracks().length) return;
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      const dataArray = new Uint8Array(analyser.frequencyBinCount);

      const checkVolume = () => {
        if (!S) return;
        analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
        const avg = sum / dataArray.length;
        const tile = $('tile-' + peerId);
        if (tile) {
          if (avg > 15) {
            tile.classList.add('speaking');
          } else if (!S.floorHolder || S.floorHolder !== peerId) {
            tile.classList.remove('speaking');
          }
        }
        requestAnimationFrame(checkVolume);
      };
      checkVolume();
    } catch (e) {
      console.warn('Audio meter warning:', e);
    }
  }

  function addTile(peerId, name, id, stream, isMe) {
    let tile = $('tile-' + peerId);
    if (!tile) {
      tile = document.createElement('div');
      tile.className = 'dbt-tile';
      tile.id = 'tile-' + peerId;
      tile.innerHTML =
        `<video id="vid-${peerId}" autoplay playsinline${isMe ? ' muted' : ''}></video>` +
        `<div class="dbt-off" hidden><span>${escapeHtml((name || '?')[0].toUpperCase())}</span></div>` +
        `<div class="dbt-tag"><b>${escapeHtml(name || 'Guest')}${isMe ? ' (you)' : ''}</b><i>${escapeHtml(id || '')}</i></div>` +
        `<span class="dbt-speak">Speaking</span>`;
      $('dbtGrid').appendChild(tile);
    }
    const v = tile.querySelector('video');
    const off = tile.querySelector('.dbt-off');
    if (stream && v.srcObject !== stream) {
      v.srcObject = stream;
      v.play?.().catch(() => {});
      setupAudioMeter(stream, peerId);
    }
    // Avatar shows only for a remote peer whose video hasn't arrived yet.
    if (off) off.hidden = isMe ? true : !!stream;
    updateCount(); markFloor();
  }

  function renderRoster() {
    // add placeholder tiles for peers we know but have no stream yet
    for (const [peerId, info] of S.roster) {
      if (peerId === S.me.peerId) continue;
      if (!$('tile-' + peerId) && !S.streams.has(peerId)) addTile(peerId, info.name, info.id, null, false);
    }
    updateCount();
  }

  function updateCount() {
    const n = S.roster.size;
    $('dbtCount').textContent = n === 1 ? '1 in room' : n + ' in room';
    $('dbtGrid').dataset.n = Math.min(n, 6);
  }

  function markFloor() {
    document.querySelectorAll('.dbt-tile').forEach(t => t.classList.remove('speaking'));
    if (S.floorHolder) $('tile-' + S.floorHolder)?.classList.add('speaking');
  }

  function showResults(report, topic) {
    const el = $('dbtResults');
    el.hidden = false;
    const winner = report.winner || '';
    const cards = (report.speakers || []).map(s => {
      const isWin = s.name && winner && s.name.trim().toLowerCase() === winner.trim().toLowerCase();
      return `<div class="dbt-scard ${isWin ? 'win' : ''}">
        <div class="dbt-scard__top">
          <b>${escapeHtml(s.name || 'Speaker')}</b>
          ${isWin ? '<span class="dbt-badge">🏆 Best debater</span>' : ''}
          <span class="dbt-score">${s.score}<i>/100</i></span>
        </div>
        ${list('Key points', s.keyPoints, 'key')}
        ${list('What worked', s.positives, 'pos')}
        ${list('To improve', s.negatives, 'neg')}
      </div>`;
    }).join('');
    el.innerHTML =
      `<div class="dbt-verdict">
         <span class="dbt-verdict__lbl">Verdict</span>
         <h3>🏆 ${escapeHtml(winner || 'Great debate')}</h3>
         <p>${escapeHtml(report.winnerReason || '')}</p>
         ${topic ? `<span class="dbt-verdict__topic">On: ${escapeHtml(topic)}</span>` : ''}
       </div>
       <div class="dbt-scards">${cards}</div>
       ${report.advice ? `<div class="dbt-advice"><b>Tip for next time.</b> ${escapeHtml(report.advice)}</div>` : ''}`;
    el.scrollIntoView({ behavior: 'smooth' });
    roomStatus('');
  }

  function list(title, arr, cls) {
    if (!arr || !arr.length) return '';
    return `<div class="dbt-list dbt-list--${cls}"><span>${title}</span><ul>${arr.map(x => `<li>${escapeHtml(x)}</li>`).join('')}</ul></div>`;
  }

  /* ---------------- leave / cleanup ---------------- */
  function leaveRoom() {
    if (!S) { $('dbtLobby').hidden = false; $('dbtRoom-wrap').hidden = true; return; }
    try { S.recorder && S.recorder.state !== 'inactive' && S.recorder.stop(); } catch {}
    for (const [, c] of S.calls) { try { c.close(); } catch {} }
    for (const [, c] of S.dataConns) { try { c.close(); } catch {} }
    try { S.hostConn && S.hostConn.close(); } catch {}
    try { S.peer && S.peer.destroy(); } catch {}
    try { S.localStream && S.localStream.getTracks().forEach(t => t.stop()); } catch {}
    if (S.analysisTimer) clearTimeout(S.analysisTimer);
    S = null;
    $('dbtLobby').hidden = false;
    $('dbtRoom-wrap').hidden = true;
    $('dbtResults').hidden = true;
    $('dbtFloor').disabled = false; $('dbtEnd').disabled = false;
    setFloorBtn(false);
    $('dbtMotion').hidden = true;
    lobbyStatus('You left the room.');
  }
  window.addEventListener('beforeunload', () => { if (S) leaveRoom(); });

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
})();

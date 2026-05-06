const roomInput = document.getElementById("room-input");
const roleSelect = document.getElementById("role-select");
const joinButton = document.getElementById("join-button");
const pttButton = document.getElementById("ptt-button");
const connectionStatus = document.getElementById("connection-status");
const speakingStatus = document.getElementById("speaking-status");
const statusMessage = document.getElementById("status-message");
const debugState = document.getElementById("debug-state");
const remoteAudio = document.getElementById("remote-audio");
const resumeAudioButton = document.getElementById("resume-audio-button");

const ICE_SERVERS = {
  iceServers: [
    {
      urls: ["stun:stun.l.google.com:19302"],
    },
  ],
};

const state = {
  ws: null,
  roomId: "",
  role: "",
  wsState: "disconnected",
  joined: false,
  peerPresent: false,
  peerRole: null,
  floorHolder: null,
  wantsToTalk: false,
  awaitingFloor: false,
  localMicEnabled: false,
  micPermission: "idle",
  remoteAudioAttached: false,
  remoteAudioUnlocked: false,
  pttActive: false,
  speakingState: "idle",
  peerConnection: null,
  peerConnectionState: "new",
  signalingState: "stable",
  iceConnectionState: "new",
  localStream: null,
  localTrack: null,
  remoteStream: null,
};

function setStatus(message, tone = "neutral") {
  statusMessage.textContent = message;
  statusMessage.classList.toggle("is-error", tone === "error");
  statusMessage.classList.toggle("is-success", tone === "success");
}

function derivePeerRole() {
  if (!state.role) {
    return null;
  }

  return state.role === "mac" ? "iphone" : "mac";
}

function refreshDebugState() {
  const entries = [
    ["Room", state.roomId || "—"],
    ["Role", state.role || "—"],
    ["Peer Role", state.peerRole || "—"],
    ["Joined", state.joined ? "yes" : "no"],
    ["Peer Present", state.peerPresent ? "yes" : "no"],
    ["WebSocket", state.wsState],
    ["RTCPeerConnection", state.peerConnectionState],
    ["Signaling", state.signalingState],
    ["ICE", state.iceConnectionState],
    ["Floor Holder", state.floorHolder || "none"],
    ["Wants To Talk", state.wantsToTalk ? "yes" : "no"],
    ["Awaiting Floor", state.awaitingFloor ? "yes" : "no"],
    ["Mic Permission", state.micPermission],
    ["Local Mic Enabled", state.localMicEnabled ? "yes" : "no"],
    ["Remote Audio", state.remoteAudioAttached ? "attached" : "waiting"],
  ];

  debugState.innerHTML = entries
    .map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`)
    .join("");
}

function refreshUi() {
  const peerConnected =
    state.peerConnection &&
    (state.peerConnectionState === "connected" || state.iceConnectionState === "connected" || state.iceConnectionState === "completed");

  const canTalk =
    state.joined &&
    state.wsState === "open" &&
    state.peerPresent &&
    Boolean(peerConnected) &&
    Boolean(state.localTrack);

  connectionStatus.textContent = state.joined
    ? `${state.wsState} / ${state.peerConnectionState}`
    : "Disconnected";

  if (!state.joined) {
    speakingStatus.textContent = "Idle";
  } else if (state.localMicEnabled) {
    speakingStatus.textContent = "Speaking";
  } else if (state.awaitingFloor) {
    speakingStatus.textContent = "Waiting";
  } else if (state.floorHolder && state.floorHolder !== state.role) {
    speakingStatus.textContent = "Peer Speaking";
  } else if (state.peerPresent) {
    speakingStatus.textContent = "Ready";
  } else {
    speakingStatus.textContent = "Waiting for Peer";
  }

  pttButton.disabled = !canTalk;
  pttButton.classList.toggle("is-active", state.pttActive && state.localMicEnabled);
  pttButton.textContent = state.awaitingFloor
    ? "Requesting Floor..."
    : state.localMicEnabled
      ? "Talking..."
      : "Hold to Talk";

  roomInput.disabled = state.joined;
  roleSelect.disabled = state.joined;
  joinButton.textContent = state.joined ? "Joined" : "Join Room";
  joinButton.disabled = state.joined;

  refreshDebugState();
}

function setLocalMicEnabled(enabled) {
  if (!state.localTrack) {
    state.localMicEnabled = false;
    refreshUi();
    return;
  }

  state.localTrack.enabled = enabled;
  state.localMicEnabled = enabled;
  refreshUi();
}

function clearSpeakingIntent() {
  state.wantsToTalk = false;
  state.awaitingFloor = false;
  state.pttActive = false;
  setLocalMicEnabled(false);
}

function sendMessage(payload) {
  if (!state.ws || state.ws.readyState !== WebSocket.OPEN) {
    return false;
  }

  state.ws.send(JSON.stringify(payload));
  return true;
}

async function unlockRemoteAudio() {
  try {
    await remoteAudio.play();
    state.remoteAudioUnlocked = true;
  } catch (error) {
    setStatus("Remote audio is ready, but Safari may need a tap on Resume Audio before playback starts.");
  } finally {
    refreshDebugState();
  }
}

function cleanupPeerConnection() {
  if (state.peerConnection) {
    state.peerConnection.onicecandidate = null;
    state.peerConnection.ontrack = null;
    state.peerConnection.onconnectionstatechange = null;
    state.peerConnection.onsignalingstatechange = null;
    state.peerConnection.oniceconnectionstatechange = null;
    state.peerConnection.close();
  }

  state.peerConnection = null;
  state.peerConnectionState = "new";
  state.signalingState = "stable";
  state.iceConnectionState = "new";
  state.remoteAudioAttached = false;
  state.remoteStream = null;
  remoteAudio.srcObject = null;
  clearSpeakingIntent();
}

function cleanupSocket() {
  if (state.ws) {
    state.ws.onopen = null;
    state.ws.onmessage = null;
    state.ws.onerror = null;
    state.ws.onclose = null;
    state.ws.close();
  }

  state.ws = null;
  state.wsState = "disconnected";
}

function resetRoomState() {
  state.joined = false;
  state.peerPresent = false;
  state.peerRole = null;
  state.floorHolder = null;
  cleanupPeerConnection();
  cleanupSocket();
  refreshUi();
}

async function ensureLocalMedia() {
  if (state.localStream && state.localTrack) {
    return;
  }

  state.micPermission = "requesting";
  refreshUi();

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    });

    const [track] = stream.getAudioTracks();
    track.enabled = false;

    state.localStream = stream;
    state.localTrack = track;
    state.micPermission = "granted";
  } catch (error) {
    state.micPermission = "denied";
    refreshUi();
    throw error;
  }

  refreshUi();
}

async function createPeerConnection() {
  cleanupPeerConnection();

  const pc = new RTCPeerConnection(ICE_SERVERS);
  state.peerConnection = pc;
  state.peerRole = derivePeerRole();

  if (state.localStream) {
    for (const track of state.localStream.getTracks()) {
      pc.addTrack(track, state.localStream);
    }
  }

  pc.onicecandidate = (event) => {
    if (!event.candidate || !state.peerRole) {
      return;
    }

    sendMessage({
      type: "ice-candidate",
      roomId: state.roomId,
      targetRole: state.peerRole,
      candidate: event.candidate,
    });
  };

  pc.ontrack = (event) => {
    const [stream] = event.streams;
    state.remoteStream = stream;
    state.remoteAudioAttached = true;
    remoteAudio.srcObject = stream;
    unlockRemoteAudio();
    refreshUi();
  };

  pc.onconnectionstatechange = () => {
    state.peerConnectionState = pc.connectionState;

    if (pc.connectionState === "failed" || pc.connectionState === "disconnected" || pc.connectionState === "closed") {
      clearSpeakingIntent();
    }

    refreshUi();
  };

  pc.onsignalingstatechange = () => {
    state.signalingState = pc.signalingState;
    refreshUi();
  };

  pc.oniceconnectionstatechange = () => {
    state.iceConnectionState = pc.iceConnectionState;
    refreshUi();
  };

  refreshUi();
}

async function maybeCreateOffer() {
  if (!state.peerConnection || !state.peerRole) {
    return;
  }

  const offer = await state.peerConnection.createOffer();
  await state.peerConnection.setLocalDescription(offer);

  sendMessage({
    type: "webrtc-offer",
    roomId: state.roomId,
    targetRole: state.peerRole,
    sdp: state.peerConnection.localDescription,
  });
}

async function handleOffer(message) {
  if (!state.peerConnection) {
    await createPeerConnection();
  }

  await state.peerConnection.setRemoteDescription(message.sdp);
  const answer = await state.peerConnection.createAnswer();
  await state.peerConnection.setLocalDescription(answer);

  sendMessage({
    type: "webrtc-answer",
    roomId: state.roomId,
    targetRole: message.sourceRole,
    sdp: state.peerConnection.localDescription,
  });
}

async function handleAnswer(message) {
  if (!state.peerConnection) {
    return;
  }

  await state.peerConnection.setRemoteDescription(message.sdp);
}

async function handleIceCandidate(message) {
  if (!state.peerConnection || !message.candidate) {
    return;
  }

  try {
    await state.peerConnection.addIceCandidate(message.candidate);
  } catch (error) {
    console.error("Failed to add ICE candidate", error);
  }
}

async function handleServerMessage(message) {
  switch (message.type) {
    case "join-ack": {
      state.joined = true;
      state.roomId = message.roomId;
      state.role = message.role;
      state.peerPresent = message.peerPresent;
      state.peerRole = derivePeerRole();
      state.floorHolder = message.floorHolder;
      await createPeerConnection();
      setStatus(
        message.peerPresent
          ? "Joined room. Waiting for the active peer to negotiate."
          : "Joined room. Waiting for the second peer to connect.",
        "success"
      );
      break;
    }
    case "peer-joined": {
      state.peerPresent = true;
      state.peerRole = message.role;
      setStatus("Peer joined. Creating live audio connection.", "success");
      await maybeCreateOffer();
      break;
    }
    case "peer-left": {
      state.peerPresent = false;
      state.peerRole = derivePeerRole();
      state.floorHolder = null;
      cleanupPeerConnection();
      await createPeerConnection();
      setStatus("Peer left the room. Ask them to rejoin to restore audio.", "error");
      break;
    }
    case "webrtc-offer": {
      state.peerPresent = true;
      state.peerRole = message.sourceRole;
      await handleOffer(message);
      setStatus("Received offer. Audio path is being established.", "success");
      break;
    }
    case "webrtc-answer": {
      await handleAnswer(message);
      setStatus("Received answer. Finalizing live connection.", "success");
      break;
    }
    case "ice-candidate": {
      await handleIceCandidate(message);
      break;
    }
    case "floor-granted": {
      state.floorHolder = message.floorHolder;

      if (message.role === state.role && state.wantsToTalk) {
        state.awaitingFloor = false;
        state.pttActive = true;
        setLocalMicEnabled(true);
        setStatus("Floor granted. Live audio is streaming while you hold the button.", "success");
      } else {
        setStatus("Peer has the floor. Your mic stays muted until it is free.");
      }
      break;
    }
    case "floor-denied": {
      state.floorHolder = message.floorHolder;
      state.awaitingFloor = false;
      state.pttActive = false;
      setLocalMicEnabled(false);
      setStatus("Floor denied because the other peer is speaking.", "error");
      break;
    }
    case "floor-released": {
      state.floorHolder = message.floorHolder;
      if (!state.wantsToTalk) {
        clearSpeakingIntent();
      }
      setStatus("Floor released. Hold push-to-talk when you want to speak.");
      break;
    }
    case "error": {
      setStatus(`${message.code}: ${message.message}`, "error");
      break;
    }
    default: {
      console.warn("Unhandled server message", message);
    }
  }

  refreshUi();
}

function buildWebSocketUrl() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws`;
}

async function joinRoom() {
  const roomId = roomInput.value.trim();
  const role = roleSelect.value;

  if (!roomId) {
    setStatus("Room is required before joining.", "error");
    return;
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    setStatus("This browser does not support microphone capture required for the MVP.", "error");
    return;
  }

  joinButton.disabled = true;
  setStatus("Requesting microphone permission and connecting to signaling...");

  try {
    await ensureLocalMedia();
  } catch (error) {
    setStatus("Microphone permission is required before joining.", "error");
    joinButton.disabled = false;
    return;
  }

  const ws = new WebSocket(buildWebSocketUrl());
  state.ws = ws;
  state.wsState = "connecting";
  state.roomId = roomId;
  state.role = role;
  state.peerRole = derivePeerRole();
  refreshUi();

  ws.onopen = () => {
    state.wsState = "open";
    refreshUi();
    sendMessage({
      type: "join-room",
      roomId,
      role,
    });
  };

  ws.onmessage = async (event) => {
    try {
      const message = JSON.parse(event.data);
      await handleServerMessage(message);
    } catch (error) {
      console.error("Failed to process server message", error);
      setStatus("Received an invalid server message.", "error");
    }
  };

  ws.onerror = () => {
    setStatus("WebSocket error while connecting to signaling server.", "error");
  };

  ws.onclose = () => {
    clearSpeakingIntent();
    state.wsState = "closed";
    const wasJoined = state.joined;
    resetRoomState();
    setStatus(
      wasJoined
        ? "Disconnected from signaling. Use Join Room to reconnect manually."
        : "Could not connect to signaling server.",
      "error"
    );
  };
}

function pressToTalkStart(event) {
  event.preventDefault();

  if (pttButton.disabled || state.wantsToTalk || !state.joined) {
    return;
  }

  state.wantsToTalk = true;
  state.awaitingFloor = true;
  state.pttActive = true;
  refreshUi();

  const sent = sendMessage({
    type: "floor-request",
    roomId: state.roomId,
    role: state.role,
  });

  if (!sent) {
    clearSpeakingIntent();
    setStatus("Unable to request the floor because signaling is disconnected.", "error");
  } else {
    setStatus("Requesting speaking floor...");
  }
}

function pressToTalkEnd(event) {
  if (event) {
    event.preventDefault();
  }

  const hadIntent = state.wantsToTalk || state.localMicEnabled || state.awaitingFloor;
  clearSpeakingIntent();

  if (!hadIntent) {
    return;
  }

  sendMessage({
    type: "floor-release",
    roomId: state.roomId,
    role: state.role,
  });

  setStatus("Floor released. Mic muted.");
}

joinButton.addEventListener("click", () => {
  joinRoom();
});

pttButton.addEventListener("pointerdown", pressToTalkStart);
pttButton.addEventListener("pointerup", pressToTalkEnd);
pttButton.addEventListener("pointercancel", pressToTalkEnd);
pttButton.addEventListener("pointerleave", (event) => {
  if (state.localMicEnabled || state.awaitingFloor) {
    pressToTalkEnd(event);
  }
});
pttButton.addEventListener("touchstart", pressToTalkStart, { passive: false });
pttButton.addEventListener("touchend", pressToTalkEnd, { passive: false });
pttButton.addEventListener("touchcancel", pressToTalkEnd, { passive: false });

window.addEventListener("blur", () => {
  pressToTalkEnd();
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    pressToTalkEnd();
  }
});

resumeAudioButton.addEventListener("click", () => {
  unlockRemoteAudio();
});

refreshUi();

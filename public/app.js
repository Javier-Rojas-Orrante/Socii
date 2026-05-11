const roleSelect = document.getElementById("role-select");
const joinButton = document.getElementById("join-button");
const statusMessage = document.getElementById("status-message");
const debugPanel = document.getElementById("debug-panel");
const debugState = document.getElementById("debug-state");
const remoteAudio = document.getElementById("remote-audio");
const resumeAudioButton = document.getElementById("resume-audio-button");
const presenceSummary = document.getElementById("presence-summary");
const partnerOrbButton = document.getElementById("partner-orb-button");
const partnerOrb = document.getElementById("partner-orb");
const partnerStatusLabel = document.getElementById("partner-status-label");
const noteComposerDisplay = document.getElementById("note-composer-display");
const clearNoteButton = document.getElementById("clear-note-button");
const sendNoteButton = document.getElementById("send-note-button");
const kaomojiRow = document.getElementById("kaomoji-row");
const latestReceivedMeta = document.getElementById("latest-received-meta");
const kaomojiButtons = [...document.querySelectorAll(".kaomoji-chip")];

const DEFAULT_SESSION_ID = "socii-default";
const NOTE_MAX_LENGTH = 280;
const ACKNOWLEDGEMENT_WINDOW_MS = 15000;
const ICE_SERVERS = {
  iceServers: [
    {
      urls: ["stun:stun.l.google.com:19302"],
    },
  ],
};

function createPresenceState() {
  return {
    online: false,
    wantsToTalk: false,
    messageWaiting: false,
    speaking: false,
    lastWantToTalkAt: null,
    lastAcknowledgedAt: null,
    lastUpdatedAt: null,
  };
}

const state = {
  ws: null,
  roomId: "",
  role: "",
  peerRole: null,
  wsState: "disconnected",
  joined: false,
  joinInProgress: false,
  peerPresent: false,
  floorHolder: null,
  awaitingFloor: false,
  pttPressed: false,
  localMicEnabled: false,
  micPermission: "idle",
  remoteAudioAttached: false,
  remoteAudioUnlocked: false,
  peerConnection: null,
  peerConnectionState: "new",
  signalingState: "stable",
  iceConnectionState: "new",
  localStream: null,
  localTrack: null,
  remoteStream: null,
  localPresence: createPresenceState(),
  peerPresence: createPresenceState(),
  callMode: {
    active: false,
    activatedAt: null,
  },
  noteDraft: "",
  latestReceivedNote: null,
  latestSentNote: null,
  lastAcknowledgement: null,
};

function nowIso() {
  return new Date().toISOString();
}

function humanRole(role) {
  if (role === "javi") {
    return "Javi";
  }

  if (role === "sofi") {
    return "Sofi";
  }

  return "Socii";
}

function derivePeerRole() {
  if (!state.role) {
    return null;
  }

  return state.role === "javi" ? "sofi" : "javi";
}

function getSociiName(fallback = "your Socii") {
  return state.peerRole ? humanRole(state.peerRole) : fallback;
}

function applyRoleTheme(role) {
  const themeRole = role === "sofi" ? "sofi" : role === "javi" ? "javi" : "neutral";
  document.body.dataset.roleTheme = themeRole;
}

function cloneNote(note) {
  return note ? { ...note } : null;
}

function normalizePresence(presence) {
  return {
    ...createPresenceState(),
    ...(presence || {}),
  };
}

function setStatus(message, tone = "neutral") {
  statusMessage.textContent = message;
  statusMessage.classList.toggle("is-error", tone === "error");
  statusMessage.classList.toggle("is-success", tone === "success");
}

function sendMessage(payload) {
  if (!state.ws || state.ws.readyState !== WebSocket.OPEN) {
    return false;
  }

  state.ws.send(JSON.stringify(payload));
  return true;
}

function sendTimedEvent(type, payload = {}) {
  return sendMessage({
    type,
    timestamp: nowIso(),
    ...payload,
  });
}

function isPeerConnectionReady() {
  return Boolean(
    state.peerConnection &&
      (state.peerConnectionState === "connected" ||
        state.iceConnectionState === "connected" ||
        state.iceConnectionState === "completed")
  );
}

function formatTimestamp(timestamp) {
  if (!timestamp) {
    return "just now";
  }

  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return "just now";
  }

  return date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

function hasRecentAcknowledgement() {
  if (!state.lastAcknowledgement?.timestamp) {
    return false;
  }

  const time = new Date(state.lastAcknowledgement.timestamp).getTime();
  if (Number.isNaN(time)) {
    return false;
  }

  return Date.now() - time <= ACKNOWLEDGEMENT_WINDOW_MS;
}

function rememberAcknowledgement(sourceRole, timestamp) {
  state.lastAcknowledgement = {
    sourceRole,
    timestamp,
  };
}

function generateNoteId() {
  if (window.crypto?.randomUUID) {
    return window.crypto.randomUUID();
  }

  return `${state.role || "note"}-${Date.now()}`;
}

function getUnreadNote() {
  return Boolean(state.latestReceivedNote && !state.latestReceivedNote.read);
}

function getPresenceSummary() {
  const peerName = getSociiName();

  if (state.peerPresence.wantsToTalk) {
    return `${peerName} wants to talk`;
  }

  if (state.callMode.active) {
    return "open call live";
  }

  if (state.localPresence.wantsToTalk) {
    return "request sent";
  }

  if (getUnreadNote()) {
    return "note waiting";
  }

  if (hasRecentAcknowledgement()) {
    return state.lastAcknowledgement.sourceRole === state.role
      ? "acknowledged"
      : "acknowledged by Socii";
  }

  if (state.peerPresence.online) {
    return "tap orb to talk";
  }

  return "offline";
}

function getPartnerStatusModel() {
  const unreadNote = getUnreadNote();
  const recentAck = hasRecentAcknowledgement();
  const partnerConnected = isPeerConnectionReady();

  if (!state.peerPresence.online) {
    return {
      key: "offline",
      label: "Offline",
      cssClass: "orb-offline",
    };
  }

  if (state.callMode.active) {
    return {
      key: "open_call",
      label: "Open Call",
      cssClass: "orb-open-call",
    };
  }

  if (state.peerPresence.speaking) {
    return {
      key: "speaking",
      label: "Speaking",
      cssClass: "orb-speaking",
    };
  }

  if (state.peerPresence.wantsToTalk) {
    return {
      key: "peer_wants_to_talk",
      label: "Wants to Talk",
      cssClass: "orb-peer-wants-to-talk",
    };
  }

  if (unreadNote && state.latestReceivedNote) {
    return {
      key: "message_waiting",
      label: "Message Waiting",
      cssClass: "orb-message-waiting",
    };
  }

  if (recentAck) {
    return {
      key: "acknowledged",
      label: "Acknowledged",
      cssClass: "orb-acknowledged",
    };
  }

  if (state.localPresence.wantsToTalk) {
    return {
      key: "local_wants_to_talk",
      label: "Waiting on Your Signal",
      cssClass: "orb-local-wants-to-talk",
    };
  }

  if (!partnerConnected) {
    return {
      key: "online",
      label: "Online",
      cssClass: "orb-online",
    };
  }

  return {
    key: "idle",
    label: "Idle",
    cssClass: "orb-idle",
  };
}

function applyPresenceSnapshot(presence, notes, floorHolder, callMode) {
  if (!state.role) {
    return;
  }

  const peerRole = state.peerRole || derivePeerRole();
  const localPresence = normalizePresence(presence?.[state.role]);
  const peerPresence = normalizePresence(presence?.[peerRole]);
  const incomingNote =
    notes?.[state.role] && notes[state.role].senderRole === peerRole ? cloneNote(notes[state.role]) : null;
  const outgoingNote =
    notes?.[peerRole] && notes[peerRole].senderRole === state.role ? cloneNote(notes[peerRole]) : null;

  localPresence.messageWaiting = Boolean(incomingNote && !incomingNote.read);
  localPresence.speaking = floorHolder === state.role;
  peerPresence.speaking = floorHolder === peerRole;

  state.localPresence = localPresence;
  state.peerPresence = peerPresence;
  state.latestReceivedNote = incomingNote;
  state.latestSentNote = outgoingNote;
  state.floorHolder = floorHolder ?? null;
  state.callMode = {
    active: Boolean(callMode?.active),
    activatedAt: callMode?.activatedAt || null,
  };
  state.peerPresent = peerPresence.online;
  syncAudioMode();

  refreshUi();
}

function syncAudioMode() {
  if (!state.localTrack) {
    state.localMicEnabled = false;
    return;
  }

  if (state.callMode.active && state.joined && state.peerPresence.online) {
    state.awaitingFloor = false;
    state.pttPressed = false;
    state.localTrack.enabled = true;
    state.localMicEnabled = true;
    return;
  }

  if (!state.awaitingFloor) {
    state.localTrack.enabled = false;
    state.localMicEnabled = false;
  }
}

function refreshDebugState() {
  const entries = [
    ["Role", state.role || "—"],
    ["Socii Role", state.peerRole || "—"],
    ["Joined", state.joined ? "yes" : "no"],
    ["Socii Online", state.peerPresence.online ? "yes" : "no"],
    ["Open Call", state.callMode.active ? "yes" : "no"],
    ["WebSocket", state.wsState],
    ["RTCPeerConnection", state.peerConnectionState],
    ["Signaling", state.signalingState],
    ["ICE", state.iceConnectionState],
    ["Floor Holder", state.floorHolder || "none"],
    ["Awaiting Floor", state.awaitingFloor ? "yes" : "no"],
    ["Mic Permission", state.micPermission],
    ["Local Mic Enabled", state.localMicEnabled ? "yes" : "no"],
    ["Local Wants To Talk", state.localPresence.wantsToTalk ? "yes" : "no"],
    ["Socii Wants To Talk", state.peerPresence.wantsToTalk ? "yes" : "no"],
    ["Unread Note", getUnreadNote() ? "yes" : "no"],
    ["Remote Audio", state.remoteAudioAttached ? "attached" : "waiting"],
  ];

  debugState.innerHTML = entries
    .map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`)
    .join("");
}

function refreshUi() {
  const noteDraftValue = state.noteDraft.trim();
  const partnerStatus = getPartnerStatusModel();
  const activeRole = state.role || roleSelect.value;
  const orbActionLabel = !state.joined
    ? "Join Socii to activate the orb"
    : state.callMode.active
      ? "End the open call"
      : state.peerPresence.wantsToTalk
        ? "Acknowledge your Socii and start the call"
        : state.localPresence.wantsToTalk
          ? "Cancel your talk request"
          : "Tell your Socii you want to talk";

  applyRoleTheme(activeRole);

  for (const button of kaomojiButtons) {
    button.disabled = !state.joined;
    button.classList.toggle("is-selected", button.dataset.kaomoji === state.noteDraft);
  }

  kaomojiRow.classList.toggle("is-disabled", !state.joined);
  noteComposerDisplay.textContent = state.latestReceivedNote?.content || "";
  noteComposerDisplay.classList.toggle("is-empty", !state.latestReceivedNote?.content);
  noteComposerDisplay.classList.toggle("is-unread", Boolean(state.latestReceivedNote && !state.latestReceivedNote.read));
  sendNoteButton.disabled = !state.joined || !noteDraftValue || noteDraftValue.length > NOTE_MAX_LENGTH;
  clearNoteButton.disabled = !state.joined || !state.noteDraft;
  partnerOrbButton.disabled = !state.joined;
  partnerOrbButton.setAttribute("aria-label", orbActionLabel);
  partnerOrbButton.title = orbActionLabel;
  debugPanel.classList.toggle("is-hidden", activeRole !== "javi");

  presenceSummary.textContent = getPresenceSummary();
  partnerOrb.className = `partner-orb ${partnerStatus.cssClass}`;
  partnerStatusLabel.textContent = partnerStatus.label;

  if (state.latestReceivedNote) {
    latestReceivedMeta.textContent = `${formatTimestamp(state.latestReceivedNote.timestamp)}${
      state.latestReceivedNote.read ? " · Read" : " · Unread"
    }`;
  } else {
    latestReceivedMeta.textContent = "";
  }

  roleSelect.disabled = state.joined || state.joinInProgress;
  joinButton.textContent = state.joined ? "Connected" : state.joinInProgress ? "Connecting..." : "Join Socii";
  joinButton.disabled = state.joined || state.joinInProgress;

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
  if (!state.callMode.active) {
    state.localPresence.speaking = enabled;
  }
  refreshUi();
}

function clearPushToTalkState() {
  state.awaitingFloor = false;
  state.pttPressed = false;
  if (!state.callMode.active) {
    setLocalMicEnabled(false);
  }
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
  clearPushToTalkState();
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
  state.joinInProgress = false;
  state.roomId = "";
  state.role = "";
  state.peerRole = null;
  state.peerPresent = false;
  state.floorHolder = null;
  state.callMode = {
    active: false,
    activatedAt: null,
  };
  state.noteDraft = "";
  state.localPresence = createPresenceState();
  state.peerPresence = createPresenceState();
  state.latestReceivedNote = null;
  state.latestSentNote = null;
  state.lastAcknowledgement = null;
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
      roomId: state.roomId || DEFAULT_SESSION_ID,
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
      clearPushToTalkState();
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
    roomId: state.roomId || DEFAULT_SESSION_ID,
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
    roomId: state.roomId || DEFAULT_SESSION_ID,
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
      state.joinInProgress = false;
      state.roomId = message.roomId;
      state.role = message.role;
      state.peerRole = derivePeerRole();
      applyPresenceSnapshot(message.presence, message.notes, message.floorHolder, message.callMode);
      await createPeerConnection();

      if (state.latestReceivedNote && !state.latestReceivedNote.read) {
        setStatus("Connected. A note from your Socii is already waiting.", "success");
      } else {
        setStatus(
          message.peerPresent
            ? "Connected. Socii is online and the live audio link is waking up."
            : "Connected. You can leave presence signals while your Socii is offline.",
          "success"
        );
      }
      break;
    }
    case "peer-joined": {
      state.peerRole = message.role;
      state.peerPresent = true;
      state.peerPresence.online = true;
      setStatus("Your Socii connected. Creating the live audio link.", "success");
      await maybeCreateOffer();
      break;
    }
    case "peer-left": {
      state.peerPresent = false;
      state.floorHolder = null;
      state.peerPresence = {
        ...state.peerPresence,
        online: false,
        wantsToTalk: false,
        speaking: false,
      };
      state.callMode = {
        active: false,
        activatedAt: null,
      };
      cleanupPeerConnection();
      await createPeerConnection();
      setStatus("Your Socii disconnected. Presence will wake back up when they reconnect.", "error");
      break;
    }
    case "presence-sync": {
      applyPresenceSnapshot(message.presence, message.notes, message.floorHolder, message.callMode);
      break;
    }
    case "webrtc-offer": {
      state.peerRole = message.sourceRole;
      state.peerPresent = true;
      state.peerPresence.online = true;
      await handleOffer(message);
      setStatus("Received offer. Building the live audio path now.", "success");
      break;
    }
    case "webrtc-answer": {
      await handleAnswer(message);
      setStatus("Received answer. Finalizing the live audio path.", "success");
      break;
    }
    case "ice-candidate": {
      await handleIceCandidate(message);
      break;
    }
    case "floor-granted": {
      state.floorHolder = message.floorHolder;
      state.localPresence.speaking = message.role === state.role;
      state.peerPresence.speaking = message.role === state.peerRole;

      if (message.role === state.role && state.pttPressed) {
        state.awaitingFloor = false;
        setLocalMicEnabled(true);
        setStatus("Floor granted. Live audio is streaming while you hold the button.", "success");
      } else {
        setStatus("Your Socii has the floor. Your mic stays muted until it is free.");
      }
      break;
    }
    case "floor-denied": {
      state.floorHolder = message.floorHolder;
      state.awaitingFloor = false;
      state.pttPressed = false;
      setLocalMicEnabled(false);
      setStatus("Floor denied because the other peer is speaking.", "error");
      break;
    }
    case "floor-released": {
      state.floorHolder = message.floorHolder;
      state.localPresence.speaking = false;
      state.peerPresence.speaking = false;
      if (!state.pttPressed) {
        clearPushToTalkState();
      }
      setStatus("Floor released.");
      break;
    }
    case "want-to-talk": {
      setStatus(
        "Your Socii wants to talk. Tap the orb when you are ready to acknowledge.",
        "success"
      );
      break;
    }
    case "cancel-want-to-talk": {
      setStatus("Your Socii cleared their talk request.");
      break;
    }
    case "ack-want-to-talk": {
      rememberAcknowledgement(message.sourceRole, message.timestamp);
      setStatus(
        message.callModeActive
          ? "Your Socii acknowledged your request. Open call is going live."
          : "Your Socii acknowledged your talk request.",
        "success"
      );
      break;
    }
    case "open-call-end": {
      state.callMode = {
        active: false,
        activatedAt: null,
      };
      syncAudioMode();
      setStatus("Open call ended. The orb is back in ambient mode.", "success");
      break;
    }
    case "note-send": {
      setStatus("Your Socii left you a note.", "success");
      break;
    }
    case "note-read": {
      setStatus("Your Socii marked your note as read.", "success");
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
  const roomId = DEFAULT_SESSION_ID;
  const role = roleSelect.value;

  if (!navigator.mediaDevices?.getUserMedia) {
    setStatus("This browser does not support microphone capture required for the MVP.", "error");
    return;
  }

  joinButton.disabled = true;
  setStatus("Requesting microphone permission and connecting to Socii...");

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
  state.joinInProgress = true;
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
    clearPushToTalkState();
    state.wsState = "closed";
    state.joinInProgress = false;
    const wasJoined = state.joined;
    resetRoomState();
    setStatus(
      wasJoined
        ? "Disconnected from signaling. Use Join Socii to reconnect manually."
        : "Could not connect to signaling server.",
      "error"
    );
  };
}

function sendWantToTalk() {
  if (!state.joined || state.localPresence.wantsToTalk || state.callMode.active) {
    return;
  }

  const timestamp = nowIso();
  state.localPresence.wantsToTalk = true;
  state.localPresence.lastWantToTalkAt = timestamp;
  refreshUi();

  if (!sendTimedEvent("want-to-talk")) {
    state.localPresence.wantsToTalk = false;
    refreshUi();
    setStatus("Could not send want-to-talk because signaling is disconnected.", "error");
    return;
  }

  setStatus("Want-to-talk signal sent.", "success");
}

function cancelWantToTalk() {
  if (!state.joined || !state.localPresence.wantsToTalk || state.callMode.active) {
    return;
  }

  state.localPresence.wantsToTalk = false;
  refreshUi();

  if (!sendTimedEvent("cancel-want-to-talk")) {
    state.localPresence.wantsToTalk = true;
    refreshUi();
    setStatus("Could not cancel the talk signal because signaling is disconnected.", "error");
    return;
  }

  setStatus("Talk request cleared.");
}

function acknowledgeWantToTalk() {
  if (!state.joined || !state.peerPresence.wantsToTalk || state.callMode.active) {
    return;
  }

  const timestamp = nowIso();
  const previousLocalWantsToTalk = state.localPresence.wantsToTalk;
  const previousPeerWantsToTalk = state.peerPresence.wantsToTalk;
  const previousLocalAcknowledgedAt = state.localPresence.lastAcknowledgedAt;
  const previousPeerAcknowledgedAt = state.peerPresence.lastAcknowledgedAt;
  const previousAcknowledgement = state.lastAcknowledgement;
  state.localPresence.wantsToTalk = false;
  state.peerPresence.wantsToTalk = false;
  state.localPresence.lastAcknowledgedAt = timestamp;
  state.peerPresence.lastAcknowledgedAt = timestamp;
  rememberAcknowledgement(state.role, timestamp);
  refreshUi();

  if (!sendTimedEvent("ack-want-to-talk")) {
    state.localPresence.wantsToTalk = previousLocalWantsToTalk;
    state.peerPresence.wantsToTalk = previousPeerWantsToTalk;
    state.localPresence.lastAcknowledgedAt = previousLocalAcknowledgedAt;
    state.peerPresence.lastAcknowledgedAt = previousPeerAcknowledgedAt;
    state.lastAcknowledgement = previousAcknowledgement;
    refreshUi();
    setStatus("Could not acknowledge because signaling is disconnected.", "error");
    return;
  }

  setStatus("Talk request acknowledged. Open call is going live.", "success");
}

function endOpenCall() {
  if (!state.joined || !state.callMode.active) {
    return;
  }

  const previousCallMode = { ...state.callMode };
  state.callMode = {
    active: false,
    activatedAt: null,
  };
  syncAudioMode();
  refreshUi();

  if (!sendTimedEvent("open-call-end")) {
    state.callMode = previousCallMode;
    syncAudioMode();
    refreshUi();
    setStatus("Could not end the open call because signaling is disconnected.", "error");
    return;
  }

  setStatus("Open call ended. The orb is back in ambient mode.", "success");
}

function handleOrbAction() {
  if (!state.joined) {
    return;
  }

  if (state.callMode.active) {
    endOpenCall();
    return;
  }

  if (state.peerPresence.wantsToTalk) {
    acknowledgeWantToTalk();
    return;
  }

  if (state.localPresence.wantsToTalk) {
    cancelWantToTalk();
    return;
  }

  sendWantToTalk();
}

function sendNote(content, noteType) {
  if (!state.joined) {
    return;
  }

  const trimmed = content.trim();
  if (!trimmed) {
    setStatus("Note content is required.", "error");
    return;
  }

  if (trimmed.length > NOTE_MAX_LENGTH) {
    setStatus(`Notes must be ${NOTE_MAX_LENGTH} characters or fewer.`, "error");
    return;
  }

  const note = {
    id: generateNoteId(),
    senderRole: state.role,
    content: trimmed,
    type: noteType,
    timestamp: nowIso(),
    read: false,
    readAt: null,
  };

  const previousLatestSentNote = cloneNote(state.latestSentNote);
  state.latestSentNote = cloneNote(note);
  refreshUi();

  if (!sendTimedEvent("note-send", {
    id: note.id,
    content: note.content,
    noteType: note.type,
    timestamp: note.timestamp,
  })) {
    state.latestSentNote = previousLatestSentNote;
    refreshUi();
    setStatus("Could not send note because signaling is disconnected.", "error");
    return;
  }

  state.noteDraft = "";
  refreshUi();
  setStatus("Note sent.", "success");
}

function insertKaomoji(kaomoji) {
  if (!state.joined) {
    return;
  }

  state.noteDraft = kaomoji.slice(0, NOTE_MAX_LENGTH);
  refreshUi();
}

function clearNoteDraft() {
  if (!state.joined) {
    return;
  }

  state.noteDraft = "";
  refreshUi();
}

function markLatestNoteAsRead() {
  if (!state.joined || !state.latestReceivedNote || state.latestReceivedNote.read) {
    return;
  }

  const timestamp = nowIso();
  state.latestReceivedNote.read = true;
  state.latestReceivedNote.readAt = timestamp;
  state.localPresence.messageWaiting = false;
  refreshUi();

  if (!sendTimedEvent("note-read", {
    id: state.latestReceivedNote.id,
    timestamp,
  })) {
    state.latestReceivedNote.read = false;
    state.latestReceivedNote.readAt = null;
    state.localPresence.messageWaiting = true;
    refreshUi();
    setStatus("Could not mark the note as read because signaling is disconnected.", "error");
    return;
  }

  setStatus("Note marked as read.", "success");
}

joinButton.addEventListener("click", () => {
  joinRoom();
});

roleSelect.addEventListener("change", () => {
  refreshUi();
});

partnerOrbButton.addEventListener("click", () => {
  handleOrbAction();
});

for (const button of kaomojiButtons) {
  button.addEventListener("click", () => {
    insertKaomoji(button.dataset.kaomoji || "");
  });
}

sendNoteButton.addEventListener("click", () => {
  sendNote(state.noteDraft, "kaomoji");
});

clearNoteButton.addEventListener("click", () => {
  clearNoteDraft();
});

noteComposerDisplay.addEventListener("click", () => {
  markLatestNoteAsRead();
});

resumeAudioButton.addEventListener("click", () => {
  unlockRemoteAudio();
});

refreshUi();

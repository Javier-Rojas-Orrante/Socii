const http = require("http");
const fs = require("fs");
const path = require("path");
const { WebSocketServer, WebSocket } = require("ws");

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");
const DEFAULT_ROOM_ID = "socii-default";
const ROLES = ["javi", "sofi"];
const VALID_ROLES = new Set(ROLES);
const MAX_NOTE_LENGTH = 140;
const FORWARDABLE_TYPES = new Set(["webrtc-offer", "webrtc-answer", "ice-candidate"]);
const PRESENCE_EVENT_TYPES = new Set([
  "want-to-talk",
  "cancel-want-to-talk",
  "ack-want-to-talk",
  "open-call-end",
  "note-send",
  "note-read",
]);
const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".ico": "image/x-icon",
};

const rooms = new Map();

function nowIso() {
  return new Date().toISOString();
}

function normalizeTimestamp(value) {
  if (typeof value === "string" && !Number.isNaN(Date.parse(value))) {
    return new Date(value).toISOString();
  }

  return nowIso();
}

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

function createRoom() {
  return {
      peersByRole: new Map(),
      floorHolder: null,
      callMode: {
        active: false,
        activatedAt: null,
      },
      presenceByRole: {
      javi: createPresenceState(),
      sofi: createPresenceState(),
      },
      notesByRecipientRole: {
      javi: null,
      sofi: null,
      },
  };
}

function getRoom(roomId) {
  let room = rooms.get(roomId);
  if (!room) {
    room = createRoom();
    rooms.set(roomId, room);
  }
  return room;
}

function deleteRoomIfEmpty(roomId) {
  const room = rooms.get(roomId);
  if (!room) {
    return;
  }

  if (room.peersByRole.size === 0) {
    rooms.delete(roomId);
  }
}

function getPeerRole(role) {
  return role === "javi" ? "sofi" : "javi";
}

function cloneNote(note) {
  return note ? { ...note } : null;
}

function clonePresence(presence) {
  return { ...presence };
}

function sendJson(ws, payload) {
  if (ws.readyState !== WebSocket.OPEN) {
    return;
  }

  ws.send(JSON.stringify(payload));
}

function broadcastRoom(room, payload, excludeWs = null) {
  for (const peer of room.peersByRole.values()) {
    if (peer.ws !== excludeWs) {
      sendJson(peer.ws, payload);
    }
  }
}

function sendError(ws, code, message) {
  sendJson(ws, {
    type: "error",
    code,
    message,
  });
}

function isValidJoinMessage(message) {
  return (
    typeof message.role === "string" &&
    VALID_ROLES.has(message.role)
  );
}

function buildRoomSnapshot(room) {
  return {
    floorHolder: room.floorHolder,
    callMode: { ...room.callMode },
    presence: {
      javi: clonePresence(room.presenceByRole.javi),
      sofi: clonePresence(room.presenceByRole.sofi),
    },
    notes: {
      javi: cloneNote(room.notesByRecipientRole.javi),
      sofi: cloneNote(room.notesByRecipientRole.sofi),
    },
  };
}

function sendPresenceSync(roomId) {
  const room = rooms.get(roomId);
  if (!room) {
    return;
  }

  const snapshot = buildRoomSnapshot(room);
  broadcastRoom(room, {
    type: "presence-sync",
    roomId,
    floorHolder: snapshot.floorHolder,
    callMode: snapshot.callMode,
    presence: snapshot.presence,
    notes: snapshot.notes,
  });
}

function updatePresenceState(presence, updates) {
  Object.assign(presence, updates, {
    lastUpdatedAt: nowIso(),
  });
}

function syncSpeakingPresence(room) {
  const timestamp = nowIso();

  for (const role of ROLES) {
    room.presenceByRole[role].speaking = room.floorHolder === role;
    room.presenceByRole[role].lastUpdatedAt = timestamp;
  }
}

function setFloorHolder(room, role) {
  room.floorHolder = role;
  syncSpeakingPresence(room);
}

function setCallMode(room, active, timestamp = nowIso()) {
  room.callMode.active = active;
  room.callMode.activatedAt = active ? timestamp : null;
}

function getJoinedRoom(ws) {
  if (!ws.roomId || !ws.role) {
    sendError(ws, "invalid-message", "Join Socii before sending this event.");
    return null;
  }

  const room = rooms.get(ws.roomId);
  if (!room) {
    sendError(ws, "invalid-message", "The Socii link is no longer available.");
    return null;
  }

  return room;
}

function forwardToPeer(room, role, payload) {
  const targetRole = getPeerRole(role);
  const peer = room.peersByRole.get(targetRole);

  if (peer) {
    sendJson(peer.ws, payload);
  }
}

function cleanupPeer(ws) {
  if (!ws.roomId || !ws.role) {
    return;
  }

  const room = rooms.get(ws.roomId);
  if (!room) {
    ws.roomId = null;
    ws.role = null;
    return;
  }

  const peer = room.peersByRole.get(ws.role);
  if (peer && peer.ws === ws) {
    room.peersByRole.delete(ws.role);

    updatePresenceState(room.presenceByRole[ws.role], {
      online: false,
      wantsToTalk: false,
      speaking: false,
    });

    if (room.callMode.active) {
      setCallMode(room, false);
    }

    if (room.floorHolder === ws.role) {
      setFloorHolder(room, null);
      broadcastRoom(room, {
        type: "floor-released",
        roomId: ws.roomId,
        floorHolder: null,
      });
    }

    broadcastRoom(room, {
      type: "peer-left",
      role: ws.role,
    });

    if (room.peersByRole.size > 0) {
      sendPresenceSync(ws.roomId);
    }
  }

  const oldRoomId = ws.roomId;
  ws.roomId = null;
  ws.role = null;
  deleteRoomIfEmpty(oldRoomId);
}

function handleJoinRoom(ws, message) {
  if (!isValidJoinMessage(message)) {
    sendError(ws, "invalid-message", "join-room requires a valid role.");
    return;
  }

  if (ws.roomId || ws.role) {
    cleanupPeer(ws);
  }

  const roomId =
    typeof message.roomId === "string" && message.roomId.trim()
      ? message.roomId.trim()
      : DEFAULT_ROOM_ID;
  const role = message.role;
  const peerRole = getPeerRole(role);
  const room = getRoom(roomId);

  if (room.peersByRole.has(role)) {
    sendError(ws, "role-taken", `Role "${role}" is already active in Socii.`);
    return;
  }

  if (room.peersByRole.size >= 2) {
    sendError(ws, "room-full", "Socii already has two connected roles.");
    return;
  }

  const existingPeers = [...room.peersByRole.values()];
  room.peersByRole.set(role, { ws, role });
  ws.roomId = roomId;
  ws.role = role;

  updatePresenceState(room.presenceByRole[role], {
    online: true,
    wantsToTalk: false,
    speaking: room.floorHolder === role,
  });

  const snapshot = buildRoomSnapshot(room);
  sendJson(ws, {
    type: "join-ack",
    roomId,
    role,
    peerPresent: snapshot.presence[peerRole].online,
    shouldCreateOffer: false,
    floorHolder: snapshot.floorHolder,
    callMode: snapshot.callMode,
    presence: snapshot.presence,
    notes: snapshot.notes,
  });

  if (existingPeers.length > 0) {
    for (const peer of existingPeers) {
      sendJson(peer.ws, {
        type: "peer-joined",
        role,
      });
    }
  }

  sendPresenceSync(roomId);
}

function handleForwardableMessage(ws, message) {
  const room = getJoinedRoom(ws);
  if (!room) {
    return;
  }

  if (typeof message.targetRole !== "string" || !VALID_ROLES.has(message.targetRole)) {
    sendError(ws, "invalid-message", "targetRole must be a valid peer role.");
    return;
  }

  if (message.targetRole === ws.role) {
    sendError(ws, "invalid-message", "Cannot target the same role.");
    return;
  }

  const targetPeer = room.peersByRole.get(message.targetRole);
  if (!targetPeer) {
    sendError(ws, "invalid-message", "Target peer is not connected.");
    return;
  }

  sendJson(targetPeer.ws, {
    type: message.type,
    roomId: ws.roomId,
    targetRole: message.targetRole,
    sourceRole: ws.role,
    sdp: message.sdp,
    candidate: message.candidate,
  });
}

function handleFloorRequest(ws, message) {
  const room = getJoinedRoom(ws);
  if (!room) {
    return;
  }

  if (message.role !== ws.role) {
    sendError(ws, "invalid-message", "floor-request role must match the connected peer.");
    return;
  }

  if (room.callMode.active) {
    sendJson(ws, {
      type: "floor-released",
      roomId: ws.roomId,
      floorHolder: null,
    });
    return;
  }

  if (room.floorHolder === null || room.floorHolder === ws.role) {
    setFloorHolder(room, ws.role);
    broadcastRoom(room, {
      type: "floor-granted",
      roomId: ws.roomId,
      role: ws.role,
      floorHolder: room.floorHolder,
    });
    sendPresenceSync(ws.roomId);
    return;
  }

  sendJson(ws, {
    type: "floor-denied",
    roomId: ws.roomId,
    role: ws.role,
    floorHolder: room.floorHolder,
  });
}

function handleFloorRelease(ws, message) {
  const room = getJoinedRoom(ws);
  if (!room) {
    return;
  }

  if (message.role !== ws.role) {
    sendError(ws, "invalid-message", "floor-release role must match the connected peer.");
    return;
  }

  if (room.callMode.active) {
    sendJson(ws, {
      type: "floor-released",
      roomId: ws.roomId,
      floorHolder: null,
    });
    return;
  }

  if (room.floorHolder === ws.role) {
    setFloorHolder(room, null);
    broadcastRoom(room, {
      type: "floor-released",
      roomId: ws.roomId,
      floorHolder: null,
    });
    sendPresenceSync(ws.roomId);
  } else {
    sendJson(ws, {
      type: "floor-released",
      roomId: ws.roomId,
      floorHolder: room.floorHolder,
    });
  }
}

function handlePresenceEvent(ws, message) {
  const room = getJoinedRoom(ws);
  if (!room) {
    return;
  }

  const role = ws.role;
  const peerRole = getPeerRole(role);
  const timestamp = normalizeTimestamp(message.timestamp);

  if (message.type === "want-to-talk") {
    updatePresenceState(room.presenceByRole[role], {
      wantsToTalk: true,
      lastWantToTalkAt: timestamp,
    });
    forwardToPeer(room, role, {
      type: "want-to-talk",
      roomId: ws.roomId,
      sourceRole: role,
      timestamp,
    });
    sendPresenceSync(ws.roomId);
    return;
  }

  if (message.type === "cancel-want-to-talk") {
    updatePresenceState(room.presenceByRole[role], {
      wantsToTalk: false,
    });
    forwardToPeer(room, role, {
      type: "cancel-want-to-talk",
      roomId: ws.roomId,
      sourceRole: role,
      timestamp,
    });
    sendPresenceSync(ws.roomId);
    return;
  }

  if (message.type === "ack-want-to-talk") {
    updatePresenceState(room.presenceByRole[role], {
      wantsToTalk: false,
      lastAcknowledgedAt: timestamp,
    });
    updatePresenceState(room.presenceByRole[peerRole], {
      wantsToTalk: false,
      lastAcknowledgedAt: timestamp,
    });
    setFloorHolder(room, null);
    setCallMode(room, true, timestamp);
    forwardToPeer(room, role, {
      type: "ack-want-to-talk",
      roomId: ws.roomId,
      sourceRole: role,
      timestamp,
      callModeActive: true,
    });
    sendPresenceSync(ws.roomId);
    return;
  }

  if (message.type === "open-call-end") {
    if (room.callMode.active) {
      setCallMode(room, false);
      setFloorHolder(room, null);
      forwardToPeer(room, role, {
        type: "open-call-end",
        roomId: ws.roomId,
        sourceRole: role,
        timestamp,
      });
      sendPresenceSync(ws.roomId);
    } else {
      sendJson(ws, {
        type: "open-call-end",
        roomId: ws.roomId,
        sourceRole: role,
        timestamp,
      });
    }
    return;
  }

  if (message.type === "note-send") {
    const content = typeof message.content === "string" ? message.content.trim() : "";
    const noteType = message.noteType === "custom" ? "custom" : "preset";

    if (!content) {
      sendError(ws, "invalid-message", "note-send requires note content.");
      return;
    }

    if (content.length > MAX_NOTE_LENGTH) {
      sendError(ws, "invalid-message", `Notes must be ${MAX_NOTE_LENGTH} characters or fewer.`);
      return;
    }

    const note = {
      id: typeof message.id === "string" && message.id.trim() ? message.id.trim() : `${role}-${Date.now()}`,
      senderRole: role,
      content,
      type: noteType,
      timestamp,
      read: false,
      readAt: null,
    };

    room.notesByRecipientRole[peerRole] = note;
    updatePresenceState(room.presenceByRole[peerRole], {
      messageWaiting: true,
    });
    updatePresenceState(room.presenceByRole[role], {});

    forwardToPeer(room, role, {
      type: "note-send",
      roomId: ws.roomId,
      sourceRole: role,
      note: cloneNote(note),
    });
    sendPresenceSync(ws.roomId);
    return;
  }

  if (message.type === "note-read") {
    if (typeof message.id !== "string" || !message.id.trim()) {
      sendError(ws, "invalid-message", "note-read requires a note id.");
      return;
    }

    const note = room.notesByRecipientRole[role];
    if (!note || note.id !== message.id.trim()) {
      sendError(ws, "invalid-message", "That note is not available to mark as read.");
      return;
    }

    note.read = true;
    note.readAt = timestamp;
    updatePresenceState(room.presenceByRole[role], {
      messageWaiting: false,
    });

    forwardToPeer(room, role, {
      type: "note-read",
      roomId: ws.roomId,
      sourceRole: role,
      id: note.id,
      timestamp,
    });
    sendPresenceSync(ws.roomId);
    return;
  }
}

function handleWebSocketMessage(ws, rawMessage) {
  let message;

  try {
    message = JSON.parse(rawMessage.toString());
  } catch (error) {
    sendError(ws, "invalid-message", "Messages must be valid JSON.");
    return;
  }

  if (!message || typeof message.type !== "string") {
    sendError(ws, "invalid-message", "Message type is required.");
    return;
  }

  if (message.type === "join-room") {
    handleJoinRoom(ws, message);
    return;
  }

  if (FORWARDABLE_TYPES.has(message.type)) {
    handleForwardableMessage(ws, message);
    return;
  }

  if (message.type === "floor-request") {
    handleFloorRequest(ws, message);
    return;
  }

  if (message.type === "floor-release") {
    handleFloorRelease(ws, message);
    return;
  }

  if (PRESENCE_EVENT_TYPES.has(message.type)) {
    handlePresenceEvent(ws, message);
    return;
  }

  sendError(ws, "invalid-message", `Unsupported message type: ${message.type}`);
}

function serveStaticFile(req, res) {
  const requestPath = req.url === "/" ? "/index.html" : req.url;
  const normalizedPath = path.normalize(requestPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(PUBLIC_DIR, normalizedPath);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      if (error.code === "ENOENT") {
        res.writeHead(404);
        res.end("Not found");
        return;
      }

      res.writeHead(500);
      res.end("Server error");
      return;
    }

    const ext = path.extname(filePath);
    const contentType = MIME_TYPES[ext] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": contentType });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  serveStaticFile(req, res);
});

const wss = new WebSocketServer({ noServer: true });

wss.on("connection", (ws) => {
  ws.roomId = null;
  ws.role = null;

  ws.on("message", (message) => {
    handleWebSocketMessage(ws, message);
  });

  ws.on("close", () => {
    cleanupPeer(ws);
  });

  ws.on("error", () => {
    cleanupPeer(ws);
  });
});

server.on("upgrade", (req, socket, head) => {
  if (req.url !== "/ws") {
    socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit("connection", ws, req);
  });
});

server.listen(PORT, () => {
  console.log(`Socii server listening on http://localhost:${PORT}`);
});

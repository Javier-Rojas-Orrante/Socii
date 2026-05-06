const http = require("http");
const fs = require("fs");
const path = require("path");
const { WebSocketServer, WebSocket } = require("ws");

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");
const VALID_ROLES = new Set(["mac", "iphone"]);
const FORWARDABLE_TYPES = new Set(["webrtc-offer", "webrtc-answer", "ice-candidate"]);
const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".ico": "image/x-icon",
};

const rooms = new Map();

function getRoom(roomId) {
  let room = rooms.get(roomId);
  if (!room) {
    room = {
      peersByRole: new Map(),
      floorHolder: null,
    };
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
    typeof message.roomId === "string" &&
    message.roomId.trim() !== "" &&
    typeof message.role === "string" &&
    VALID_ROLES.has(message.role)
  );
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

    if (room.floorHolder === ws.role) {
      room.floorHolder = null;
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
  }

  const oldRoomId = ws.roomId;
  ws.roomId = null;
  ws.role = null;
  deleteRoomIfEmpty(oldRoomId);
}

function handleJoinRoom(ws, message) {
  if (!isValidJoinMessage(message)) {
    sendError(ws, "invalid-message", "join-room requires a roomId and valid role.");
    return;
  }

  if (ws.roomId || ws.role) {
    cleanupPeer(ws);
  }

  const roomId = message.roomId.trim();
  const role = message.role;
  const room = getRoom(roomId);

  if (room.peersByRole.has(role)) {
    sendError(ws, "role-taken", `Role "${role}" is already in use for this room.`);
    return;
  }

  if (room.peersByRole.size >= 2) {
    sendError(ws, "room-full", "This room already has two peers.");
    return;
  }

  const existingPeers = [...room.peersByRole.values()];
  room.peersByRole.set(role, { ws, role });
  ws.roomId = roomId;
  ws.role = role;

  sendJson(ws, {
    type: "join-ack",
    roomId,
    role,
    peerPresent: existingPeers.length > 0,
    shouldCreateOffer: false,
    floorHolder: room.floorHolder,
  });

  if (existingPeers.length > 0) {
    for (const peer of existingPeers) {
      sendJson(peer.ws, {
        type: "peer-joined",
        role,
      });
    }
  }
}

function handleForwardableMessage(ws, message) {
  if (!ws.roomId || !ws.role) {
    sendError(ws, "invalid-message", "Join a room before signaling.");
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

  const room = rooms.get(ws.roomId);
  if (!room) {
    sendError(ws, "invalid-message", "Room no longer exists.");
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
  if (!ws.roomId || !ws.role) {
    sendError(ws, "invalid-message", "Join a room before requesting the floor.");
    return;
  }

  if (message.role !== ws.role) {
    sendError(ws, "invalid-message", "floor-request role must match the connected peer.");
    return;
  }

  const room = rooms.get(ws.roomId);
  if (!room) {
    sendError(ws, "invalid-message", "Room no longer exists.");
    return;
  }

  if (room.floorHolder === null || room.floorHolder === ws.role) {
    room.floorHolder = ws.role;
    broadcastRoom(room, {
      type: "floor-granted",
      roomId: ws.roomId,
      role: ws.role,
      floorHolder: room.floorHolder,
    });
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
  if (!ws.roomId || !ws.role) {
    sendError(ws, "invalid-message", "Join a room before releasing the floor.");
    return;
  }

  if (message.role !== ws.role) {
    sendError(ws, "invalid-message", "floor-release role must match the connected peer.");
    return;
  }

  const room = rooms.get(ws.roomId);
  if (!room) {
    sendError(ws, "invalid-message", "Room no longer exists.");
    return;
  }

  if (room.floorHolder === ws.role) {
    room.floorHolder = null;
    broadcastRoom(room, {
      type: "floor-released",
      roomId: ws.roomId,
      floorHolder: null,
    });
  } else {
    sendJson(ws, {
      type: "floor-released",
      roomId: ws.roomId,
      floorHolder: room.floorHolder,
    });
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

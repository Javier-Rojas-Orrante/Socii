# Current Status

This document describes the features that are actually implemented in the repository today and how to use them.

## What is in the repo now

The current app is a browser-based presence plus push-to-stream MVP with:

- a Node.js server that serves the client and hosts a WebSocket signaling endpoint
- a single shared web client for Mac and iPhone Safari
- paired identities named `Javi` and `Sofi`
- one WebRTC audio connection per shared Socii link
- half-duplex push-to-talk floor control managed by the server
- presence sync for want-to-talk, silent mode, and notes
- a browser simulation of the future Socii orb/status behavior
- in-memory session and peer state

The server does not relay audio. Audio goes peer-to-peer over WebRTC once signaling completes.

## Implemented features

### Server

The current server in [server.js](/Users/javier/Socii/server.js:1) supports:

- static file serving from `public/`
- WebSocket signaling on `/ws`
- join with explicit roles: `javi` and `sofi`
- one peer per role, maximum two peers total
- forwarding of:
  - `webrtc-offer`
  - `webrtc-answer`
  - `ice-candidate`
- floor control messages:
  - `floor-request`
  - `floor-granted`
  - `floor-denied`
  - `floor-release`
  - `floor-released`
- presence events:
  - `want-to-talk`
  - `cancel-want-to-talk`
  - `ack-want-to-talk`
  - `silent-mode-update`
  - `note-send`
  - `note-read`
  - `presence-sync`
- peer leave handling
- floor cleanup when the active speaker disconnects
- in-memory presence state and latest-note state for the shared session

### Client

The current client in [public/index.html](/Users/javier/Socii/public/index.html:1) and [public/app.js](/Users/javier/Socii/public/app.js:1) includes:

- role selector
- Join Socii button
- one large simulated Socii orb
- silent mode toggle
- custom note text box
- optional kaomoji tray with quick insert chips
- latest received note display
- latest sent note display
- mark-as-read button
- remote audio playback
- debug state panel
- Resume Audio button for Safari playback issues

Client behavior currently implemented:

- requests microphone permission before joining
- opens one persistent `RTCPeerConnection`
- adds the local microphone track once and starts with `track.enabled = false`
- uses STUN only
- derives the WebSocket URL from the current page origin
- keeps local and peer presence state in one shared client state object
- derives a single Socii display status for the orb and its supporting text
- supports persistent ambient want-to-talk signals
- escalates an acknowledged want-to-talk signal into a full live open call
- supports silent/do-not-disturb mode sync
- supports custom notes with optional kaomoji insertion
- supports unread/read note state
- enables both microphones when open-call mode becomes active
- resets the peer connection when the other peer leaves
- requires manual rejoin after disconnect

## How to use the current app

### Local browser-to-browser test

1. Install dependencies:

   ```bash
   npm install
   ```

2. Start the server:

   ```bash
   npm start
   ```

3. Open `http://localhost:3000` in two browser tabs on your Mac.
4. In tab one:
   - choose role `javi`
   - click `Join Socii`
   - allow microphone access
5. In tab two:
   - choose role `sofi`
   - click `Join Socii`
   - allow microphone access
6. Once both sides are joined, use the orb to send and acknowledge talk intent.

### Presence feature use

Once joined:

- tap the orb to leave a persistent talk request
- tap the orb again to cancel your own request
- tap the orb when your Socii has requested a talk to acknowledge and open the call
- tap the orb during an open call to end it
- tap `Turn Silent Mode On` to stay present but visual-only
- type a short custom note
- optionally open the kaomoji tray and tap a kaomoji chip to append it to the note
- tap `Mark as Read` when you have seen the latest incoming note

The orb and its supporting text will update to reflect:

- offline
- online
- idle
- silent mode
- wants to talk
- message waiting
- speaking
- acknowledged
- open call

### Mac + iPhone test

1. Start the server on the Mac:

   ```bash
   npm start
   ```

2. Expose `http://localhost:3000` through an HTTPS tunnel.

   Example with Cloudflare:

   ```bash
   cloudflared tunnel --url http://localhost:3000
   ```

3. Open the same generated `https://...` URL on:
   - the Mac browser
   - iPhone Safari
4. On the Mac:
   - choose role `javi`
   - click `Join Socii`
5. On the iPhone:
   - choose role `sofi`
   - tap `Join Socii`
6. Allow microphone access on both devices.
7. Use the orb to signal talk intent, then acknowledge it on the other side to enter the live open call.

## Current operational rules

- The app expects exactly two roles: `javi` and `sofi`.
- A second client cannot join if the chosen role is already taken.
- The shared Socii link cannot exceed two peers.
- Ambient signaling is half-duplex, but an acknowledged talk request escalates into a full two-way open call.
- Want-to-talk signals can stay pending even if the peer is not currently online.
- Silent mode affects passive notifications only, not intentional open-call use.
- Notes are stored only in in-memory session state and last until the session disappears.
- The orb is the main interaction surface for want-to-talk, acknowledgement, cancellation, and ending a call.
- The mic remains muted until the shared session enters open-call mode.

## Known limitations in the current repo

- No authentication
- No persistence
- No TURN server support
- No automatic reconnect
- No dedicated leave button in the UI
- No recording, history, or analytics
- No native toy integration yet
- No persistence beyond in-memory session state
- Real-world device/network performance still depends on browser and NAT behavior

## Good indicators during testing

- The Socii orb should shift between offline, idle, message waiting, wants-to-talk, acknowledged, and open-call states.
- After acknowledgement, both sides should move into the live open call without needing push-to-talk.
- The debug panel should show:
  - the selected role
  - whether a peer is present
  - WebSocket state
  - peer connection state
  - current floor holder
  - whether the local mic is enabled
  - local and peer silent mode
  - local and peer want-to-talk state
  - unread note state

If iPhone audio does not begin automatically, tap `Resume Audio`.

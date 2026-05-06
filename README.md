# Socii

Push-to-stream MVP for live half-duplex voice between a Mac browser and iPhone Safari using WebRTC for audio and WebSocket signaling for setup and floor control.

## Requirements

- Node.js 18+
- An HTTPS tunnel for iPhone Safari microphone access during device testing

## Run locally

1. Install dependencies:

   ```bash
   npm install
   ```

2. Start the server:

   ```bash
   npm start
   ```

3. Open `http://localhost:3000` on the Mac for local testing.
4. For iPhone Safari, expose the same local port through an HTTPS tunnel and open the tunnel URL on both devices.

## MVP flow

- Choose a room ID and role (`mac` or `iphone`)
- Join the room on both devices
- Wait for the WebRTC connection to establish
- Hold the push-to-talk button to request the speaking floor
- Speak only while the button is held and the floor is granted
- Release the button to mute immediately

## Notes

- Audio is never recorded or stored.
- The server only handles signaling and floor control.
- Room and floor state are stored in memory and reset on server restart.

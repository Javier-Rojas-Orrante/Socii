# Socii

Socii (masculine plural, singular: socius) is a Latin term primarily meaning allies, partners, comrades, or confederates.

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

## Run on a Mac + iPhone pair

1. Start the local app on your Mac:

   ```bash
   cd /Users/javier/Socii
   npm start
   ```

2. In a second Terminal window, create an HTTPS tunnel to the local server.

   Cloudflare quick tunnel:

   ```bash
   brew install cloudflared
   cloudflared tunnel --url http://localhost:3000
   ```

   ngrok alternative:

   ```bash
   brew install ngrok/ngrok/ngrok
   ngrok http 3000
   ```

3. Copy the generated public `https://...` URL.
4. Open that same `https://...` URL on:
   - the Mac browser
   - iPhone Safari
5. On the Mac client:
   - enter a room name
   - choose role `mac`
   - click `Join Room`
   - allow microphone access
6. On the iPhone client:
   - enter the same room name
   - choose role `iphone`
   - tap `Join Room`
   - allow microphone access
7. Wait for the peer connection to establish, then hold `Hold to Talk` to stream live voice.
8. Release the button to mute immediately and release the speaking floor.

### iPhone notes

- Use Safari on iPhone for microphone support.
- Do not use `http://localhost:3000` or `http://<mac-ip>:3000` on the iPhone.
- If remote audio does not start automatically, tap `Resume Audio`.
- Keep both the app server and the tunnel process running during the test.

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

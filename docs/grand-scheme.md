# Grand Scheme

This document captures the larger intended shape of Socii beyond the current repository snapshot.

## Product direction

Socii is intended to become a communication layer for an AI companion toy, with the browser-based Mac and iPhone setup acting as a temporary stand-in for future physical endpoints.

The core communication mode is:

- live voice streaming
- push-to-talk interaction
- half-duplex turn taking
- privacy-first microphone behavior

The long-term idea is to preserve the same communication model as the system moves from browsers to toy hardware.

## Core system model

The system is built around three responsibilities:

1. Endpoint client
   - capture microphone audio
   - play remote audio
   - connect to signaling
   - join a paired room
   - request and release speaking floor
   - reflect status to the user

2. Signaling and coordination server
   - manage rooms
   - track peer presence
   - exchange WebRTC signaling messages
   - arbitrate speaking-floor ownership

3. Peer-to-peer media transport
   - deliver live audio directly between endpoints over WebRTC
   - avoid routing media through the app server

## Interaction model

The intended communication behavior is:

- connection remains established between peers
- microphone starts muted by default
- pressing and holding push-to-talk requests the speaking floor
- if the floor is granted, the local microphone becomes active
- releasing the button immediately disables the microphone
- only one peer can speak at a time

This makes the experience closer to a walkie-talkie than a voice note or call.

## Near-term browser incarnation

The browser-based MVP exists to validate:

- the room and signaling model
- the half-duplex floor-control behavior
- the human experience of press-to-speak live audio
- Mac-to-iPhone browser interoperability

In this phase:

- Mac and iPhone are stand-ins for future toys
- HTTPS access is required on iPhone Safari for microphone capture
- the browser button is a stand-in for the toy’s physical push-to-talk button
- browser status text is a stand-in for LEDs, tones, or other toy feedback

## Transition to toy hardware

The final toy endpoint should keep the same logical responsibilities as the web client:

- connect to the signaling service
- authenticate or identify the device
- join the paired room automatically
- establish WebRTC with its counterpart
- capture mic audio
- play incoming audio
- map a physical button to floor request and release
- present state through light or sound cues

Planned mapping:

- web PTT button -> physical toy button
- browser mic -> toy microphone
- browser audio output -> toy speaker
- screen-based state -> LED or sound cues
- room input -> app-driven pairing or provisioning
- manual join -> automatic connect on boot

## Privacy model

The intended privacy posture is:

- microphone muted by default
- audio transmitted only while the user actively holds push-to-talk and owns the floor
- no recording by default
- no audio storage by default

This is important both for the browser MVP and for the eventual toy form factor.

## AI separation

Human-to-human walkie-talkie communication should remain its own mode.

AI companion behavior, if added later, should be introduced as a separate mode that can reuse parts of the transport and endpoint architecture without changing the basic human communication path.

## Relationship to the current repo

The current repository implements the first slice of this system:

- browser endpoints
- local Node signaling server
- WebRTC live audio
- half-duplex push-to-talk

It does not yet implement:

- toy hardware endpoints
- pairing or authentication
- persistent backend state
- richer deployment infrastructure
- separate AI mode

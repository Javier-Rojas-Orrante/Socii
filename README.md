# Socii

Socii is a relationship object: a pair of intimate companion devices designed to help two people feel present with each other across distance.

The product goal is not to automate the relationship or replace either person. The goal is to create a calm communication layer that helps people feel closer through ambient presence, intentional signals, live voice, and eventually AI-assisted reflection.

## Product Vision

Socii should feel:

- soft
- private
- low-friction
- emotionally intentional
- more like shared presence than messaging

At its core, Socii is meant to become a physical communication bridge between two people. The browser-based repo is the current simulation layer for that future object.

## Current Repository Focus

The repository currently implements the first product slice: a browser-based Socii presence and communication prototype.

What is in the repo now:

- paired roles: `Javi` and `Sofi`
- a shared browser UI that simulates the Socii object
- one large orb for ambient signaling
- want-to-talk requests
- acknowledgement into a live open call
- short notes with optional kaomoji
- WebSocket signaling
- WebRTC peer-to-peer audio
- a Node.js server for coordination

This phase validates the interaction model before moving into full hardware and AI layers.

For exact current behavior, see [docs/current-status.md](/Users/javier/Socii/docs/current-status.md:1).

## Product Roadmap

### 1. Browser Presence and Call MVP

Status: in repository now

This phase establishes the foundational Socii interaction model:

- ambient presence
- orb-based signaling
- lightweight note exchange
- live voice connection
- browser simulation of a future physical object

This gives the product a real emotional interface before hardware is built.

### 2. Dual Socii Reflection System

Status: next in line to implement

This is the next major planned feature layer for the product.

The Dual Socii Reflection System introduces one private AI-powered Socii per partner. Each person first reflects privately with their own Socii before deciding what to share with the other person.

The purpose of this system is to help transform messy emotional input into clearer, safer, and more intentional communication.

The next implementation direction includes:

- private AI reflection per partner
- consent-based sharing of approved emotional signals
- AI-assisted message drafting
- misunderstanding detection
- emotional pattern memory with consent
- shared conversation framing when both people approve participation

This system should help people communicate better without exposing private thoughts automatically and without positioning AI as a judge, therapist, or replacement for human intimacy.

Full concept doc: [docs/dual-socii-reflection-system.md](/Users/javier/Socii/docs/dual-socii-reflection-system.md:1)

### 3. Physical Socii Device Layer

Status: later phase

After the browser simulation and AI reflection system are defined more clearly, the next product step is to map the same logic into physical Socii devices.

Planned hardware mapping includes:

- browser orb -> physical light or LED matrix
- browser tap interactions -> physical buttons
- browser microphone -> device microphone
- browser speaker output -> device speaker
- browser status text -> light, sound, or small display feedback

The product should preserve the same state model across browser and hardware versions.

### 4. Shared Memory and Relationship Context

Status: later phase

Over time, Socii may support consent-based memory layers that help preserve useful relationship context, including:

- shared agreements
- recurring needs
- important dates
- repair patterns
- rituals and preferences

This memory must remain explicitly consent-based, privacy-first, and clearly separated between private and shared data.

## Dual AI System Principles

The Dual Socii Reflection System should follow these rules:

- each partner has a private AI space
- private reflections are not shared automatically
- only approved summaries or signals can cross the bridge
- AI should clarify feelings, not decide who is right
- AI should help people communicate better, not speak for them without approval
- memory must be separated into private, shared, and temporary layers

In simple terms:

> Each person talks privately to their Socii.  
> Each Socii helps clarify what the person feels.  
> Each person approves what can be shared.  
> The two Sociis exchange only approved signals.  
> AI helps both people arrive at a clearer conversation.

## Repo Documents

- [docs/current-status.md](/Users/javier/Socii/docs/current-status.md:1): what the repository actually implements today
- [docs/grand-scheme.md](/Users/javier/Socii/docs/grand-scheme.md:1): broader product and architecture direction
- [docs/dual-socii-reflection-system.md](/Users/javier/Socii/docs/dual-socii-reflection-system.md:1): detailed concept for the next AI reflection phase

## Guiding Principle

Socii should help two humans understand each other better.

The final goal is not automation of the relationship.

The final goal is better human communication.

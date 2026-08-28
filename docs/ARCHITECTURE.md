# Architecture

The project is a modular monolith with a separate desktop/web client.

- `apps/client`: React renders interface layers and PixiJS renders the game world. `WorldState` is framework-independent.
- `crates/game-server`: an Axum/Tokio process holding active world state in memory. Clients send intentions and the server validates outcomes.
- `crates/game-protocol`: versioned network messages.
- `crates/game-types`: shared domain types without networking or storage concerns.
- `content`: stable original content IDs and data validated during server startup.

HTTP handles Argon2id registration, login, and character management. The WebSocket handshake then requires a session token and character ID, verifying account ownership before creating world state. Sessions deliberately reset on server restart during this phase.

The current slice uses a process-local broadcast channel carrying both public and recipient-filtered events. Movement and ground items are shared, while inventory is never exposed to other sessions. Chunk-based interest subscriptions replace global broadcast before the world grows beyond prototype scale.

Movement is keyboard-first on the client, including continuous held-key input and safe prediction. The renderer keeps logical and visual positions separate, interpolating entities and the camera every frame so tile boundaries are not exposed as movement jumps. The server still accepts only adjacent tile intentions and remains authoritative over collision and movement rate.

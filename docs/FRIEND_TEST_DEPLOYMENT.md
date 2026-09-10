# Friend test deployment

Development / VS Code:
- API http://127.0.0.1:4000/api
- WS  ws://127.0.0.1:4000/ws

Installed friend client:
- API http://213.65.167.85:4000/api
- WS  ws://213.65.167.85:4000/ws

Friend server mode binds to:
- 0.0.0.0:4000

Router:
- forward TCP 4000 to the development PC LAN IPv4 on port 4000.

Distribution:
- download `Embers-of-Aldoria-Native-windows-x86_64.zip` from the latest `client-v*` GitHub release;
- extract the complete archive so `assets` remains beside `EmbersOfAldoria.exe`.

Updater:
- https://github.com/Ghilea/tibiaCloneGame/releases/latest/download/native-latest.json
- `crates/game-client/updater.pub` is public and committed.
- the updater private key must never be committed.

Security:
The updater is HTTPS + signature verified.
The first direct-IP game transport is HTTP/WS and therefore does not encrypt
friend login traffic. Use dedicated test passwords until DNS + HTTPS/WSS is
configured.

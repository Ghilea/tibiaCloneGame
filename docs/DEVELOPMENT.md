# Development

1. Copy `.env.example` to `.env` when PostgreSQL should be enabled. The server reads it automatically during startup.
2. Start PostgreSQL with `docker compose up -d postgres`.
3. Run `cargo run -p game-server`.
4. Run `npm run dev` to start the native Rust/Bevy client.

The optional browser world editor is installed with `npm install --prefix apps/world-editor` and started with `npm run editor`.

Without `DATABASE_URL`, the server explicitly starts in ephemeral development mode. With the variable set, it runs migrations and verifies database reads and writes during startup.

Compose exposes PostgreSQL on host port `5433` because local installations commonly occupy the default port 5432. The connection string is `postgres://postgres:postgres@localhost:5433/aldoria`.

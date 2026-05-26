# Frontier Realtime

Reserved placeholder for `@shapeshift-labs/frontier-realtime`.

This repository is intentionally a placeholder. It reserves the package and source
repository name for a future Frontier realtime multiplayer runtime. It does not
contain production APIs, implementation code, benchmark claims, or release-ready
package contents yet.

Planned scope:

- realtime command, tick, and snapshot contracts
- client prediction and authoritative reconciliation primitives
- interpolation and rollback buffer contracts
- shared replication message types for server and transport packages

This package is intended to sit above the core Frontier state, codec, schema,
event-log, and query layers. It should stay separate from CRDT collaboration
sync, which remains owned by `@shapeshift-labs/frontier-crdt-sync`.


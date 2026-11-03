# shared/testing

- `builders.ts`: `account()`, `transaction()`, `category()`, `recurring()` with
  sensible defaults (DOP, 2026-11-02, 100.00); pass overrides for what matters.
- `memory-storage.ts`: `MemoryStorage` (+ `seed`, `failOnSet`) and `boot(storage)`,
  which starts a fresh app session (new service instances) over that storage.

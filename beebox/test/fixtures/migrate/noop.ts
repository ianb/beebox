#!/usr/bin/env tsx
// A migrator that does nothing and exits 0, for sweep tests that need a pending
// script migration whose side effects are nil. Registered by those tests.
process.exitCode = 0;

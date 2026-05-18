# Contributing

## Dev setup

```bash
git clone https://github.com/dislev/mqtt-scenario-sim.git
cd mqtt-scenario-sim
npm install
npm run build
```

Node >=22 required.

## Running tests

```bash
npm test              # run tests with coverage summary
npm run test:ci       # run tests with lcov output (used in CI)
```

All tests live in `test/`. The suite runs without a live MQTT broker — the simulator client is not exercised in unit tests.

## Code style

```bash
npm run lint
```

ESLint is configured at the root. Fix any errors before opening a PR.

## Making changes

1. Fork the repo and create a feature branch from `main`.
2. Make your changes with tests.
3. Run `npm run build && npm test` — both must pass.
4. Open a pull request. Describe what changed and why.

The `main` branch requires a passing CI check and one review before merging.

## Reporting bugs

Open a GitHub issue with:
- What you expected
- What happened instead
- Minimal config/command to reproduce

## Feature requests

Open an issue first to discuss before implementing. This keeps PRs focused and avoids wasted work.

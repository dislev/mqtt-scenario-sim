# Changelog

All notable changes to this project will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-05-18

### Added
- Configurable MQTT sensor simulator with freeform `labels` on each source
- Topic template interpolation using label keys (`{building}/{floor}/metrics`)
- Sensor modes: `sinusoidal`, `drift`, `normal`, `spike`
- Six built-in test scenarios: `normal`, `out_of_range`, `trending_to_breach`, `stable_healthy`, `recovery`, `oscillating`
- Scenario auto-revert via `?durationSeconds=` query param
- Per-source scenario targeting via `?sourceKey=` query param
- Config-driven effects system for external bias simulation
- JSON encoding (default, zero config)
- Protobuf encoding via user-supplied `.proto` file with optional `fieldMap` remapping
- HTTP control plane: `/health`, `/scenario`, `/state`, `/effects`
- CLI entry point: `npx mqtt-scenario-sim --config my.yaml`
- Library exports: `startSimulator`, `buildEncoder`, `jsonEncoder`, `loadConfig`
- Environment variable overrides for all MQTT and encoding settings
- Example configs: `minimal.yaml`, `greenhouse.yaml`, `custom-proto.yaml`

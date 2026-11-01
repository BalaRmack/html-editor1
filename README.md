# PineconeMC — Autonomous Minecraft Launcher

A beautiful, modern launcher with autonomous offline account support. Built with a stunning glassmorphism web interface and a Rust backend.

## Features

- 🌟 **Super Beautiful Interface** — Glassmorphism, gradients, animations, floating orbs
- 🔑 **Autonomous Account** — Play without Microsoft login
- ⚡ **Multiple Versions** — Vanilla, Fabric, Forge
- 🔧 **Flexible Config** — RAM, Java version, game directory
- 📜 **Live Log Console** — Real-time launch feedback
- 🦀 **Rust Backend** — Fast, safe launcher core

## Structure

- `index.html` — Beautiful web launcher interface
- `src/main.rs` + `Cargo.toml` — Rust launcher backend
- `launcher_config.json` — Configuration file

## Quick Start

```bash
# Web launcher
open index.html

# Rust backend
cargo run -- launch
cargo run -- account
cargo run -- instances
```

## Design

The interface uses:
- Deep dark gradients with glowing orbs
- Frosted glass panels (`backdrop-filter`)
- Animated play button
- Responsive layout
- Orbitron + Outfit typography

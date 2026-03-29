# FFCommander
**A highly responsive, command-centric GUI engine bridging absolute OS native file structures into raw `ffmpeg` telemetry strings.**

Built natively using Tauri v2 (Rust) and React, FFCommander completely abandons the traditional timeline-based video editing hierarchy, pivoting back into raw syntax manipulation for power-users, DITs, and command-line engineers. 

![Dissector Snapshot](https://via.placeholder.com/800x400.png?text=FFCommander+GUI)

---

## 🛠 Features

### 1. The Reactive Command Dissector
Instead of shielding you from pure CLI strings, FFCommander visually tokenizes them. 
- Paste raw `ffmpeg` commands straight from the internet; the engine instantly dissects parameters into clickable HTML tiles.
- Click any `-i` (Input) or `Output` block to boot Native OS GUI file pickers. The absolute paths are recursively mapped back into the string structure automatically!
- Support for absolute Drag & Drop (Tauri Native Webview) bridging directly from the OS desktop into the active tile!

### 2. Live Process Telemetry
We re-engineered standard Node.js `spawn()` buffers natively into Rust `std::process::Command` byte iterators.
- **Microsecond Logging**: The UI Console detects physical Carriage Returns natively emitted by FFmpeg (`\r`), dropping them flawlessly into the frontend exactly mimicking the true Terminal.
- **Native OS Kills:** The Pause & Drop buttons target the raw active Process ID (PID) registered inside the native Thread HashMap, executing true `child.kill()` OS closures instantaneously!

### 3. Professional Edge Cases
- **Sequence Formatter**: Automatically extracts and rewrites enumerating digits (e.g. `render_%04d.exr`) injecting `-start_number` values recursively when Image Sequences are dropped.
- **SMPTE Timecodes & Framerate Topology**: Natively caches Ghost files via FFprobe capturing true `field_order` (Progressive/Interlaced), PARs, and mathematically deduces true fractional `HH:MM:SS:FF` video Timecodes.

## 🚀 CI/CD & Deployments

The infrastructure relies on GitHub Actions (`deploy.yml`) tracking Webkit / MSVC headers.
Whenever you push a semantic version tag (e.g., `git push origin --tags v1.0.0`), the cloud environment automatically builds:
- **Windows**: `x86_64-pc-windows-msvc` natively mapped to an `.exe` installer.
- **Linux**: Target `.deb` and `.AppImage` distributions bundled via `libwebkit2gtk`.

## ⚙ Development Setup

Ensure you have Rust (`rustup`) and standard Web dependencies.

```bash
# Extract core Node packages
npm install

# Boot the native environment
npm run tauri dev

# Compile your environment specifically
npm run tauri build
```

**Architecture Map:**
- `/src-tauri/src/lib.rs` -> The hardware I/O streaming hub, bridging HashMap concurrency.
- `/src/App.tsx` -> The primary React framework executing Queue processing arrays and Native UI routing. 
- `/src/lib/ffmpegParser.ts` -> The active AST token manipulator separating flags from absolute strings.

# ZenterPrime - Electron Desktop Executable (.exe) Build Guide

This project is fully configured for building Windows Desktop Executables (`.exe`) using **Electron** and **electron-builder**.

---

## 🚀 Quick Build Commands

### 1. Build Windows `.exe` Installer & Portable Exe
```bash
npm run build:exe
```
This command:
1. Builds the production frontend bundle into `dist/` with relative asset paths (`base: './'`).
2. Packages the Electron main process and preload scripts.
3. Generates:
   - **NSIS Setup Installer** (`.exe` with desktop shortcut, start menu entry, and customizable installation directory).
   - **Standalone Portable `.exe`** (single standalone file that runs immediately without installation).
4. Outputs the binaries into the `dist-electron/` folder.

---

### 2. Build Unpacked Directory (Fast Test)
```bash
npm run pack:exe
```
Generates an unpacked folder inside `dist-electron/win-unpacked/` containing `ZenterPrime.exe`. You can directly double-click `ZenterPrime.exe` to run it immediately without running an installer.

---

### 3. Run in Desktop Electron Development Mode
```bash
# Terminal 1: Run dev server
npm run dev

# Terminal 2: Run Electron pointing to dev server
npm run electron:dev
```

---

## 🛠 Project Configuration Details

- **Entry Point**: `electron/main.cjs`
- **Preload Script**: `electron/preload.cjs` (exposes `window.electronAPI`)
- **Relative Asset Base**: `vite.config.ts` configured with `base: './'` for `file://` protocol compatibility.
- **Routing**: `HashRouter` is used in `App.tsx` for navigation across Windows filesystem paths without route 404s.
- **Single Instance**: Only one window instance will be created; subsequent launches will focus the active window.
- **External Links**: All `http/https` links outside the app open safely in the user's default browser.
- **Offline / Local Data**: Works with both Supabase cloud syncing and offline local storage caching.

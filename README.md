# Fortnite Observer Switcher

Fortnite Observer Switcher is a Node.js + Express + Socket.IO web application for switching and projecting up to 8 shared screens to an OBS Browser Source.

## Features

- Up to 8 screen-sharing clients
- Screen thumbnails and preview
- Single-screen selection
- Two-screen selection with the Ctrl key
- Shift + screen key for immediate single-screen projection
- Enter key for projection
- Configurable keyboard shortcuts
- R key for clearing the projection and making Preview black
- OBS Browser Source output
- WebRTC screen sharing
- Socket.IO signaling

## Project structure

```text
fortnite-observer-switcher/
├─ public/
│  ├─ index.html
│  ├─ controller.js
│  ├─ share.html
│  ├─ share.js
│  ├─ obs.html
│  └─ obs.js
├─ server.js
├─ package.json
├─ package-lock.json
├─ .gitignore
└─ README.md
```

## Requirements

- Node.js 18+ recommended
- npm
- A browser supporting WebRTC / `getDisplayMedia()`
- HTTPS is required for screen sharing on normal remote domains. `localhost` can be used for local development.

## Installation

Clone the repository:

```bash
git clone https://github.com/YOUR-USERNAME/fortnite-observer-switcher.git
cd fortnite-observer-switcher
```

Install dependencies:

```bash
npm install
```

Start the server:

```bash
npm start
```

Then open the address shown by the server.

## OBS setup

Open the OBS Browser Source and use the OBS page provided by this application.

Example:

```text
https://YOUR-DOMAIN/obs.html
```

Use the actual URL and port of your deployment.

## Keyboard controls

Default controls:

| Key | Action |
|---|---|
| `1` - `8` | Select screen 1 - 8 |
| `Ctrl` + screen key | Add a second screen |
| `Shift` + screen key | Immediately project that single screen |
| `Enter` | Project the current selection |
| `R` | Clear projection / make Preview black |

`Ctrl + Shift` does not perform a two-screen instant projection.

Keyboard bindings can be changed from the settings panel.

## Deployment

This repository contains the application source code. It can be deployed to a Node.js-compatible rental server or VPS.

For remote screen sharing, configure the deployment with HTTPS.

Do not commit private API keys, passwords, certificates, or `.env` files to GitHub.

## License

No license is currently specified for this project.

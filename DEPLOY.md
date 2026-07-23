# Albion Helper Deployment

## Prerequisites
- Python 3.13+
- Node.js 22+

## Install
From the repository root:

```bash
cd backend
python -m pip install -r requirements.txt

cd ../frontend
node --version
```

## Build the frontend
The backend serves `frontend/dist` when it exists, so build the UI first:

```bash
cd frontend
node scripts/build.mjs
```

## Start the application
Run the backend server from the repository root:

```bash
python -m backend.main
```

Open:
- `http://127.0.0.1:8000`

## Notes
- The backend exposes `/api/health`, `/api/config`, `/api/items`, and `/api/optimize`.
- If you change frontend files, rerun `node scripts/build.mjs` before restarting the backend.
- If `npm` is blocked in PowerShell, use `node scripts/build.mjs` directly or `npm.cmd` instead of `npm`.

## Optional Dev Flow
If you want to edit the frontend without rebuilding every time, serve `frontend/src` directly with the included dev script:

```bash
cd frontend
node scripts/dev-server.mjs
```

This starts the frontend on `http://127.0.0.1:5173` and proxies API calls to the backend.

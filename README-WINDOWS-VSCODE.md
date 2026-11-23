# WinGo Admin Panel & Backend API — Windows VS Code Setup Guide

This package contains the complete **WinGo 23-Module Admin Panel** (English, Simplified Chinese, Khmer), the **Centralized Backend API**, **PostgreSQL schema migrations**, and the interactive **Super Administrator (`Afa`) first-run setup**.

No passwords or secrets are hardcoded anywhere in this package.

## Prerequisites
- Node.js 20+ (https://nodejs.org)
- PostgreSQL 15+ installed locally **OR** Docker Desktop for Windows
- VS Code

## Step-by-Step Setup in Windows VS Code

### 1. Open Folder & Create `.env`
Extract `wingo-admin-panel.zip`, open the `wingo-admin-panel` folder in VS Code, and open a terminal (`Ctrl + ``):
```powershell
copy .env.example .env
```
Edit `.env` and set:
- `DATABASE_URL` (matching your local PostgreSQL username, password, and database name)
- `WINGO_ENCRYPTION_KEY` (generate a 64-character hex string with:
  `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`)

### 2. Start Persistent PostgreSQL (if using Docker Desktop)
```powershell
docker compose up -d
```
*(If you installed PostgreSQL directly on Windows, create a database named `wingo` in pgAdmin or psql and point `DATABASE_URL` to it.)*

### 3. Install Dependencies & Run Database Migrations
```powershell
npm install
npm run db:migrate
```

### 4. Create Initial Super Administrator Account (`Afa`)
Run the beginner-friendly interactive setup command:
```powershell
npm run setup:admin
```
- Username is pre-configured as **`Afa`** (`role: super_admin`).
- Enter and confirm your chosen administrator password (masked input, minimum 10 characters with letters and numbers).
- The password is hashed with `scrypt` and stored in PostgreSQL. It is never written to source files or logs.
- Running `npm run dev` later will **never** overwrite or recreate your `Afa` account.

### 5. Start the Backend API + Admin Panel
```powershell
npm run dev
```
- Open **http://localhost:3000** in your browser to sign in to the **WinGo Admin Panel** as `Afa`.
- Now open the separate `wingo-game-page` folder in a second VS Code window and run `npm run dev` to test the **WinGo Player Game Page** at **http://localhost:5173** connected live to this exact same Backend API and PostgreSQL database!

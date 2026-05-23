# 🚀 Quick Installation Guide

## Streamer Maintenance Tracker

Get up and running in 5 minutes.

---

## 📋 Requirements

- **Node.js** 14.0+ ([Download](https://nodejs.org/))
- **npm** 6.0+ (included with Node.js)
- **Operating System**: Windows 10+, macOS 10.12+, or Linux

---

## 🔧 Installation Steps

### 1. Verify Node.js

```bash
node --version  # Should show v14.0.0 or higher
npm --version   # Should show 6.0 or higher
```

If not installed, download from [nodejs.org](https://nodejs.org/)

### 2. Get the Application

**Option A: Clone with Git**
```bash
git clone https://github.com/egorov-maksim/streamer-maintenance-app
cd streamer-maintenance-app
```

**Option B: Download ZIP**
- Download and extract to desired location
- Open terminal in extracted folder

### 3. Install Dependencies

```bash
npm install
```

Wait 1-2 minutes for installation to complete.

### 4. Install frontend libraries (REQUIRED)

Download UMD builds into `public/libs/` (no bundler). From the repo root:

```bash
mkdir -p public/libs

# PDF
curl -fsSL -o public/libs/jspdf.umd.min.js https://unpkg.com/jspdf@4.0.0/dist/jspdf.umd.min.js
curl -fsSL -o public/libs/jspdf-autotable.min.js https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.4/dist/jspdf.plugin.autotable.min.js

# CSV, charts, toasts, heatmap colors
curl -fsSL -o public/libs/papaparse.min.js https://cdn.jsdelivr.net/npm/papaparse@5.4.1/papaparse.min.js
curl -fsSL -o public/libs/chart.umd.min.js https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js
curl -fsSL -o public/libs/notyf.min.js https://cdn.jsdelivr.net/npm/notyf@3.10.0/notyf.min.js
curl -fsSL -o public/libs/notyf.min.css https://cdn.jsdelivr.net/npm/notyf@3.10.0/notyf.min.css
curl -fsSL -o public/libs/chroma.min.js https://cdn.jsdelivr.net/npm/chroma-js@2.4.2/chroma.min.js
```

**Windows users**: Download the same files from the URLs above into `public\libs\`.

### 5. Generate password hashes (AUTH_USERS)

Passwords in `.env` must be **bcrypt hashes**, not plaintext:

```bash
node -e "const b=require('bcryptjs'); console.log(b.hashSync('yourpassword', 10))"
```

Use the output in `AUTH_USERS` as the password field:

```env
AUTH_USERS=admin:$2b$10$YourHashHere:admin:TTN
```

### 6. Configure (Optional)

Create a `.env` file for custom settings:

```env
PORT=3000
DB_FILE=./backend/streamer.db
ALLOWED_ORIGINS=http://localhost:3000

# Authentication (format: USERNAME:PASSWORD_HASH:ROLE:VESSEL_TAG[:GLOBAL])
AUTH_USERS=USERNAME:$2b$10$hash:admin:ALL:true,USERNAME:$2b$10$hash:viewer:TTN
```

### 7. Start the Application

```bash
npm start
```

You should see:
```
Server running on http://localhost:3000
Database schema ensured.
Starting automated database backup scheduler...
```

### 8. Open in Browser

Navigate to: **http://localhost:3000**

**Default Login Credentials:** See `.env` (AUTH_USERS). Configure users in `.env` or copy from `.env.example`; see [README.md](README.md) for format.

---

## ✅ Verify Installation

After logging in:

1. ✅ Heatmap with 12 streamers displays
2. ✅ Configuration section is accessible
3. ✅ Can drag-select sections on heatmap
4. ✅ Events appear in history log
5. ✅ Statistics update automatically

---

## 🔧 Common Issues

### Port 3000 Already in Use

```bash
# Use different port
PORT=3001 npm start
```

### Cannot Find Module Error

```bash
# Reinstall dependencies
rm -rf node_modules package-lock.json
npm install
npm start
```

### PDF Generation Fails

**Check jsPDF library:**
```bash
# Verify file exists
ls public/libs/jspdf.umd.min.js

# If missing, download jsPDF 4.x:
curl -o public/libs/jspdf.umd.min.js https://unpkg.com/jspdf@4.0.0/dist/jspdf.umd.min.js
```

### Database Lock Error

```bash
# Simply restart the server
Ctrl+C
npm start
```

### Login Issues

Check `.env` file `AUTH_USERS` format (password field must be a bcrypt hash):

```env
AUTH_USERS=USERNAME:$2b$10$hash:ROLE:VESSEL_TAG
```

No spaces around colons or commas. Wrap the value in single quotes in shell scripts if `$` appears in hashes.

---

## 📊 File Structure

After installation:

```
streamer-maintenance-app/
├── backend/
│   ├── server.js          # Express server
│   ├── db.js              # Database setup
│   ├── schema.sql         # Database schema
│   └── streamer.db        # SQLite database (created on first run)
├── public/
│   ├── libs/               # UMD frontend libraries (REQUIRED — see step 4)
│   ├── index.html
│   ├── app.js
│   ├── styles.css
│   └── pdf-generator.js
├── backup/                # Auto-created for database backups
├── node_modules/          # Dependencies (created by npm install)
├── .env                   # Configuration (optional)
├── package.json
└── README.md
```

---

## 🚀 Advanced Options

### Run with PM2 (Production)

```bash
npm install -g pm2
pm2 start backend/server.js --name streamer-app
pm2 save
pm2 startup
```

### Run in Background (Linux/macOS)

```bash
npm start &
```

### Development Mode with Auto-Reload

```bash
npm install -g nodemon
nodemon backend/server.js
```

---

## 🔄 Data Management

### Backup Database

```bash
# Manual backup
cp backend/streamer.db backend/streamer.db.backup

# Automated backups run every 12 hours in ./backup/ folder
```

### Export/Import Data

Use the web interface:
- **Export**: Click "Export CSV" button
- **Import**: Click "Import CSV" button

---

## 🎯 Next Steps

1. **Configure Streamer Setup**: Match your cable configuration
2. **Create Projects**: Set up project tracking
3. **Test Logging**: Try drag-to-select feature
4. **Generate Report**: Test PDF generation
5. **Set Up Backups**: Configure automated backups

**Documentation:** [README.md](README.md) (overview), [TESTING.md](TESTING.md) (test setup), [API.md](API.md) (API reference).

---

## 📞 Support

- **Documentation**: [README.md](README.md), [TESTING.md](TESTING.md), [API.md](API.md)
- **Issues**: Check troubleshooting section above
- **Contact**: maksim.egorov@tgs.com

---

**Version**: 1.2.0  
**Last Updated**: January 2026  
**Node.js Required**: 14.0+


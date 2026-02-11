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

### 4. Install jsPDF Library (REQUIRED)

Download and place the jsPDF 4.x library for PDF report generation:

```bash
# Create libs directory
mkdir -p public/libs

# Download jsPDF 4.x (macOS/Linux)
curl -o public/libs/jspdf.umd.min.js https://unpkg.com/jspdf@4.0.0/dist/jspdf.umd.min.js

# Or download manually from the URL above and place in public/libs/
```

**Windows users**: Download from the URL above and save to `public\libs\jspdf.umd.min.js`

### 5. Configure (Optional)

Create a `.env` file for custom settings:

```env
PORT=3000
DB_FILE=./backend/streamer.db
ALLOWED_ORIGINS=http://localhost:3000

# Authentication (format: USERNAME:PASSWORD:ROLE)
AUTH_USERS=USERNAME:PASSWORD:admin,USERNAME:PASSWORD:viewer
```

### 6. Start the Application

```bash
npm start
```

You should see:
```
Server running on http://localhost:3000
Database schema ensured.
Starting automated database backup scheduler...
```

### 7. Open in Browser

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

Check `.env` file AUTH_USERS format:
```env
AUTH_USERS=USERNAME:PASSWORD:ROLE,NEXTUSER:NEXTPASS:ROLE
```
No spaces around colons or commas.

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
│   ├── libs/
│   │   └── jspdf.umd.min.js  # jsPDF library (REQUIRED)
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


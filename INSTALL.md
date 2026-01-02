# 🚀 Installation & Setup Guide

## Streamer Maintenance Tracker - Local Installation

Complete step-by-step guide to install and run the Streamer Maintenance Tracker on your local machine.

---

## 📋 System Requirements

### Minimum Requirements
- **Operating System**: Windows 10+, macOS 10.12+, or Linux (Ubuntu 18.04+)
- **RAM**: 512 MB minimum, 2 GB recommended
- **Disk Space**: 500 MB for installation and database
- **Network**: Internet connection (for PDF generation CDN)

### Required Software
- **Node.js**: Version 14.0.0 or higher ([Download](https://nodejs.org/))
- **npm**: Comes with Node.js (version 6.0+)
- **Git**: Optional, for cloning repository
- **Terminal/Command Prompt**: For running commands

---

## 🔧 Step-by-Step Installation

### Step 1: Verify Node.js Installation

Open your terminal/command prompt and verify Node.js and npm are installed:

```bash
node --version
npm --version
```

**Expected Output:**
```
v16.13.0    (or higher)
8.1.0       (or higher)
```

If not installed, download from [nodejs.org](https://nodejs.org/)

### Step 2: Obtain the Application Files

#### Option A: Clone from Git Repository
```bash
git clone https://github.com/yourusername/streamer-maintenance-app.git
cd streamer-maintenance-app
```

#### Option B: Manual Download
1. Download the project as ZIP file
2. Extract to your desired location
3. Open terminal in the extracted folder

### Step 3: Install Dependencies

Navigate to the project directory and install all required packages:

```bash
npm install
```

This command will:
- Download all dependencies listed in `package.json`
- Create a `node_modules` folder (this will take 1-2 minutes)
- Prepare the application for running

**You should see output like:**
```
added 150 packages in 2m
```

### Step 4: Verify Installation

Check that all key files exist:

```bash
# On Windows:
dir

# On macOS/Linux:
ls -la
```

**You should see:**
```
package.json
package-lock.json
server.js
db.js
schema.sql
public/
  index.html
  app.js
  styles.css
  pdf-generator.js
node_modules/
```

### Step 5: Start the Application

```bash
npm start
```

You should see:

```
Server running on http://localhost:3000
Database schema ensured.
```

### Step 6: Open in Browser

1. Open your web browser (Chrome, Firefox, Safari, Edge)
2. Navigate to: `http://localhost:3000`
3. The Streamer Maintenance Tracker dashboard should load

---

## ✨ Initial Setup

### First Launch Checklist

After opening the app in your browser:

1. **Verify Dashboard Loads**: Heatmap with 12 cables visible
2. **Check Configuration**: Expand "Configuration" section
3. **Review Default Settings**:
   - Number of Cables: 12
   - Sections per Cable: 107
   - Section Length: 25m
   - Module Frequency: 4
   - Use Rope for Tail: true

4. **Customize Configuration** (if needed):
   - Modify numbers to match your actual streamer setup
   - Click outside or refresh page to apply changes

5. **Test Drag-to-Select**:
   - Select a cleaning method (Rope)
   - Click and drag across a few sections in the heatmap
   - Verify entry appears in "Cleaning History Log"

---

## 🔧 Configuration

### Configure for Your Setup

Edit the configuration to match your actual streamer configuration:

1. **Number of Cables**: Set to your streamer array size (typically 12)
2. **Sections per Cable**: Number of active sections (typically 107)
3. **Section Length**: Length of each section in meters (typically 25m)
4. **Module Frequency**: EB (sensor module) placement (typically every 4 sections)
5. **Use Rope for Tail**:
   - `true` = Use rope for tail termination (no additional sections)
   - `false` = Add 5 dedicated tail sections
6. **Channels per Section**: Number of channels per section (typically 6)

### Example Configurations

**Standard Survey Setup:**
```
Cables: 12
Sections: 107
Length: 25m
Modules: Every 4 sections
Tail: Rope only
Channels: 6
```

**Extended Cable Setup:**
```
Cables: 15
Sections: 120
Length: 25m
Modules: Every 5 sections
Tail: 5 sections
Channels: 8
```

---

## 🗄️ Database Setup

The application automatically creates and initializes the SQLite database on first run.

### Database File Location

By default, the database is created at:
```
./streamer.db
```

### Custom Database Location

Set the `DB_FILE` environment variable:

```bash
# Create .env file
echo DB_FILE=/custom/path/streamer.db > .env

# Start server
npm start
```

### Database Contents

**Tables Created Automatically:**

1. **cleaning_events**: All logged cleaning events
2. **app_config**: Configuration settings

**Indexes Created:**
- Cable ID index (fast cable queries)
- Date index (fast date-range queries)

---

## 🌐 Environment Variables

### Optional: Create .env File

Create a `.env` file in the project root for custom settings:

```bash
# Create .env file (Windows)
echo. > .env

# Create .env file (macOS/Linux)
touch .env
```

Edit `.env` with your settings:

```env
# Server Configuration
PORT=3000
NODE_ENV=production

# CORS - Allowed origins (comma-separated)
ALLOWED_ORIGINS=http://localhost:3000,http://192.168.1.100:3000

# Database
DB_FILE=./streamer.db
```

### Environment Variables Reference

| Variable | Default | Description |
|----------|---------|-------------|
| PORT | 3000 | Server port number |
| NODE_ENV | development | Environment mode |
| ALLOWED_ORIGINS | http://localhost:3000 | CORS allowed origins |
| DB_FILE | ./streamer.db | Database file path |

---

## 🚀 Running the Application

### Normal Startup

```bash
npm start
```

### Development Mode (with auto-reload)

Install nodemon globally (optional):
```bash
npm install -g nodemon
```

Then run:
```bash
nodemon server.js
```

### Background Process (Linux/macOS)

Run in background:
```bash
npm start &
```

### Process Manager (Production Recommended)

Install PM2 globally:
```bash
npm install -g pm2
```

Start with PM2:
```bash
pm2 start server.js --name streamer-app
pm2 save
pm2 startup
```

Monitor:
```bash
pm2 logs streamer-app
pm2 status
```

---

## 🧪 Testing the Installation

### Test 1: Server Connectivity

```bash
curl http://localhost:3000
```

Should return HTML content of index.html

### Test 2: API Health

```bash
curl http://localhost:3000/api/config
```

Should return JSON configuration:
```json
{
  "numCables": 12,
  "sectionsPerCable": 107,
  ...
}
```

### Test 3: Create Test Event

```bash
curl -X POST http://localhost:3000/api/events \
  -H "Content-Type: application/json" \
  -d '{
    "cable_id": "cable-0",
    "section_index_start": 0,
    "section_index_end": 5,
    "cleaning_method": "rope",
    "cleaned_at": "2024-01-01T10:00:00Z",
    "cleaning_count": 1
  }'
```

Should return the created event with an ID

### Test 4: Retrieve Events

```bash
curl http://localhost:3000/api/events
```

Should return array of events

---

## 🔐 Security Considerations

### For Production Deployment

1. **HTTPS Only**: Use SSL/TLS certificate
2. **CORS Configuration**: Restrict to known origins only
3. **Helmet.js**: CSP headers enabled by default
4. **Input Validation**: All inputs validated server-side
5. **SQL Injection Protection**: Parameterized queries used

### Database Security

- Keep `streamer.db` file in secure location
- Regular backups recommended
- File permissions: `600` (owner read/write only)

### Network Security

```bash
# Bind to local interface only
PORT=3000 npm start

# Or configure reverse proxy (nginx) for external access
```

---

## 📦 Folder Structure

After installation, your folder structure should look like:

```
streamer-maintenance-app/
├── server.js              # Express server
├── db.js                  # Database initialization
├── schema.sql             # Database schema
├── package.json           # Dependencies manifest
├── package-lock.json      # Locked dependency versions
├── .env                   # Environment config (optional)
├── .gitignore             # Git ignore rules
├── streamer.db            # SQLite database (created on first run)
├── public/
│   ├── index.html         # Frontend HTML
│   ├── app.js             # Frontend JavaScript
│   ├── styles.css         # Frontend styles
│   └── pdf-generator.js   # PDF generation
├── node_modules/          # Dependencies (created by npm install)
└── README.md              # Documentation
```

---

## 🔄 Updating the Application

### Update Dependencies

```bash
npm update
```

### Update to Latest Node.js

1. Visit [nodejs.org](https://nodejs.org/)
2. Download latest LTS version
3. Run installer
4. Restart application

```bash
# Verify new version
node --version
```

---

## 🆘 Troubleshooting

### Issue: "Port 3000 already in use"

**Solution 1: Change port**
```bash
PORT=3001 npm start
```

**Solution 2: Kill process on port 3000**
```bash
# macOS/Linux
lsof -i :3000
kill -9 <PID>

# Windows PowerShell (as Admin)
netstat -ano | findstr :3000
taskkill /PID <PID> /F
```

### Issue: "npm: command not found"

**Solution**: Node.js not installed or PATH not set correctly
1. Verify Node.js installation: `node --version`
2. Restart terminal
3. Reinstall Node.js if needed

### Issue: "Cannot find module 'express'"

**Solution**: Dependencies not installed
```bash
# Clear and reinstall
rm -rf node_modules package-lock.json
npm install
npm start
```

### Issue: "EADDRINUSE: address already in use"

**Solution**: Another application using the port
```bash
# Find what's using port 3000
lsof -i :3000  # macOS/Linux
netstat -ano | findstr :3000  # Windows

# Kill the process or change PORT
PORT=3001 npm start
```

### Issue: "Database is locked"

**Solution**: File is in use by another process
```bash
# Restart the server
Ctrl+C
npm start
```

### Issue: "CORS error in browser console"

**Solution**: Update ALLOWED_ORIGINS in .env
```env
ALLOWED_ORIGINS=http://localhost:3000,http://myserver.com
```

### Issue: "PDF generation fails"

**Possible Causes:**
- No internet connection (jsPDF CDN)
- Browser blocking popups
- CSP policy violation

**Solution:**
- Check browser console for errors
- Try in different browser
- Ensure internet connection

### Issue: "Cannot connect to http://localhost:3000"

**Solution:**
1. Verify server is running (should see "Server running on http://localhost:3000")
2. Check firewall allows port 3000
3. Try `http://127.0.0.1:3000` instead
4. Check terminal for error messages

---

## 📊 Performance Optimization

### For Large Datasets (10,000+ events)

1. **Increase Node.js heap size**:
```bash
node --max-old-space-size=4096 server.js
```

2. **Database optimization**:
```bash
# Rebuild database indexes
sqlite3 streamer.db "VACUUM; ANALYZE;"
```

3. **Frontend optimization**:
- Use modern browser (Chrome, Firefox, Safari)
- Clear browser cache
- Disable browser extensions

---

## 🔄 Data Backup & Recovery

### Regular Backup

```bash
# Backup database (daily)
cp streamer.db streamer.db.backup.$(date +%Y%m%d)

# Or use automated backup script
*/0 * * * * cp /path/to/streamer.db /backups/streamer.db.$(date +%Y%m%d-%H%M%S)
```

### Export Data

Use the app's CSV export feature:
1. Click "⬇️ Export as CSV"
2. File downloads as `streamer-events.csv`

### Recovery

```bash
# Restore from backup
cp streamer.db.backup.20240101 streamer.db
npm start
```

---

## 📝 Logs & Debugging

### View Server Logs

Logs are printed to console during runtime:

```bash
# Start with log output visible
npm start

# Capture to file (macOS/Linux)
npm start > app.log 2>&1

# View logs
tail -f app.log
```

### Enable Verbose Logging

Edit `server.js` and uncomment console.error() statements

### Browser Console Logs

Press `F12` in browser to open Developer Tools → Console tab

---

## 🎓 Next Steps

After successful installation:

1. **Read the README**: Full feature documentation
2. **Configure Settings**: Adjust for your streamer setup
3. **Log Test Events**: Practice with drag-to-select
4. **Generate a Report**: Test PDF functionality
5. **Backup Your Data**: Set up regular backups
6. **Deploy** (optional): Set up for team access

---

## 📞 Support Resources

### Documentation Files
- `README.md` - Feature documentation
- `package.json` - Dependencies list
- `schema.sql` - Database structure

### Online Resources
- [Node.js Documentation](https://nodejs.org/docs/)
- [Express.js Documentation](https://expressjs.com/)
- [SQLite Documentation](https://www.sqlite.org/docs.html)

### Troubleshooting Checklist
- ✅ Node.js version >= 14.0
- ✅ npm installed and working
- ✅ Dependencies installed (`npm install`)
- ✅ Port 3000 is available
- ✅ No firewall blocking
- ✅ Database file created in project root
- ✅ Any AI assistant
- ✅ maksim.egorov@tgs.com as last resort.

---

## ✅ Installation Checklist

- [ ] Node.js 14+ installed
- [ ] npm 6+ installed
- [ ] Project files obtained
- [ ] `npm install` completed
- [ ] All dependencies installed
- [ ] Database initialized on first run
- [ ] Server starts with `npm start`
- [ ] Browser loads http://localhost:3000
- [ ] Heatmap displays correctly
- [ ] Configuration loads and is editable
- [ ] Can drag-to-select in heatmap
- [ ] Events appear in history log
- [ ] PDF generation works
- [ ] CSV export works

---

**Version**: 1.0.0  
**Last Updated**: January 2026  
**Recommended Node.js**: 16+ LTS
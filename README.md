# 🧹 Streamer Maintenance Tracker

A comprehensive web application for tracking seismic streamer maintenance operations. This production-ready solution provides real-time visualization, detailed logging, and comprehensive reporting of streamer upkeep with robust multi-user access control and project management.

## 🎯 Overview

The **Streamer Maintenance Tracker** is a purpose-built solution for tracking cleaning and maintenance of seismic streamer cables used in marine survey operations.

### Problem Solved
- **Manual Tracking**: Eliminates paper logs and spreadsheets
- **Visibility**: Real-time heatmap shows cable maintenance status at a glance
- **Accountability**: Every cleaning event is logged with date, method, location, and user
- **Compliance**: Comprehensive reporting for operational audits and vessel documentation
- **Analytics**: Identify cleaning patterns and optimize maintenance schedules
- **Multi-Project Support**: Manage multiple projects with independent configurations
- **Access Control**: Role-based access (Admin/Viewer) with secure authentication

---

## ✨ Key Features

### 🔐 User Authentication & Access Control
- **Multi-User Support**: Secure login system with role-based permissions
- **Three Access Levels**:
  - 🔑 **SuperUser**: Full access (projects, config, deployments, backups, global clear, force-delete)
  - 👨‍💼 **Admin**: Event management only (add/edit/delete events, per-project clear)
  - 👁️ **Viewer**: Read-only access (view data, filter, export reports)
- **Session Management**: Secure session tokens with localStorage persistence
- **Configurable Users**: Define users and roles via `AUTH_USERS` in `.env` (format: `user:pass:role` with role `superuser`, `admin`, or `viewer`)

### 📋 Project Management
- **Multi-Project Tracking**: Create and manage multiple seismic survey projects
- **Project-Specific Configuration**: Each project maintains its own streamer configuration
- **Project Status**: Track active/inactive projects
- **Project Analytics**: View event counts and cleaning history per project
- **Vessel Tagging**: Associate projects with specific vessels (e.g., TTN, vessel names)
- **Project Filtering**: View events and statistics filtered by selected project

### 🗺️ Interactive Heat-Map Visualization
- **Visual Status Dashboard**: Color-coded grid showing all streamers and their sections
- **Vertical Layout**: Centered, responsive grid with integrated module markers
- **Age-Based Coloring System**:
  - 🟢 **Fresh** (0-3 days): Green - Just cleaned
  - 🟡 **4-6 days**: Yellow - Scheduled for cleaning soon
  - 🟠 **7-9 days**: Orange - Cleaning recommended
  - 🔴 **10-13 days**: Red - High priority cleaning
  - 🔴 **14+ days**: Dark Red - Critical - needs immediate cleaning
  - ⚪ **Never**: Gray - Never cleaned
- **Module Integration**: eBird module positions displayed directly on heatmap
- **Real-Time Updates**: Heatmap refreshes immediately after logging events
- **Hover Tooltips**: Section hover shows age, method, distance, EB range; **streamer column header hover** shows deployment date, days in water, coating status, total cleanings, and last cleaned date

### 🖱️ Drag-to-Select Cleaning Interface
- **One-Click Logging**: Click and drag across sections to mark them as cleaned
- **Visual Feedback**: Cells highlight during drag selection
- **Multi-Method Support**: Select from 5 cleaning methods:
  - 🪢 Rope
  - 🛠️ Scraper
  - 🪢🛠️ Scraper & Rope (combined)
  - ⚙️ SCUE
  - 🔪 Knife
- **Automatic Section Numbering**: AS01-ASxxx for active sections, tail sections when applicable
- **Smart EB Range Calculation**: Automatically calculates affected EB modules

### 🔧 Dynamic Configuration Management
- **Per-Project Settings**: Each project has independent configuration
- **Configurable Parameters**:
  - Number of cables/streamers (typically 12)
  - Sections per cable (typically 107)
  - Section length in meters (for distance calculations)
  - eBird module frequency (placement intervals)
  - Tail section options (5 tail sections or rope-only)
  - Channels per section
  - Vessel tag identifier
- **Real-Time Updates**: Configuration changes immediately update the heatmap
- **Collapse/Expand UI**: Fold configuration section for cleaner interface
- **Cleanup Orphaned Streamers**: When streamer count is reduced, SuperUser can remove events and deployments for hidden streamers via "Cleanup orphaned streamers"

### 📊 Comprehensive Statistics Dashboard
- **Coverage Metrics**:
  - Overall coverage percentage (active + tails)
  - Active section coverage percentage
  - Tail section coverage percentage
  - Individual cable/streamer statistics
- **Key Performance Indicators**:
  - Total cleaning events logged
  - Total distance cleaned (in meters and kilometers)
  - Last cleaning event details with timestamp
  - Events count by project
- **Method Breakdown**: 
  - Count of events by cleaning method
  - Distance cleaned by each method
  - Visualization of method distribution
- **Streamer Overview Cards**: Quick stats for each individual cable (distance, coverage %)

### 📝 Cleaning History Log
- **Detailed Event Table** with sortable columns:
  - Date & Time of cleaning
  - Project number
  - Vessel tag
  - Cable/Streamer number
  - Section range (e.g., AS01-AS10)
  - eBird range affected
  - Total distance cleaned (meters)
  - Cleaning method used
  - Cleaning count
  - Edit/Delete actions
- **Chronological Tracking**: Events listed newest first
- **Sortable Columns**: Click headers to sort by any field
- **Quick Actions**: Edit or delete events with inline confirmation
- **Visual Indicators**: Status badges for critical/warning states

### 🖊️ Manual Entry Interface
- **Quick Logging**: Manually enter cleaning events when needed
- **Form Validation**: Ensures data integrity with proper error handling
- **Flexible Inputs**: Support for ranges and individual sections
- **Project Selection**: Assign events to specific projects
- **Date/Time Picker**: Select exact cleaning date and time
- **Method Selection**: Choose from available cleaning methods

### 📈 Advanced Analytics & Filtering
- **Date Range Filtering**:
  - Filter events by start and end dates
  - View statistics for custom time periods
  - Analyze seasonal cleaning patterns
  - Filter by single date or date range
- **Project Filtering**: View data for specific projects
- **Method-Specific Analytics**: Breakdown of cleaning distance by method
- **Real-Time Filter Application**: Statistics update instantly when filters change
- **Persistent Filters**: Filters applied to reports and exports

### 📄 Professional PDF Report Generation
- **Comprehensive Reports** including:
  - Header with generation date
  - Configuration summary
  - Overall statistics (all-time)
  - Filtered period statistics (if dates selected)
  - Visual heat-map of cleaning status
  - Complete event log with all details including EB modules
  - Color legend for age buckets
  - Method breakdown
- **Landscape Format**: Optimized for large heatmaps and tables
- **Multiple Heatmaps**: 
  - All-history view always included
  - Filtered-period view (if date filter applied)
- **Professional Styling**: Print-ready with clear layout
- **Auto-Naming**: Reports named with generation date

### 📤 CSV Import/Export
- **Export Events**: Download all cleaning events as CSV file
- **Import Events**: Bulk upload previously saved events
- **Backup Capability**: Create data backups for offline storage
- **Data Migration**: Transfer data between systems or backup locations
- **Format Preservation**: Maintains data integrity during import/export

### 💾 Automated Database Backup
- **Scheduled Backups**: Automatic backups every 12 hours
- **Manual Backups**: Create on-demand backups anytime
- **Backup Management**: 
  - List available backups with dates and file sizes
  - Restore from any previous backup
  - Automatic cleanup (keeps last 14 backups)
- **WAL Mode**: Write-Ahead Logging ensures data integrity
- **Automatic Safety**: Creates backup before restore operation
- **Transaction Safety**: Proper data integrity with PRAGMA settings

### 🔔 Smart Alerts & Indicators
- **Critical Alerts**: Visual warnings for uncleaned sections (14+ days)
- **Warning Alerts**: Highlight sections needing attention (10+ days)
- **Status Indicators**: Real-time status badges on cards
- **Uncleaned Sections**: List sections that have never been cleaned
- **Toast Notifications**: Real-time feedback for actions (success/error/warning)

### 📊 eBird Module Tracking
- **Intelligent Calculation**: Automatically calculates EB module ranges affected by cleaning
- **Visual Integration**: Module positions shown on heatmap as highlighted cells
- **Event Logging**: EB range included in event history
- **Report Inclusion**: EB module details in PDF reports
- **Configurable Frequency**: Adjust module spacing based on project needs

### 🔧 Per-Streamer Deployment Configuration
- **Deployment Date**: Set deployment date per streamer for the active project
- **Coating Status**: Three-state toggle (Coated / Uncoated / Unknown) per streamer
- **Modern Card UI**: One card per streamer with date input and coating buttons
- **Heatmap Tooltip**: Hover on streamer column header to see deployment date, days in water, coating, and cleaning stats
- **Clear Config**: SuperUser can clear individual or all streamer configurations

### 🗄️ Database Schema (Fresh Install)
- **Streamer IDs**: All streamer references use `streamer_id` (INTEGER 1–12). No migration from legacy `cable_id`.
- **Cascade Deletes**: Deleting a project removes its events and deployment configs automatically.
- **Tables**: `cleaning_events` (streamer_id, project_number FK CASCADE), `projects`, `streamer_deployments` (streamer_id, project_id FK CASCADE), `app_config`.

### 🔐 Data Security & Persistence
- **SQLite Database**: Local database with WAL mode for reliability
- **Automatic Persistence**: All events automatically saved
- **Data Recovery**: Configuration backed up in database
- **Transaction Safety**: Proper data integrity with PRAGMA settings
- **Access Control**: API endpoints protected with authentication
- **CORS Protection**: Configurable allowed origins
- **CSP Headers**: Content Security Policy for XSS protection

---

## 🚀 Getting Started

### Prerequisites
- **Node.js** 14.0 or higher
- **npm** 6.0 or higher
- **git** (for cloning the repository)
- **jsPDF library** (4.x) - Required for PDF report generation; see [INSTALL.md](INSTALL.md) for download

### Quick Start

```bash
# 1. Navigate to the project directory
cd streamer-maintenance-app

# 2. Install dependencies
npm install

# 3. Configure environment (optional - see below for defaults)
cp .env.example .env  # Review and edit if needed

# 4. Start the server
npm start

# 5. Open in browser
# Visit http://localhost:3000
# Login with default credentials or configured users
```

The application will:
- Initialize SQLite database automatically
- Load default configuration
- Create backup directory
- Start listening on configured port (default 3000)
- Begin automatic backup scheduler (every 12 hours)

### Environment Configuration

Create a `.env` file in the root directory (copy from `.env.example` for a template with safe defaults):

```env
# Server
PORT=3000
DB_FILE=./backend/streamer.db

# CORS
ALLOWED_ORIGINS=http://localhost:3000

# Authentication (format: USERNAME:PASSWORD:ROLE, separated by commas)
AUTH_USERS=TTNOBS:Password:admin,TTNView:Password:viewer,TTNNav:Password:viewer
```

---

## 📚 Usage Guide

### Daily Workflow

#### 1. **Login**
- Navigate to http://localhost:3000
- Enter username and password
- Roles determine available actions

#### 2. **Select or Create Project**
- Choose active project from project list
- Or create new project (Admin only)
- New projects inherit current configuration

#### 3. **Review Current Status**
- Check the heatmap for sections needing cleaning
- Review alerts for cables with 14+ day old sections
- Check streamer overview cards for quick stats

#### 4. **Log Cleaning Operations**
- Select a cleaning method from the tiles
- Click and drag across the heatmap to mark sections as cleaned
- Review the logged event in the history
- Statistics update automatically
- Hover over sections for detailed information

#### 5. **Manual Entry**
- For off-schedule cleanings, use the manual entry form
- Select project, cable, date, method, and section range
- Submit to add to the log

#### 6. **Review History**
- Sort the cleaning history by any column
- Edit or delete events if needed
- Filter by date range for analysis

#### 7. **Generate Reports**
- (Optional) Set date filter to analyze a period
- Click "Generate PDF Report"
- Share or archive the report

#### 8. **Export Data**
- Click "Export to CSV" to download events
- Use for backup or analysis in spreadsheets

#### 9. **Manage Backups** (Admin only)
- View list of automatic backups
- Create manual backups anytime
- Restore from previous backups if needed

### Configuration

#### Accessing Configuration
1. Admin login required
2. Scroll to "Configuration" section
3. Click to expand/collapse
4. Modify any setting
5. Changes apply immediately to active project

#### Key Settings

| Setting | Default | Purpose |
|---------|---------|---------|
| Number of Cables | 12 | Total streamers in array |
| Sections per Cable | 107 | Active sensor sections |
| Section Length (m) | 25 | Length of each section for distance calculation |
| eBird Frequency | 4 | EB module spacing (every N sections) |
| Use Rope for Tail | true | Use rope (true) or add 5 tail sections (false) |
| Channels per Section | 6 | Sensor channels per section |
| Vessel Tag | TTN | Vessel identifier for events |

---

## 📄 PDF Report Generation

### Features

The PDF report includes:

1. **Header**: Title, generation date, vessel/project info
2. **Configuration**: System configuration at report time
3. **Overall Statistics**: All-time metrics
4. **Filtered Statistics** (optional): Period-specific metrics
5. **All-History Heatmap**: Visual grid of cleaning status
6. **Filtered Heatmap** (optional): Period-specific heatmap
7. **Method Breakdown**: Distance by cleaning method
8. **Event Log**: Complete table with EB module details
9. **Color Legend**: Age bucket interpretation

### Report Layout

- **Orientation**: Landscape (A4)
- **Scale**: Optimized for 12 cables × 107+ sections
- **Legend**: Color-coded age buckets
- **EB Ranges**: Sensor module locations marked

### Generating Reports

1. (Optional) Set date filters for period analysis
2. (Optional) Select project to filter data
3. Click "Generate PDF Report" button
4. Report downloads automatically as `streamer-maintenance-report-YYYY-MM-DD.pdf`

---

## 🔧 API Endpoints

### Authentication
- `POST /api/login` - Login with credentials
- `POST /api/logout` - Logout current session
- `GET /api/session` - Verify current session

### Configuration
- `GET /api/config` - Get current configuration
- `PUT /api/config` - Update configuration (Admin only)

### Projects
- `GET /api/projects` - List all projects
- `GET /api/projects/active` - Get active project
- `POST /api/projects` - Create new project (Admin only)
- `PUT /api/projects/:id` - Update project (Admin only)
- `DELETE /api/projects/:id` - Delete project (Admin only)
- `GET /api/projects/stats` - Get event counts by project

### Cleaning Events
- `GET /api/events` - Get all events
- `POST /api/events` - Create new event
- `PUT /api/events/:id` - Update event (Admin only)
- `DELETE /api/events/:id` - Delete event (Admin only)
- `GET /api/events/export` - Export events as CSV

### Statistics
- `GET /api/stats` - Get overall statistics
- `GET /api/stats/filter` - Get filtered statistics
- `GET /api/last-cleaned` - Get last cleaned data for heatmap
- `GET /api/last-cleaned-filtered` - Get filtered heatmap data

### Utilities
- `GET /api/eb-range` - Calculate EB module range for sections

### Backups (Admin only)
- `GET /api/backups` - List available backups
- `POST /api/backups` - Create manual backup
- `POST /api/backups/:filename/restore` - Restore from backup

---

## 🔧 Troubleshooting

### Issue: Port 3000 Already in Use

**Solution**: Change port in `.env`
```env
PORT=3001
```

### Issue: Database Lock Error

**Solution**: Restart the server. The app uses WAL mode for safety.

```bash
# Kill the server
Ctrl+C

# Restart
npm start
```

### Issue: Cannot Import Events

**Ensure CSV Format** (streamer_id is 1-12):
```
streamer_id,section_index_start,section_index_end,cleaning_method,cleaned_at,project_number,vessel_tag
1,0,5,rope,2024-01-01T10:00:00Z,PRJ-001,TTN
2,10,15,scraper,2024-01-01T11:00:00Z,PRJ-001,TTN
```

### Issue: Stats Not Updating

**Solution**: Refresh the page (data syncs < 1 second typically)

### Issue: PDF Generation Fails

**Check Console**: Look for jsPDF loading errors
- Ensure internet connection (CDN loading jsPDF)
- Browser console may show CSP policy violations
- Try disabling browser extensions
- Verify ALLOWED_ORIGINS includes your domain

### Issue: Login Failed

**Verify Credentials**: Check AUTH_USERS in `.env`
- Format: `USERNAME:PASSWORD:ROLE`
- Multiple users: comma-separated
- No spaces around colons

### Issue: Cannot See Other Users' Events

**Check Project Filter**: Events may be filtered by project
- Clear project filter to see all projects
- Check user role (Viewer can see all events)

---

## 📊 Performance Notes

- Database optimized for 12+ cables, 100+ sections, 10,000+ events
- Heatmap renders in < 500ms on modern browsers
- API responses < 100ms typical
- Handles concurrent users efficiently
- Backup operations don't block application
- Filter operations are instant with proper indexing

---

## 📚 Tech Stack

### Backend
- **Node.js** - JavaScript runtime
- **Express.js** - Web framework
- **SQLite3** - Database with WAL mode
- **jsPDF** - PDF report generation
- **Helmet** - Security headers
- **CORS** - Cross-origin resource sharing

### Frontend
- **Vanilla JavaScript** - No frameworks
- **HTML5** - Semantic markup
- **CSS3** - Modern styling with variables
- **Responsive Design** - Mobile-friendly UI

### Security
- Session-based authentication
- Role-based access control (RBAC)
- CSRF protection via CORS
- Content Security Policy (CSP)
- Input validation and sanitization

---

## 📄 File Structure

```
streamer-maintenance-app/
├── backend/
│   ├── server.js          # Express server & API entry
│   ├── db.js              # SQLite database setup
│   ├── config.js          # App config (port, CORS, etc.)
│   ├── schema.sql         # Database schema
│   ├── middleware/
│   │   └── auth.js        # Session auth & role middleware
│   ├── routes/
│   │   ├── auth.js        # Login / session endpoints
│   │   ├── backups.js     # Backup list / create / restore
│   │   ├── config.js      # App & streamer config API
│   │   ├── events.js      # Cleaning events CRUD
│   │   ├── projects.js    # Projects CRUD
│   │   └── stats.js       # Statistics & aggregates
│   └── utils/
│       ├── eb.js          # eBird module helpers
│       ├── errors.js      # Error response helpers
│       ├── queryHelpers.js
│       └── validation.js
├── public/
│   ├── index.html         # Main UI
│   ├── app.js             # Frontend entry & orchestration
│   ├── styles.css         # UI styling
│   ├── pdf-generator.js   # PDF report generation
│   ├── libs/
│   │   └── jspdf.umd.min.js  # jsPDF 4.x (see INSTALL.md)
│   └── js/
│       ├── api.js         # API client
│       ├── auth.js        # Auth state & login
│       ├── modals.js      # Modal UI
│       ├── projects.js    # Project UI logic
│       ├── state.js       # App state
│       ├── streamer-utils.js
│       └── ui.js          # UI helpers
├── backup/                # Automated backup directory (created at runtime)
├── .env                   # Environment config (copy from .env.example)
├── .env.example           # Example env template
├── package.json           # Dependencies & scripts
├── API.md                 # API reference
├── INSTALL.md             # Installation guide
├── README.md              # This file
└── verify-schema.sh       # Schema verification script
```

---

## 🔐 Security Considerations

- **Authentication**: All API endpoints require valid session token
- **Authorization**: Role checks for admin-only operations
- **Database**: SQLite with WAL mode and foreign key constraints
- **Input Validation**: All user inputs validated server-side
- **CORS**: Configurable allowed origins
- **Session Tokens**: Cryptographically secure random tokens
- **No Passwords in DB**: Authentication handled in memory from env vars

---

## 📝 Latest Updates (January 2026)

- ✅ Multi-project support with project creation and management
- ✅ User authentication with role-based access control (Admin/Viewer)
- ✅ Session management with localStorage persistence
- ✅ Project-specific streamer configuration
- ✅ Automated database backups (every 12 hours)
- ✅ Manual backup creation and restore functionality
- ✅ Vessel tag tracking per project
- ✅ Enhanced EB module range calculation
- ✅ Toast notifications for user feedback
- ✅ Improved error handling and validation
- ✅ API endpoint documentation
- ✅ CSV import/export with project support
- ✅ Professional PDF report generation

---

## 📜 License

This project is provided as-is for TGS marine survey operations.

---

**Version**: 1.2.0  
**Last Updated**: January 2026  
**Node.js Required**: 14.0+  
**Author**: Maksim Egorov  
**Vessel**: Ramform Titan, Brazil  

**Documentation:** [INSTALL.md](INSTALL.md) (installation), [TESTING.md](TESTING.md) (testing), [API.md](API.md) (API reference).

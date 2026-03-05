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
- **Access Control**: Role-based access (four levels: GrandSuperUser/SuperUser/Admin/Viewer) with vessel-scoped authentication

---

## ✨ Key Features

### 🔐 User Authentication & Access Control
- **Multi-User Support**: Secure login system with role-based permissions
- **Access Levels**:
  - 👑 **GrandSuperUser**: Full access to **all vessels** (projects, global config, deployments, backups, *global* clears, force-delete)
  - 🔑 **SuperUser**: Full access **within their vessel** (projects, per-vessel config, deployments, backups listing/creation, per-project clears)
  - 👨‍💼 **Admin**: Event management only **within their vessel** (add/edit/delete events, per-project clear)
  - 👁️ **Viewer**: Read-only access **within their vessel** (view data, filter, export reports)
- **Session Management**: Secure session tokens with localStorage persistence
- **Configurable Users**: Define users and roles via `AUTH_USERS` in `.env`
  - Format (recommended): `USERNAME:PASSWORD:ROLE:VESSEL_TAG[:GLOBAL]`
    - `ROLE`: `grandsuperuser`, `superuser`, `admin`, or `viewer`
    - `VESSEL_TAG`: short code for the vessel (e.g. `TTN`, `RAM`)
    - `GLOBAL` (optional): `true` to give the user global (all-vessel) access
  - Examples:
    - `GrandRoot:Password:grandsuperuser:ALL:true` (grand superuser, all vessels)
    - `TTNOBS:Password:superuser:TTN` (superuser for vessel `TTN`)
    - `TTNView:Password:viewer:TTN` (viewer for vessel `TTN`)

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
- **Hover Tooltips**: Section hover shows last cleaned method & date, days since last clean, total times cleaned, and the last 5 cleanings with dates and methods; **streamer column header hover** shows deployment date, days from deployment to first scraping, coating status, total cleanings, and last cleaned date

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
- **Cleanup Orphaned Streamers**: When streamer count is reduced, GrandSuperUser (or global SuperUser) can remove events and deployments for hidden streamers via "Cleanup orphaned streamers"

### ⚙️ Config Page (Dedicated Dashboard)
- **Separate Configuration UI**: Full-screen dashboard at `/config` for managing projects and streamer settings without cluttering the main heatmap view
- **Access**: SuperUser and GrandSuperUser only; link "⚙️ Config" appears in the main app header when permitted
- **Independent login**: the page has its own login form, same as the `/stats` and `/planning` pages
- **Project & Streamer Configuration**: Active project banner, project comments (superuser-editable), project selector, and streamer parameters (count, sections, length, eBird frequency, tail option, etc.) with Save and "Cleanup orphaned streamers"
- **Per-Streamer Deployment**: Set deployment date and coating (Coated/Uncoated/Unknown) per streamer; bulk actions to set all dates, set all coating, or clear all/single streamer config
- **Vessel Project Overview**: Table of vessels with active project and project name; SuperUsers can change the active project per vessel from dropdowns
- **Project Management**: Create new project, set active project, clear active project; list of all projects with actions (activate, force-delete with confirmation)
- **Backup & Restore**: Create manual backup, refresh backup list, restore from backup (restore requires GrandSuperUser or a global SuperUser; requires server restart after restore)
- **Back to Main**: Header link returns to the main app at `/`

### 🗺️ Planning Page (Dedicated Maintenance Planning View)
- **Separate page** at `/planning` — read-only heatmap focused on upcoming cleaning decisions; scoped to per-vessel users (GrandSuperUser is intentionally blocked with a "restricted" notice)
- **Heatmap**: displays *days since last cleaning* per section instead of section numbers; includes a **channel reference column** (CH) showing the channel range for each section row
- **Cleaning Suggestions table**: automatically computes all contiguous section ranges where `days_since_last_clean ≥ 4` (or never cleaned), sorted by urgency (most overdue first)
  - Columns: Days Since (color-coded badge), Streamer, Section Range, EB Range, Channel Range, Avg RMS Noise (hidden when no noise data is loaded)
  - Badge colors: 4–6d yellow → 7–9d orange → 10–13d red → 14+d dark red → never gray
  - Active and tail sections are kept as separate groups (never merged across the boundary)
- **RMS Noise overlay**: same upload/toggle controls as the main page (see RMS Noise section below); when enabled, replaces age-bucket coloring with a RMS gradient and shows numeric values in cells
- **Section tooltips**: show last cleaned date, days since, and RMS noise value on hover
- **Independent login**: the page has its own login form; no separate tab or account needed
- **Scoped automatically** to the vessel's active project on load; no project switching UI

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
- **Days to First Scraping per Streamer**: Horizontal bar chart showing how many days elapsed from each streamer's deployment date to its first recorded cleaning event; only shown when the active project has deployment dates configured and at least some cleaning events recorded
- **Available as standalone page**: The stats dashboard is also accessible at `/stats` with its own independent login form

### 📝 Cleaning History Log
- **Detailed Event Table** with sortable columns:
  - Date & Time of cleaning
  - Project number
  - Vessel tag
  - Cable/Streamer number
  - Section range (e.g., AS01-AS10 for active; Tail 1–Tail 5 for tail). For a crossing range (active + tail), the log shows **two separate rows** (one active, one tail), not a single contiguous range.
  - eBird range affected
  - Total distance cleaned (meters)
  - Cleaning method used
  - Cleaning count
  - **Added By**: username of the person who logged the event (automatically recorded on create; preserved on CSV import)
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
- **Export Events**: Download all cleaning events as CSV file (includes Section Type: active or tail, and Added By column); when a project filter is active the filename includes the project number suffix (e.g. `streamer-cleaning-events-PRJ001-2026-03-05.csv`)
- **Import Events**: Bulk upload previously saved events; supports both legacy format and Section Type column; the `addedByUsertag` column is preserved on import
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
- **Duplicate-Clean Guard**: When logging a new event over a section already cleaned within the last 24 hours, a warning modal interrupts the save — showing which prior event overlaps, how long ago it was cleaned (e.g. "3 hrs 22 min ago"), and offering Cancel or Save Anyway
- **Adjacent Event Merge**: When a newly logged range is immediately adjacent (end+1 = proposed start, or vice versa) to an existing event on the same streamer with the same cleaning method and logged within 1 hour, a merge modal appears showing the existing range, the new range, and the combined merged range — the user can choose Merge (extends the existing event) or Keep Separate (saves as a new event)
- **Clear All Events**: SuperUser+ can bulk-delete all events for the active project (or globally if no active project for GrandSuperUser) via a confirmation modal that requires typing `DELETE` to proceed

### 📡 RMS Noise Data Upload & Overlay
- **CSV Upload**: Upload per-section RMS noise measurements from a CSV file (Admin+); the file is validated client-side before upload
  - Expected format: first column = 1-based section number; remaining columns = `Active, Cable 01, Cable 02, …` with values per streamer
  - The number of data columns must match the project's `numCables` and `sectionsPerCable` settings
- **Multi-Batch History**: multiple upload batches are stored per project; a dropdown selector lets you switch between historical uploads
- **Noise Overlay Toggle**: a toggle switch on the heatmap replaces age-bucket coloring with a two-stop RMS gradient (dark blue → white at 5 µV → deep red at 20+ µV) and renders numeric RMS values inside each cell
- **Cleaning Suggestions integration**: when noise data is loaded, the Planning Page suggestions table gains an **Avg RMS Noise** column
- **Section tooltips**: planning page hover tooltips include the RMS value for each section when data is active

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
- **Heatmap Tooltip**: Hover on streamer column header to see deployment date, days from deployment to first scraping, coating, and cleaning stats
- **Clear Config**: SuperUser can clear individual or all streamer configurations

### 🗄️ Database Schema (Fresh Install)
- **Streamer IDs**: All streamer references use `streamer_id` (INTEGER 1–12). No migration from legacy `cable_id`.
- **Cascade Deletes**: Deleting a project removes its events and deployment configs automatically.
- **Tables**:
  - `cleaning_events` — streamer_id, project_number FK CASCADE, added_by_usertag
  - `projects` — project metadata, vessel_tag
  - `streamer_deployments` — deployment date & coating per streamer, project_id FK CASCADE
  - `app_config` — key/value configuration store (scoped by vessel_tag)
  - `vessel_context` — per-vessel active-project mapping
  - `noise_uploads` — RMS noise upload batch metadata (project, label, created_at)
  - `noise_data` — per-section RMS measurements linked to an upload batch

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
- **Node.js** 20.0 or higher
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

# Authentication (format: USERNAME:PASSWORD:ROLE:VESSEL_TAG[:GLOBAL], separated by commas)
AUTH_USERS=TTNOBS:Password:admin:TTN:true,TTNView:Password:viewer:TTN,TTNNav:Password:viewer:TTN
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
- Or create new project (SuperUser/GrandSuperUser only)
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
- If the selected area was already cleaned within the last 24 hours, a warning dialog will appear showing the prior clean time before confirming

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

#### 9. **Manage Backups** (SuperUser+ for listing/creating; GrandSuperUser / global SuperUser for restore)
- View list of automatic backups
- Create manual backups anytime
- Restore from previous backups if needed (server restart required after restore)

### Configuration

Configuration is changed on the dedicated **Config page** (SuperUser only); there is no configuration section on the main page.

#### Config Page (SuperUser only)
- Open the **⚙️ Config** link in the main app header (visible only to SuperUser/GrandSuperUser), or go to **http://localhost:3000/config**
- After login, the dashboard shows:
  - **Active project** and project comments (editable by superuser)
  - **Project selector** and "Set as Active" to switch the active project
  - **Streamer configuration** (number of streamers, sections, section length, eBird frequency, tail option, etc.) — Save applies to the active project; "Cleanup orphaned streamers" removes events/deployments for streamers above the current count (GrandSuperUser / global SuperUser only)
  - **Per-streamer deployment** (deployment date and coating per streamer; bulk Set All Date / Set All Coating / Clear All)
  - **Vessel Project Overview** — see which project is active per vessel; superusers can change active project per vessel from the table
  - **Create New Project** (project number, name, vessel tag)
  - **All Projects** list with activate/delete actions
  - **Database Backup & Restore** — create backup, refresh list, restore
- Use **← Back to main** to return to the heatmap and event log.

#### Key Settings

| Setting | Default | Purpose |
|---------|---------|---------|
| Number of Cables | 12 | Total streamers in array |
| Sections per Cable | 107 | Active sensor sections |
| Section Length (m) | 75 | Length of each section for distance calculation |
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

- **Orientation**: Landscape (A3)
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
- `PUT /api/config` - Update configuration (SuperUser only)

### Projects
- `GET /api/projects` - List all projects
- `GET /api/projects/active` - Get active project
- `POST /api/projects` - Create new project (SuperUser+)
- `PUT /api/projects/:id` - Update project (SuperUser+)
- `DELETE /api/projects/:id` - Delete project; returns 409 if events/deployments exist (SuperUser+)
- `DELETE /api/projects/:id/force` - Force-delete project with all events and deployments (SuperUser+)
- `PUT /api/projects/:id/activate` - Set project as active for its vessel (SuperUser+)
- `POST /api/projects/deactivate` - Clear active project for the vessel (SuperUser+)
- `GET /api/projects/stats` - Get event counts by project
- `GET /api/projects/:id/streamer-deployments` - Get per-streamer deployment config
- `PUT /api/projects/:id/streamer-deployments` - Save per-streamer deployment config (upsert, SuperUser+)
- `DELETE /api/projects/:id/streamer-deployments/:streamerId` - Clear a single streamer deployment
- `POST /api/cleanup-streamers` - Delete events/deployments for streamers above configured max (GrandSuperUser+)

### Cleaning Events
- `GET /api/events` - Get all events (supports `?project=X`, `?start=`, `?end=` query params)
- `POST /api/events` - Create new event (Admin+); stores `addedByUsertag` from the authenticated user
- `PUT /api/events/:id` - Update event (Admin+)
- `DELETE /api/events/:id` - Delete single event (Admin+)
- `DELETE /api/events` - Bulk clear events; accepts optional `?project=X` param (Admin+)
- `GET /api/events/export` - Export events as CSV (includes Added By column; filename includes project suffix when filtered)
- `POST /api/events/import` - Bulk import events from CSV (Admin+)

### Statistics
- `GET /api/stats` - Get overall statistics (supports `?project=X`)
- `GET /api/stats/filter` - Get filtered statistics (supports `?start=`, `?end=`, `?project=X`)
- `GET /api/last-cleaned` - Get last cleaned data for heatmap (supports `?project=X`)
- `GET /api/last-cleaned-filtered` - Get filtered heatmap data (supports `?start=`, `?end=`, `?project=X`)

### Utilities
- `GET /api/eb-range` - Calculate EB range for active sections (supports `?sectionType=tail`, returns `"—"` for tails)

### RMS Noise Data
- `GET /api/noise-data/uploads` - List upload batches for a project (`?project=X`)
- `GET /api/noise-data` - Fetch RMS measurements for a batch or latest for project (`?project=X[&uploadId=Y]`)
- `POST /api/noise-data` - Upload new RMS noise CSV batch (Admin+)

### Backups (SuperUser+; restore requires GrandSuperUser / global SuperUser)
- `GET /api/backups` - List available backups
- `POST /api/backups` - Create manual backup
- `POST /api/backups/:filename/restore` - Restore from backup (server restart required after)

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

**Ensure CSV Format** (streamer 1-12). Exported CSV uses: Streamer Number, Section Type (active/tail), First Section, Last Section (1-based within type), Cleaning Method, Date & Time, Project Number, Vessel Tag. Legacy import accepts 5+ columns without Section Type (global 1-based indices; backend splits active/tail).
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
│   ├── db.js              # SQLite database setup & backup scheduler
│   ├── config.js          # App config (port, CORS, etc.)
│   ├── schema.sql         # Database schema
│   ├── activeProject.js   # Per-vessel active-project lookup
│   ├── middleware/
│   │   └── auth.js        # Session auth & role middleware
│   ├── routes/
│   │   ├── auth.js        # Login / session endpoints
│   │   ├── backups.js     # Backup list / create / restore
│   │   ├── config.js      # App & streamer config API
│   │   ├── events.js      # Cleaning events CRUD & bulk clear
│   │   ├── noise.js       # RMS noise upload batches & per-section data
│   │   ├── projects.js    # Projects CRUD, deployments, cleanup
│   │   └── stats.js       # Statistics & aggregates
│   └── utils/
│       ├── eb.js          # eBird module range calculator (pure)
│       ├── errors.js      # sendError() response helper
│       ├── queryHelpers.js # Dynamic SQL WHERE clause builder
│       ├── sectionType.js  # Active/tail section split & validation (pure)
│       └── validation.js  # toInt(), requireValidId() guards
├── public/
│   ├── index.html         # Main UI (heatmap, events, stats)
│   ├── app.js             # Frontend entry & orchestration
│   ├── config.html        # Config page (projects, streamer config, backups)
│   ├── configPage.js      # Config page logic (SuperUser only)
│   ├── stats.html         # Standalone stats page at /stats
│   ├── statsPage.js       # Stats page entry (independent login)
│   ├── planning.html      # Standalone planning page at /planning
│   ├── planningPage.js    # Planning page entry (independent login; per-vessel only)
│   ├── styles.css         # Single global stylesheet
│   ├── pdf-generator.js   # PDF report generation (A3 landscape via jsPDF)
│   ├── libs/
│   │   └── jspdf.umd.min.js  # jsPDF 4.x (see INSTALL.md)
│   └── js/
│       ├── api.js              # All fetch() wrappers; handles 401/403 centrally
│       ├── auth.js             # Auth state & login
│       ├── modals.js           # Modal UI
│       ├── noise-validation.js # Pure CSV validation for noise uploads
│       ├── projects.js         # Project UI logic
│       ├── state.js            # Single source of truth for frontend state
│       ├── stats.js            # Shared stats rendering (app.js & statsPage.js)
│       ├── streamer-tooltip.js # Heatmap column header tooltip
│       ├── streamer-utils.js   # Section label helpers
│       └── ui.js               # DOM helpers, toasts, status indicators
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

## 📝 Latest Updates (March 2026)

- ✅ **Planning page** (`/planning`): dedicated read-only heatmap with cleaning suggestions table, channel reference column, and urgency-ranked section ranges — scoped to per-vessel users only
- ✅ **RMS Noise overlay**: upload per-section RMS noise CSVs, toggle noise coloring on the heatmap, view Avg RMS Noise in the cleaning suggestions table, multi-batch upload history
- ✅ **Adjacent Event Merge**: when a new range is immediately adjacent to an existing same-method event within 1 hour, a merge modal offers to extend the prior event instead of creating a new one
- ✅ **Added By tracking**: every cleaning event records the username that created it; shown in the event log and CSV export
- ✅ **Days to First Scraping chart**: horizontal bar chart per streamer showing elapsed days from deployment to first cleaning; visible on main and `/stats` pages
- ✅ **Clear All Events**: SuperUser+ bulk-delete with `DELETE` confirmation; scoped to active project or global
- ✅ **Project delete safeguard**: `DELETE /api/projects/:id` returns 409 when data exists; force-delete requires a separate confirmation with typed `DELETE`
- ✅ **Standalone stats page** (`/stats`): full statistics dashboard with its own independent login form
- ✅ **Duplicate-clean guard**: warning modal when logging a cleaning event over an area already cleaned within the last 24 hours
- ✅ **Config page** (`/config`): dedicated SuperUser dashboard for project & streamer configuration, vessel–project overview, per-streamer deployment, backups, and project management
- ✅ Multi-project support with project creation and management (SuperUser+)
- ✅ Four-role RBAC: GrandSuperUser / SuperUser / Admin / Viewer with vessel scoping
- ✅ Session management with localStorage persistence
- ✅ Automated database backups every 12 hours; manual backups on demand
- ✅ CSV import/export with Added By column and project-suffixed filename
- ✅ PDF report generation (A3 landscape)

---

## 📜 License

This project is provided as-is for TGS marine survey operations.

---

**Version**: 1.4.0  
**Last Updated**: March 2026  
**Node.js Required**: 20.0+  
**Author**: Maksim Egorov  
**Vessel**: Ramform Titan, Brazil  

**Documentation:** [INSTALL.md](INSTALL.md) (installation), [TESTING.md](TESTING.md) (testing), [API.md](API.md) (API reference).

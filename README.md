# 🧹 Streamer Scraping Tracker

A comprehensive web application for tracking seismic streamer scraping operations. Designed exlusively for TGS, this app provides real-time visualization, detailed logging, and comprehensive reporting of streamers upkeep.

---

## 📋 Table of Contents

- [Overview](#overview)
- [Key Features](#key-features)
- [Getting Started](#getting-started)
- [Usage Guide](#usage-guide)
- [Configuration](#configuration)
- [PDF Report Generation](#pdf-report-generation)
- [Troubleshooting](#troubleshooting)

---

## 🎯 Overview

The **Streamer Maintenance Tracker** is a purpose-built solution for tracking scraping of seismic streamer cables. 

### Problem Solved
- **Manual Tracking**: Eliminates paper logs and spreadsheets
- **Visibility**: Real-time heatmap shows cable maintenance status at a glance
- **Accountability**: Every cleaning event is logged with date, method, and location
- **Compliance**: Comprehensive reporting for operational audits
- **Analytics**: Identify cleaning patterns and optimize maintenance schedules

---

## ✨ Key Features

### 🗺️ Interactive Heat-Map Visualization
- **Visual Status Dashboard**: Color-coded grid showing all 12 streamers and their 107+ sections
- **Age-Based Coloring System**:
  - 🟢 **Fresh** (0-3 days): Green - Just cleaned
  - 🟡 **4+ days**: Yellow - Scheduled for cleaning soon
  - 🟠 **7-9 days**: Orange - Cleaning recommended
  - 🔴 **10-13 days**: Red - High priority cleaning
  - 🔴 **14+ days**: Dark Red - Critical - needs immediate cleaning
  - ⚪ **Never**: Gray - Never cleaned

### 🖱️ Drag-to-Select Cleaning Interface
- **One-Click Logging**: Click and drag across sections to mark them as cleaned
- **Multi-Method Support**: Select from 5 cleaning methods:
  - 🪢 Rope
  - 🛠️ Scraper
  - 🪢🛠️ Scraper & Rope (combined)
  - ⚙️ SCUE 
  - 🔪 Knife
- **Automatic Section Numbering**: AS01-ASxxx for active sections, tail sections when applicable

### 🔧 Configuration Management
- **Dynamic Setup**: Configure:
  - Number of cables (typically 12)
  - Sections per cable (typically 107)
  - Section length in meters (for distance calculations)
  - Module frequency (eBird placement intervals)
  - Tail section options (5 tail sections or rope-only)
  - Channels per section
- **Real-Time Updates**: Configuration changes immediately update the heatmap

### 📊 Comprehensive Statistics Dashboard
- **Coverage Metrics**:
  - Overall coverage percentage (active + tails)
  - Active section coverage
  - Tail section coverage
- **Key Performance Indicators**:
  - Total cleaning events logged
  - Total distance cleaned (in meters and kilometers)
  - Last cleaning event details
- **Method Breakdown**: Count and distance by cleaning method

### 📝 Cleaning History Log
- **Detailed Event Table** with sortable columns:
  - Date & Time of cleaning
  - Cable/Streamer number
  - Section range (e.g., AS01-AS10)
  - eBird range affected
  - Total distance cleaned
  - Cleaning method used
  - Edit/Delete actions
- **Chronological Tracking**: All events listed newest first and could be sorted
- **Quick Actions**: Edit or delete events inline

### 🖊️ Manual Entry Interface
- **Quick Logging**: Manually enter cleaning events when needed
- **Form Validation**: Ensures data integrity with proper error handling
- **Flexible Inputs**: Support for ranges and individual sections

### 📈 Advanced Analytics & Filtering
- **Date Range Filtering**:
  - Filter events by start and end dates
  - View statistics for custom time periods
  - Analyze seasonal cleaning patterns
- **Method-Specific Analytics**: Breakdown of cleaning distance by method
- **Streamer Overview Cards**: Quick stats for each cable

### 📄 PDF Report Generation
- **Professional Reports** including:
  - Configuration summary
  - Overall statistics (all-time)
  - Filtered period statistics (if dates selected)
  - Visual heatmap of cleaning status
  - Complete event log with EB module details
  - Color legend for age buckets
- **Export Ready**: Landscape format for printing/archiving
- **Multiple Heatmaps**: All-history and filtered-period views

### 📤 CSV Import/Export
- **Export Events**: Download all cleaning events as CSV
- **Import Events**: Bulk upload previously saved events
- **Backup**: Create data backups for offline storage
- **Data Migration**: Transfer data between systems

### 🔔 Smart Alerts & Indicators
- **Critical Alerts**: Visual warnings for uncleaned sections (14+ days)
- **Warning Alerts**: Highlight sections needing attention (10+ days)
- **Status Indicators**: Real-time status badges on cards


### 💾 Persistent Data Storage
- **SQLite Database**: Local database with WAL mode for reliability
- **Automatic Persistence**: All events automatically saved
- **Data Recovery**: Configuration backed up in database
- **Transaction Safety**: Proper data integrity with PRAGMA settings


### Future plans
Scheduled DB backup and PDF reports generation 18:00 vessel local time.
2 user levels, admin to add and edit event, user to view.
Edited logic to calculate EB Ranges in the log 

## 🚀 Getting Started

### Prerequisites
- **Node.js** 14.0 or higher
- **npm** 6.0 or higher
- **git** (for cloning the repository)

### Quick Start

```bash
# 1. Navigate to the project directory
cd streamer-maintenance-app

# 2. Install dependencies
npm install

# 3. Start the server
npm start

# 4. Open in browser
# Visit http://localhost:3000
```

The application will:
- Initialize SQLite database automatically
- Load default configuration
- Start listening on port 3000

---

## 📚 Usage Guide

### Daily Workflow

#### 1. **Review Current Status**
- Open the app (http://localhost:3000)
- Check the heatmap for sections needing cleaning
- Review alerts for cables with 14+ day old sections

#### 2. **Log Cleaning Operations**
- Select a cleaning method from the tile options
- Click and drag across the heatmap to mark sections as cleaned
- Review the logged event in the history
- The statistics automatically update

#### 3. **Manual Entry**
- For off-schedule cleanings, use the manual entry form
- Select cable, date, method, and section range
- Submit to add to the log

#### 4. **Review History**
- Sort the cleaning history by any column
- Edit or delete events if needed
- Filter by date range for analysis

#### 5. **Generate Reports**
- Set optional date filter to analyze a period
- Click "Generate PDF Report"
- Share or archive the report

### Configuration

#### Accessing Configuration
1. Scroll to "Configuration" section
2. Click the collapse icon to expand
3. Modify any setting

#### Key Settings

| Setting | Default | Purpose |
|---------|---------|---------|
| Number of Cables | 12 | Total streamers in array |
| Sections per Cable | 107 | Active sensor sections |
| Section Length (m) | 75 | Length of each section for distance calc |
| eBird Frequency | 4 | EB module spacing (every N sections) |
| Use Rope for Tail | true | Use rope (true) or add 5 tails (false) |
| Channels per Section | 6 | Sensor channels per section |

---

## 📄 PDF Report Generation

### Features

The PDF report includes:

1. **Header**: Title, generation date
2. **Configuration**: System configuration at report time
3. **Overall Statistics**: All-time metrics
4. **Filtered Statistics** (optional): Period-specific metrics
5. **All-History Heatmap**: Visual grid of cleaning status
6. **Filtered Heatmap** (optional): Period-specific heatmap
7. **Event Log**: Complete table of all cleaning events

### Report Layout

- **Orientation**: Landscape (A4)
- **Scale**: Optimized for 12 cables × 107 sections
- **Legend**: Color-coded age buckets
- **EB Ranges**: Sensor module locations marked

### Generating Reports

1. Click "Generate PDF Report" button
2. (Optional) Set date filters first for period analysis
3. Report downloads automatically as `streamer-maintenance-report-YYYY-MM-DD.pdf`

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

**Ensure CSV Format**:
```
cable_id,section_index_start,section_index_end,cleaning_method,cleaned_at
cable-0,0,5,rope,2024-01-01T10:00:00Z
```

### Issue: Stats Not Updating

**Solution**: Refresh the page or wait for automatic sync (typically < 1 second)

### Issue: PDF Generation Fails

**Check Console**: Look for jsPDF loading errors
- Ensure internet connection (CDN loading)
- Browser console may show CSP policy violations
- Try disabling browser extensions

---

### Performance Notes

- Database optimized for 12+ cables, 100+ sections
- Heatmap renders in < 500ms on modern browsers
- API responses < 100ms typical
- Handles 10,000+ events efficiently

---

## 📜 License

This project is provided as-is for TGS crews.

---

## 🙏 Acknowledgments

Built for professional managing streamer scraping logging with precision and accountability.

---

**Version**: 1.0.0  
**Last Updated**: January 2026 
**Node.js Required**: 14.0+
**Author**: Maksim Egorov. Ramform Titan, Brazil.

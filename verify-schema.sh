#!/bin/bash
# Quick SQL verification script for schema changes

DB_FILE="backend/streamer.db"

echo "=== Schema Verification for Steps 2 & 3 ==="
echo ""

# Check if database exists
if [ ! -f "$DB_FILE" ]; then
    echo "❌ Database not found at $DB_FILE"
    echo "   Please start the server first to create the database."
    exit 1
fi

echo "✅ Database found"
echo ""

echo "--- 1. Checking cleaning_events table ---"
sqlite3 "$DB_FILE" ".schema cleaning_events" | grep -E "(streamer_id|FOREIGN KEY)" || echo "❌ Schema check failed"
echo ""

echo "--- 2. Checking for streamer_id column (should be INTEGER) ---"
COLUMN_TYPE=$(sqlite3 "$DB_FILE" "PRAGMA table_info(cleaning_events);" | grep streamer_id | cut -d'|' -f3)
if [ "$COLUMN_TYPE" = "INTEGER" ]; then
    echo "✅ streamer_id is INTEGER"
else
    echo "❌ streamer_id is $COLUMN_TYPE (expected INTEGER)"
fi
echo ""

echo "--- 3. Checking for CASCADE foreign key ---"
HAS_CASCADE=$(sqlite3 "$DB_FILE" ".schema cleaning_events" | grep -c "ON DELETE CASCADE")
if [ "$HAS_CASCADE" -gt "0" ]; then
    echo "✅ CASCADE foreign key exists ($HAS_CASCADE found)"
else
    echo "❌ No CASCADE foreign key found"
fi
echo ""

echo "--- 4. Checking streamer_deployments table ---"
sqlite3 "$DB_FILE" ".schema streamer_deployments" | grep -E "streamer_id" || echo "❌ Schema check failed"
echo ""

echo "--- 5. Sample data check (if any events exist) ---"
EVENT_COUNT=$(sqlite3 "$DB_FILE" "SELECT COUNT(*) FROM cleaning_events;")
echo "Events in database: $EVENT_COUNT"
if [ "$EVENT_COUNT" -gt "0" ]; then
    echo "Sample event (first row):"
    sqlite3 "$DB_FILE" "SELECT id, streamer_id, section_index_start, section_index_end, cleaning_method FROM cleaning_events LIMIT 1;"
fi
echo ""

echo "--- 6. Checking for old cable_id column (should NOT exist) ---"
HAS_CABLE_ID=$(sqlite3 "$DB_FILE" "PRAGMA table_info(cleaning_events);" | grep -c "cable_id")
if [ "$HAS_CABLE_ID" -eq "0" ]; then
    echo "✅ No cable_id column found (correct)"
else
    echo "❌ Found cable_id column (should not exist)"
fi
echo ""

echo "=== Verification Complete ==="
echo ""
echo "Expected Results:"
echo "  ✅ streamer_id is INTEGER"
echo "  ✅ CASCADE foreign key exists"
echo "  ✅ No cable_id column"
echo "  ✅ streamer_deployments uses streamer_id"

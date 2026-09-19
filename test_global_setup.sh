#!/usr/bin/env bash
# Automated fix-validate cycle for global setup pip stall.
# Usage: ./test_global_setup.sh
#
# Kills any running uvicorn, does task reset, starts a fresh backend,
# POSTs to trigger global setup, and tails the debug log.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DBG_LOG=/tmp/dbt_ui_pip_debug.log
BACKEND_DIR="$SCRIPT_DIR/backend"
TIMEOUT_SECS=900  # 15 minutes (fresh install takes a while)
API_BASE="http://localhost:8001"

echo "=== test_global_setup.sh ==="

# --- 1. Kill any running uvicorn ---
echo ""
echo ">>> Step 1: killing any existing uvicorn"
pkill -f "uvicorn app.main:app" 2>/dev/null && sleep 2 || true
echo "Clean."

# --- 2. Reset (wipe .venv + db) ---
echo ""
echo ">>> Step 2: task reset"
cd "$SCRIPT_DIR"
task reset

# --- 3. Clear debug log ---
> "$DBG_LOG"
echo "[test] debug log cleared" >> "$DBG_LOG"

# --- 4. Start backend ---
echo ""
echo ">>> Step 3: starting backend"
cd "$BACKEND_DIR"
.venv/bin/uvicorn app.main:app --port 8001 &
UVICORN_PID=$!
echo "uvicorn pid=$UVICORN_PID"

cleanup() {
    echo ""
    echo ">>> Stopping backend (pid=$UVICORN_PID)"
    kill "$UVICORN_PID" 2>/dev/null || true
    wait "$UVICORN_PID" 2>/dev/null || true
}
trap cleanup EXIT

# --- 5. Wait for backend ready ---
echo ""
echo ">>> Step 4: waiting for backend to be ready..."
WAIT_START=$SECONDS
until curl -sf "$API_BASE/api/settings" > /dev/null 2>&1; do
    if (( SECONDS - WAIT_START > 60 )); then
        echo "ERROR: backend did not start within 60s"
        exit 1
    fi
    sleep 1
    echo -n "."
done
echo ""
echo "Backend ready."

# --- 6. Trigger global setup ---
echo ""
echo ">>> Step 5: POST /api/init/global-setup"
RESPONSE=$(curl -sf -X POST "$API_BASE/api/init/global-setup" \
    -H "Content-Type: application/json" \
    -w "\nHTTP_STATUS:%{http_code}" || echo "CURL_FAILED")
echo "Response: $RESPONSE"

# --- 7. Tail debug log ---
echo ""
echo ">>> Step 6: tailing debug log (max ${TIMEOUT_SECS}s)"
echo "Waiting for 'thread: pip exited' or 'thread: EXCEPTION'..."
echo ""

START=$SECONDS
DONE=false
LAST_SIZE=0

while (( SECONDS - START < TIMEOUT_SECS )); do
    if grep -q "thread: pip exited\|thread: EXCEPTION\|finally rc=" "$DBG_LOG" 2>/dev/null; then
        DONE=true
        break
    fi

    # Show new log lines
    CURR_SIZE=$(wc -l < "$DBG_LOG" 2>/dev/null || echo 0)
    if (( CURR_SIZE > LAST_SIZE )); then
        tail -n "+$((LAST_SIZE + 1))" "$DBG_LOG" 2>/dev/null | sed 's/^/  LOG: /'
        LAST_SIZE=$CURR_SIZE
    fi

    ELAPSED=$((SECONDS - START))
    echo "  [${ELAPSED}s elapsed, still waiting...]"
    sleep 10
done

echo ""
echo "=== FINAL DEBUG LOG ==="
cat "$DBG_LOG"
echo ""

# --- 8. Report ---
echo ""
if $DONE; then
    RC_LINE=$(grep "thread: pip exited\|finally rc=" "$DBG_LOG" | tail -1 || echo "no rc line")
    echo "=== RESULT: SUCCESS ($RC_LINE) ==="
    exit 0
else
    echo "=== RESULT: STALLED (no completion after ${TIMEOUT_SECS}s) ==="
    echo ""
    echo "Orphaned pip processes:"
    pgrep -la pip 2>/dev/null || echo "  (none)"
    exit 1
fi

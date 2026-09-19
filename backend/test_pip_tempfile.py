"""Standalone test of the temp-file pip approach.

Run from the backend directory:
  .venv/bin/python test_pip_tempfile.py /path/to/requirements.txt

This completely bypasses FastAPI/asyncio/SSE — just raw subprocess + file tailing.
If this stalls, the issue is in pip itself or the temp-file tailing logic.
If this works, the issue is in our asyncio integration.
"""
import subprocess
import sys
import tempfile
import time
from pathlib import Path

def run(pip: Path, req_path: Path) -> int:
    print(f"[test] pip={pip}", flush=True)
    print(f"[test] req={req_path}", flush=True)

    with tempfile.NamedTemporaryFile(mode='w', suffix='.pip.log', delete=False) as tf:
        log_path = tf.name
    print(f"[test] temp log: {log_path}", flush=True)

    # Open log file for writing, spawn pip with stdout/stderr → file
    with open(log_path, 'wb') as log_f:
        proc = subprocess.Popen(
            [str(pip), "install", "-r", str(req_path),
             "--progress-bar", "off", "--no-input", "-v",
             "--keyring-provider", "disabled"],
            stdout=log_f,
            stderr=log_f,
        )
    print(f"[test] spawned pid={proc.pid}", flush=True)

    # Tail the log file while pip runs
    chunks = 0
    with open(log_path, 'rb') as reader:
        while proc.poll() is None:
            chunk = reader.read(4096)
            if chunk:
                chunks += 1
                sys.stdout.buffer.write(chunk)
                sys.stdout.buffer.flush()
            else:
                time.sleep(0.05)
        print(f"\n[test] pip main process exited, draining remaining output...", flush=True)
        # Drain remaining
        while True:
            chunk = reader.read(4096)
            if not chunk:
                break
            chunks += 1
            sys.stdout.buffer.write(chunk)
            sys.stdout.buffer.flush()

    rc = proc.returncode
    print(f"\n[test] done: rc={rc}, chunks_read={chunks}", flush=True)

    import os
    try:
        os.unlink(log_path)
    except OSError:
        pass

    return rc


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: .venv/bin/python test_pip_tempfile.py /path/to/requirements.txt")
        sys.exit(1)
    req = Path(sys.argv[1])
    pip = Path(sys.argv[0]).parent / ".venv" / "bin" / "pip"
    if not pip.exists():
        # Try relative to script location
        pip = Path(__file__).parent / ".venv" / "bin" / "pip"
    if not pip.exists():
        print(f"Cannot find pip at {pip}")
        sys.exit(1)
    sys.exit(run(pip, req))

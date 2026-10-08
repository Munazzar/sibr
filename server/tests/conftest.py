import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
# Keep a real server/.env access key out of the tests (the .env loader never overrides set vars).
os.environ["SIBR_API_KEY"] = ""
os.environ["SIBR_LOG_FILE"] = ""  # tests never write server/logs

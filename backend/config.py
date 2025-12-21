"""
Configuration and constants for the backend.
"""
import os
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Paths
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
RECORDINGS_DIR = os.path.join(BASE_DIR, "recordings")
os.makedirs(RECORDINGS_DIR, exist_ok=True)

# Server configuration
PORT = int(os.getenv("PORT", 8000))
SECRET_KEY = os.getenv("SECRET_KEY", "dev-secret-change-in-production")

# Deepgram
DEEPGRAM_API_KEY = os.getenv("DEEPGRAM_API_KEY")

# Boot logging
print(f"[BOOT] BASE_DIR={BASE_DIR}")
print(f"[BOOT] RECORDINGS_DIR={RECORDINGS_DIR}")
print(f"[BOOT] PORT={PORT}")
if not DEEPGRAM_API_KEY:
    print("[WARN] DEEPGRAM_API_KEY not found in .env - transcription will not work!")
else:
    print(f"[BOOT] DEEPGRAM_API_KEY loaded (length={len(DEEPGRAM_API_KEY)})")


# Live Transcription Studio

A real-time audio transcription application powered by **Deepgram's Nova-2** speech-to-text API. Record audio from your microphone and see live transcriptions appear instantly.

![Live Transcription Studio](https://img.shields.io/badge/Deepgram-Nova--2-blue) ![React](https://img.shields.io/badge/React-18-61dafb) ![Flask](https://img.shields.io/badge/Flask-SocketIO-green)

## Features

-  **Real-time transcription** - See words appear as you speak
-  **Live recording** - Record audio directly from your browser
-  **Audio playback** - Listen to your recordings after stopping
-  **Auto-save** - Recordings are automatically saved as WebM files
-  **Modern UI** - Dark theme with glassmorphism and smooth animations

## Tech Stack

### Frontend
- **React 18** with Vite
- **Socket.IO Client** for real-time communication
- Modern CSS with custom properties and animations

### Backend
- **Flask** with Flask-SocketIO
- **Eventlet** for async WebSocket support
- **Deepgram SDK** for speech-to-text

## Project Structure

```
realtime-transcription-editor/
├── frontend/                 # React frontend
│   ├── src/
│   │   ├── App.jsx          # Main application component
│   │   ├── App.css          # Component styles
│   │   ├── index.css        # Global styles & design system
│   │   └── main.jsx         # Entry point
│   └── package.json
├── backend/                  # Flask backend
│   ├── app.py               # Main server with Deepgram integration
│   ├── recordings/          # Saved audio files (gitignored)
│   ├── requirements.txt     # Python dependencies
│   └── .env                 # API keys (gitignored)
└── .gitignore
```

## Setup

### Prerequisites
- Node.js 18+
- Python 3.10+
- Deepgram API key ([Get one free](https://console.deepgram.com/signup))

### 1. Clone the repository
```bash
git clone <your-repo-url>
cd realtime-transcription-editor
```

### 2. Backend Setup
```bash
cd backend

# Create virtual environment
python -m venv .venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Create .env file with your Deepgram API key
echo "DEEPGRAM_API_KEY=your_api_key_here" > .env
```

### 3. Frontend Setup
```bash
cd frontend

# Install dependencies
npm install
```

## Running the Application

### Start Backend (Terminal 1)
```bash
cd backend
source .venv/bin/activate
python app.py
```
The backend will start on `http://localhost:8000`

### Start Frontend (Terminal 2)
```bash
cd frontend
npm run dev
```
The frontend will start on `http://localhost:5173`

## Usage

1. Open `http://localhost:5173` in your browser
2. Click **"Start Recording"** to begin
3. Speak into your microphone
4. Watch the live transcription appear in real-time
5. Click **"Stop"** to end the recording
6. Use the audio player to replay your recording

## API Reference

### Socket.IO Events

| Event | Direction | Description |
|-------|-----------|-------------|
| `start_transcription` | Client → Server | Start a new transcription session |
| `audio_chunk` | Client → Server | Send audio data chunk |
| `stop_recording` | Client → Server | Stop recording and save file |
| `finalize_transcription` | Client → Server | End transcription session |
| `transcript_partial` | Server → Client | Partial/final transcript updates |
| `transcript_final` | Server → Client | Final complete transcript |
| `audio_ack` | Server → Client | Acknowledge received audio chunk |
| `recording_saved` | Server → Client | Confirm recording saved |

## Configuration

### Environment Variables

| Variable | Description |
|----------|-------------|
| `DEEPGRAM_API_KEY` | Your Deepgram API key |

### Deepgram Options (in `app.py`)

```python
deepgram.listen.v1.connect(
    model="nova-2",           # Deepgram model
    interim_results=True,     # Enable real-time partials
    punctuate=True,           # Auto-punctuation
    smart_format=True,        # Smart formatting
)
```

## License

MIT

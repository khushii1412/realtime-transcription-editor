"""
Deepgram adapter - handles Deepgram client creation.
"""
from deepgram import DeepgramClient
from config import DEEPGRAM_API_KEY


def create_client():
    """
    Create a new Deepgram client.
    Returns DeepgramClient instance.
    """
    return DeepgramClient()


def is_available():
    """Check if Deepgram is configured."""
    return bool(DEEPGRAM_API_KEY)

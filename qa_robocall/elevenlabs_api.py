import os
import requests

ELEVENLABS_API_KEY = os.getenv("ELEVENLABS_API_KEY") or os.getenv("XI_API_KEY")

BASE_URL = "https://api.elevenlabs.io/v1/convai/conversations"

def get_conversation_detail(conversation_id, api_key=ELEVENLABS_API_KEY):
    """
    Fetch conversation record details from ElevenLabs API.
    """
    url = f"{BASE_URL}/{conversation_id}"
    headers = {"xi-api-key": api_key}
    response = requests.get(url, headers=headers)
    response.raise_for_status()
    return response.json()

def get_conversation_audio(conversation_id, api_key=ELEVENLABS_API_KEY):
    """
    Fetch conversation audio from ElevenLabs API.
    Returns binary audio content.
    """
    url = f"{BASE_URL}/{conversation_id}/audio"
    headers = {"xi-api-key": api_key}
    response = requests.get(url, headers=headers)
    response.raise_for_status()
    return response.content

def format_conversation_for_llm(conv_detail):
    """
    Format the conversation JSON into a list of strings for LLM input.
    Each line: 'Agent: ...' or 'User: ...'
    """
    transcript = conv_detail.get("transcript", [])
    formatted = []
    for turn in transcript:
        role = turn.get("role", "unknown").capitalize()
        message = turn.get("message", "")
        formatted.append(f"{role}: {message}")
    return formatted

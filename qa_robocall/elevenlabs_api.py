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
    Each line: 'Agent [start: Xs, end: Ys]: ...' or 'User [start: Xs, end: Ys]: ...'
    Includes timing information for each speech turn.
    """
    transcript = conv_detail.get("transcript", [])
    call_duration = None
    # Try to get call duration from metadata
    if "metadata" in conv_detail and "call_duration_secs" in conv_detail["metadata"]:
        call_duration = conv_detail["metadata"]["call_duration_secs"]

    formatted = []
    for idx, turn in enumerate(transcript):
        role = turn.get("role", "unknown").capitalize()
        message = turn.get("message", "")
        start = turn.get("time_in_call_secs", None)

        # Try to use LLM timing if available (for agent turns)
        end = None
        metrics = None
        elapsed_time = None
        if "conversation_turn_metrics" in turn and turn["conversation_turn_metrics"]:
            metrics = turn["conversation_turn_metrics"].get("metrics", {})
            if (
                metrics
                and "convai_llm_service_ttf_sentence" in metrics
                and "elapsed_time" in metrics["convai_llm_service_ttf_sentence"]
            ):
                elapsed_time = metrics["convai_llm_service_ttf_sentence"]["elapsed_time"]

        if elapsed_time is not None and start is not None:
            # Use LLM elapsed time for end
            end = round(start + elapsed_time, 3)
        else:
            # Fallback: next turn's start, or call duration for last turn
            if idx + 1 < len(transcript):
                next_start = transcript[idx + 1].get("time_in_call_secs", None)
                end = next_start if next_start is not None else start
            else:
                end = call_duration if call_duration is not None else start

        # Fallback if start is None
        if start is None:
            start = 0
        if end is None:
            end = start
        formatted.append(f"{role} [start: {start}s, end: {end}s]: {message}")
    return formatted

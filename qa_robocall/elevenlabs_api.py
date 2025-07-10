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

def format_conversation_for_llm(ticket_json):
    """
    Format the conversation JSON into a dialogue-like list of strings for LLM input.
    Each message is followed by its time range (mm:ss-mm:ss or mm:ss if start==end).
    Appends [INTERRUPTED] to the time line if the turn was interrupted.
    Blank line between turns.
    """
    def format_time(secs):
        secs = int(round(secs or 0))
        m, s = divmod(secs, 60)
        h, m = divmod(m, 60)
        if h > 0:
            return f"{h}:{m:02d}:{s:02d}"
        else:
            return f"{m}:{s:02d}"

    # Try new structure first
    transcript = []
    call_duration = None

    call_transcription = ticket_json.get("call_transcription", {})
    data = call_transcription.get("data", {})
    transcript = data.get("transcript", [])
    metadata = data.get("metadata", {})
    call_duration = metadata.get("call_duration_secs", None)

    # Fallback: old structure (transcript at top level)
    if not transcript and "transcript" in ticket_json:
        transcript = ticket_json.get("transcript", [])
        metadata = ticket_json.get("metadata", {})
        call_duration = metadata.get("call_duration_secs", None)

    if not transcript:
        return []

    formatted = []
    for idx, turn in enumerate(transcript):
        role = (turn.get("role") or "unknown").capitalize()
        message = turn.get("message", "")
        if message is None or not str(message).strip():
            continue  # Skip empty/null messages
        start = turn.get("time_in_call_secs", None)
        interrupted = turn.get("interrupted", False)

        # End time logic
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
            end = round(start + elapsed_time, 3)
        else:
            if idx + 1 < len(transcript):
                next_start = transcript[idx + 1].get("time_in_call_secs", None)
                end = next_start if next_start is not None else start
            else:
                end = call_duration if call_duration is not None else start

        if start is None:
            start = 0
        if end is None:
            end = start

        t_start = format_time(start)
        t_end = format_time(end)
        if start == end:
            time_str = t_start
        else:
            time_str = f"{t_start}-{t_end}"
        if interrupted:
            time_str += " [INTERRUPTED]"
        # Single line per turn, compact and LLM-friendly
        formatted.append(f"[{role} {time_str}]: {message}")
    return formatted

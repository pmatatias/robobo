import os

def transcribe_audio_google(audio_path, language_code="id-ID", enable_word_time_offsets=True, enable_speaker_diarization=True, sample_rate_hertz=16000):
    """
    Transcribe an audio file using Google Speech-to-Text API.

    Args:
        audio_path (str): Path to the audio file (must be .wav, .flac, or .mp3).
        language_code (str): Language code for transcription (default: "id-ID" for Indonesian).
        enable_word_time_offsets (bool): Whether to include word-level timestamps.
        enable_speaker_diarization (bool): Whether to enable speaker diarization.
        sample_rate_hertz (int): Sample rate of the audio file.

    Returns:
        dict: {
            "transcript": str,
            "words": list of dicts (word, start_time, end_time, speaker_tag if diarization enabled)
        }
    """
    from google.cloud import speech_v1p1beta1 as speech

    client = speech.SpeechClient()

    # Read audio file
    with open(audio_path, "rb") as audio_file:
        content = audio_file.read()

    audio = speech.RecognitionAudio(content=content)
    diarization_config = speech.SpeakerDiarizationConfig(
        enable_speaker_diarization=enable_speaker_diarization,
        min_speaker_count=2,
        max_speaker_count=2
    ) if enable_speaker_diarization else None

    config = speech.RecognitionConfig(
        encoding=speech.RecognitionConfig.AudioEncoding.LINEAR16 if audio_path.endswith(".wav") else speech.RecognitionConfig.AudioEncoding.MP3,
        sample_rate_hertz=sample_rate_hertz,
        language_code=language_code,
        enable_word_time_offsets=enable_word_time_offsets,
        enable_automatic_punctuation=True,
        diarization_config=diarization_config
    )

    response = client.recognize(config=config, audio=audio)

    transcript = ""
    words = []
    for result in response.results:
        alternative = result.alternatives[0]
        transcript += alternative.transcript + " "
        for word_info in alternative.words:
            word_dict = {
                "word": word_info.word,
                "start_time": word_info.start_time.total_seconds(),
                "end_time": word_info.end_time.total_seconds()
            }
            if enable_speaker_diarization and hasattr(word_info, "speaker_tag"):
                word_dict["speaker_tag"] = word_info.speaker_tag
            words.append(word_dict)

    return {
        "transcript": transcript.strip(),
        "words": words
    }

def transcribe_audio_assemblyai(audio_path, api_key, language_code="id"):
    """
    Transcribe audio using AssemblyAI Python SDK with word-level timestamps, speaker diarization, and emotion/tone analysis.

    Args:
        audio_path (str): Path to the audio file (wav, mp3, m4a, etc.)
        api_key (str): Your AssemblyAI API key
        language_code (str): Language code for transcription (default: "id" for Indonesian)

    Returns:
        transcript: AssemblyAI transcript object with .text, .utterances, .words, .sentiment_analysis, .emotions, etc.
    """
    import assemblyai as aai

    aai.settings.api_key = api_key

    config = aai.TranscriptionConfig(
        speaker_labels=True,
        sentiment_analysis=True,
        emotion_detection=True,
        word_timestamps=True,
        language_code=language_code,
        punctuate=True,
        format_text=True
    )

    transcriber = aai.Transcriber()
    transcript = transcriber.transcribe(audio_path, config=config)
    return transcript

# Example usage:
# result_google = transcribe_audio_google("path/to/audio.wav")
# print(result_google["transcript"])
# print(result_google["words"])
#
# api_key = "YOUR_ASSEMBLYAI_API_KEY"
# result_assembly = transcribe_audio_assemblyai("path/to/audio.wav", api_key)
# print(result_assembly["text"])
# print(result_assembly["words"])  # List of dicts with word, start, end, speaker, etc.
# print(result_assembly.get("sentiment_analysis_results"))
# print(result_assembly.get("emotions"))

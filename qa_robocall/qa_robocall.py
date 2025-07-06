import os
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

from langchain_openai import ChatOpenAI

import json
from elevenlabs_api import format_conversation_for_llm

# Load transcript from dummy/convai_detail.json and format for LLM
import pathlib

dummy_path = pathlib.Path(__file__).parent / "dummy" / "convai_detail.json"
with open(dummy_path, "r", encoding="utf-8") as f:
    convai_data = json.load(f)
transcript = format_conversation_for_llm(convai_data)

# Load scorecard prompt
qa_prompt_path = pathlib.Path(__file__).parent / "qa_prompt.md"
with open(qa_prompt_path, "r", encoding="utf-8") as f:
    qa_prompt = f.read()

def evaluate_with_llm(transcript, qa_prompt):
    llm = ChatOpenAI(model="gpt-4.1", temperature=0.7)
    transcript_text = "\n".join(transcript)
    prompt = qa_prompt + f"\n\nTranscript:\n{transcript_text}\n"
    response = llm.invoke(prompt)
    # print(f"\n[DEBUG] LLM response:\n{response}\n")
    return response

from elevenlabs_api import get_conversation_detail, get_conversation_audio

if __name__ == "__main__":
    # Example: fetch conversation detail and audio from ElevenLabs API
    conversation_id = "your_conversation_id"  # Replace with actual ID

    # try:
    #     conv_detail = get_conversation_detail(conversation_id)
    #     print("Conversation Detail:", conv_detail)
    #     audio_data = get_conversation_audio(conversation_id)
    #     audio_path = f"{conversation_id}.mp3"
    #     with open(audio_path, "wb") as f:
    #         f.write(audio_data)
    #     print(f"Audio saved as {audio_path}")
    # except Exception as e:
    # #     print("Error fetching conversation data:", e)
    # print(transcript)
    result = evaluate_with_llm(transcript, qa_prompt)
    # print("QA Evaluation Results (LLM):")
    # print(result)

    # Example usage:
    import datetime

    def save_json_result(data, directory="records"):
        import os
        os.makedirs(directory, exist_ok=True)
        timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"llm_result_{timestamp}.json"
        filepath = os.path.join(directory, filename)
        with open(filepath, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        print(f"LLM result saved to {filepath}")

    try:
        # Handle AIMessage object with 'content' attribute
        result_content = result.content if hasattr(result, "content") else result
        if isinstance(result_content, dict):
            parsed = result_content
        else:
            print("[DEBUG] result_content before json.loads:", repr(result_content))
            # Remove Markdown code block if present
            if result_content.strip().startswith("```"):
                lines = result_content.strip().splitlines()
                # Remove the first line (```json or ```) and the last line (```)
                if lines[0].startswith("```") and lines[-1].startswith("```"):
                    result_content = "\n".join(lines[1:-1])
            parsed = json.loads(result_content)
        # Calculate total score with zero tolerance check
        if parsed.get("zero_tolerance_flag"):
            total_score = 0
            print("Zero Tolerance violation detected. Total Score set to 0.")
        else:
            total_score = sum(item["weight"] for item in parsed.get("results", []) if item.get("answer") == "YES")
            print(f"Total Score: {total_score}")
        save_json_result(parsed)
    except Exception as e:
        print("Error calculating total score:", e)

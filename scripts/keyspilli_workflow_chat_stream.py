import json
from typing import TypedDict


class FunctionParts(TypedDict):
    name: str
    arguments: str


class CallParts(TypedDict):
    id: str
    type: str
    function: FunctionParts


def parse_chat_stream(raw: bytes) -> dict[str, object]:
    if len(raw) > 2 * 1024 * 1024: raise ValueError("stream exceeds 2 MiB")
    model: str | None = None
    content, reasoning = "", ""
    calls: dict[int, CallParts] = {}
    usage: dict[str, object] | None = None
    finished = done = False
    for block in raw.decode("utf-8").replace("\r\n", "\n").split("\n\n"):
        lines = [line[5:].lstrip() for line in block.splitlines() if line.startswith("data:")]
        if not lines: continue
        if done: raise ValueError("stream continues after DONE")
        data = "\n".join(lines)
        if data == "[DONE]": done = True; continue
        chunk = json.loads(data)
        if not isinstance(chunk, dict): raise ValueError("stream event must be an object")
        current = chunk.get("model")
        if current is not None:
            if not isinstance(current, str) or not current or model is not None and current != model:
                raise ValueError("stream model changed or is invalid")
            model = current
        reported_usage = chunk.get("usage")
        if reported_usage is not None:
            if not isinstance(reported_usage, dict) or usage is not None: raise ValueError("stream usage must appear once as an object")
            usage = reported_usage
        choices = chunk.get("choices")
        if not isinstance(choices, list) or len(choices) > 1: raise ValueError("stream choices must contain at most one object")
        if not choices:
            if reported_usage is None: raise ValueError("empty stream event lacks usage")
            continue
        if finished: raise ValueError("stream content continues after completion")
        choice = choices[0]
        if not isinstance(choice, dict) or type(choice.get("index")) is not int or choice["index"] != 0:
            raise ValueError("stream choice index must be zero")
        delta = choice.get("delta")
        if not isinstance(delta, dict): raise ValueError("stream delta must be an object")
        if delta.get("role") not in (None, "assistant"): raise ValueError("stream role must be assistant")
        for key in ("content", "reasoning_content"):
            value = delta.get(key)
            if value is not None:
                if not isinstance(value, str): raise ValueError("stream text must be a string")
                if key == "content": content += value
                else: reasoning += value
        fragments = delta.get("tool_calls")
        if fragments is not None:
            if not isinstance(fragments, list): raise ValueError("stream tool calls must be a list")
            for fragment in fragments:
                if not isinstance(fragment, dict): raise ValueError("stream tool fragment must be an object")
                index = fragment.get("index")
                if type(index) is not int or not 0 <= index < 24: raise ValueError("stream tool index exceeds bound")
                call = calls.setdefault(index, {"id": "", "type": "function", "function": {"name": "", "arguments": ""}})
                identity = fragment.get("id")
                if identity is not None:
                    if not isinstance(identity, str) or not identity or call["id"] and call["id"] != identity:
                        raise ValueError("stream tool identity changed")
                    call["id"] = identity
                if fragment.get("type") not in (None, "function"): raise ValueError("unsupported stream tool type")
                function = fragment.get("function")
                if function is not None:
                    if not isinstance(function, dict): raise ValueError("stream function must be an object")
                    for key in ("name", "arguments"):
                        value = function.get(key)
                        if value is not None:
                            if not isinstance(value, str): raise ValueError("stream function fragment must be a string")
                            call["function"][key] += value
        finish = choice.get("finish_reason")
        if finish is not None:
            if finish not in ("stop", "tool_calls"): raise ValueError("stream completion is truncated or unsupported")
            finished = True
    if not done or not finished or model is None: raise ValueError("stream did not complete")
    if set(calls) != set(range(len(calls))) or any(not call["id"] or not call["function"]["name"] for call in calls.values()):
        raise ValueError("stream tool inventory is incomplete")
    message: dict[str, object] = {"role": "assistant", "content": content or None}
    if reasoning: message["reasoning_content"] = reasoning
    if calls: message["tool_calls"] = [calls[index] for index in range(len(calls))]
    return {"model": model, "choices": [{"message": message}], "usage": usage}

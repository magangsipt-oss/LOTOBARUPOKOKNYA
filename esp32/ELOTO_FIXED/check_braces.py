from pathlib import Path
import sys

source = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).with_name("ELOTO_FIXED.ino")
text = source.read_text(encoding="utf-8", errors="strict")

balance = 0
line = 1
state = "code"
escape = False
i = 0
while i < len(text):
    char = text[i]
    following = text[i + 1] if i + 1 < len(text) else ""
    if char == "\n":
        line += 1
        if state == "line-comment":
            state = "code"
    elif state == "code":
        if char == "/" and following == "/":
            state = "line-comment"
            i += 1
        elif char == "/" and following == "*":
            state = "block-comment"
            i += 1
        elif char == '"':
            state = "string"
        elif char == "'":
            state = "character"
        elif char == "{":
            balance += 1
        elif char == "}":
            balance -= 1
            if balance < 0:
                raise SystemExit(f"Unexpected closing brace at line {line}")
    elif state == "block-comment" and char == "*" and following == "/":
        state = "code"
        i += 1
    elif state in {"string", "character"}:
        if escape:
            escape = False
        elif char == "\\":
            escape = True
        elif (state == "string" and char == '"') or (state == "character" and char == "'"):
            state = "code"
    i += 1

if state == "block-comment":
    raise SystemExit("Unclosed block comment")
if balance:
    raise SystemExit(f"Unbalanced braces: {balance:+d}")
print(f"Brace check passed: {source}")

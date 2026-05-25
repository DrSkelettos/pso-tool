"""
Checkbox import script.
Scans import/import.png for pixels of a given color and exports
checkbox field definitions as JSON.
"""

from PIL import Image
import json
import os

# ── Constants ─────────────────────────────────────────────────────────────────
PAGE        = 1
QUESTION_ID = "2"
COLOR       = (178, 0, 255)   # RGB target color
WIDTH       = 36
HEIGHT      = 36
# Optional: allow slight color deviation (0 = exact match)
TOLERANCE   = 0
# ──────────────────────────────────────────────────────────────────────────────

ALPHABET = "abcdefghijklmnopqrstuvwxyz"

def color_matches(pixel, target, tolerance):
    return all(abs(int(pixel[i]) - int(target[i])) <= tolerance for i in range(3))

def main():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    image_path = os.path.join(script_dir, "import.png")

    img = Image.open(image_path).convert("RGB")
    pixels = img.load()
    w, h = img.size

    # Collect all matching pixel coordinates
    matches = []
    for y in range(h):
        for x in range(w):
            if color_matches(pixels[x, y], COLOR, TOLERANCE):
                matches.append((x, y))

    if not matches:
        print("No matching pixels found.")
        return

    # Group by y value → rows
    rows_dict = {}
    for x, y in matches:
        rows_dict.setdefault(y, []).append(x)

    # Sort rows by y, columns by x within each row
    sorted_ys = sorted(rows_dict.keys())

    fields = []
    for row_idx, y in enumerate(sorted_ys):
        row_letter = ALPHABET[row_idx]
        sorted_xs = sorted(rows_dict[y])
        for col_idx, x in enumerate(sorted_xs):
            field_id = f"{QUESTION_ID}_{row_letter}_{col_idx}"
            fields.append({
                "id":     field_id,
                "page":   PAGE,
                "x":      x,
                "y":      y,
                "width":  WIDTH,
                "height": HEIGHT,
            })

    output_path = os.path.join(script_dir, "output.json")
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(fields, f, indent=2)

    print(f"Exported {len(fields)} field(s) to {output_path}")

if __name__ == "__main__":
    main()

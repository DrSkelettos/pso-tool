"""
Checkbox import script.
Scans import/import.png for pixels of a given color and exports
checkbox field definitions as JSON.
"""

from PIL import Image
import json
import os

# ── Constants ─────────────────────────────────────────────────────────────────
PAGE        = 2
QUESTION_ID = "3"
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

    # Group by y value → rows (with ±10 px tolerance)
    rows_dict = {}
    for x, y in matches:
        matched_key = None
        for key in rows_dict:
            if abs(y - key) <= 10:
                matched_key = key
                break
        if matched_key is None:
            rows_dict[y] = []
            matched_key = y
        rows_dict[matched_key].append((x, y))

    # Sort rows by representative y, columns by x within each row
    sorted_ys = sorted(rows_dict.keys())

    fields = []
    for row_idx, key_y in enumerate(sorted_ys):
        row_letter = ALPHABET[row_idx]
        # Use the average y of all pixels in the row as the field y
        pts = rows_dict[key_y]
        avg_y = round(sum(p[1] for p in pts) / len(pts))
        sorted_xs = sorted(p[0] for p in pts)
        for col_idx, x in enumerate(sorted_xs):
            field_id = f"{QUESTION_ID}_{row_letter}_{col_idx}"
            fields.append({
                "id":     field_id,
                "page":   PAGE,
                "x":      x,
                "y":      avg_y,
                "width":  WIDTH,
                "height": HEIGHT,
            })

    output_path = os.path.join(script_dir, "output.json")
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(fields, f, indent=2)

    print(f"Exported {len(fields)} field(s) to {output_path}")

if __name__ == "__main__":
    main()

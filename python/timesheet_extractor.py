"""Extract every field (header info, daily table rows, signature block) from a
timesheet PDF or Excel file.

Usage:
    python timesheet_extractor.py <file.pdf|file.xlsx> [output.json]

Why this isn't a one-liner: some Thai timesheet PDFs (broken/subset CID
fonts) reorder combining vowel marks and scramble reading order when text is
pulled out block-by-block, and "label" / "value" text often live in separate
text objects that share a visual row but are far apart in the PDF's internal
stream order. This script:
  1. Rebuilds each PDF table cell's text from its own bounding box (avoids
     vowel/tone-mark reordering bugs in the library's built-in cell text).
  2. Reconstructs "logical lines" from raw text spans (each grouped the way
     they visually render), then pairs label lines (e.g. "ชื่อบริษัท:") with
     the nearest value line to their right on the same row - recovering
     header fields whose label/value are separate text objects.
  3. Detects the signature/approval row inside the table (พนักงาน / หัวหน้า
     งาน / ผู้จัดการ, etc.) and parses it the same way, instead of leaving it
     as one unstructured blob.
Anything that can't be confidently paired to a label is kept in
"unlabeled_text" rather than silently dropped.
"""
import json
import re
import sys
from pathlib import Path

import pandas as pd
import pymupdf

# Known broken CID->Unicode substitutions seen in real-world Thai timesheet
# PDFs. Extend this if a new file surfaces a new bad code point.
CHAR_FIXES = {
    "ѷ": "่",  # substituted for Thai MAI EK (่) in some subset fonts
}

# Some fonts drop combining marks from specific labels; these are never
# valid standalone Thai words, so it's safe to normalize them.
LABEL_NORMALIZE = {
    "วันที": "วันที่",
    "เวลาที": "เวลาที่",
}

SIGNATURE_HINTS = ("พนักงาน", "หัวหน้างาน", "ผู้จัดการ", "ผู้อนุมัติ", "ลงชื่อ")

# Header labels that don't end in ':' in this template but are still labels,
# not values (their value sits to the right on the same row).
EXTRA_LABEL_WORDS = {"ไซต์", "แผนก", "สังกัด", "หน่วยงาน"}

# "Key: Value" already sitting together on one visual line (e.g. plain
# English-style forms). Only matches when something follows the colon, so a
# bare "label:" line (value elsewhere on the page) falls through to
# position-based pairing instead.
INLINE_FIELD_PATTERN = re.compile(r"^\s*([A-Za-zก-๙0-9 /_-]+?)\s*[:：]\s*(.+)$")


def fix_chars(text: str) -> str:
    for bad, good in CHAR_FIXES.items():
        text = text.replace(bad, good)
    return text.strip()


def is_label(text: str) -> bool:
    stripped = text.strip()
    return (
        stripped.endswith((":", "："))
        or stripped in LABEL_NORMALIZE
        or stripped in SIGNATURE_HINTS
        or stripped in EXTRA_LABEL_WORDS
    )


def normalize_label(text: str) -> str:
    key = text.rstrip(": ：").strip()
    return LABEL_NORMALIZE.get(key, key)


def y_overlap(a: tuple, b: tuple) -> float:
    top = max(a[1], b[1])
    bot = min(a[3], b[3])
    return max(0.0, bot - top)


def reconstruct_span_text(span: dict) -> str:
    """สร้างข้อความของ span จากตำแหน่งตัวอักษรจริง (rawdict's "chars") แทรกช่องว่างตรงช่องว่างที่กว้าง
    ผิดปกติเมื่อเทียบกับช่องว่างปกติของตัวอักษรข้างเคียงใน span เดียวกัน

    ทำไมต้องทำแบบนี้: บางฟอนต์ในฟอร์ม Timesheet (เจอจริงกับฟอร์ม Big-C) เว้นวรรคระหว่างคำด้วยการขยับ
    ตำแหน่ง glyph เฉยๆ ไม่มีอักขระเว้นวรรค (U+0020) แทรกอยู่จริงในสตรีมของ PDF เลย เช่นชื่อ-สกุล
    "สยาม แสงทอง" ถูกเข้ารหัสเป็น span เดียว 10 ตัวอักษรที่ช่องว่างระหว่างตัวอักษรเกือบทุกคู่แคบมาก
    (~0.00-0.08pt) ยกเว้นระหว่าง "ม" กับ "แ" ที่ห่างถึง ~1.9pt — ถ้าอ่าน span["text"] ตรงๆ (ใช้ได้กับ
    เกือบทุกฟอนต์อื่น) จะได้ "สยามแสงทอง" ติดกันเป็นคำเดียวที่ไม่มีในภาษาไทยจริง อ่านชื่อผิด/แยกคำไม่ออก
    """
    chars = span.get("chars")
    if not chars:
        return span.get("text", "")

    widths = [c["bbox"][2] - c["bbox"][0] for c in chars if c["bbox"][2] > c["bbox"][0]]
    avg_width = sum(widths) / len(widths) if widths else 0.0
    threshold = max(1.0, avg_width * 0.35)

    out = [chars[0]["c"]]
    prev_x1 = chars[0]["bbox"][2]
    for c in chars[1:]:
        gap = c["bbox"][0] - prev_x1
        if gap > threshold and c["c"] != " " and out[-1] != " ":
            out.append(" ")
        out.append(c["c"])
        prev_x1 = c["bbox"][2]
    return "".join(out)


def extract_cell_text(page, bbox) -> str:
    """เหมือน page.get_text('text', clip=bbox) แต่แทรกช่องว่างที่ reconstruct_span_text() กู้คืนมาได้
    (ตารางรายวัน โดยเฉพาะคอลัมน์รายละเอียดงาน/หมายเหตุ เจอปัญหาคำติดกันแบบเดียวกับชื่อ-สกุลในหัวเอกสาร)
    หลายบรรทัดในเซลล์เดียวต่อกันด้วยช่องว่างเหมือนพฤติกรรมเดิมที่ .replace("\\n", " ") เคยทำ"""
    d = page.get_text("rawdict", clip=pymupdf.Rect(bbox))
    line_texts = []
    for block in d["blocks"]:
        for line in block.get("lines", []):
            spans = line.get("spans", [])
            if not spans:
                continue
            line_texts.append("".join(reconstruct_span_text(s) for s in spans))
    return fix_chars(" ".join(t for t in line_texts if t.strip()))


def build_logical_lines(page, clip=None) -> list[dict]:
    """Group text spans the way PyMuPDF's layout engine renders them (fixes within-line
    character reordering), keeping each line's bounding box. Uses "rawdict" (per-character
    boxes) rather than "dict" so reconstruct_span_text() can recover word gaps that some
    fonts encode as glyph positioning only (see its docstring)."""
    d = page.get_text("rawdict", clip=clip) if clip else page.get_text("rawdict")
    lines = []
    for block in d["blocks"]:
        for line in block.get("lines", []):
            spans = line.get("spans", [])
            if not spans:
                continue
            text = fix_chars("".join(reconstruct_span_text(s) for s in spans))
            if not text.strip():
                continue
            x0 = min(s["bbox"][0] for s in spans)
            y0 = min(s["bbox"][1] for s in spans)
            x1 = max(s["bbox"][2] for s in spans)
            y1 = max(s["bbox"][3] for s in spans)
            lines.append({"text": text, "bbox": (x0, y0, x1, y1)})
    return lines


def pair_label_value(lines: list[dict], max_gap: float = 250.0) -> tuple[dict, list[str]]:
    """Pair each label line with the nearest value line to its right on the same row."""
    labels = [l for l in lines if is_label(l["text"])]
    values = [l for l in lines if not is_label(l["text"])]
    used = set()
    fields = {}
    for label in labels:
        lx1 = label["bbox"][2]
        best, best_gap = None, None
        for i, val in enumerate(values):
            if i in used:
                continue
            vx0 = val["bbox"][0]
            if vx0 < lx1 or y_overlap(label["bbox"], val["bbox"]) <= 0:
                continue
            gap = vx0 - lx1
            if gap <= max_gap and (best_gap is None or gap < best_gap):
                best, best_gap = i, gap
        key = normalize_label(label["text"])
        fields[key] = values[best]["text"].strip() if best is not None else ""
        if best is not None:
            used.add(best)
    unlabeled = [v["text"] for i, v in enumerate(values) if i not in used]
    return fields, unlabeled


def group_into_rows(lines: list[dict], y_tol: float = 4.0) -> list[list[dict]]:
    """Cluster lines into visual rows so repeated labels (e.g. three 'วันที่'
    fields in a signature block) get paired independently instead of
    colliding on one flat dict key."""
    def mid_y(l):
        return (l["bbox"][1] + l["bbox"][3]) / 2

    rows: list[list[dict]] = []
    for line in sorted(lines, key=lambda l: (l["bbox"][1], l["bbox"][0])):
        for row in rows:
            if abs(mid_y(row[0]) - mid_y(line)) <= y_tol:
                row.append(line)
                break
        else:
            rows.append([line])
    for row in rows:
        row.sort(key=lambda l: l["bbox"][0])
    return rows


def extract_fields(lines: list[dict], max_gap: float = 250.0) -> tuple[dict, list[str]]:
    """Combine inline 'Key: Value' lines with position-paired split label/value lines."""
    inline_fields = {}
    remaining = []
    for l in lines:
        m = INLINE_FIELD_PATTERN.match(l["text"])
        if m and m.group(2).strip():
            inline_fields[m.group(1).strip()] = m.group(2).strip()
        else:
            remaining.append(l)
    positional_fields, unlabeled = pair_label_value(remaining, max_gap=max_gap)
    return {**inline_fields, **positional_fields}, unlabeled


# ---------------------------------------------------------------------------
# Mapping the raw, positionally-extracted fields onto a fixed target schema
# (document header / per-day detail rows / computed summary). Source PDFs
# vary in which fields they include and what they call them, so this is a
# best-effort mapping: anything recognized lands in the named schema field,
# anything else is preserved under "raw" / "unmapped_columns" instead of
# being silently dropped.
# ---------------------------------------------------------------------------

HEADER_SCHEMA_KEYS = [
    "vendorName", "clientName", "projectName", "employeeName", "employeeId",
    "position", "role", "department", "monthYear", "reportingPeriod",
    "supervisorName", "approverName", "site", "projectTeam",
]

DETAIL_SCHEMA_KEYS = [
    "rowNumber", "date", "day", "project", "site", "workLocation", "workType",
    "timeIn", "timeOut", "breakHours", "otTimeIn", "otTimeOut", "otBreakHours",
    "normalHours", "otHours", "totalHours", "additionalHours", "jobDescription",
    "activity", "leaveType", "leaveDays", "remarks",
]

SUMMARY_SCHEMA_KEYS = ["totalWorkDays", "totalLeaveDays", "totalHours"]

# label text (as produced by extract_fields, colon stripped) -> schema key
HEADER_LABEL_MAP = {
    "ชื่อบริษัท": "vendorName",
    "ชื่อบริษัทผู้ให้บริการ": "vendorName",
    "ชื่อลูกค้า": "clientName",
    "ชื่อโครงการ": "projectName",
    "ชื่อ-สกุล": "employeeName",
    "ชื่อพนักงาน": "employeeName",
    "รหัสพนักงาน": "employeeId",
    "ตำแหน่ง": "position",
    "บทบาท": "role",
    "แผนก": "department",
    "สังกัด": "department",
    "แผนก/สังกัด": "department",
    "เดือน/ปี": "monthYear",
    "เดือนปี": "monthYear",
    "ช่วงวันที่ของรอบ": "reportingPeriod",
    "ชื่อหัวหน้างาน": "supervisorName",
    "ชื่อผู้อนุมัติ": "approverName",
    "ไซต์": "site",
    "สถานที่ปฏิบัติงาน": "site",
    "ทีมโครงการ": "projectTeam",
    # English forms (e.g. the generated sample timesheet)
    "name": "employeeName",
    "employee id": "employeeId",
    "department": "department",
    "month": "monthYear",
}

# Labels found in the signature/approval block map to the same header fields
# (name confirms/backfills the header value; never overwrites it).
SIGNATURE_LABEL_MAP = {
    "พนักงาน": "employeeName",
    "หัวหน้างาน": "supervisorName",
    "ผู้จัดการ": "approverName",
    "ผู้อนุมัติ": "approverName",
}

# (keywords that must ALL appear in a column's combined header text, schema key)
# checked in order; first full match wins.
COLUMN_KEYWORD_RULES = [
    (("เวลาที่ใช้", "ปกติ"), "normalHours"),
    (("เวลาที่ใช้", "ล่วงเวลา"), "otHours"),
    (("เวลาที่ใช้", "รวม"), "totalHours"),
    (("ปกติ", "เวลาเข้า"), "timeIn"),
    (("ปกติ", "เวลาออก"), "timeOut"),
    (("ปกติ", "พัก"), "breakHours"),
    (("ล่วงเวลา", "เวลาเข้า"), "otTimeIn"),
    (("ล่วงเวลา", "เวลาออก"), "otTimeOut"),
    (("ล่วงเวลา", "พัก"), "otBreakHours"),
    (("รายละเอียด",), "jobDescription"),
    (("หมายเหตุ",), "remarks"),
    (("กิจกรรม",), "activity"),
    (("โครงการ",), "project"),
    (("สถานที่",), "site"),
    (("ประเภทการลา",), "leaveType"),
    (("จำนวนวันลา",), "leaveDays"),
    (("รูปแบบการทำงาน",), "workLocation"),
    (("ประเภทของวัน",), "workType"),
    (("แมนเดย์",), "additionalHours"),
    (("วันที่",), "date"),
    (("วัน",), "day"),
    (("time in",), "timeIn"),
    (("time out",), "timeOut"),
    (("break",), "breakHours"),
    (("total hours",), "totalHours"),
    (("remarks",), "remarks"),
    (("date",), "date"),
    (("day",), "day"),
]

DATE_PATTERNS = [
    re.compile(r"^\d{1,2}\s*[/\-]?\s*[A-Za-zก-๙\.]{2,10}\s*[/\-]?\s*\d{2,4}$"),
    re.compile(r"^\d{1,2}[/\-]\d{1,2}[/\-]\d{2,4}$"),
    re.compile(r"^\d{4}-\d{2}-\d{2}$"),
]


def looks_like_date(text: str) -> bool:
    text = text.strip()
    return bool(text) and any(p.match(text) for p in DATE_PATTERNS)


def to_float(text: str):
    try:
        return float(text.strip())
    except (ValueError, AttributeError):
        return None


def fill_row_leftward(row: list[str], num_cols: int) -> list[str]:
    """Simulate merged/spanned header cells: a blank cell inherits the
    nearest non-blank cell to its left in the same row."""
    filled, last = [], ""
    for i in range(num_cols):
        cell = row[i].strip() if i < len(row) else ""
        if cell:
            last = cell
        filled.append(last)
    return filled


def detect_columns(header_rows: list[list[str]]) -> dict:
    """Map column index -> schema detail key by reading the (possibly
    multi-row, merged-cell) table header text."""
    if not header_rows:
        return {}
    num_cols = max(len(r) for r in header_rows)
    filled_rows = [fill_row_leftward(row, num_cols) for row in header_rows]
    combined = []
    for i in range(num_cols):
        parts = []
        for filled in filled_rows:
            v = filled[i]
            if v and (not parts or parts[-1] != v):
                parts.append(v)
        combined.append(" ".join(parts))

    col_map, seen_date_col = {}, None
    for i, label in enumerate(combined):
        label_l = label.lower()
        for keywords, key in COLUMN_KEYWORD_RULES:
            if all(kw.lower() in label_l for kw in keywords):
                if key == "date" and seen_date_col is not None:
                    key = "day"
                if key == "date":
                    seen_date_col = i
                col_map[i] = key
                break
    return col_map


def split_table_rows(table_rows: list[list[str]]) -> tuple[list[list[str]], list[list[str]], list[str] | None]:
    """Split a table's raw rows into (header_rows, data_rows, totals_row).
    The first row containing a date-like cell starts the data section; the
    first later row that stops looking date-like ends it (treated as a
    grand-total row, if any)."""
    first_data_idx = None
    for i, row in enumerate(table_rows):
        if any(looks_like_date(c) for c in row):
            first_data_idx = i
            break
    if first_data_idx is None:
        return table_rows, [], None

    header_rows = table_rows[:first_data_idx]
    data_rows, totals_row = [], None
    for row in table_rows[first_data_idx:]:
        if any(looks_like_date(c) for c in row):
            data_rows.append(row)
        elif totals_row is None and any(c.strip() for c in row):
            totals_row = row
    return header_rows, data_rows, totals_row


def build_details(table_rows: list[list[str]]) -> tuple[list[dict], dict]:
    header_rows, data_rows, totals_row = split_table_rows(table_rows)
    col_map = detect_columns(header_rows)
    mapped_cols = set(col_map.values())

    details = []
    for row_number, row in enumerate(data_rows, start=1):
        record = {key: None for key in DETAIL_SCHEMA_KEYS}
        record["rowNumber"] = row_number
        extra = {}
        for i, cell in enumerate(row):
            cell = cell.strip()
            key = col_map.get(i)
            if key in DETAIL_SCHEMA_KEYS:
                record[key] = cell if cell else None
            elif cell:
                extra[f"column_{i}"] = cell
        if extra:
            record["_unmapped_columns"] = extra
        details.append(record)

    total_row_info = {}
    if totals_row is not None:
        total_row_info = {f"column_{i}": c for i, c in enumerate(totals_row) if c.strip()}

    return details, {"header_rows": header_rows, "totals_row": total_row_info, "mapped_columns": sorted(mapped_cols)}


def build_header(header_fields: dict, signature_rows: list[dict]) -> dict:
    header = {key: None for key in HEADER_SCHEMA_KEYS}
    unmapped = {}
    for label, value in header_fields.items():
        key = HEADER_LABEL_MAP.get(label) or HEADER_LABEL_MAP.get(label.lower())
        if key:
            if not header.get(key):
                header[key] = value or None
        elif value:
            unmapped[label] = value

    for sig in signature_rows:
        for label, value in sig.items():
            key = SIGNATURE_LABEL_MAP.get(label)
            if key and not header.get(key) and value:
                header[key] = value

    return header, unmapped


def build_summary(details: list[dict], totals_row: dict) -> dict:
    total_hours_values = [to_float(d["totalHours"]) for d in details if to_float(d["totalHours"]) is not None]
    leave_days_values = [to_float(d["leaveDays"]) for d in details if to_float(d["leaveDays"]) is not None]

    summary = {
        "totalWorkDays": sum(1 for v in total_hours_values if v > 0),
        "totalLeaveDays": sum(leave_days_values) if leave_days_values else 0,
        "totalHours": round(sum(total_hours_values), 2) if total_hours_values else 0,
    }
    return summary


def extract_page(page) -> dict:
    all_lines = build_logical_lines(page)
    tables = page.find_tables()

    table_top = min((t.bbox[1] for t in tables.tables), default=None)
    header_lines = [l for l in all_lines if table_top is None or l["bbox"][3] <= table_top]
    header_fields: dict = {}
    header_unlabeled: list[str] = []
    for row in group_into_rows(header_lines):
        fields, unlabeled = extract_fields(row)
        header_fields.update(fields)
        header_unlabeled.extend(unlabeled)

    table_rows: list[list[str]] = []
    signature_rows: list[dict] = []
    signature_unlabeled: list[str] = []

    for table in tables.tables:
        for row in table.rows:
            cells = []
            for bbox in row.cells:
                if bbox is None:
                    cells.append("")
                    continue
                cells.append(extract_cell_text(page, bbox))

            row_blob = " ".join(cells)
            if any(hint in row_blob for hint in SIGNATURE_HINTS):
                row_y0 = min(b[1] for b in row.cells if b)
                row_y1 = max(b[3] for b in row.cells if b)
                row_clip = pymupdf.Rect(table.bbox[0], row_y0, table.bbox[2], row_y1)
                row_lines = build_logical_lines(page, clip=row_clip)
                for sub_row in group_into_rows(row_lines):
                    fields, unlabeled = extract_fields(sub_row)
                    if fields:
                        signature_rows.append(fields)
                    signature_unlabeled.extend(unlabeled)
            else:
                table_rows.append(cells)

    details, table_meta = build_details(table_rows)
    header, unmapped_header = build_header(header_fields, signature_rows)
    summary = build_summary(details, table_meta["totals_row"])

    return {
        "header": header,
        "details": details,
        "summary": summary,
        "raw": {
            "header_fields": header_fields,
            "signature_rows": signature_rows,
            "unlabeled_text": header_unlabeled + signature_unlabeled,
            "unmapped_header_fields": unmapped_header,
            "table_header_rows": table_meta["header_rows"],
            "totals_row": table_meta["totals_row"],
            "table_rows": table_rows,
        },
    }


def extract_from_pdf(path: Path) -> dict:
    result = {"source": str(path), "type": "pdf", "pages": []}
    with pymupdf.open(path) as doc:
        for i, page in enumerate(doc, start=1):
            page_data = extract_page(page)
            page_data["page"] = i
            result["pages"].append(page_data)
    return result


def extract_from_excel(path: Path) -> dict:
    sheets = pd.read_excel(path, sheet_name=None, header=None)
    result = {"source": str(path), "type": "excel", "sheets": {}}
    for name, df in sheets.items():
        df = df.dropna(how="all").dropna(axis=1, how="all")
        result["sheets"][name] = df.fillna("").values.tolist()
    return result


def save_tables_as_csv(data: dict, out_dir: Path) -> list[Path]:
    """Dump every detected table to its own CSV for quick spot-checking."""
    saved = []
    if data["type"] == "pdf":
        for page in data["pages"]:
            rows = page["raw"]["table_rows"]
            if not rows:
                continue
            df = pd.DataFrame(rows)
            out_path = out_dir / f"page{page['page']}_table.csv"
            df.to_csv(out_path, index=False, header=False, encoding="utf-8-sig")
            saved.append(out_path)
    else:
        for name, rows in data["sheets"].items():
            if not rows:
                continue
            df = pd.DataFrame(rows[1:], columns=rows[0])
            safe_name = re.sub(r"[^\w-]", "_", name)
            out_path = out_dir / f"{safe_name}.csv"
            df.to_csv(out_path, index=False, encoding="utf-8-sig")
            saved.append(out_path)
    return saved


def main():
    if len(sys.argv) < 2:
        print("Usage: python timesheet_extractor.py <file.pdf|file.xlsx> [output.json]")
        sys.exit(1)

    path = Path(sys.argv[1])
    if not path.exists():
        print(f"File not found: {path}")
        sys.exit(1)

    suffix = path.suffix.lower()
    if suffix in (".xlsx", ".xls"):
        data = extract_from_excel(path)
    elif suffix == ".pdf":
        data = extract_from_pdf(path)
    else:
        print("Unsupported file type. Use .pdf, .xlsx, or .xls")
        sys.exit(1)

    out_path = Path(sys.argv[2]) if len(sys.argv) > 2 else path.with_suffix(".json")
    out_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Extracted data written to {out_path}")

    csv_paths = save_tables_as_csv(data, out_path.parent)
    for p in csv_paths:
        print(f"Table CSV: {p}")


if __name__ == "__main__":
    main()

"""Rebuilds built/template-studio.html from src/ and assets/ (reference build, stdlib only)."""
import base64, json
from pathlib import Path
R = Path(__file__).parent
page = (R / "src/page.html").read_text()
eng_js = (R / "src/engine.js").read_text().replace('if (typeof module !== "undefined") module.exports = Engine;\n', "")
parts = {
    "/*__MINIZIP_JS__*/": (R / "src/minizip.js").read_text(),
    "/*__ENGINE_JS__*/": eng_js,
    "/*__ENGINE_PY__*/": json.dumps((R / "src/engine.py").read_text()),
    "/*__SAMPLE_B64__*/": json.dumps(base64.b64encode((R / "assets/sample_template.pptx").read_bytes()).decode()),
    "/*__BLANK_B64__*/": json.dumps(base64.b64encode((R / "assets/blank.pptx").read_bytes()).decode()),
    "/*__SAMPLE_PROJECT__*/": json.dumps(json.loads((R / "assets/sample_project.json").read_text())),
    "/*__SAMPLE_TEST__*/": json.dumps(json.loads((R / "assets/sample_test_data.json").read_text())),
    "/*__CORE_JS__*/": (R / "src/core.js").read_text(),
    "/*__UI_JS__*/": (R / "src/ui.js").read_text(),
}
for k, v in parts.items():
    page = page.replace(k, v)
(R / "built/template-studio.html").write_text(page)
print("built/template-studio.html", len(page))

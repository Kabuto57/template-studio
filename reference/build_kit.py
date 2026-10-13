"""Rebuilds built/pptx_kit.py from src/kit_src.py + src/engine.py (reference build, stdlib only)."""
from pathlib import Path
R = Path(__file__).parent
src = (R / "src/kit_src.py").read_text()
eng = (R / "src/engine.py").read_text()
split = eng.index("# =========================================================================== command line")
out = src.replace("/*__ENGINE_A__*/\n", eng[:split]).replace("/*__ENGINE_B__*/", eng[split:])
(R / "built/pptx_kit.py").write_text(out)
print("built/pptx_kit.py", len(out))

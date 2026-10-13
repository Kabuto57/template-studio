"""Runs python/engine.py on fixtures from stdin (JSON) and prints the results (JSON).
Input:  {"cases": [{"xml": str, "data": dict, "rules": list}]}
Output: [{"xml": str, "replaced": [..], "missing": [..]}]"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
src = (ROOT / "python" / "engine.py").read_text(encoding="utf-8")
src = src[:src.index("# =========================================================================== command line")]
ns = {"__name__": "engine"}
exec(compile(src, "engine.py", "exec"), ns)

out = []
for case in json.load(sys.stdin)["cases"]:
    report = {"replaced": set(), "missing": set()}
    xml = ns["fill_xml"](case["xml"], case["data"], report, case.get("rules", []))
    out.append({"xml": xml, "replaced": sorted(report["replaced"]), "missing": sorted(report["missing"])})
sys.stdout.write(json.dumps(out, ensure_ascii=False))

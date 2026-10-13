"""Runs a generated fill_pptx.py the way a Dify Code node does: exec the source, then call
main(content_json). Run with `python -I -S` so no site-packages can leak in.
usage: dify_run.py <fill_pptx.py> <content.json | --bad> <out.pptx>   -> prints the result (minus the base64) as JSON"""
import base64
import json
import sys

code = open(sys.argv[1], encoding="utf-8").read()
ns = {"__name__": "dify_sandbox"}   # not "__main__": the command-line block must not run
exec(compile(code, "fill_pptx.py", "exec"), ns)
content = "{not json" if sys.argv[2] == "--bad" else open(sys.argv[2], encoding="utf-8").read()
result = ns["main"](content)
assert set(result) == {"pptx_base64", "file_name", "status", "message"}, sorted(result)
assert all(isinstance(v, str) for v in result.values()), "every output must be a String"
blob = base64.b64decode(result.pop("pptx_base64"))
if blob:
    open(sys.argv[3], "wb").write(blob)
result["bytes"] = len(blob)
result["stdlib_only"] = "site" not in sys.modules
print(json.dumps(result))

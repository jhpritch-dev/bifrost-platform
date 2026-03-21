"""
bifrost_shell.py — BIFROST Shell MCP Tool Server
=================================================
Exposes static analysis tools as MCP-callable functions.
Used by Verification Harness Level 3 in AUTOPILOT subtask pipeline.

Tools:
  run_ruff   — lint Python code, return violations
  run_mypy   — type-check Python code, return errors
  run_checks — run both ruff + mypy, return combined pass/fail

Usage:
  # Start server (stdio transport for LangGraph MCP adapter):
  python bifrost_shell.py

  # Or HTTP transport for direct REST calls:
  python bifrost_shell.py --transport http --port 8086

Machine: Bifrost (D:\\Projects\\bifrost-router\\)
"""

import subprocess
import sys
import tempfile
import os
import re
from pathlib import Path

from fastmcp import FastMCP

mcp = FastMCP(
    name="bifrost-shell",
    instructions=(
        "Static analysis tools for BIFROST code verification. "
        "Use run_checks() to validate generated Python code before delivery. "
        "Returns structured pass/fail results with line-level error details."
    ),
)


# ---------------------------------------------------------------------------
# Tool: run_ruff
# ---------------------------------------------------------------------------

@mcp.tool()
def run_ruff(code: str, filename: str = "generated.py") -> dict:
    """
    Run ruff linter on Python code string.
    
    Args:
        code: Python source code to lint
        filename: Virtual filename for error messages (default: generated.py)
    
    Returns:
        {
            "passed": bool,
            "violations": [{"line": int, "col": int, "code": str, "message": str}],
            "violation_count": int,
            "summary": str
        }
    """
    with tempfile.NamedTemporaryFile(
        mode="w", suffix=".py", prefix="bifrost_", delete=False, encoding="utf-8"
    ) as f:
        f.write(code)
        tmp_path = f.name

    try:
        result = subprocess.run(
            [sys.executable, "-m", "ruff", "check", "--output-format=json", tmp_path],
            capture_output=True,
            text=True,
            timeout=30,
        )

        violations = []
        try:
            import json
            raw = json.loads(result.stdout) if result.stdout.strip() else []
            for v in raw:
                violations.append({
                    "line":    v.get("location", {}).get("row", 0),
                    "col":     v.get("location", {}).get("column", 0),
                    "code":    v.get("code", ""),
                    "message": v.get("message", ""),
                })
        except Exception:
            # Fallback: parse text output
            for line in result.stdout.splitlines():
                if ":error:" in line or " E" in line:
                    violations.append({"line": 0, "col": 0, "code": "PARSE_ERROR", "message": line.strip()})

        passed = len(violations) == 0
        summary = f"ruff: {'PASS' if passed else f'FAIL ({len(violations)} violations)'}"

        return {
            "passed":          passed,
            "violations":      violations,
            "violation_count": len(violations),
            "summary":         summary,
        }

    except subprocess.TimeoutExpired:
        return {"passed": False, "violations": [], "violation_count": 0, "summary": "ruff: TIMEOUT"}
    except FileNotFoundError:
        return {"passed": False, "violations": [], "violation_count": 0, "summary": "ruff: NOT INSTALLED"}
    finally:
        try:
            os.unlink(tmp_path)
        except Exception:
            pass


# ---------------------------------------------------------------------------
# Tool: run_mypy
# ---------------------------------------------------------------------------

@mcp.tool()
def run_mypy(code: str, filename: str = "generated.py") -> dict:
    """
    Run mypy type checker on Python code string.
    
    Args:
        code: Python source code to type-check
        filename: Virtual filename for error messages (default: generated.py)
    
    Returns:
        {
            "passed": bool,
            "errors": [{"line": int, "severity": str, "message": str}],
            "error_count": int,
            "summary": str
        }
    """
    with tempfile.NamedTemporaryFile(
        mode="w", suffix=".py", prefix="bifrost_", delete=False, encoding="utf-8"
    ) as f:
        f.write(code)
        tmp_path = f.name

    try:
        result = subprocess.run(
            [
                sys.executable, "-m", "mypy",
                "--ignore-missing-imports",
                "--no-error-summary",
                "--show-column-numbers",
                tmp_path,
            ],
            capture_output=True,
            text=True,
            timeout=60,
        )

        errors = []
        pattern = re.compile(r".+?:(\d+):(?:\d+:)?\s*(error|warning|note):\s*(.+)")
        for line in result.stdout.splitlines():
            m = pattern.search(line)
            if m:
                errors.append({
                    "line":     int(m.group(1)),
                    "severity": m.group(2),
                    "message":  m.group(3).strip(),
                })

        # mypy exits 0 = no errors, 1 = errors found, 2 = internal error
        passed = result.returncode == 0
        error_count = sum(1 for e in errors if e["severity"] == "error")
        summary = f"mypy: {'PASS' if passed else f'FAIL ({error_count} errors)'}"

        return {
            "passed":      passed,
            "errors":      errors,
            "error_count": error_count,
            "summary":     summary,
        }

    except subprocess.TimeoutExpired:
        return {"passed": False, "errors": [], "error_count": 0, "summary": "mypy: TIMEOUT"}
    except FileNotFoundError:
        return {"passed": False, "errors": [], "error_count": 0, "summary": "mypy: NOT INSTALLED"}
    finally:
        try:
            os.unlink(tmp_path)
        except Exception:
            pass


# ---------------------------------------------------------------------------
# Tool: run_checks (combined)
# ---------------------------------------------------------------------------

@mcp.tool()
def run_checks(code: str, filename: str = "generated.py") -> dict:
    """
    Run both ruff and mypy on Python code. Primary tool for Verification Harness Level 3.
    
    Args:
        code: Python source code to validate
        filename: Virtual filename for error messages
    
    Returns:
        {
            "passed": bool,          # True only if BOTH ruff and mypy pass
            "python", "-m", "ruff": {...},           # Full ruff result
            "mypy": {...},           # Full mypy result  
            "total_issues": int,     # ruff violations + mypy errors
            "summary": str           # "PASS" or "FAIL: ruff(N) mypy(M)"
        }
    """
    ruff_result = run_ruff(code, filename)
    mypy_result = run_mypy(code, filename)

    passed = ruff_result["passed"] and mypy_result["passed"]
    total  = ruff_result["violation_count"] + mypy_result["error_count"]

    if passed:
        summary = "PASS: ruff clean, mypy clean"
    else:
        parts = []
        if not ruff_result["passed"]:
            parts.append(f"ruff({ruff_result['violation_count']} violations)")
        if not mypy_result["passed"]:
            parts.append(f"mypy({mypy_result['error_count']} errors)")
        summary = "FAIL: " + ", ".join(parts)

    return {
        "passed":       passed,
        "ruff":         ruff_result,
        "mypy":         mypy_result,
        "total_issues": total,
        "summary":      summary,
    }


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="BIFROST Shell MCP Tool Server")
    parser.add_argument("--transport", choices=["stdio", "http"], default="stdio")
    parser.add_argument("--port", type=int, default=8086)
    parser.add_argument("--host", default="0.0.0.0")
    args = parser.parse_args()

    if args.transport == "http":
        print(f"[bifrost-shell] Starting HTTP server on {args.host}:{args.port}")
        mcp.run(transport="streamable-http", host=args.host, port=args.port)
    else:
        mcp.run(transport="stdio")




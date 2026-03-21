"""
patch_arbiter_lock.py
Adds forced-mode lock to Arbiter so POST /mode overrides hold for 10 minutes.
Run on Bifrost: python D:\Projects\bifrost-router\patch_arbiter_lock.py
"""
path = r"D:\Projects\bifrost-router\arbiter.py"

with open(path, "r", encoding="utf-8-sig") as f:
    content = f.read()

# 1. Add forced_until field to ArbiterState.__init__
old1 = "        self.start_time: float = time.time()"
new1 = "        self.start_time: float = time.time()\n        self.forced_until: float = 0.0  # epoch time until which POST /mode override holds"
content = content.replace(old1, new1, 1)

# 2. Block process_mode_update when force lock is active
old2 = "def process_mode_update(reported_mode: OperatingMode) -> None:\n    \"\"\"Core state machine: debounce mode transitions.\"\"\"\n    now = time.time()"
new2 = """def process_mode_update(reported_mode: OperatingMode) -> None:
    \"\"\"Core state machine: debounce mode transitions.\"\"\"
    now = time.time()

    # If a manual override is active, ignore Broadcaster reports until lock expires
    if now < state.forced_until:
        remaining = round(state.forced_until - now, 0)
        logger.debug("Force lock active (%.0fs remaining) — ignoring Broadcaster report of %s", remaining, reported_mode.value)
        return"""
content = content.replace(old2, new2, 1)

# 3. Set forced_until in the POST /mode handler (10 minutes)
old3 = "    logger.info(\"MODE OVERRIDE: %s -> %s (via POST /mode)\", old_mode.value, new_mode.value)"
new3 = "    state.forced_until = time.time() + 600  # lock for 10 minutes\n    logger.info(\"MODE OVERRIDE: %s -> %s (via POST /mode, locked 10min)\", old_mode.value, new_mode.value)"
content = content.replace(old3, new3, 1)

with open(path, "w", encoding="utf-8") as f:
    f.write(content)

# Verify
checks = [
    "forced_until",
    "Force lock active",
    "locked 10min",
]
for c in checks:
    print(f"{'OK' if c in content else 'MISSING'}: {c}")
print("done")

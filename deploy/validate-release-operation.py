#!/usr/bin/env python3
"""Validate dispatch scope before any deployment or production source mutation."""
import os
import re


def validate(operation, base_id, mode, confirmation):
    if operation not in {"deploy_only", "rebuild_target", "rebuild_all"}:
        raise ValueError("Choose a supported release operation")
    if mode not in {"strict", "preserve-melody"}:
        raise ValueError("Choose a supported transcription mode")
    if operation == "deploy_only":
        if base_id or mode != "strict" or confirmation:
            raise ValueError("Deploy-only must not include rebuild settings")
        return False
    if operation == "rebuild_target":
        if not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,119}", base_id) or confirmation:
            raise ValueError("Targeted rebuild requires one valid base ID and no full-catalog confirmation")
    elif base_id or mode != "strict" or confirmation != "REBUILD_ALL_CATALOG":
        raise ValueError("Full rebuild requires an empty base ID, strict mode and REBUILD_ALL_CATALOG confirmation")
    return True


if __name__ == "__main__":
    try:
        rebuild = validate(os.environ.get("RELEASE_OPERATION", "deploy_only"), os.environ.get("REBUILD_BASE_ID", ""), os.environ.get("REBUILD_TRANSCRIPTION_MODE", "strict"), os.environ.get("REBUILD_CONFIRMATION", ""))
    except ValueError as error:
        raise SystemExit(str(error))
    print("validated catalog rebuild" if rebuild else "validated deploy-only release")

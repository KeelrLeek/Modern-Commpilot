"""Build the install ZIP from the extension files only."""

import json
import shutil
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile


SOURCE = Path(__file__).resolve().parent.parent
FILES = (
    "manifest.json",
    "README.md",
    "src/bg/credential-bridge.js",
    "src/bg/rules.json",
    "src/content/cloak.js",
    "src/content/enhancer.css",
    "src/content/enhancer.js",
    "src/content/fonts.js",
    "src/content/login.css",
    "src/content/login.js",
    "src/content/native-pjax.css",
    "src/content/pjax.js",
    "src/content/recovery-bridge.js",
    "src/content/skin.css",
    "src/content/skin.js",
    "src/content/stubguard.js",
)


def main():
    version = json.loads((SOURCE / "manifest.json").read_text(encoding="utf-8"))["version"]
    versioned = SOURCE / "release" / f"BroadWorks-Enhancer-PJAX-Preview-{version}.zip"
    current = SOURCE.parent / "release" / "BroadWorks-Enhancer-PJAX-Preview.zip"
    versioned.parent.mkdir(parents=True, exist_ok=True)
    current.parent.mkdir(parents=True, exist_ok=True)
    with ZipFile(versioned, "w", compression=ZIP_DEFLATED, compresslevel=9) as archive:
        for relative in FILES:
            source = SOURCE / relative
            if not source.is_file():
                raise FileNotFoundError(source)
            archive.write(source, relative)
    with ZipFile(versioned) as archive:
        if archive.namelist() != list(FILES):
            raise ValueError("Unexpected install ZIP contents")
        for relative in FILES:
            if archive.read(relative) != (SOURCE / relative).read_bytes():
                raise ValueError(f"Install ZIP differs from source: {relative}")
    shutil.copyfile(versioned, current)
    print(versioned)
    print(current)


if __name__ == "__main__":
    main()

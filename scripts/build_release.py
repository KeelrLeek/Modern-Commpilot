"""Build the versioned preview and refresh both advertised local install paths."""

from __future__ import annotations

import hashlib
import json
import shutil
from fnmatch import fnmatchcase
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile


SOURCE = Path(__file__).resolve().parents[1]
PROJECT = SOURCE.parent
SOURCE_RELEASE = SOURCE / "release"
PROJECT_RELEASE = PROJECT / "release"
UNPACKED = PROJECT_RELEASE / "unpacked"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def verify_manifest_files(manifest: dict, names: set[str]) -> None:
    """Check the paths the browser needs, including web-accessible assets."""
    required = {manifest["action"]["default_popup"]}
    for script in manifest.get("content_scripts", []):
        required.update(script.get("css", []))
        required.update(script.get("js", []))
    background = manifest.get("background", {})
    required.update(background.get("scripts", []))
    if background.get("service_worker"):
        required.add(background["service_worker"])
    required.update(
        rule["path"]
        for rule in manifest.get("declarative_net_request", {}).get("rule_resources", [])
    )
    for accessible in manifest.get("web_accessible_resources", []):
        for resource in accessible.get("resources", []):
            if any(character in resource for character in "*?["):
                if not any(fnmatchcase(name, resource) for name in names):
                    raise SystemExit(f"Release ZIP has no files matching: {resource}")
            else:
                required.add(resource)
    if missing := required - names:
        raise SystemExit(f"Release ZIP is missing manifest files: {sorted(missing)}")


def main() -> None:
    if not (PROJECT / "README.md").is_file() or not PROJECT_RELEASE.is_dir():
        raise SystemExit("Expected the BroadWorks project release directory beside source/.")
    project_root = PROJECT.resolve()
    for output in (SOURCE_RELEASE, PROJECT_RELEASE, UNPACKED):
        if not output.resolve().is_relative_to(project_root):
            raise SystemExit(f"Release output escapes the project directory: {output}")
    manifest = json.loads((SOURCE / "manifest.json").read_text(encoding="utf-8"))
    version = manifest["version"]
    versioned = SOURCE_RELEASE / f"BroadWorks-Enhancer-PJAX-Preview-{version}.zip"
    current = PROJECT_RELEASE / "BroadWorks-Enhancer-PJAX-Preview.zip"

    files = {SOURCE / "manifest.json", SOURCE / "README.md"}
    files.update(path for path in (SOURCE / "src").rglob("*") if path.is_file())
    files.update((SOURCE / "assets" / "icons").rglob("*.svg"))
    files.update((SOURCE / "assets" / "login").glob("*.png"))
    files.update({
        SOURCE / "assets" / "help" / "help-content.json",
        SOURCE / "assets" / "fonts" / "InterVariable.woff2",
        SOURCE / "assets" / "fonts" / "GeistVariable.woff2",
    })
    if any(not path.is_file() for path in files):
        raise SystemExit("A release file is missing from source/.")

    SOURCE_RELEASE.mkdir(parents=True, exist_ok=True)
    temporary = versioned.with_suffix(".zip.tmp")
    with ZipFile(temporary, "w", ZIP_DEFLATED, compresslevel=9) as archive:
        for path in sorted(files):
            archive.write(path, path.relative_to(SOURCE).as_posix())
    with ZipFile(temporary) as archive:
        if archive.testzip() is not None:
            raise SystemExit("Release ZIP failed its integrity check.")
        packed_manifest = json.loads(archive.read("manifest.json"))
        if packed_manifest["version"] != version:
            raise SystemExit("Release ZIP version does not match the source manifest.")
        names = set(archive.namelist())
        verify_manifest_files(packed_manifest, names)
    temporary.replace(versioned)

    current_temporary = current.with_suffix(".zip.tmp")
    shutil.copyfile(versioned, current_temporary)
    current_temporary.replace(current)

    unpacked_root = UNPACKED.resolve()
    with ZipFile(versioned) as archive:
        for entry in archive.infolist():
            target = (UNPACKED / entry.filename).resolve()
            if not target.is_relative_to(unpacked_root):
                raise SystemExit(f"Unsafe archive path: {entry.filename}")
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(archive.read(entry))
            if hashlib.sha256(target.read_bytes()).digest() != hashlib.sha256(archive.read(entry)).digest():
                raise SystemExit(f"Unpacked file did not match ZIP: {entry.filename}")

    if sha256(versioned) != sha256(current):
        raise SystemExit("Current release ZIP does not match versioned ZIP.")
    unpacked_manifest = json.loads((UNPACKED / "manifest.json").read_text(encoding="utf-8"))
    if unpacked_manifest["version"] != version:
        raise SystemExit("Unpacked install does not match release version.")
    verify_manifest_files(unpacked_manifest, {
        path.relative_to(UNPACKED).as_posix()
        for path in UNPACKED.rglob("*") if path.is_file()
    })
    print(f"Built preview {version}: {len(files)} files")
    print(f"Versioned: {versioned}")
    print(f"Current:   {current}")
    print(f"Unpacked:  {UNPACKED}")
    print(f"SHA-256:   {sha256(versioned)}")


if __name__ == "__main__":
    main()

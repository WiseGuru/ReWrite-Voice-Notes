import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";

// Only record a new versions.json entry when the target version itself isn't already a key.
// (Previously checked whether minAppVersion was already a *value*, which meant no new entry was
// ever recorded once any prior version shared the same minAppVersion — silently dropping every
// release after the first from the compatibility map.) Exported for tests.
export function shouldRecordVersion(targetVersion, versions) {
    return !(targetVersion in versions);
}

function run() {
    const targetVersion = process.env.npm_package_version;

    // read minAppVersion from manifest.json and bump version to target version
    const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
    const { minAppVersion } = manifest;
    manifest.version = targetVersion;
    writeFileSync("manifest.json", JSON.stringify(manifest, null, "\t"));

    // update versions.json with target version and minAppVersion from manifest.json
    // but only if the target version is not already in versions.json
    const versions = JSON.parse(readFileSync("versions.json", "utf8"));
    if (shouldRecordVersion(targetVersion, versions)) {
        versions[targetVersion] = minAppVersion;
        writeFileSync("versions.json", JSON.stringify(versions, null, "\t"));
    }
}

// Guards the file-writing side effects behind "run as a script", not "imported as a module", so
// tests can import shouldRecordVersion() without touching manifest.json/versions.json on disk.
if (fileURLToPath(import.meta.url) === process.argv[1]) {
    run();
}

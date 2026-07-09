/**
 * Version Manager — stores recent XML versions for undo functionality.
 * Keeps up to MAX_VERSIONS per fileName in the app's userData directory.
 */

const fs = require("fs");
const path = require("path");
const { app } = require("electron");

const MAX_VERSIONS = 5;

function getVersionsDir() {
  const dir = path.join(app.getPath("userData"), "versions");
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/** Sanitize a fileName into a safe key for file storage. */
function safeKey(fileName) {
  return (fileName || "untitled").replace(/[^a-zA-Z0-9._-]/g, "_");
}

/**
 * Push a new XML version onto the stack.
 * @param {string} xml  — full XML string
 * @param {string} fileName — original file name
 * @param {string} label — short description (e.g. "AI update", "manual edit")
 * @returns {object} version info { id, timestamp, label }
 */
function pushVersion(xml, fileName, label = "") {
  const dir = getVersionsDir();
  const key = safeKey(fileName);

  // Read existing index
  const indexPath = path.join(dir, `${key}.index.json`);
  let versions = [];
  try {
    if (fs.existsSync(indexPath)) {
      versions = JSON.parse(fs.readFileSync(indexPath, "utf8"));
    }
  } catch {
    versions = [];
  }

  const id = `v${Date.now()}`;
  const timestamp = new Date().toISOString();
  const entry = { id, timestamp, label, file: `${key}.${id}.xml` };

  // Write the XML blob
  const xmlPath = path.join(dir, entry.file);
  fs.writeFileSync(xmlPath, xml, "utf8");

  // Prepend to index (newest first)
  versions.unshift(entry);

  // Trim to MAX_VERSIONS — delete old blobs
  if (versions.length > MAX_VERSIONS) {
    const removed = versions.splice(MAX_VERSIONS);
    for (const r of removed) {
      const oldPath = path.join(dir, r.file);
      try { fs.unlinkSync(oldPath); } catch {}
    }
  }

  fs.writeFileSync(indexPath, JSON.stringify(versions, null, 2), "utf8");
  return entry;
}

/**
 * Get the list of versions for a fileName.
 * @returns {array} [{ id, timestamp, label }] newest first
 */
function getVersions(fileName) {
  const dir = getVersionsDir();
  const key = safeKey(fileName);
  const indexPath = path.join(dir, `${key}.index.json`);
  try {
    if (!fs.existsSync(indexPath)) return [];
    return JSON.parse(fs.readFileSync(indexPath, "utf8"));
  } catch {
    return [];
  }
}

/**
 * Get the XML content of a specific version.
 * @returns {string|null} XML string or null if not found
 */
function getVersion(fileName, versionId) {
  const versions = getVersions(fileName);
  const entry = versions.find((v) => v.id === versionId);
  if (!entry) return null;
  const dir = getVersionsDir();
  const xmlPath = path.join(dir, entry.file);
  try {
    return fs.readFileSync(xmlPath, "utf8");
  } catch {
    return null;
  }
}

/**
 * Get the most recent version (previous to current state).
 * @returns {string|null} XML string or null
 */
function getPreviousVersion(fileName) {
  const versions = getVersions(fileName);
  if (versions.length === 0) return null;
  // The first entry is the most recent saved snapshot
  return getVersion(fileName, versions[0].id);
}

/**
 * Clear all versions for a fileName.
 */
function clearVersions(fileName) {
  const dir = getVersionsDir();
  const key = safeKey(fileName);
  const versions = getVersions(fileName);
  for (const v of versions) {
    try { fs.unlinkSync(path.join(dir, v.file)); } catch {}
  }
  const indexPath = path.join(dir, `${key}.index.json`);
  try { fs.unlinkSync(indexPath); } catch {}
}

module.exports = {
  pushVersion,
  getVersions,
  getVersion,
  getPreviousVersion,
  clearVersions,
  MAX_VERSIONS,
};

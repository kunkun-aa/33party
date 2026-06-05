const fs = require("fs");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");
const outputDir = path.join(rootDir, ".weapp", "upload");

const rootFiles = [
  "app.js",
  "app.json",
  "app.wxss",
  "config.js",
  "sitemap.json",
  "project.config.json"
];

const textFileExts = new Set([".js", ".json", ".wxml", ".wxss", ".wxs"]);

function cleanDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
}

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function copyFile(relativePath) {
  const source = path.join(rootDir, relativePath);
  const dest = path.join(outputDir, relativePath);
  if (!fs.existsSync(source) || fs.statSync(source).isDirectory()) {
    return false;
  }
  ensureDir(dest);
  fs.copyFileSync(source, dest);
  return true;
}

function copyDir(relativeDir, options = {}) {
  const sourceDir = path.join(rootDir, relativeDir);
  if (!fs.existsSync(sourceDir)) {
    return;
  }
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const child = path.join(relativeDir, entry.name);
    if (options.ignore && options.ignore(child, entry)) {
      continue;
    }
    if (entry.isDirectory()) {
      copyDir(child, options);
    } else {
      copyFile(child);
    }
  }
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(rootDir, relativePath), "utf8"));
}

function toPosix(filePath) {
  return filePath.split(path.sep).join("/");
}

function normalizeRelative(filePath) {
  return toPosix(path.normalize(filePath));
}

function resolveComponentBase(componentPath, fromDir = "") {
  if (componentPath.startsWith("tdesign-miniprogram/")) {
    return normalizeRelative(path.join("miniprogram_npm", componentPath));
  }
  if (componentPath.startsWith(".")) {
    return normalizeRelative(path.join(fromDir, componentPath));
  }
  return null;
}

function resolveModuleFile(importPath, fromFile) {
  if (importPath === "tslib") {
    return "miniprogram_npm/tdesign-miniprogram/miniprogram_npm/tslib/index.js";
  }
  if (!importPath.startsWith(".")) {
    return null;
  }

  const base = normalizeRelative(path.join(path.dirname(fromFile), importPath));
  const candidates = [
    base,
    `${base}.js`,
    `${base}.json`,
    `${base}.wxs`,
    path.join(base, "index.js")
  ].map(normalizeRelative);

  return candidates.find((candidate) => {
    const absolutePath = path.join(rootDir, candidate);
    return fs.existsSync(absolutePath) && fs.statSync(absolutePath).isFile();
  }) || null;
}

function collectTextRefs(relativePath) {
  const source = fs.readFileSync(path.join(rootDir, relativePath), "utf8");
  const refs = [];
  const ext = path.extname(relativePath);

  if (ext === ".js") {
    const importPattern = /(?:import|export)\s*(?:[^"']*?\s*from\s*)?["']([^"']+)["']|require\(["']([^"']+)["']\)/g;
    let match;
    while ((match = importPattern.exec(source))) {
      const resolved = resolveModuleFile(match[1] || match[2], relativePath);
      if (resolved) {
        refs.push(resolved);
      }
    }
  }

  if (ext === ".wxml") {
    const wxmlPattern = /<(?:import|include|wxs)\b[^>]*\bsrc=["']([^"']+)["']/g;
    let match;
    while ((match = wxmlPattern.exec(source))) {
      refs.push(normalizeRelative(path.join(path.dirname(relativePath), match[1])));
    }
  }

  if (ext === ".wxss") {
    const wxssPattern = /@import\s+["']([^"']+)["']/g;
    let match;
    while ((match = wxssPattern.exec(source))) {
      refs.push(normalizeRelative(path.join(path.dirname(relativePath), match[1])));
    }
  }

  if (ext === ".json") {
    try {
      const parsed = JSON.parse(source);
      const usingComponents = parsed.usingComponents || {};
      for (const componentPath of Object.values(usingComponents)) {
        const base = resolveComponentBase(componentPath, path.dirname(relativePath));
        if (base) {
          refs.push(`${base}.json`, `${base}.js`, `${base}.wxml`, `${base}.wxss`);
        }
      }
    } catch (error) {
      throw new Error(`Invalid JSON in ${relativePath}: ${error.message}`);
    }
  }

  return refs;
}

function copyWithDeps(entryFiles) {
  const queue = [...entryFiles];
  const seen = new Set();

  while (queue.length) {
    const relativePath = normalizeRelative(queue.shift());
    if (seen.has(relativePath)) {
      continue;
    }
    seen.add(relativePath);

    if (!copyFile(relativePath)) {
      continue;
    }

    if (!textFileExts.has(path.extname(relativePath))) {
      continue;
    }

    for (const ref of collectTextRefs(relativePath)) {
      queue.push(ref);
    }
  }

  return seen;
}

function pageFilesFromAppJson() {
  const appJson = readJson("app.json");
  const files = [];
  for (const page of appJson.pages || []) {
    files.push(`${page}.js`, `${page}.json`, `${page}.wxml`, `${page}.wxss`);
  }
  return files;
}

function sizeOf(relativePath) {
  const absolutePath = path.join(outputDir, relativePath);
  if (!fs.existsSync(absolutePath)) {
    return 0;
  }
  const stat = fs.statSync(absolutePath);
  if (stat.isFile()) {
    return stat.size;
  }
  return fs.readdirSync(absolutePath).reduce((sum, entry) => {
    return sum + sizeOf(path.join(relativePath, entry));
  }, 0);
}

function buildUploadProject() {
  cleanDir(outputDir);
  rootFiles.forEach(copyFile);
  copyDir("frontend", {
    ignore(relativePath, entry) {
      return entry.isFile() && /README\.md$/i.test(relativePath);
    }
  });

  copyWithDeps([
    ...rootFiles.filter((file) => textFileExts.has(path.extname(file))),
    ...pageFilesFromAppJson()
  ]);

  const pkg = {
    name: "33party-miniprogram-upload",
    version: "1.0.0",
    private: true
  };
  fs.writeFileSync(path.join(outputDir, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`);

  return {
    outputDir,
    size: sizeOf(".")
  };
}

module.exports = {
  buildUploadProject,
  outputDir
};

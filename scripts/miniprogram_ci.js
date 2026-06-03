const fs = require("fs");
const path = require("path");
const ci = require("miniprogram-ci");
const pkg = require("../package.json");
const projectConfig = require("../project.config.json");

const rootDir = path.resolve(__dirname, "..");
const mode = process.argv[2] || "preview";
const appid = process.env.WECHAT_MINIPROGRAM_APPID || projectConfig.appid;
const privateKeyPath = path.resolve(
  rootDir,
  process.env.WECHAT_PRIVATE_KEY_PATH || `private.${appid}.key`
);
const robot = Number(process.env.WECHAT_CI_ROBOT || 1);
const version = process.env.WECHAT_UPLOAD_VERSION || pkg.version;
const desc = process.env.WECHAT_UPLOAD_DESC || `33party ${version}`;
const qrcodeOutputDest = path.resolve(
  rootDir,
  process.env.WECHAT_PREVIEW_QRCODE || ".weapp/preview.jpg"
);

const projectIgnores = [
  "node_modules/**/*",
  "backend/**/*",
  "docs/**/*",
  "deploy/**/*",
  "ops/**/*",
  "scripts/**/*",
  ".git/**/*",
  ".weapp/**/*",
  "*.key",
  "*.pem",
  "private.*.key",
  "frontend_files_bundle.txt"
];

function ensureReady() {
  if (!appid) {
    throw new Error("Missing appid. Set WECHAT_MINIPROGRAM_APPID or project.config.json appid.");
  }
  if (!fs.existsSync(privateKeyPath)) {
    throw new Error(`Missing private key: ${privateKeyPath}`);
  }
  fs.mkdirSync(path.dirname(qrcodeOutputDest), { recursive: true });
}

function buildProject() {
  return new ci.Project({
    appid,
    type: "miniProgram",
    projectPath: rootDir,
    privateKeyPath,
    ignores: projectIgnores
  });
}

function logProgress(event) {
  if (!event) {
    return;
  }
  if (typeof event === "string") {
    console.log(event);
    return;
  }
  const message = event.message || event.status || event.name || "";
  if (message) {
    console.log(message);
  }
}

async function packNpm(project) {
  console.log("Packing miniprogram npm...");
  const warnings = await ci.packNpm(project, {
    reporter: logProgress
  });
  if (warnings && warnings.length) {
    console.warn("packNpm warnings:");
    warnings.forEach((warning) => {
      console.warn(`- ${warning.msg || JSON.stringify(warning)}`);
    });
  }
}

async function runPreview(project) {
  console.log(`Creating preview for ${appid}...`);
  const result = await ci.preview({
    project,
    version,
    desc,
    robot,
    setting: {
      useProjectConfig: true
    },
    qrcodeFormat: "image",
    qrcodeOutputDest,
    onProgressUpdate: logProgress
  });
  console.log(`Preview QR code: ${qrcodeOutputDest}`);
  console.log(JSON.stringify(result, null, 2));
}

async function runUpload(project) {
  console.log(`Uploading ${appid} version ${version} with robot ${robot}...`);
  const result = await ci.upload({
    project,
    version,
    desc,
    robot,
    setting: {
      useProjectConfig: true
    },
    onProgressUpdate: logProgress
  });
  console.log(JSON.stringify(result, null, 2));
}

async function main() {
  if (!["preview", "upload"].includes(mode)) {
    throw new Error("Usage: node scripts/miniprogram_ci.js <preview|upload>");
  }
  ensureReady();
  const project = buildProject();
  await packNpm(project);
  if (mode === "preview") {
    await runPreview(project);
    return;
  }
  await runUpload(project);
}

main().catch((error) => {
  console.error(error && error.message ? error.message : error);
  process.exit(1);
});

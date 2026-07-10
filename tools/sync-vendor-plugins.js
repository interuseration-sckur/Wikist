const path = require("path");
const { pluginCatalog, syncVendorPlugin } = require("../src/core/plugin-registry");

const rootDir = path.resolve(__dirname, "..");
const targets = pluginCatalog(rootDir).filter((plugin) => plugin.vendor?.supported);

if (!targets.length) {
  console.log("No vendor plugins configured.");
  process.exit(0);
}

let failed = 0;
for (const plugin of targets) {
  try {
    const vendor = syncVendorPlugin(rootDir, { id: plugin.id });
    const warning = vendor.lastSyncWarning ? ` (${vendor.lastSyncWarning})` : "";
    console.log(`${plugin.id}: ${vendor.installed ? "ready" : "missing"} ${vendor.path} ${vendor.commit || ""}${warning}`.trim());
  } catch (error) {
    failed += 1;
    console.error(`${plugin.id}: ${error.message}`);
  }
}

process.exitCode = failed ? 1 : 0;

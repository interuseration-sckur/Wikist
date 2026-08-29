#!/usr/bin/env node
"use strict";

const importer = require("./eom-zh-release-import");

if (require.main === module) importer.runCli();

module.exports = importer;

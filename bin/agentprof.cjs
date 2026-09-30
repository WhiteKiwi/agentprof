#!/usr/bin/env node
"use strict";

// Keep this bootstrap parseable before the supported-runtime check.
var parts = process.versions.node.split(".").map(Number);
var supported = parts[0] > 24 || (parts[0] === 24 && parts[1] >= 15);
var jsonOutput = process.argv.indexOf("--json") !== -1;

function fail(code, message) {
  var output = jsonOutput
    ? JSON.stringify({ schema: "agentprof.cli/v1", ok: false, error: { code: code, message: message } })
    : "agentprof: " + message;
  process.stderr.write(output + "\n");
  process.exitCode = 2;
}

if (!supported) {
  fail("UNSUPPORTED_RUNTIME", "AgentProf requires Node.js >=24.15.0. Install a supported Node.js version and retry.");
} else if (process.platform !== "darwin" && process.platform !== "linux") {
  fail("UNSUPPORTED_PLATFORM", "AgentProf currently supports macOS and Linux.");
} else {
  import("./cli/main.js").then(function (cli) {
    return cli.run(process.argv);
  }).catch(function () {
    fail("INTERNAL_ERROR", "AgentProf could not start. Check the installation and retry.");
  });
}

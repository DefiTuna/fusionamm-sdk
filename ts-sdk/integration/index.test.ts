import assert from "assert";
import { execSync } from "child_process";
import { readdirSync } from "fs";
import { describe, it } from "vitest";

const commandTemplates = [
  "tsx --tsconfig {} ./index.ts",
  "tsc --project {} --outDir ./dist && node ./dist/index.js",
  // FIXME: ts-node does not play nice with ESM since node 20
  // "ts-node --esm --project {} ./index.ts",
  // TODO: should we also add browser/bundler?
];

// commonjs not included here because wasm wouldn't support it
const tsConfigs = readdirSync("./configs");

describe("Integration", () => {
  commandTemplates.forEach(template => {
    tsConfigs.forEach(config => {
      const command = template.replace("{}", `./configs/${config}`);
      it(`Use '${command}'`, () => {
        const output = execSync(command).toString();
        assert(output.includes("256"));
        assert(output.includes("fUSioN9YKKSa3CUC2YUc4tPkHJ5Y6XW1yz8y6F7qWz9"));
      });
    });
  });
});

import { createFromRoot } from "codama";
import { renderVisitor } from "@codama/renderers-rust";
import { rootNodeFromAnchor } from "@codama/nodes-from-anchor";
import { readFileSync } from "fs";

const idl = JSON.parse(readFileSync("../../target/idl/fusionamm.json", "utf8"));
const node = rootNodeFromAnchor(idl);
const visitor = renderVisitor("./src/generated");
const codama = createFromRoot(node);
codama.accept(visitor);

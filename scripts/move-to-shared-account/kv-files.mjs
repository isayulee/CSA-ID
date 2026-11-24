// Copies the Profile images (KV keys under img/) between accounts, for lib.sh.
//   names  <list.json>                    "0000<TAB>key" per key, in list order
//   count  <list.json>                    how many keys
//   bundle <list.json> <dir> <bulk.json>  a `wrangler kv bulk put` file: base64 values with their metadata
//   same   <a.json> <b.json>              exit 0 when both lists hold the same keys with the same metadata
// <list.json> is `wrangler kv key list` output; <dir>/0000.bin holds the value of the list's first key.
import { readFileSync, writeFileSync } from "node:fs";

const [command, ...args] = process.argv.slice(2);
const readList = (path) => JSON.parse(readFileSync(path, "utf8"));
const index = (i) => String(i).padStart(4, "0");

switch (command) {
  case "names":
    readList(args[0]).forEach((key, i) => console.log(`${index(i)}\t${key.name}`));
    break;
  case "count":
    console.log(readList(args[0]).length);
    break;
  case "bundle": {
    const [listPath, dir, outPath] = args;
    const bulk = readList(listPath).map((key, i) => ({
      key: key.name,
      value: readFileSync(`${dir}/${index(i)}.bin`).toString("base64"),
      base64: true,
      ...(key.metadata ? { metadata: key.metadata } : {}),
    }));
    writeFileSync(outPath, JSON.stringify(bulk));
    break;
  }
  case "same": {
    const shape = (path) => JSON.stringify(readList(path).map((key) => [key.name, key.metadata ?? null]));
    process.exit(shape(args[0]) === shape(args[1]) ? 0 : 1);
    break;
  }
  default:
    console.error("usage: node kv-files.mjs names|count|bundle|same ...");
    process.exit(2);
}

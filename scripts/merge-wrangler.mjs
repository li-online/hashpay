import { readFileSync, writeFileSync } from "node:fs";

const [currentPath, nextPath] = process.argv.slice(2);
if (!currentPath || !nextPath) {
  console.error("Usage: node scripts/merge-wrangler.mjs <current> <next>");
  process.exit(1);
}

const current = readJsonc(currentPath);
const next = readJsonc(nextPath);

for (const key of ["name", "routes", "vars", "workers_dev"]) {
  if (current[key] !== undefined) next[key] = current[key];
}

mergeD1();
mergeQueues();

writeFileSync(nextPath, `${JSON.stringify(next, null, 2)}\n`);

function mergeD1() {
  const currentByBinding = new Map((current.d1_databases ?? []).map((item) => [item.binding, item]));
  next.d1_databases = (next.d1_databases ?? []).map((item) => {
    const old = currentByBinding.get(item.binding);
    if (!old) return item;
    return {
      ...item,
      database_id: old.database_id ?? item.database_id,
      database_name: old.database_name ?? item.database_name,
      preview_database_id: old.preview_database_id ?? item.preview_database_id,
    };
  });
}

function mergeQueues() {
  if (!next.queues || !current.queues) return;

  const currentProducers = new Map((current.queues.producers ?? []).map((item) => [item.binding, item]));
  next.queues.producers = (next.queues.producers ?? []).map((item) => ({
    ...item,
    queue: currentProducers.get(item.binding)?.queue ?? item.queue,
  }));

  const currentConsumers = current.queues.consumers ?? [];
  next.queues.consumers = (next.queues.consumers ?? []).map((item, index) => ({
    ...item,
    queue: currentConsumers[index]?.queue ?? item.queue,
  }));
}

function readJsonc(path) {
  return JSON.parse(stripJsonComments(readFileSync(path, "utf8")));
}

function stripJsonComments(input) {
  let output = "";
  let inString = false;
  let escaped = false;
  let block = false;
  let line = false;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    const next = input[i + 1];

    if (line) {
      if (char === "\n") {
        line = false;
        output += char;
      }
      continue;
    }

    if (block) {
      if (char === "*" && next === "/") {
        block = false;
        i += 1;
      }
      continue;
    }

    if (inString) {
      output += char;
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      output += char;
      continue;
    }

    if (char === "/" && next === "/") {
      line = true;
      i += 1;
      continue;
    }

    if (char === "/" && next === "*") {
      block = true;
      i += 1;
      continue;
    }

    output += char;
  }

  return output;
}

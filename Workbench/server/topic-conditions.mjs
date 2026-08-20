import { promises as fs } from "node:fs";
import path from "node:path";
import matter from "gray-matter";

function resolveTopicPath(vaultRoot, topicPath) {
  const fullPath = path.join(vaultRoot, topicPath);
  if (!fullPath.startsWith(path.resolve(vaultRoot))) {
    throw new Error("Invalid topic path");
  }
  return fullPath;
}

async function readTopicFile(vaultRoot, topicPath) {
  const fullPath = resolveTopicPath(vaultRoot, topicPath);
  const raw = await fs.readFile(fullPath, "utf-8");
  return { raw, parsed: matter(raw), fullPath };
}

async function writeTopicFile(fullPath, parsed) {
  // lineWidth: -1 prevents js-yaml from wrapping long strings into block scalars (>-)
  // Block scalars break our self-built frontmatter parser in vault-index.mjs
  const output = matter.stringify(parsed.content, parsed.data, { lineWidth: -1 });
  await fs.writeFile(fullPath, output, "utf-8");
}

export async function updateConditions(vaultRoot, topicPath, conditions) {
  const { parsed, fullPath } = await readTopicFile(vaultRoot, topicPath);
  parsed.data.landing_conditions = JSON.stringify(conditions);
  if (!parsed.data.conditions_finalized) {
    parsed.data.conditions_finalized = false;
  }
  await writeTopicFile(fullPath, parsed);
  return { conditions, finalized: false };
}

export async function finalizeConditions(vaultRoot, topicPath, finalized) {
  const { parsed, fullPath } = await readTopicFile(vaultRoot, topicPath);
  parsed.data.conditions_finalized = finalized;
  await writeTopicFile(fullPath, parsed);
  return { finalized };
}

export async function updateCondition(vaultRoot, topicPath, index, { done, note }) {
  const { parsed, fullPath } = await readTopicFile(vaultRoot, topicPath);
  let conditions = [];
  if (parsed.data.landing_conditions) {
    try {
      conditions = JSON.parse(parsed.data.landing_conditions);
    } catch {
      conditions = [];
    }
  }
  if (index < 0 || index >= conditions.length) {
    throw new Error(`Condition index ${index} out of range (0-${conditions.length - 1})`);
  }
  if (done !== undefined) conditions[index].done = done;
  if (note !== undefined) conditions[index].note = note;
  parsed.data.landing_conditions = JSON.stringify(conditions);
  await writeTopicFile(fullPath, parsed);
  return { conditions, index };
}

export async function generateAndAttachConditions(vaultRoot, topicPath, conditions) {
  const { parsed, fullPath } = await readTopicFile(vaultRoot, topicPath);
  parsed.data.landing_conditions = JSON.stringify(conditions);
  parsed.data.conditions_finalized = false;
  await writeTopicFile(fullPath, parsed);
  return { conditions };
}

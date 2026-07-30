// import { readFile, readdir } from 'node:fs/promises';
// import { join } from 'node:path';

// export interface AgentFrontmatter {
// 	name: string;
// 	description: string;
// 	argumentHint?: string;
// 	tools: string[];
// 	userInvocable: boolean;
// }

// export interface LoadedAgent {
// 	frontmatter: AgentFrontmatter;
// 	body: string;
// 	sourcePath: string;
// }

// export type AgentRegistry = Record<string, LoadedAgent>;

// const FRONTMATTER_DELIMITER = '---';

// const KEY_ALIASES: Record<string, keyof AgentFrontmatter> = {
// 	'name': 'name',
// 	'description': 'description',
// 	'argument-hint': 'argumentHint',
// 	'tools': 'tools',
// 	'user-invocable': 'userInvocable',
// };

// function stripQuotes(value: string): string {
// 	if (value.length >= 2) {
// 		const first = value[0];
// 		const last = value[value.length - 1];
// 		if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
// 			return value.slice(1, -1);
// 		}
// 	}
// 	return value;
// }

// function parseInlineArray(raw: string): string[] {
// 	const inner = raw.slice(1, -1).trim();
// 	if (inner.length === 0) {
// 		return [];
// 	}
// 	return inner
// 		.split(',')
// 		.map((item) => stripQuotes(item.trim()))
// 		.filter((item) => item.length > 0);
// }

// function coerceValue(raw: string): string | boolean | string[] {
// 	const trimmed = raw.trim();
// 	if (trimmed === 'true') {
// 		return true;
// 	}
// 	if (trimmed === 'false') {
// 		return false;
// 	}
// 	if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
// 		return parseInlineArray(trimmed);
// 	}
// 	return stripQuotes(trimmed);
// }

// function splitFrontmatter(source: string, sourcePath: string): { frontmatterBlock: string; body: string } {
// 	const normalized = source.replace(/\r\n/g, '\n');
// 	const lines = normalized.split('\n');

// 	if (lines[0]?.trim() !== FRONTMATTER_DELIMITER) {
// 		throw new Error(`Agent file "${sourcePath}" is missing an opening --- frontmatter delimiter.`);
// 	}

// 	let closingIndex = -1;
// 	for (let i = 1; i < lines.length; i++) {
// 		if (lines[i].trim() === FRONTMATTER_DELIMITER) {
// 			closingIndex = i;
// 			break;
// 		}
// 	}

// 	if (closingIndex === -1) {
// 		throw new Error(`Agent file "${sourcePath}" is missing a closing --- frontmatter delimiter.`);
// 	}

// 	const frontmatterBlock = lines.slice(1, closingIndex).join('\n');
// 	const body = lines.slice(closingIndex + 1).join('\n').trim();

// 	return { frontmatterBlock, body };
// }

// function parseFrontmatter(block: string, sourcePath: string): AgentFrontmatter {
// 	const parsed: Partial<Record<keyof AgentFrontmatter, string | boolean | string[]>> = {};

// 	for (const rawLine of block.split('\n')) {
// 		const line = rawLine.trim();
// 		if (line.length === 0 || line.startsWith('#')) {
// 			continue;
// 		}

// 		const colonIndex = line.indexOf(':');
// 		if (colonIndex === -1) {
// 			throw new Error(`Malformed frontmatter line in "${sourcePath}": ${rawLine}`);
// 		}

// 		const key = line.slice(0, colonIndex).trim();
// 		const value = line.slice(colonIndex + 1).trim();

// 		const normalizedKey = KEY_ALIASES[key];
// 		if (!normalizedKey) {
// 			// Lenient: ignore unknown keys so new fields can be added incrementally.
// 			continue;
// 		}

// 		parsed[normalizedKey] = coerceValue(value);
// 	}

// 	if (typeof parsed.name !== 'string' || parsed.name.length === 0) {
// 		throw new Error(`Agent file "${sourcePath}" is missing a required "name" field.`);
// 	}
// 	if (typeof parsed.description !== 'string' || parsed.description.length === 0) {
// 		throw new Error(`Agent file "${sourcePath}" is missing a required "description" field.`);
// 	}

// 	const tools = parsed.tools ?? [];
// 	if (!Array.isArray(tools)) {
// 		throw new Error(`Agent file "${sourcePath}" has a "tools" field that is not an array.`);
// 	}

// 	const userInvocable = parsed.userInvocable ?? false;
// 	if (typeof userInvocable !== 'boolean') {
// 		throw new Error(`Agent file "${sourcePath}" has a "user-invocable" field that is not a boolean.`);
// 	}

// 	const argumentHint = parsed.argumentHint;
// 	if (argumentHint !== undefined && typeof argumentHint !== 'string') {
// 		throw new Error(`Agent file "${sourcePath}" has an "argument-hint" field that is not a string.`);
// 	}

// 	return {
// 		name: parsed.name,
// 		description: parsed.description,
// 		argumentHint,
// 		tools,
// 		userInvocable,
// 	};
// }

// async function loadAgentFile(sourcePath: string): Promise<LoadedAgent> {
// 	const raw = await readFile(sourcePath, 'utf8');
// 	const { frontmatterBlock, body } = splitFrontmatter(raw, sourcePath);
// 	const frontmatter = parseFrontmatter(frontmatterBlock, sourcePath);
// 	return { frontmatter, body, sourcePath };
// }

// export async function loadAgents(agentsDir: string): Promise<AgentRegistry> {
// 	const entries = await readdir(agentsDir, { withFileTypes: true });
// 	const markdownFiles = entries
// 		.filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.md'))
// 		.map((entry) => join(agentsDir, entry.name));

// 	const registry: AgentRegistry = {};

// 	for (const filePath of markdownFiles) {
// 		const loaded = await loadAgentFile(filePath);
// 		if (registry[loaded.frontmatter.name]) {
// 			throw new Error(
// 				`Duplicate agent name "${loaded.frontmatter.name}" found in "${filePath}" (already defined in "${registry[loaded.frontmatter.name].sourcePath}").`,
// 			);
// 		}
// 		registry[loaded.frontmatter.name] = loaded;
// 	}

// 	return registry;
// }

import * as fs from 'fs/promises';
import * as path from 'path';

export interface AgentDefinition {
    name: string;
    description: string;
    argumentHint?: string;
    tools: string[];
    phases: string[];
    model?: string;
    body: string;
    filePath: string;
}

export async function loadAgents(dirs: string[]): Promise<Record<string, AgentDefinition>> {
    const out: Record<string, AgentDefinition> = {};
    for (const dir of dirs) {
        let entries: string[] = [];
        try {
            entries = await fs.readdir(dir);
        } catch {
            continue;
        }
        for (const entry of entries) {
            if (!entry.endsWith('.md')) {
                continue;
            }
            const full = path.join(dir, entry);
            let raw: string;
            try {
                raw = await fs.readFile(full, 'utf8');
            } catch {
                continue;
            }
            const def = parseAgentFile(raw, full);
            if (def) {
                out[def.name] = def;
            }
        }
    }
    return out;
}

function parseAgentFile(raw: string, filePath: string): AgentDefinition | null {
    const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
    if (!m) {
        return null;
    }
    const fm = parseFrontmatter(m[1]);
    const fallbackName = path.basename(filePath).replace(/\.agent\.md$/i, '').replace(/\.md$/i, '');
    const name = String(fm.name ?? fallbackName);
    const description = String(fm.description ?? '');
    const argumentHint = fm['argument-hint'] ? String(fm['argument-hint']) : undefined;
    const toolsField = fm.tools;
    let tools: string[] = [];
    if (Array.isArray(toolsField)) {
        tools = toolsField.map(String);
    } else if (typeof toolsField === 'string') {
        tools = parseInlineArray(toolsField);
    }
    const phasesField = fm.phases;
    let phases: string[] = [];
    if (Array.isArray(phasesField)) {
        phases = phasesField.map(String);
    } else if (typeof phasesField === 'string') {
        phases = parseInlineArray(phasesField);
    }
    const model = fm.model ? String(fm.model) : undefined;
    return { name, description, argumentHint, tools, phases, model, body: m[2].trim(), filePath };
}

// Minimal YAML frontmatter parser
function parseFrontmatter(text: string): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const lineRaw of text.split(/\r?\n/)) {
        const line = lineRaw.trimEnd();
        if (!line || line.startsWith('#')) {
            continue;
        }
        const idx = line.indexOf(':');
        if (idx < 0) {
            continue;
        }
        const key = line.slice(0, idx).trim();
        let value: string = line.slice(idx + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
            result[key] = value;
        } else if (value.startsWith('[') && value.endsWith(']')) {
            result[key] = parseInlineArray(value);
        } else {
            result[key] = value;
        }
    }
    return result;
}

function parseInlineArray(value: string): string[] {
    const inner = value.replace(/^\[/, '').replace(/\]$/, '');
    if (!inner.trim()) {
        return [];
    }
    return inner
    .split(',')
    .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean);
}
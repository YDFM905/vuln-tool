import type { AgentDefinition } from '../agents/agentLoader.js';
import type { ManagedSession } from '../agents/sessionManager.js';
import {
	runNpmAudit,
	runNpmAuditFix,
	runNpmLs,
	classifyDependencies,
	readOverrides,
	type DependencyMap,
	type NpmAuditResult,
} from '../npm_tools/npmAuditRunner.js';
import { getRepositoryPath } from '../general_tools/repositoryInput.js';

export type Phase = {
	id: string;
	status: 'pending' | 'active' | 'complete' | 'failed';
};

export type RunState = 'idle' | 'running' | 'complete' | 'failed' | 'cancelled';

export type OrchestratorEvent = {
	type: string;
	payload?: unknown;
};

export interface OrchestratorCallbacks {
	onPhaseUpdate(phase: Phase): void;
	onEvent(event: OrchestratorEvent): void;
	awaitConfirmation(phaseId: string, summary: string): Promise<boolean>;
	onRunState(state: RunState): void;
}

export interface RunInput {
	repositoryPath: string;
	signal?: AbortSignal;
}

const PRIMARY_AGENT_NAME = 'npm-remediation';
const PIPELINE_PHASES = ['scan-audit', 'remediation', 'final-report'] as const;
type PipelinePhaseId = (typeof PIPELINE_PHASES)[number];

interface AuditSummary {
	counts: Record<string, unknown>;
	remainingNames: string[];
}

interface RemainingItem {
	name: string;
	currentVersion?: string;
	isDirect: boolean;
	vulnerableRange?: string;
	patchedRange?: string;
	parents?: string[];
}

interface AuditReport {
	baseline: AuditSummary;
	postFix: AuditSummary;
	remaining: RemainingItem[];
}

export class Orchestrator {
	private activePhaseId?: PipelinePhaseId;

	constructor(
		private readonly session: ManagedSession,
		private readonly agents: Record<string, AgentDefinition>,
		private readonly workspaceRoot: string,
		private readonly callbacks: OrchestratorCallbacks,
	) {}

	async run(input: RunInput): Promise<void> {
		this.callbacks.onRunState('running');
		for (const id of PIPELINE_PHASES) {
			this.callbacks.onPhaseUpdate({ id, status: 'pending' });
		}

		try {
			const repositoryPath = await getRepositoryPath(input.repositoryPath);
			if (input.signal?.aborted) {
				this.callbacks.onRunState('cancelled');
				return;
			}
			this.emitOutput(`Validated repository path: ${repositoryPath}\n\n`);

			const auditReport = await this.runScanAuditPhase(repositoryPath, input.signal);
			if (input.signal?.aborted) {
				this.callbacks.onRunState('cancelled');
				return;
			}

			const preRemediationOverrides = await readOverrides(repositoryPath);
			await this.runRemediationPhase(repositoryPath, auditReport, input.signal);
			if (input.signal?.aborted) {
				this.callbacks.onRunState('cancelled');
				return;
			}

			await this.runFinalReportPhase(repositoryPath, auditReport, preRemediationOverrides, input.signal);

			this.emitOutput('\nRun complete.\n');
			this.callbacks.onRunState('complete');
		} catch (err) {
			if (this.activePhaseId) {
				this.callbacks.onPhaseUpdate({ id: this.activePhaseId, status: 'failed' });
				this.activePhaseId = undefined;
			}
			if (input.signal?.aborted) {
				this.callbacks.onRunState('cancelled');
				return;
			}
			this.callbacks.onRunState('failed');
			throw err;
		}
	}

	// Reserved for Plan C. Confirmation prompts proxy through the orchestrator
	// so the logic stays panel-agnostic.
	async requestConfirmation(phaseId: string, summary: string): Promise<boolean> {
		return this.callbacks.awaitConfirmation(phaseId, summary);
	}

	private async runScanAuditPhase(repositoryPath: string, signal?: AbortSignal): Promise<AuditReport> {
		this.markActive('scan-audit');
		this.emitOutput('=== Scan & audit ===\n');

		this.emitOutput('Running baseline npm audit...\n');
		const baseline = await runNpmAudit(repositoryPath, signal);
		this.emitOutput(`Baseline vulnerabilities: ${JSON.stringify(baseline.vulnerabilityCounts)}\n`);

		this.emitOutput('Running npm audit fix...\n');
		await runNpmAuditFix(repositoryPath, signal);

		this.emitOutput('Running post-fix npm audit...\n');
		const postFix = await runNpmAudit(repositoryPath, signal);
		this.emitOutput(`Post-fix vulnerabilities: ${JSON.stringify(postFix.vulnerabilityCounts)}\n`);

		this.emitOutput('Classifying dependency graph...\n');
		const lsRoot = await runNpmLs(repositoryPath, signal);
		const depMap = classifyDependencies(lsRoot);
		this.emitOutput(`Direct dependency count: ${depMap.directDeps.size}\n`);

		const report = buildAuditReport(baseline, postFix, depMap);
		this.emitOutput(`Remaining vulnerable packages to consider: ${report.remaining.length}\n\n`);

		this.markComplete('scan-audit');
		return report;
	}

	private async runRemediationPhase(
		repositoryPath: string,
		report: AuditReport,
		signal?: AbortSignal,
	): Promise<void> {
		this.markActive('remediation');
		this.emitOutput('=== Remediation ===\n');

		if (report.remaining.length === 0) {
			this.emitOutput('Nothing to do — no vulnerabilities remain after npm audit fix.\n\n');
			this.markComplete('remediation');
			return;
		}

		const agent = this.agents[PRIMARY_AGENT_NAME];
		if (!agent) {
			const loadedNames = Object.keys(this.agents);
			const discovered = loadedNames.length === 0 ? '<none>' : loadedNames.join(', ');
			throw new Error(
				`Agent "${PRIMARY_AGENT_NAME}" was not found. Loaded agents: ${discovered}.`,
			);
		}

		const currentOverrides = await readOverrides(repositoryPath);
		const prompt = buildRemediationPrompt(repositoryPath, report, currentOverrides);
		this.emitOutput(`Invoking ${agent.name}...\n\n`);

		await this.session.send(prompt, agent.name, {
			onDelta: (delta) => this.emitOutput(delta),
			signal,
		});

		this.emitOutput('\n');
		this.markComplete('remediation');
	}

	private async runFinalReportPhase(
		repositoryPath: string,
		auditReport: AuditReport,
		preRemediationOverrides: Record<string, string>,
		signal?: AbortSignal,
	): Promise<void> {
		this.markActive('final-report');
		this.emitOutput('=== Final report ===\n');

		this.emitOutput('Running post-remediation npm audit...\n');
		const postRemediation = await runNpmAudit(repositoryPath, signal);

		this.emitOutput('\nVulnerability counts:\n');
		this.emitOutput(`  Baseline:          ${JSON.stringify(auditReport.baseline.counts)}\n`);
		this.emitOutput(`  Post-audit-fix:    ${JSON.stringify(auditReport.postFix.counts)}\n`);
		this.emitOutput(`  Post-remediation:  ${JSON.stringify(postRemediation.vulnerabilityCounts)}\n`);

		const postOverrides = await readOverrides(repositoryPath);
		const diff = diffOverrides(preRemediationOverrides, postOverrides);
		this.emitOutput('\nOverride changes:\n');
		if (diff.length === 0) {
			this.emitOutput('  (none)\n');
		} else {
			for (const entry of diff) {
				this.emitOutput(`  ${entry}\n`);
			}
		}

		this.markComplete('final-report');
	}

	private markActive(id: PipelinePhaseId): void {
		this.activePhaseId = id;
		this.callbacks.onPhaseUpdate({ id, status: 'active' });
	}

	private markComplete(id: PipelinePhaseId): void {
		this.callbacks.onPhaseUpdate({ id, status: 'complete' });
		if (this.activePhaseId === id) {
			this.activePhaseId = undefined;
		}
	}

	private emitOutput(text: string): void {
		this.callbacks.onEvent({ type: 'output', payload: text });
	}
}

function extractVulnerablePackages(auditResults: NpmAuditResult): Record<string, any> {
	if (
		auditResults.vulnerabilityDetail &&
		typeof auditResults.vulnerabilityDetail === 'object' &&
		!Array.isArray(auditResults.vulnerabilityDetail)
	) {
		return auditResults.vulnerabilityDetail as Record<string, any>;
	}
	return {};
}

function buildAuditReport(
	baseline: NpmAuditResult,
	postFix: NpmAuditResult,
	depMap: DependencyMap,
): AuditReport {
	const baselineVulns = extractVulnerablePackages(baseline);
	const postFixVulns = extractVulnerablePackages(postFix);
	const baselineNames = Object.keys(baselineVulns);
	const postFixNames = Object.keys(postFixVulns);

	const remaining: RemainingItem[] = [];
	for (const name of postFixNames) {
		const info = postFixVulns[name];
		const isDirect = depMap.directDeps.has(name);
		const parents = depMap.parentsByPackage[name];

		let vulnerableRange: string | undefined;
		if (Array.isArray(info?.via)) {
			const first = info.via.find((v: any) => v && typeof v === 'object' && v.range);
			if (first) {
				vulnerableRange = String(first.range);
			}
		}

		let patchedRange: string | undefined;
		if (info?.fixAvailable && typeof info.fixAvailable === 'object' && info.fixAvailable.version) {
			patchedRange = String(info.fixAvailable.version);
		}

		remaining.push({
			name,
			currentVersion: info?.range ? String(info.range) : undefined,
			isDirect,
			vulnerableRange,
			patchedRange,
			parents: parents && parents.length > 0 ? parents : undefined,
		});
	}

	return {
		baseline: {
			counts: (baseline.vulnerabilityCounts as Record<string, unknown>) ?? {},
			remainingNames: baselineNames,
		},
		postFix: {
			counts: (postFix.vulnerabilityCounts as Record<string, unknown>) ?? {},
			remainingNames: postFixNames,
		},
		remaining,
	};
}

function buildRemediationPrompt(
	repositoryPath: string,
	report: AuditReport,
	currentOverrides: Record<string, string>,
): string {
	const lines: string[] = [];
	lines.push('Repository path:', repositoryPath, '');
	lines.push('Baseline vulnerability counts:', JSON.stringify(report.baseline.counts), '');
	lines.push('Post-`npm audit fix` vulnerability counts:', JSON.stringify(report.postFix.counts), '');
	lines.push('Existing package.json overrides:', JSON.stringify(currentOverrides, null, 2), '');
	lines.push(
		'Remaining vulnerable packages (direct/transitive already classified — do NOT re-run `npm audit` or `npm audit fix`):',
	);
	lines.push(JSON.stringify(report.remaining, null, 2));
	lines.push('');
	lines.push('Execute your remediation workflow now.');
	return lines.join('\n');
}

function diffOverrides(before: Record<string, string>, after: Record<string, string>): string[] {
	const entries: string[] = [];
	const allKeys = new Set<string>([...Object.keys(before), ...Object.keys(after)]);
	for (const key of Array.from(allKeys).sort()) {
		const b = before[key];
		const a = after[key];
		if (b === undefined && a !== undefined) {
			entries.push(`+ ${key}: ${a}`);
		} else if (b !== undefined && a === undefined) {
			entries.push(`- ${key}: was ${b}`);
		} else if (b !== a) {
			entries.push(`~ ${key}: ${b} → ${a}`);
		}
	}
	return entries;
}

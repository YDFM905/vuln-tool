import { runNpmAudit } from '../npm_tools/npmAuditRunner.js';
import { getRepositoryPath } from '../general_tools/repositoryInput.js';
import { runRemediationAgent } from '../agents/remediationAgentRunner.js';

export interface PipelineRunOptions {
	signal?: AbortSignal;
	onOutput?: (message: string) => void;
}

export async function runPipeline(repositoryPathInput: string, options: PipelineRunOptions = {}): Promise<void> {
	const emit = options.onOutput ?? (() => undefined);
	const repositoryPath = await getRepositoryPath(repositoryPathInput);
	if (options.signal?.aborted) {
		throw new Error('Run cancelled.');
	}

	emit(`Validated repository path: ${repositoryPath}\n`);
	emit('Running baseline npm audit...\n');

	const auditResults = await runNpmAudit(repositoryPath, options.signal);

	emit(`Baseline npm audit counts: ${JSON.stringify(auditResults.vulnerabilityCounts)}\n`);
	emit('Starting Copilot remediation agent...\n\n');

	const agentResult = await runRemediationAgent({
		repositoryPath,
		baselineAuditOutput: auditResults.rawOutput,
		signal: options.signal,
		onProgress: (chunk: string) => {
			emit(chunk);
		},
	});

	if (agentResult.parsedDecision) {
		emit('\n\nAgent final decision JSON:\n');
		emit(JSON.stringify(agentResult.parsedDecision, null, 2) + '\n');
	} else {
		emit('\n\nAgent returned non-JSON output:\n');
		emit(agentResult.finalText + '\n');
	}

	emit('\nRun complete.\n');

}
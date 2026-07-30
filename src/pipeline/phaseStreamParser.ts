import type { Phase } from './orchestrator.js';

export interface PhaseStreamParserCallbacks {
	onPhase: (phase: Phase) => void;
	onText: (text: string) => void;
}

const MARKER_REGEX = /^\s*<<<PHASE:([\w-]+):(active|complete|failed)>>>\s*$/;

/**
 * Splits an incoming text stream by newline, forwards non-marker lines
 * to `onText`, and routes recognized phase sentinel lines to `onPhase`.
 *
 * Marker format: `<<<PHASE:<id>:<active|complete|failed>>>>` on its own line.
 * Markers must appear on a line by themselves (leading/trailing whitespace
 * ignored). Any marker embedded in prose or a code block will NOT be detected
 * and will be forwarded as ordinary text.
 */
export class PhaseStreamParser {
	private buffer = '';
	private activePhaseId: string | undefined;

	constructor(private readonly callbacks: PhaseStreamParserCallbacks) {}

	push(chunk: string): void {
		this.buffer += chunk;

		let newlineIndex = this.buffer.indexOf('\n');
		while (newlineIndex !== -1) {
			const line = this.buffer.slice(0, newlineIndex);
			this.buffer = this.buffer.slice(newlineIndex + 1);
			this.dispatchLine(line, true);
			newlineIndex = this.buffer.indexOf('\n');
		}
	}

	flush(): void {
		if (this.buffer.length === 0) {
			return;
		}
		const tail = this.buffer;
		this.buffer = '';
		this.dispatchLine(tail, false);
	}

	getActivePhaseId(): string | undefined {
		return this.activePhaseId;
	}

	private dispatchLine(line: string, withNewline: boolean): void {
		const match = MARKER_REGEX.exec(line);
		if (match) {
			const id = match[1];
			const status = match[2] as 'active' | 'complete' | 'failed';
			if (status === 'active') {
				this.activePhaseId = id;
			} else if (this.activePhaseId === id) {
				this.activePhaseId = undefined;
			}
			this.callbacks.onPhase({ id, status });
			return;
		}
		this.callbacks.onText(withNewline ? line + '\n' : line);
	}
}

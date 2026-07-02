import type { EditorCommand, Surface } from '../types/index.js';

const DEFAULT_SURFACES: Surface[] = ['slash', 'plus'];

/**
 * Reactive command registry. One `EditorCommand` definition powers the slash
 * menu, plus menu, toolbar, and floating menu consistently.
 */
export class CommandRegistry {
	#commands = $state<EditorCommand[]>([]);

	get all(): readonly EditorCommand[] {
		return this.#commands;
	}

	/** Registers commands (replacing same-name entries). Returns an unregister fn. */
	register(...commands: EditorCommand[]): () => void {
		const names = new Set(commands.map((command) => command.name));
		this.#commands = [
			...this.#commands.filter((command) => !names.has(command.name)),
			...commands,
		];
		return () => {
			this.#commands = this.#commands.filter((command) => !commands.includes(command));
		};
	}

	get(name: string): EditorCommand | undefined {
		return this.#commands.find((command) => command.name === name);
	}

	forSurface(surface: Surface): EditorCommand[] {
		return this.#commands.filter((command) =>
			(command.surfaces ?? DEFAULT_SURFACES).includes(surface),
		);
	}

	/**
	 * Fuzzy search over label + keywords: subsequence match scored with
	 * start-of-word and consecutivity bonuses. Empty query returns all
	 * commands for the surface in registration order.
	 */
	search(query: string, surface: Surface): EditorCommand[] {
		const commands = this.forSurface(surface);
		const trimmed = query.trim().toLowerCase();
		if (!trimmed) return commands;
		return commands
			.map((command) => ({ command, score: scoreCommand(command, trimmed) }))
			.filter((entry) => entry.score > 0)
			.sort((a, b) => b.score - a.score)
			.map((entry) => entry.command);
	}
}

function scoreCommand(command: EditorCommand, query: string): number {
	let best = fuzzyScore(command.label.toLowerCase(), query) * 2;
	for (const keyword of command.keywords ?? []) {
		best = Math.max(best, fuzzyScore(keyword.toLowerCase(), query));
	}
	if (command.group)
		best = Math.max(best, fuzzyScore(command.group.toLowerCase(), query) * 0.5);
	return best;
}

/** Subsequence match: 0 = no match. Higher = better. */
function fuzzyScore(target: string, query: string): number {
	let score = 0;
	let targetIndex = 0;
	let lastMatch = -2;
	for (const char of query) {
		const found = target.indexOf(char, targetIndex);
		if (found === -1) return 0;
		score += 1;
		if (found === lastMatch + 1) score += 2; // consecutive
		if (found === 0 || target[found - 1] === ' ') score += 3; // word start
		lastMatch = found;
		targetIndex = found + 1;
	}
	// Prefer tighter matches in shorter targets
	return score + Math.max(0, 8 - target.length / 4);
}

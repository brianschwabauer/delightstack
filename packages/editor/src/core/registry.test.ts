import { describe, expect, it } from 'vitest';
import { CommandRegistry } from './registry.svelte.js';
import type { EditorCommand } from '../types/index.js';

function cmd(
	partial: Partial<EditorCommand> & { name: string; label: string },
): EditorCommand {
	return { run: () => true, ...partial };
}

describe('CommandRegistry', () => {
	it('registers, replaces by name, and unregisters', () => {
		const registry = new CommandRegistry();
		const unregister = registry.register(cmd({ name: 'a', label: 'First' }));
		registry.register(cmd({ name: 'a', label: 'Replaced' }));
		expect(registry.get('a')?.label).toBe('Replaced');
		expect(registry.all).toHaveLength(1);
		unregister();
		// unregister only removes its own instances (already replaced)
		expect(registry.get('a')?.label).toBe('Replaced');
	});

	it('filters by surface with slash+plus as the default', () => {
		const registry = new CommandRegistry();
		registry.register(
			cmd({ name: 'default_surfaces', label: 'Default' }),
			cmd({ name: 'toolbar_only', label: 'Toolbar', surfaces: ['toolbar'] }),
		);
		expect(registry.forSurface('slash').map((c) => c.name)).toEqual(['default_surfaces']);
		expect(registry.forSurface('plus').map((c) => c.name)).toEqual(['default_surfaces']);
		expect(registry.forSurface('toolbar').map((c) => c.name)).toEqual(['toolbar_only']);
	});

	it('fuzzy searches labels and keywords', () => {
		const registry = new CommandRegistry();
		registry.register(
			cmd({ name: 'heading_2', label: 'Heading 2', keywords: ['h2', 'title'] }),
			cmd({ name: 'heading_3', label: 'Heading 3', keywords: ['h3'] }),
			cmd({ name: 'bullet_list', label: 'Bullet list', keywords: ['ul', 'unordered'] }),
			cmd({ name: 'todo_list', label: 'To-do list', keywords: ['checkbox', 'task'] }),
		);
		expect(registry.search('h2', 'slash')[0]?.name).toBe('heading_2');
		expect(registry.search('bull', 'slash')[0]?.name).toBe('bullet_list');
		expect(registry.search('task', 'slash')[0]?.name).toBe('todo_list');
		expect(registry.search('xyzzy', 'slash')).toHaveLength(0);
		// Empty query returns everything in registration order
		expect(registry.search('', 'slash')).toHaveLength(4);
	});

	it('prefers word-start and consecutive matches', () => {
		const registry = new CommandRegistry();
		registry.register(
			cmd({ name: 'list', label: 'Bullet list' }),
			cmd({ name: 'link', label: 'Link' }),
		);
		expect(registry.search('li', 'slash')[0]?.name).toBe('link');
	});
});

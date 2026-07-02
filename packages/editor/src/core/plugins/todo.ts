import { Plugin, PluginKey } from 'prosemirror-state';

export const todoKey = new PluginKey('todo');

/**
 * Toggles a todo item's `checked` attr when its checkbox is clicked.
 * The checkbox is rendered by CSS (`li[data-todo]::before`), so the click
 * lands on the `li` itself only in the checkbox gutter — clicks on the text
 * hit the inner paragraph and fall through to normal editing.
 */
export function todoClicks(): Plugin {
	return new Plugin({
		key: todoKey,
		props: {
			handleClickOn(view, _pos, node, nodePos, event) {
				if (node.type.name !== 'todo_item') return false;
				const target = event.target;
				if (!(target instanceof HTMLElement) || target.tagName !== 'LI') return false;
				const checking = !node.attrs.checked;
				view.dispatch(
					view.state.tr
						.setNodeMarkup(nodePos, null, { ...node.attrs, checked: checking })
						.setMeta('addToHistory', true),
				);
				// One-shot check pop on the freshly rendered li (a class, not a
				// stateful style, so page loads and undo never replay it)
				if (checking) {
					const dom = view.nodeDOM(nodePos);
					if (dom instanceof HTMLElement) {
						dom.classList.add('ds-todo-pop');
						setTimeout(() => dom.classList.remove('ds-todo-pop'), 400);
					}
				}
				return true;
			},
		},
	});
}

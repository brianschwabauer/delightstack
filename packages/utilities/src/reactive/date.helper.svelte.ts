import { formatToString, type StringFormatOptions } from './../helpers/string.helper.js';
import { SvelteDate } from 'svelte/reactivity';

/** Returns the current timestamp (in epoch ms) that automatically updates every X ms  */
export function now(updateInterval = 10000) {
	const date = nowDate(updateInterval);
	return date.getTime();
}

/** Returns the current timestamp formatted as a string that automatically updates every X ms  */
export function nowString(
	options?:
		| (StringFormatOptions & { type: 'date' })
		| (StringFormatOptions & { type: 'relative-date' }),
	updateInterval = 10000,
) {
	const opts = options || { type: 'date' };
	const date = nowDate(updateInterval);
	return formatToString(date, opts);
}

/** Returns the current timestamp (in reactive date object) that automatically updates every X ms  */
export function nowDate(updateInterval = 10000) {
	if (updateInterval <= 0) return new SvelteDate(Date.now());
	const date = new SvelteDate(Date.now());
	$effect(() => {
		const interval = setInterval(() => {
			date.setTime(Date.now());
		}, updateInterval);
		return () => clearInterval(interval);
	});
	return date;
}

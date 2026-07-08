<script lang="ts" module>
	export interface CalendarEvent {
		/** Unique identifier for the event */
		id: string;
		/** The event title shown on the calendar */
		title: string;
		/** When the event starts */
		start: Date;
		/** When the event ends (omit for instantaneous/single-slot events) */
		end?: Date;
		/** Custom color for the event chip */
		color?: string;
		/** Whether the event spans the whole day (rendered in the all-day row) */
		allDay?: boolean;
	}

	export interface MarkedDate {
		/** The date to mark with an indicator dot */
		date: Date;
		/** Custom color for the indicator dot */
		color?: string;
		/** Accessible label / tooltip text describing the mark */
		label?: string;
	}
</script>

<script lang="ts">
	import { ripple } from '@delightstack/utilities';
	import { scrollbar } from '../actions/scrollbar';
	const propId = $props.id();

	let {
		/** Selected date(s) */
		value = $bindable(undefined) as Date | Date[] | [Date, Date] | undefined,

		/** Selection mode */
		mode = 'single' as 'single' | 'range' | 'multiple',

		/** Currently displayed month */
		month = $bindable(new Date()),

		/** Minimum selectable date */
		min = undefined as Date | undefined,

		/** Maximum selectable date */
		max = undefined as Date | undefined,

		/** Disabled dates or predicate */
		disabled = [] as Date[] | ((date: Date) => boolean),

		/** Dates with colored markers */
		marked = [] as MarkedDate[],

		/** Events to display */
		events = [] as CalendarEvent[],

		/** First day of week (0=Sun, 1=Mon, ...) */
		week_starts_on = 1 as 0 | 1 | 2 | 3 | 4 | 5 | 6,

		/** BCP 47 locale string */
		locale = undefined as string | undefined,

		/** Show time slot picker */
		show_time_slots = false,

		/** Time slot interval in minutes */
		time_slot_interval = 30,

		/** Earliest time slot */
		time_slot_min = '00:00',

		/** Latest time slot */
		time_slot_max = '23:59',

		/** Compact spacing */
		dense = false,

		/** Relaxed spacing */
		comfortable = false,

		/** Fill the container with a subtle surface so it reads as a card.
		 * Transparent by default so the calendar composes onto any surface. */
		filled = false,

		/** Give the container a 1px outline + rounded corners (transparent fill).
		 * Visible rounded card edge without imposing a surface fill. */
		outline = false,

		/** Loading skeleton */
		skeleton = false,

		/** Element ID */
		id = propId,

		/** Additional CSS classes */
		class: class_name = '',

		/** Selection changed */
		onselect = undefined as
			| ((payload: { value: Date | Date[] | [Date, Date] }) => void)
			| undefined,

		/** Month navigated */
		onmonthchange = undefined as ((payload: { month: Date }) => void) | undefined,

		/** Time slot selected */
		ontimeslotselect = undefined as
			| ((payload: { time: string; date: Date }) => void)
			| undefined,
	} = $props();

	/* ------------------------------------------------------------------ */
	/*  Date helpers (all comparisons strip time)                         */
	/* ------------------------------------------------------------------ */

	function toDateKey(d: Date): string {
		return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
	}

	function sameDay(a: Date, b: Date): boolean {
		return (
			a.getFullYear() === b.getFullYear() &&
			a.getMonth() === b.getMonth() &&
			a.getDate() === b.getDate()
		);
	}

	function stripTime(d: Date): Date {
		return new Date(d.getFullYear(), d.getMonth(), d.getDate());
	}

	function addDays(d: Date, n: number): Date {
		const r = new Date(d);
		r.setDate(r.getDate() + n);
		return r;
	}

	function isBefore(a: Date, b: Date): boolean {
		return stripTime(a).getTime() < stripTime(b).getTime();
	}

	function isAfter(a: Date, b: Date): boolean {
		return stripTime(a).getTime() > stripTime(b).getTime();
	}

	function isBetween(d: Date, start: Date, end: Date): boolean {
		const t = stripTime(d).getTime();
		const s = stripTime(start).getTime();
		const e = stripTime(end).getTime();
		const lo = Math.min(s, e);
		const hi = Math.max(s, e);
		return t >= lo && t <= hi;
	}

	/* ------------------------------------------------------------------ */
	/*  Locale-aware formatting                                           */
	/* ------------------------------------------------------------------ */

	const month_year_formatter = $derived(
		new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }),
	);

	const day_name_formatter = $derived(
		new Intl.DateTimeFormat(locale, { weekday: 'short' }),
	);

	/* ------------------------------------------------------------------ */
	/*  Grid computation                                                  */
	/* ------------------------------------------------------------------ */

	const today = $derived(stripTime(new Date()));

	const view_year = $derived(month.getFullYear());
	const view_month = $derived(month.getMonth());

	const header_label = $derived(
		month_year_formatter.format(new Date(view_year, view_month, 1)),
	);

	/** Day-of-week headers respecting week_starts_on */
	const weekday_headers = $derived.by(() => {
		const headers: string[] = [];
		// Use a known reference: Jan 4 2026 is a Sunday (day 0)
		for (let i = 0; i < 7; i++) {
			const day_index = (week_starts_on + i) % 7;
			// Build a date that is the correct weekday
			// Jan 4 2026 = Sunday. Add day_index to get desired weekday.
			const ref = new Date(2026, 0, 4 + day_index);
			headers.push(day_name_formatter.format(ref));
		}
		return headers;
	});

	interface CalendarDay {
		date: Date;
		key: string;
		day_number: number;
		is_current_month: boolean;
		is_today: boolean;
		is_disabled: boolean;
		is_selected: boolean;
		is_range_start: boolean;
		is_range_end: boolean;
		is_in_range: boolean;
		is_range_hover: boolean;
		markers: MarkedDate[];
		day_events: CalendarEvent[];
	}

	/** Compute full 6-week grid of days */
	const calendar_days = $derived.by(() => {
		const first_of_month = new Date(view_year, view_month, 1);
		const first_weekday = first_of_month.getDay(); // 0=Sun
		// How many days to go back to reach the start of the grid
		const offset = (first_weekday - week_starts_on + 7) % 7;
		const grid_start = addDays(first_of_month, -offset);

		const days: CalendarDay[] = [];
		for (let i = 0; i < 42; i++) {
			const date = addDays(grid_start, i);
			const key = toDateKey(date);
			const is_current_month =
				date.getMonth() === view_month && date.getFullYear() === view_year;

			days.push({
				date,
				key,
				day_number: date.getDate(),
				is_current_month,
				is_today: sameDay(date, today),
				is_disabled: isDateDisabled(date),
				is_selected: isDateSelected(date),
				is_range_start: isRangeStart(date),
				is_range_end: isRangeEnd(date),
				is_in_range: isInRange(date),
				is_range_hover: isRangeHover(date),
				markers: getMarkers(date),
				day_events: getEvents(date),
			});
		}
		return days;
	});

	/** Determine if a row (week) is fully outside the month -- trim to 5 or 6 rows */
	const visible_days = $derived.by(() => {
		const days = calendar_days;
		// Check if last row (days 35-41) has any current-month days
		const last_row = days.slice(35);
		const has_current_month = last_row.some((d) => d.is_current_month);
		return has_current_month ? days : days.slice(0, 35);
	});

	/* ------------------------------------------------------------------ */
	/*  Disabled check                                                    */
	/* ------------------------------------------------------------------ */

	function isDateDisabled(date: Date): boolean {
		if (min && isBefore(date, min)) return true;
		if (max && isAfter(date, max)) return true;
		if (typeof disabled === 'function') return disabled(date);
		if (Array.isArray(disabled)) {
			return disabled.some((d) => sameDay(d, date));
		}
		return false;
	}

	/* ------------------------------------------------------------------ */
	/*  Selection state                                                   */
	/* ------------------------------------------------------------------ */

	function isDateSelected(date: Date): boolean {
		if (!value) return false;
		if (mode === 'single') {
			return value instanceof Date && sameDay(value, date);
		}
		if (mode === 'multiple') {
			return Array.isArray(value) && (value as Date[]).some((d) => sameDay(d, date));
		}
		if (mode === 'range') {
			if (!Array.isArray(value)) return false;
			const [start, end] = value as [Date, Date];
			if (start && sameDay(start, date)) return true;
			if (end && sameDay(end, date)) return true;
			return false;
		}
		return false;
	}

	function isRangeStart(date: Date): boolean {
		if (mode !== 'range' || !Array.isArray(value)) return false;
		const [start] = value as [Date, Date | undefined];
		return start ? sameDay(start, date) : false;
	}

	function isRangeEnd(date: Date): boolean {
		if (mode !== 'range' || !Array.isArray(value)) return false;
		const [, end] = value as [Date, Date | undefined];
		return end ? sameDay(end, date) : false;
	}

	function isInRange(date: Date): boolean {
		if (mode !== 'range' || !Array.isArray(value)) return false;
		const [start, end] = value as [Date, Date | undefined];
		if (!start || !end) return false;
		return isBetween(date, start, end) && !sameDay(date, start) && !sameDay(date, end);
	}

	let hover_date = $state<Date | null>(null);

	function isRangeHover(date: Date): boolean {
		if (mode !== 'range') return false;
		if (!Array.isArray(value)) return false;
		const [start, end] = value as [Date, Date | undefined];
		if (!start || end) return false;
		if (!hover_date) return false;
		return isBetween(date, start, hover_date) && !sameDay(date, start);
	}

	/* ------------------------------------------------------------------ */
	/*  Markers & events                                                  */
	/* ------------------------------------------------------------------ */

	function getMarkers(date: Date): MarkedDate[] {
		return marked.filter((m) => sameDay(m.date, date));
	}

	function getEvents(date: Date): CalendarEvent[] {
		return events.filter((e) => {
			if (e.end) {
				return (
					isBetween(date, e.start, e.end) ||
					sameDay(date, e.start) ||
					sameDay(date, e.end)
				);
			}
			return sameDay(e.start, date);
		});
	}

	/* ------------------------------------------------------------------ */
	/*  Time slots                                                        */
	/* ------------------------------------------------------------------ */

	function parseTime(str: string): { hours: number; minutes: number } {
		const [h, m] = str.split(':').map(Number);
		return { hours: h, minutes: m };
	}

	const time_slots = $derived.by(() => {
		if (!show_time_slots) return [];
		const start = parseTime(time_slot_min);
		const end = parseTime(time_slot_max);
		const start_minutes = start.hours * 60 + start.minutes;
		const end_minutes = end.hours * 60 + end.minutes;
		// A zero/negative/NaN interval would loop forever and freeze the tab
		const interval =
			Number.isFinite(time_slot_interval) && time_slot_interval >= 1
				? time_slot_interval
				: 30;
		const slots: string[] = [];
		for (let m = start_minutes; m <= end_minutes; m += interval) {
			const h = Math.floor(m / 60);
			const min = m % 60;
			slots.push(`${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`);
		}
		return slots;
	});

	const time_formatter = $derived(
		new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' }),
	);

	function formatTimeSlot(slot: string): string {
		const { hours, minutes } = parseTime(slot);
		const d = new Date(2000, 0, 1, hours, minutes);
		return time_formatter.format(d);
	}

	/* ------------------------------------------------------------------ */
	/*  Navigation                                                        */
	/* ------------------------------------------------------------------ */

	function navigateMonth(delta: number) {
		const new_month = new Date(view_year, view_month + delta, 1);
		month = new_month;
		onmonthchange?.({ month: new_month });
	}

	/* ------------------------------------------------------------------ */
	/*  Selection                                                         */
	/* ------------------------------------------------------------------ */

	function selectDate(date: Date) {
		if (isDateDisabled(date)) return;

		const stripped = stripTime(date);

		if (mode === 'single') {
			value = stripped;
			onselect?.({ value: stripped });
		} else if (mode === 'multiple') {
			const current = Array.isArray(value) ? [...(value as Date[])] : [];
			const idx = current.findIndex((d) => sameDay(d, stripped));
			if (idx >= 0) {
				current.splice(idx, 1);
			} else {
				current.push(stripped);
			}
			value = current;
			onselect?.({ value: current });
		} else if (mode === 'range') {
			if (
				!Array.isArray(value) ||
				((value as [Date, Date | undefined]).length === 2 && (value as [Date, Date])[1])
			) {
				// Start new range
				value = [stripped] as unknown as [Date, Date];
				onselect?.({ value: [stripped] as unknown as [Date, Date] });
			} else {
				const [start] = value as [Date];
				const pair: [Date, Date] = isBefore(stripped, start)
					? [stripped, start]
					: [start, stripped];
				value = pair;
				onselect?.({ value: pair });
			}
		}

		// If date is in a different month, navigate to it
		if (date.getMonth() !== view_month || date.getFullYear() !== view_year) {
			const new_month = new Date(date.getFullYear(), date.getMonth(), 1);
			month = new_month;
			onmonthchange?.({ month: new_month });
		}
	}

	let selected_slot = $state<string | null>(null);

	function selectTimeSlot(slot: string) {
		selected_slot = slot;
		const selected_date = mode === 'single' && value instanceof Date ? value : today;
		const { hours, minutes } = parseTime(slot);
		const date_with_time = new Date(
			selected_date.getFullYear(),
			selected_date.getMonth(),
			selected_date.getDate(),
			hours,
			minutes,
		);
		ontimeslotselect?.({ time: slot, date: date_with_time });
	}

	/* ------------------------------------------------------------------ */
	/*  Keyboard navigation                                               */
	/* ------------------------------------------------------------------ */

	let focused_date = $state<Date | null>(null);

	function ensureFocusedDate(): Date {
		if (focused_date) return focused_date;
		if (mode === 'single' && value instanceof Date) return stripTime(value);
		if (mode === 'range' && Array.isArray(value) && value.length > 0)
			return stripTime((value as Date[])[0]);
		if (mode === 'multiple' && Array.isArray(value) && value.length > 0)
			return stripTime((value as Date[])[0]);
		// Default to today if it's in the current month, otherwise first of month
		if (today.getMonth() === view_month && today.getFullYear() === view_year)
			return today;
		return new Date(view_year, view_month, 1);
	}

	function focusCell(date: Date) {
		focused_date = stripTime(date);
		// Navigate month if needed
		if (date.getMonth() !== view_month || date.getFullYear() !== view_year) {
			const new_month = new Date(date.getFullYear(), date.getMonth(), 1);
			month = new_month;
			onmonthchange?.({ month: new_month });
		}
		// Focus the DOM element after update
		requestAnimationFrame(() => {
			const key = toDateKey(date);
			const el = document.querySelector(
				`[data-calendar-id="${id}"] [data-date="${key}"]`,
			) as HTMLElement | null;
			el?.focus();
		});
	}

	function handleGridKeyDown(e: KeyboardEvent) {
		const current = ensureFocusedDate();
		let next: Date | null = null;

		switch (e.key) {
			case 'ArrowLeft':
				e.preventDefault();
				next = addDays(current, -1);
				break;
			case 'ArrowRight':
				e.preventDefault();
				next = addDays(current, 1);
				break;
			case 'ArrowUp':
				e.preventDefault();
				next = addDays(current, -7);
				break;
			case 'ArrowDown':
				e.preventDefault();
				next = addDays(current, 7);
				break;
			case 'PageUp':
				e.preventDefault();
				if (e.shiftKey) {
					next = new Date(
						current.getFullYear() - 1,
						current.getMonth(),
						current.getDate(),
					);
				} else {
					next = new Date(
						current.getFullYear(),
						current.getMonth() - 1,
						current.getDate(),
					);
				}
				break;
			case 'PageDown':
				e.preventDefault();
				if (e.shiftKey) {
					next = new Date(
						current.getFullYear() + 1,
						current.getMonth(),
						current.getDate(),
					);
				} else {
					next = new Date(
						current.getFullYear(),
						current.getMonth() + 1,
						current.getDate(),
					);
				}
				break;
			case 'Home':
				e.preventDefault();
				{
					const day_of_week = current.getDay();
					const diff = (day_of_week - week_starts_on + 7) % 7;
					next = addDays(current, -diff);
				}
				break;
			case 'End':
				e.preventDefault();
				{
					const day_of_week = current.getDay();
					const diff = (day_of_week - week_starts_on + 7) % 7;
					next = addDays(current, 6 - diff);
				}
				break;
			case 'Enter':
			case ' ':
				e.preventDefault();
				selectDate(current);
				return;
			default:
				return;
		}

		if (next) {
			focusCell(next);
		}
	}

	function handleDayFocus(date: Date) {
		focused_date = stripTime(date);
	}

	function handleDayHover(date: Date) {
		hover_date = stripTime(date);
	}

	function handleGridMouseLeave() {
		hover_date = null;
	}
</script>

<!-- Skeleton and live calendar share one DOM structure so the loading state
	 has the exact size/shape/layout of the real calendar (no content shift on
	 swap) — only the leaf content (numbers/words) becomes a shimmer. -->
<div
	class={['calendar', class_name].filter(Boolean).join(' ')}
	class:dense
	class:comfortable
	class:filled
	class:outline
	class:skeleton
	class:has-time-slots={show_time_slots}
	{id}
	data-calendar-id={id}
	role="group"
	aria-label="Calendar"
	aria-busy={skeleton || undefined}
	aria-hidden={skeleton || undefined}>
	<div class="main">
		<!-- Header -->
		<div class="header">
			<button
				type="button"
				class="nav"
				aria-label="Previous month"
				disabled={skeleton}
				onclick={skeleton ? undefined : () => navigateMonth(-1)}
				{@attach ripple({ enabled: !skeleton, zIndex: 1 })}>
				{#if skeleton}
					<span class="skeleton-fill skeleton-nav"></span>
				{:else}
					<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
						<path
							d="M10 3L5 8L10 13"
							stroke="currentColor"
							stroke-width="1.5"
							stroke-linecap="round"
							stroke-linejoin="round" />
					</svg>
				{/if}
			</button>
			<!-- The real label stays in the DOM (rendered transparent under the
				 shimmer) so the skeleton keeps the live calendar's exact metrics. -->
			<div class="title" aria-live="polite">
				{header_label}
				{#if skeleton}
					<span class="skeleton-fill skeleton-title"></span>
				{/if}
			</div>
			<button
				type="button"
				class="nav"
				aria-label="Next month"
				disabled={skeleton}
				onclick={skeleton ? undefined : () => navigateMonth(1)}
				{@attach ripple({ enabled: !skeleton, zIndex: 1 })}>
				{#if skeleton}
					<span class="skeleton-fill skeleton-nav"></span>
				{:else}
					<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
						<path
							d="M6 3L11 8L6 13"
							stroke="currentColor"
							stroke-width="1.5"
							stroke-linecap="round"
							stroke-linejoin="round" />
					</svg>
				{/if}
			</button>
		</div>

		<!-- Weekday headers -->
		<div class="weekdays" role="row">
			{#each weekday_headers as header}
				<div class="weekday" role="columnheader" aria-label={header}>
					{header}
					{#if skeleton}
						<span class="skeleton-fill skeleton-weekday"></span>
					{/if}
				</div>
			{/each}
		</div>

		<!-- Day grid -->
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
		<!-- svelte-ignore a11y_interactive_supports_focus -->
		<div
			class="grid"
			role="grid"
			tabindex={skeleton ? -1 : 0}
			aria-label="Calendar dates"
			onkeydown={skeleton ? undefined : handleGridKeyDown}
			onmouseleave={skeleton ? undefined : handleGridMouseLeave}>
			{#each visible_days as day, i (day.key)}
				{@const has_dots = day.markers.length > 0 || day.day_events.length > 0}
				{@const dot_items = [
					...day.markers
						.slice(0, 3)
						.map((m) => m.color || 'var(--color-action, #3b82f6)'),
					...day.day_events
						.slice(0, Math.max(0, 3 - day.markers.length))
						.map((e) => e.color || 'var(--color-action, #3b82f6)'),
				].slice(0, 3)}
				{@const marker_labels = day.markers
					.filter((m) => m.label)
					.map((m) => m.label)
					.join(', ')}
				{@const event_labels = day.day_events.map((e) => e.title).join(', ')}
				{@const aria_desc_parts = [marker_labels, event_labels]
					.filter(Boolean)
					.join('; ')}
				<button
					type="button"
					class="day"
					class:other-month={!day.is_current_month}
					class:today={!skeleton && day.is_today}
					class:selected={!skeleton && day.is_selected}
					class:range-start={!skeleton && day.is_range_start}
					class:range-end={!skeleton && day.is_range_end}
					class:in-range={!skeleton && day.is_in_range}
					class:range-hover={!skeleton && day.is_range_hover}
					class:disabled={!skeleton && day.is_disabled}
					role="gridcell"
					aria-selected={!skeleton && day.is_selected}
					aria-disabled={skeleton || day.is_disabled}
					aria-label={`${day.date.getDate()}${day.is_today ? ', today' : ''}${aria_desc_parts ? `, ${aria_desc_parts}` : ''}`}
					tabindex={skeleton
						? -1
						: focused_date
							? sameDay(day.date, focused_date)
								? 0
								: -1
							: day.is_today && day.is_current_month
								? 0
								: -1}
					data-date={day.key}
					disabled={skeleton || day.is_disabled}
					onclick={skeleton ? undefined : () => selectDate(day.date)}
					onfocus={skeleton ? undefined : () => handleDayFocus(day.date)}
					onmouseenter={skeleton ? undefined : () => handleDayHover(day.date)}
					{@attach ripple({ enabled: !skeleton && !day.is_disabled, zIndex: 1 })}>
					<!-- Number stays in the DOM (transparent under the disc when
						 skeleton) so cell metrics are identical across the swap. -->
					<span class="number">{day.day_number}</span>
					{#if skeleton}
						<span class="skeleton-fill skeleton-day" style:--shimmer-delay="{i * 25}ms">
						</span>
					{:else if has_dots}
						<div class="dots">
							{#each dot_items as color}
								<span class="dot" style:background={color}></span>
							{/each}
						</div>
					{/if}
				</button>
			{/each}
		</div>
	</div>

	<!-- Time slots panel -->
	{#if show_time_slots}
		<div class="slots" role="listbox" aria-label="Time slots" {@attach scrollbar()}>
			{#if skeleton}
				{#each { length: 8 } as _, i}
					<div class="slot" aria-hidden="true">
						<span class="skeleton-fill skeleton-slot" style:--shimmer-delay="{i * 40}ms">
						</span>
					</div>
				{/each}
			{:else}
				{#each time_slots as slot}
					<button
						type="button"
						class="slot"
						class:selected={selected_slot === slot}
						role="option"
						aria-selected={selected_slot === slot}
						onclick={() => selectTimeSlot(slot)}
						{@attach ripple({ zIndex: 1 })}>
						{formatTimeSlot(slot)}
					</button>
				{/each}
			{/if}
		</div>
	{/if}
</div>

<style>
	/* ========== Container ========== */
	.calendar {
		display: inline-flex;
		font-family: inherit;
		color: light-dark(var(--color-text, #1a1a1a), var(--color-text, #f5f5f5));
		user-select: none;
		-webkit-tap-highlight-color: transparent;
		/* Generous, concentric corners (the inner padding + cell radius nests
		   neatly inside). Transparent by default so the calendar composes onto
		   any surface; `filled`/`outline` give it a card edge. */
		/* Clamp so an over-rounded radius token can't blob the calendar — see
		   --radius-cap. Variants just reassign --_radius; the base border-radius
		   + squircle block below pick it up. */
		--_radius: min(var(--radius-xl, 20px), var(--radius-cap, 40px));
		border-radius: var(--_radius);
		@supports (corner-shape: squircle) {
			corner-shape: squircle;
			border-radius: calc(var(--_radius) * var(--squircle-ratio, 2));
		}
		background: transparent;

		&.dense {
			--_radius: min(var(--radius-lg, 10px), var(--radius-cap, 40px));
		}

		&.comfortable {
			--_radius: min(var(--radius-2xl, 30px), var(--radius-cap, 40px));
		}

		&.filled {
			background: var(--color-bg-active);
		}

		&.outline {
			border: 1px solid var(--color-border);
		}

		/* Clip the side-by-side panels + their divider to the rounded corners. */
		&.has-time-slots {
			overflow: hidden;
		}
	}

	.main {
		display: flex;
		flex-direction: column;
	}

	/* ========== Header ========== */
	.header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.75rem;
		gap: 0.5rem;

		.dense & {
			padding: 0.375rem 0.5rem;
		}

		.comfortable & {
			padding: 1rem 1.25rem;
		}
	}

	.title {
		flex: 1;
		text-align: center;
		font-weight: 600;
		font-size: 0.9375rem;
		white-space: nowrap;

		.dense & {
			font-size: 0.8125rem;
		}

		.comfortable & {
			font-size: 1.0625rem;
		}
	}

	.nav {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 2rem;
		height: 2rem;
		border: none;
		background: transparent;
		border-radius: var(--radius-md, 0.25rem);
		@supports (corner-shape: squircle) {
			corner-shape: squircle;
			border-radius: calc(var(--radius-md, 0.25rem) * var(--squircle-ratio, 2));
		}
		cursor: pointer;
		color: light-dark(var(--color-text, #1a1a1a), var(--color-text, #f5f5f5));
		flex-shrink: 0;
		padding: 0;
		position: relative;
		overflow: hidden;
		transition:
			background 120ms ease,
			transform 200ms ease;

		&:hover {
			background: light-dark(
				rgb(from var(--color-text, #000) r g b / 0.06),
				rgb(from var(--color-text, #fff) r g b / 0.08)
			);
			transition: transform 200ms ease;
		}
		/* Per-button perspective so the press recedes toward this button's own
		 * center, not the calendar's center. */
		&:active {
			transform: perspective(20px)
				translate3d(0px, 1px, clamp(-10px, calc(0.2em - 12px), -2px));
		}

		&:focus-visible {
			outline: 2px solid var(--color-action, #3b82f6);
			outline-offset: -2px;
		}

		.dense & {
			width: 1.5rem;
			height: 1.5rem;
		}

		.comfortable & {
			width: 2.25rem;
			height: 2.25rem;
		}
	}

	/* ========== Weekday Headers ========== */
	.weekdays {
		display: grid;
		grid-template-columns: repeat(7, 1fr);
		gap: 2px;
		padding: 0 0.75rem;

		.dense & {
			padding: 0 0.5rem;
		}

		.comfortable & {
			padding: 0 1.25rem;
		}
	}

	.weekday {
		text-align: center;
		font-size: 0.6875rem;
		font-weight: 500;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		padding: 0.25rem 0;
		color: light-dark(var(--color-text-muted, #6b7280), var(--color-text-muted, #9ca3af));

		.dense & {
			font-size: 0.625rem;
			padding: 0.125rem 0;
		}

		.comfortable & {
			font-size: 0.75rem;
			padding: 0.375rem 0;
		}
	}

	/* ========== Day Grid ========== */
	.grid {
		display: grid;
		grid-template-columns: repeat(7, 1fr);
		gap: 2px;
		padding: 0.375rem 0.75rem 0.75rem;

		.dense & {
			padding: 0.25rem 0.5rem 0.5rem;
		}

		.comfortable & {
			padding: 0.5rem 1.25rem 1.25rem;
		}
	}

	/* ========== Day Cell ========== */
	.day {
		position: relative;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		aspect-ratio: 1;
		border: none;
		background: transparent;
		border-radius: var(--radius-md, 0.25rem);
		@supports (corner-shape: squircle) {
			corner-shape: squircle;
			border-radius: calc(var(--radius-md, 0.25rem) * var(--squircle-ratio, 2));
		}
		cursor: pointer;
		padding: 0;
		font-size: 0.8125rem;
		font-family: inherit;
		font-variant-numeric: tabular-nums;
		color: light-dark(var(--color-text, #1a1a1a), var(--color-text, #f5f5f5));
		overflow: hidden;
		transition:
			background 100ms ease,
			color 100ms ease,
			transform 200ms ease;
		outline: none;

		&:hover:not(.disabled) {
			background: light-dark(
				rgb(from var(--color-text, #000) r g b / 0.06),
				rgb(from var(--color-text, #fff) r g b / 0.08)
			);
			transition: transform 200ms ease;
		}
		/* Per-button perspective so the press recedes toward this cell's own
		 * center, not the grid's center. */
		&:active:not(.disabled) {
			transform: perspective(100px)
				translate3d(0px, 1px, clamp(-10px, calc(0.2em - 12px), -2px));
		}

		&:focus-visible {
			box-shadow: inset 0 0 0 2px var(--color-action, #3b82f6);
			z-index: 1;
		}

		.dense & {
			font-size: 0.75rem;
		}

		.comfortable & {
			font-size: 0.875rem;
		}

		/* Other month */
		&.other-month {
			color: light-dark(
				var(--color-text-muted, #6b7280),
				var(--color-text-muted, #9ca3af)
			);
			opacity: 0.4;
		}

		/* Today ring */
		&.today {
			box-shadow: inset 0 0 0 1.5px
				light-dark(var(--color-border, #d1d5db), var(--color-border, #4b5563));
		}

		/* Selected */
		&.selected {
			background: var(--color-action, #3b82f6);
			color: var(--color-action-text, #fff);

			&:hover:not(.disabled) {
				background: var(--color-action, #3b82f6);
				filter: brightness(1.1);
				transition: none;
			}

			&.today {
				box-shadow: none;
			}
		}

		/* Range start/end */
		&.range-start {
			border-radius: var(--radius-md, 0.25rem) 0 0 var(--radius-md, 0.25rem);
			@supports (corner-shape: squircle) {
				corner-shape: squircle;
				border-radius: calc(var(--radius-md, 0.25rem) * var(--squircle-ratio, 2)) 0 0
					calc(var(--radius-md, 0.25rem) * var(--squircle-ratio, 2));
			}
			background: var(--color-action, #3b82f6);
			color: var(--color-action-text, #fff);
		}

		&.range-end {
			border-radius: 0 var(--radius-md, 0.25rem) var(--radius-md, 0.25rem) 0;
			@supports (corner-shape: squircle) {
				corner-shape: squircle;
				border-radius: 0 calc(var(--radius-md, 0.25rem) * var(--squircle-ratio, 2))
					calc(var(--radius-md, 0.25rem) * var(--squircle-ratio, 2)) 0;
			}
			background: var(--color-action, #3b82f6);
			color: var(--color-action-text, #fff);
		}

		&.range-start.range-end {
			border-radius: var(--radius-md, 0.25rem);
			@supports (corner-shape: squircle) {
				corner-shape: squircle;
				border-radius: calc(var(--radius-md, 0.25rem) * var(--squircle-ratio, 2));
			}
		}

		/* In-range fill */
		&.in-range {
			background: light-dark(
				rgb(from var(--color-action, #3b82f6) r g b / 0.12),
				rgb(from var(--color-action, #3b82f6) r g b / 0.2)
			);
			border-radius: 0;
		}

		/* Range hover preview */
		&.range-hover {
			background: light-dark(
				rgb(from var(--color-action, #3b82f6) r g b / 0.08),
				rgb(from var(--color-action, #3b82f6) r g b / 0.14)
			);
			border-radius: 0;
		}

		/* Disabled */
		&.disabled {
			opacity: 0.3;
			cursor: not-allowed;
		}
	}

	/* ========== Day number ========== */
	.number {
		line-height: 1;
	}

	/* ========== Dots (markers & events) ========== */
	.dots {
		display: flex;
		gap: 2px;
		position: absolute;
		bottom: 3px;
		left: 50%;
		transform: translateX(-50%);

		.dense & {
			bottom: 1px;
		}

		.comfortable & {
			bottom: 5px;
		}
	}

	.dot {
		width: 4px;
		height: 4px;
		border-radius: 50%;
		flex-shrink: 0;

		.dense & {
			width: 3px;
			height: 3px;
		}
	}

	/* ========== Time Slots ========== */
	.slots {
		display: flex;
		flex-direction: column;
		/* Hairline divider from the day grid; both panels stay transparent so the
		   container's fill (when `filled`) shows through evenly. */
		border-left: 1px solid var(--color-border);
		overflow-y: auto;
		overscroll-behavior: contain;
		max-height: 320px;
		min-width: 6rem;
		padding: 0.5rem;
		gap: 3px;

		.dense & {
			min-width: 5rem;
			max-height: 260px;
			padding: 0.375rem;
			gap: 2px;
		}

		.comfortable & {
			min-width: 7rem;
			max-height: 400px;
			padding: 0.625rem;
			gap: 4px;
		}
	}

	.slot {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0.5rem 0.75rem;
		font-size: 0.8125rem;
		font-weight: 500;
		font-family: inherit;
		font-variant-numeric: tabular-nums;
		border: 1px solid transparent;
		background: transparent;
		border-radius: var(--radius-md, 5px);
		@supports (corner-shape: squircle) {
			corner-shape: squircle;
			border-radius: calc(var(--radius-md, 5px) * var(--squircle-ratio, 2));
		}
		cursor: pointer;
		color: light-dark(var(--color-text, #1a1a1a), var(--color-text, #f5f5f5));
		white-space: nowrap;
		position: relative;
		overflow: hidden;
		flex-shrink: 0;
		/* OUT transition — ease colors back to rest on leave (per the snap-in,
		   ease-out hover convention). */
		transition:
			background 200ms ease,
			border-color 200ms ease,
			color 200ms ease,
			transform 200ms ease;

		&:hover:not(.selected) {
			background: light-dark(
				rgb(from var(--color-text, #000) r g b / 0.06),
				rgb(from var(--color-text, #fff) r g b / 0.08)
			);
			border-color: var(--color-border);
			/* IN transition — omit the colors so they snap in; keep the press. */
			transition: transform 200ms ease;
		}
		/* Per-button perspective so the press recedes toward this slot's own
		 * center, not the column's center. */
		&:active {
			transform: perspective(100px)
				translate3d(0px, 1px, clamp(-10px, calc(0.2em - 12px), -2px));
		}

		&:focus-visible {
			outline: 2px solid var(--color-action, #3b82f6);
			outline-offset: -2px;
		}

		/* Picked slot — solid action fill, like a selected day. */
		&.selected {
			background: var(--color-action, #3b82f6);
			border-color: var(--color-action, #3b82f6);
			color: var(--color-action-text, #fff);
			font-weight: 600;

			&:hover {
				filter: brightness(1.08);
			}
		}

		.dense & {
			padding: 0.375rem 0.5rem;
			font-size: 0.75rem;
		}

		.comfortable & {
			padding: 0.625rem 0.875rem;
			font-size: 0.875rem;
		}
	}

	/* ========== Skeleton ========== */
	/* The skeleton renders the *same* markup as the live calendar (same header,
	   weekday row, 7-col grid, time-slot column) — only the leaf content swaps
	   to a shimmer. So the placeholder element just sits inside the real layout
	   slot it stands in for; that's what guarantees no content shift on swap. */
	.calendar.skeleton {
		pointer-events: none;

		/* Hide the real leaf text but keep it in the box so it still drives the
		   intrinsic width/height the live calendar will use — the shimmer overlays
		   it absolutely. This is what eliminates the skeleton→live content shift. */
		.title,
		.weekday,
		.number {
			color: transparent;
		}

		.title,
		.weekday {
			position: relative;
		}
	}

	/* Shimmer placeholder primitive (reused for every skeletonized leaf). */
	.skeleton-fill {
		display: block;
		border-radius: var(--radius-sm, 2px);
		@supports (corner-shape: squircle) {
			corner-shape: squircle;
			border-radius: calc(var(--radius-sm, 2px) * var(--squircle-ratio, 2));
		}
		background: var(--skeleton-bg, rgb(from var(--color-text, #888) r g b / 0.1));
		position: relative;
		overflow: hidden;

		&::after {
			content: '';
			position: absolute;
			inset: 0;
			transform: translateX(-100%);
			background-image: linear-gradient(
				105deg,
				transparent 25%,
				var(--skeleton-sheen, rgb(from var(--color-text, #888) r g b / 0.12)) 50%,
				transparent 75%
			);
			animation: delight-skeleton-shimmer var(--skeleton-duration, 2.4s) ease-in-out
				infinite;
			animation-delay: var(--shimmer-delay, 0s);
		}
	}

	/* Centered absolute overlay shared by the title/weekday/day placeholders so
	   none of them affect the layout they sit on top of. */
	.skeleton-title,
	.skeleton-weekday,
	.skeleton-day {
		position: absolute;
		top: 50%;
		left: 50%;
		translate: -50% -50%;
	}

	/* Nav-icon footprint inside the (still full-size) 2rem nav button. */
	.skeleton-nav {
		width: 1rem;
		height: 1rem;
	}

	/* Month/year title placeholder. */
	.skeleton-title {
		width: 7rem;
		max-width: 70%;
		height: 0.9em;

		.dense & {
			width: 5.5rem;
		}

		.comfortable & {
			width: 8rem;
		}
	}

	/* Weekday label placeholder. */
	.skeleton-weekday {
		width: 60%;
		height: 0.6875rem;

		.dense & {
			height: 0.625rem;
		}

		.comfortable & {
			height: 0.75rem;
		}
	}

	/* Day-number — a centered disc echoing the digit. */
	.skeleton-day {
		width: 45%;
		aspect-ratio: 1;
		border-radius: 50%;
	}

	/* Time-slot label bar (its own column, no underlying text to preserve). */
	.skeleton-slot {
		width: 100%;
		height: 0.9em;
	}

	@keyframes -global-delight-skeleton-shimmer {
		0% {
			transform: translateX(-100%);
		}
		55%,
		100% {
			transform: translateX(100%);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.skeleton-fill::after {
			animation: none;
		}

		.day,
		.slot,
		.nav {
			transition: none;
		}
	}
</style>

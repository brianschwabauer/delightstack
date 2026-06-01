<script lang="ts" module>
	export interface CalendarEvent {
		id: string;
		title: string;
		start: Date;
		end?: Date;
		color?: string;
		allDay?: boolean;
	}

	export interface MarkedDate {
		date: Date;
		color?: string;
		label?: string;
	}
</script>

<script lang="ts">
	import { ripple } from '@delightstack/utilities';
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

		/** Loading skeleton */
		skeleton = false,

		/** Element ID */
		id = propId,

		/** Additional CSS classes */
		class: className = '',

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
		const slots: string[] = [];
		for (let m = start_minutes; m <= end_minutes; m += time_slot_interval) {
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

	function selectTimeSlot(slot: string) {
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

{#if skeleton}
	<div
		class={['calendar skeleton', className].filter(Boolean).join(' ')}
		class:dense
		class:comfortable
		{id}
		aria-hidden="true">
		<div class="calendar-skeleton-header">
			<div class="skeleton-bar skeleton-nav"></div>
			<div class="skeleton-bar skeleton-title"></div>
			<div class="skeleton-bar skeleton-nav"></div>
		</div>
		<div class="calendar-skeleton-weekdays">
			{#each { length: 7 } as _}
				<div class="skeleton-bar skeleton-weekday"></div>
			{/each}
		</div>
		<div class="calendar-skeleton-grid">
			{#each { length: 35 } as _, i}
				<div class="skeleton-bar skeleton-day" style:animation-delay="{i * 20}ms"></div>
			{/each}
		</div>
	</div>
{:else}
	<div
		class={['calendar', className].filter(Boolean).join(' ')}
		class:dense
		class:comfortable
		class:has-time-slots={show_time_slots}
		{id}
		data-calendar-id={id}
		role="group"
		aria-label="Calendar">
		<div class="calendar-main">
			<!-- Header -->
			<div class="calendar-header">
				<button
					type="button"
					class="calendar-nav-btn"
					aria-label="Previous month"
					onclick={() => navigateMonth(-1)}
					{@attach ripple({ zIndex: 1 })}>
					<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
						<path
							d="M10 3L5 8L10 13"
							stroke="currentColor"
							stroke-width="1.5"
							stroke-linecap="round"
							stroke-linejoin="round" />
					</svg>
				</button>
				<div class="calendar-title" aria-live="polite">
					{header_label}
				</div>
				<button
					type="button"
					class="calendar-nav-btn"
					aria-label="Next month"
					onclick={() => navigateMonth(1)}
					{@attach ripple({ zIndex: 1 })}>
					<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
						<path
							d="M6 3L11 8L6 13"
							stroke="currentColor"
							stroke-width="1.5"
							stroke-linecap="round"
							stroke-linejoin="round" />
					</svg>
				</button>
			</div>

			<!-- Weekday headers -->
			<div class="calendar-weekdays" role="row">
				{#each weekday_headers as header}
					<div class="calendar-weekday" role="columnheader" aria-label={header}>
						{header}
					</div>
				{/each}
			</div>

			<!-- Day grid -->
			<!-- svelte-ignore a11y_no_noninteractive_element_interactions a11y_interactive_supports_focus -->
			<div
				class="calendar-grid"
				role="grid"
				tabindex="0"
				aria-label="Calendar dates"
				onkeydown={handleGridKeyDown}
				onmouseleave={handleGridMouseLeave}>
				{#each visible_days as day (day.key)}
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
						class="calendar-day"
						class:other-month={!day.is_current_month}
						class:today={day.is_today}
						class:selected={day.is_selected}
						class:range-start={day.is_range_start}
						class:range-end={day.is_range_end}
						class:in-range={day.is_in_range}
						class:range-hover={day.is_range_hover}
						class:disabled={day.is_disabled}
						role="gridcell"
						aria-selected={day.is_selected}
						aria-disabled={day.is_disabled}
						aria-label={`${day.date.getDate()}${day.is_today ? ', today' : ''}${aria_desc_parts ? `, ${aria_desc_parts}` : ''}`}
						tabindex={focused_date
							? sameDay(day.date, focused_date)
								? 0
								: -1
							: day.is_today && day.is_current_month
								? 0
								: -1}
						data-date={day.key}
						disabled={day.is_disabled}
						onclick={() => selectDate(day.date)}
						onfocus={() => handleDayFocus(day.date)}
						onmouseenter={() => handleDayHover(day.date)}
						{@attach ripple({ enabled: !day.is_disabled, zIndex: 1 })}>
						<span class="day-number">{day.day_number}</span>
						{#if has_dots}
							<div class="day-dots">
								{#each dot_items as color}
									<span class="day-dot" style:background={color}></span>
								{/each}
							</div>
						{/if}
					</button>
				{/each}
			</div>
		</div>

		<!-- Time slots panel -->
		{#if show_time_slots}
			<div class="calendar-time-slots" role="listbox" aria-label="Time slots">
				{#each time_slots as slot}
					<button
						type="button"
						class="time-slot"
						role="option"
						aria-selected={false}
						onclick={() => selectTimeSlot(slot)}
						{@attach ripple({ zIndex: 1 })}>
						{formatTimeSlot(slot)}
					</button>
				{/each}
			</div>
		{/if}
	</div>
{/if}

<style>
	/* ========== Container ========== */
	.calendar {
		display: inline-flex;
		font-family: inherit;
		color: light-dark(var(--color-text, #1a1a1a), var(--color-text, #f5f5f5));
		user-select: none;
		-webkit-tap-highlight-color: transparent;

		&.has-time-slots {
			gap: 1px;
			background: light-dark(var(--color-border, #e5e7eb), var(--color-border, #374151));
			border-radius: var(--radius-3, 0.5rem);
			overflow: hidden;
		}
	}

	.calendar-main {
		display: flex;
		flex-direction: column;
		background: light-dark(var(--color-bg, #fff), var(--color-bg, #111));
	}

	/* ========== Header ========== */
	.calendar-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.75rem;
		gap: 0.5rem;
	}

	.dense .calendar-header {
		padding: 0.375rem 0.5rem;
	}

	.comfortable .calendar-header {
		padding: 1rem 1.25rem;
	}

	.calendar-title {
		flex: 1;
		text-align: center;
		font-weight: 600;
		font-size: 0.9375rem;
		white-space: nowrap;
	}

	.dense .calendar-title {
		font-size: 0.8125rem;
	}

	.comfortable .calendar-title {
		font-size: 1.0625rem;
	}

	.calendar-nav-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 2rem;
		height: 2rem;
		border: none;
		background: transparent;
		border-radius: var(--radius-2, 0.25rem);
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
	}

	.dense .calendar-nav-btn {
		width: 1.5rem;
		height: 1.5rem;
	}

	.comfortable .calendar-nav-btn {
		width: 2.25rem;
		height: 2.25rem;
	}

	/* ========== Weekday Headers ========== */
	.calendar-weekdays {
		display: grid;
		grid-template-columns: repeat(7, 1fr);
		gap: 2px;
		padding: 0 0.75rem;
	}

	.dense .calendar-weekdays {
		padding: 0 0.5rem;
	}

	.comfortable .calendar-weekdays {
		padding: 0 1.25rem;
	}

	.calendar-weekday {
		text-align: center;
		font-size: 0.6875rem;
		font-weight: 500;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		padding: 0.25rem 0;
		color: light-dark(var(--color-text-muted, #6b7280), var(--color-text-muted, #9ca3af));
	}

	.dense .calendar-weekday {
		font-size: 0.625rem;
		padding: 0.125rem 0;
	}

	.comfortable .calendar-weekday {
		font-size: 0.75rem;
		padding: 0.375rem 0;
	}

	/* ========== Day Grid ========== */
	.calendar-grid {
		display: grid;
		grid-template-columns: repeat(7, 1fr);
		gap: 2px;
		padding: 0.375rem 0.75rem 0.75rem;
	}

	.dense .calendar-grid {
		padding: 0.25rem 0.5rem 0.5rem;
	}

	.comfortable .calendar-grid {
		padding: 0.5rem 1.25rem 1.25rem;
	}

	/* ========== Day Cell ========== */
	.calendar-day {
		position: relative;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		aspect-ratio: 1;
		border: none;
		background: transparent;
		border-radius: var(--radius-2, 0.25rem);
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
	}

	.dense .calendar-day {
		font-size: 0.75rem;
	}

	.comfortable .calendar-day {
		font-size: 0.875rem;
	}

	/* Other month */
	.calendar-day.other-month {
		color: light-dark(var(--color-text-muted, #6b7280), var(--color-text-muted, #9ca3af));
		opacity: 0.4;
	}

	/* Today ring */
	.calendar-day.today {
		box-shadow: inset 0 0 0 1.5px
			light-dark(var(--color-border, #d1d5db), var(--color-border, #4b5563));
	}

	/* Selected */
	.calendar-day.selected {
		background: var(--color-action, #3b82f6);
		color: var(--color-action-text, #fff);

		&:hover:not(.disabled) {
			background: var(--color-action, #3b82f6);
			filter: brightness(1.1);
			transition: none;
		}
	}

	.calendar-day.selected.today {
		box-shadow: none;
	}

	/* Range start/end */
	.calendar-day.range-start {
		border-radius: var(--radius-2, 0.25rem) 0 0 var(--radius-2, 0.25rem);
		background: var(--color-action, #3b82f6);
		color: var(--color-action-text, #fff);
	}

	.calendar-day.range-end {
		border-radius: 0 var(--radius-2, 0.25rem) var(--radius-2, 0.25rem) 0;
		background: var(--color-action, #3b82f6);
		color: var(--color-action-text, #fff);
	}

	.calendar-day.range-start.range-end {
		border-radius: var(--radius-2, 0.25rem);
	}

	/* In-range fill */
	.calendar-day.in-range {
		background: light-dark(
			rgb(from var(--color-action, #3b82f6) r g b / 0.12),
			rgb(from var(--color-action, #3b82f6) r g b / 0.2)
		);
		border-radius: 0;
	}

	/* Range hover preview */
	.calendar-day.range-hover {
		background: light-dark(
			rgb(from var(--color-action, #3b82f6) r g b / 0.08),
			rgb(from var(--color-action, #3b82f6) r g b / 0.14)
		);
		border-radius: 0;
	}

	/* Disabled */
	.calendar-day.disabled {
		opacity: 0.3;
		cursor: not-allowed;
	}

	/* ========== Day number ========== */
	.day-number {
		line-height: 1;
	}

	/* ========== Dots (markers & events) ========== */
	.day-dots {
		display: flex;
		gap: 2px;
		position: absolute;
		bottom: 3px;
		left: 50%;
		transform: translateX(-50%);
	}

	.dense .day-dots {
		bottom: 1px;
	}

	.comfortable .day-dots {
		bottom: 5px;
	}

	.day-dot {
		width: 4px;
		height: 4px;
		border-radius: 50%;
		flex-shrink: 0;
	}

	.dense .day-dot {
		width: 3px;
		height: 3px;
	}

	/* ========== Time Slots ========== */
	.calendar-time-slots {
		display: flex;
		flex-direction: column;
		background: light-dark(var(--color-bg, #fff), var(--color-bg, #111));
		overflow-y: auto;
		max-height: 320px;
		min-width: 5.5rem;
		padding: 0.375rem;
		gap: 1px;
	}

	.dense .calendar-time-slots {
		min-width: 4.5rem;
		max-height: 260px;
		padding: 0.25rem;
	}

	.comfortable .calendar-time-slots {
		min-width: 6.5rem;
		max-height: 400px;
		padding: 0.5rem;
	}

	.time-slot {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0.375rem 0.5rem;
		font-size: 0.8125rem;
		font-family: inherit;
		font-variant-numeric: tabular-nums;
		border: none;
		background: transparent;
		border-radius: var(--radius-2, 0.25rem);
		cursor: pointer;
		color: light-dark(var(--color-text, #1a1a1a), var(--color-text, #f5f5f5));
		white-space: nowrap;
		position: relative;
		overflow: hidden;
		transition:
			background 100ms ease,
			transform 200ms ease;

		&:hover {
			background: light-dark(
				rgb(from var(--color-text, #000) r g b / 0.06),
				rgb(from var(--color-text, #fff) r g b / 0.08)
			);
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
	}

	.dense .time-slot {
		padding: 0.25rem 0.375rem;
		font-size: 0.75rem;
	}

	.comfortable .time-slot {
		padding: 0.5rem 0.75rem;
		font-size: 0.875rem;
	}

	/* ========== Skeleton ========== */
	.calendar.skeleton {
		pointer-events: none;
	}

	.calendar-skeleton-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.75rem;
		gap: 0.5rem;
	}

	.calendar-skeleton-weekdays {
		display: grid;
		grid-template-columns: repeat(7, 1fr);
		gap: 2px;
		padding: 0 0.75rem;
	}

	.calendar-skeleton-grid {
		display: grid;
		grid-template-columns: repeat(7, 1fr);
		gap: 2px;
		padding: 0.375rem 0.75rem 0.75rem;
	}

	.skeleton-bar {
		border-radius: var(--radius-2, 0.25rem);
		background: light-dark(var(--color-border, #e5e7eb), var(--color-border, #374151));
		position: relative;
		overflow: hidden;

		&::after {
			content: '';
			position: absolute;
			inset: 0;
			transform: translateX(-100%);
			background-image: linear-gradient(
				90deg,
				rgb(from var(--color-text, #000) r g b / 0) 0,
				rgb(from var(--color-text, #000) r g b / 0.08) 20%,
				rgb(from var(--color-text, #000) r g b / 0.15) 60%,
				rgb(from var(--color-text, #000) r g b / 0)
			);
			animation: calendar-shimmer 2s infinite;
		}
	}

	.skeleton-nav {
		width: 2rem;
		height: 2rem;
		border-radius: var(--radius-2, 0.25rem);
	}

	.skeleton-title {
		width: 8rem;
		height: 1.25rem;
	}

	.skeleton-weekday {
		height: 0.75rem;
		margin: 0.25rem auto;
		width: 70%;
	}

	.skeleton-day {
		aspect-ratio: 1;
	}

	@keyframes calendar-shimmer {
		100% {
			transform: translateX(100%);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.skeleton-bar::after {
			animation: none;
		}

		.calendar-day,
		.time-slot,
		.calendar-nav-btn {
			transition: none;
		}
	}
</style>

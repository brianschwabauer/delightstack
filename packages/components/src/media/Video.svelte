<script lang="ts" module>
	export interface Source {
		/** URL of the video source */
		src: string;
		/** MIME type of the source (e.g. `'video/mp4'`, `'application/x-mpegURL'`) */
		type: string;
		/** Vertical resolution of this source (e.g. 720, 1080) — used for the quality menu */
		size?: number;
	}

	export interface Track {
		/** The kind of text track */
		kind: 'captions' | 'subtitles';
		/** URL of the WebVTT track file */
		src: string;
		/** Language code of the track (e.g. `'en'`) */
		srclang: string;
		/** Display name of the track in the captions menu */
		label: string;
		/** Whether this track is enabled by default */
		default?: boolean;
	}

	// --- HLS helpers ---
	const HLS_MIME = /(application\/(x-mpegurl|vnd\.apple\.mpegurl))/i;

	/** True when a source MIME type identifies an HLS playlist. */
	function isHlsType(type: string): boolean {
		return HLS_MIME.test(type);
	}

	/** True when a URL points at an `.m3u8` playlist (ignoring query/hash). */
	function isHlsUrl(url: string): boolean {
		return /\.m3u8(?:[?#]|$)/i.test(url);
	}

	/** Best-guess MIME type for a bare string `src`. */
	function inferType(url: string): string {
		return isHlsUrl(url) ? 'application/vnd.apple.mpegurl' : 'video/mp4';
	}

	// Memoized once per browser — Safari/iOS play HLS through the media element
	// directly, so hls.js is never needed there. `undefined` until first checked.
	let nativeHlsSupport: boolean | undefined;

	/** Whether the platform can play HLS natively (Safari, iOS). */
	function supportsNativeHls(): boolean {
		if (nativeHlsSupport !== undefined) return nativeHlsSupport;
		if (typeof document === 'undefined') return false; // SSR — re-checked on client
		const probe = document.createElement('video');
		nativeHlsSupport =
			probe.canPlayType('application/vnd.apple.mpegurl') !== '' ||
			probe.canPlayType('application/x-mpegurl') !== '';
		return nativeHlsSupport;
	}

	// Minimal structural types for the dynamically-imported hls.js, so we don't
	// depend on the package's types being installed (it's an optional peer dep).
	interface HlsLevelData {
		height?: number;
		bitrate?: number;
	}
	interface HlsErrorData {
		fatal?: boolean;
		type?: string;
	}
	interface HlsManifestData {
		levels?: HlsLevelData[];
	}
	interface HlsInstance {
		currentLevel: number;
		loadSource(url: string): void;
		attachMedia(media: HTMLMediaElement): void;
		startLoad(): void;
		recoverMediaError(): void;
		destroy(): void;
		on(
			event: string,
			cb: (event: string, data: HlsManifestData & HlsErrorData) => void,
		): void;
	}
	interface HlsStatic {
		new (config?: Record<string, unknown>): HlsInstance;
		isSupported(): boolean;
		Events: { MANIFEST_PARSED: string; ERROR: string };
		ErrorTypes: { NETWORK_ERROR: string; MEDIA_ERROR: string };
	}
</script>

<script lang="ts">
	import { ripple } from '@delightstack/utilities';
	import { scale } from 'svelte/transition';
	import { backOut } from 'svelte/easing';
	import Range from '../form/Range.svelte';
	const propId = $props.id();

	let {
		/** Video source URL or array of sources */
		src,

		/** Poster image URL */
		poster = undefined as string | undefined,

		/** Auto-play (requires muted for most browsers) */
		autoplay = false,

		/** Start muted */
		muted = $bindable(false),

		/** Loop playback */
		loop = false,

		/** Show custom controls */
		controls = true,

		/** CSS aspect ratio */
		aspect_ratio = '16/9',

		/** Preload behavior */
		preload = 'metadata' as 'auto' | 'metadata' | 'none',

		/** Caption/subtitle tracks */
		captions = [] as Track[],

		/** URL to a WebVTT thumbnail track. Each cue's text should be the URL
		 *  of a sprite image, optionally suffixed with `#xywh=x,y,w,h` to point
		 *  at a region of a sprite sheet. When provided, hovering the seek bar
		 *  shows a thumbnail preview at the cue's mapped time. */
		thumbnails = undefined as string | undefined,

		/** Show loading skeleton (only while no `src` is known yet) */
		skeleton = false,

		/** Element ID */
		id = propId,

		/** Additional CSS classes */
		class: class_name = '',

		/** Bindable reference to the root HTML element */
		element = $bindable(undefined as HTMLElement | undefined),

		/** Bindable reference to the video element */
		player = $bindable(undefined as HTMLVideoElement | undefined),

		/**
		 * A short title/caption for the clip, shown as part of the player chrome
		 * — directly above the control bar, under the same scrim, appearing and
		 * fading with the controls. Distinct from `captions`, which are the
		 * WebVTT subtitle tracks burned over the picture.
		 */
		title = undefined as string | undefined,

		/** Playback started */
		onplay = undefined as (() => void) | undefined,

		/** Playback paused */
		onpause = undefined as (() => void) | undefined,

		/** Playback ended */
		onended = undefined as (() => void) | undefined,

		/** Time updated */
		ontimeupdate = undefined as
			| ((detail: { currentTime: number; duration: number }) => void)
			| undefined,

		/** Error occurred */
		onerror = undefined as ((detail: { error: MediaError }) => void) | undefined,

		/** Entered fullscreen */
		onenterfullscreen = undefined as (() => void) | undefined,

		/** Exited fullscreen */
		onexitfullscreen = undefined as (() => void) | undefined,

		/** Entered PiP */
		onenterpip = undefined as (() => void) | undefined,

		/** Exited PiP */
		onexitpip = undefined as (() => void) | undefined,

		/** Video element ready */
		onready = undefined as ((detail: { player: HTMLVideoElement }) => void) | undefined,
	}: {
		src: string | Source[];
		poster?: string;
		autoplay?: boolean;
		muted?: boolean;
		loop?: boolean;
		controls?: boolean;
		aspect_ratio?: string;
		preload?: 'auto' | 'metadata' | 'none';
		captions?: Track[];
		thumbnails?: string;
		skeleton?: boolean;
		id?: string;
		class?: string;
		element?: HTMLElement | undefined;
		player?: HTMLVideoElement | undefined;
		title?: string;
		onplay?: () => void;
		onpause?: () => void;
		onended?: () => void;
		ontimeupdate?: (detail: { currentTime: number; duration: number }) => void;
		onerror?: (detail: { error: MediaError }) => void;
		onenterfullscreen?: () => void;
		onexitfullscreen?: () => void;
		onenterpip?: () => void;
		onexitpip?: () => void;
		onready?: (detail: { player: HTMLVideoElement }) => void;
	} = $props();

	// --- State ---
	let current_time = $state(0);
	let duration = $state(0);
	let buffered_end = $state(0);
	let volume = $state(1);
	let is_muted = $state(muted);
	let is_fullscreen = $state(false);
	let is_pip = $state(false);
	let captions_active = $state(false);
	let show_controls = $state(true);
	let playing = $state(false);
	let has_started = $state(false);
	let has_error = $state(false);
	let is_ready = $state(false);

	// True while the user is actively dragging the seek Range. Suppresses
	// timeupdate / rAF writes to `current_time` so the thumb tracks the pointer
	// instead of fighting the (async) seeks echoing back from the element.
	let is_scrubbing = $state(false);

	// Seek requested before the media had metadata (duration unknown /
	// readyState < HAVE_METADATA — setting currentTime then is ignored).
	// `fraction` targets a 0..1 position of the eventual duration (seek bar);
	// `time` targets an absolute second (keyboard / frame step). Applied once
	// metadata (and therefore duration) arrives.
	let pending_seek = $state<{ kind: 'fraction' | 'time'; value: number } | undefined>(
		undefined,
	);

	// One-shot guard so a pre-metadata scrub triggers at most one load() kick.
	let metadata_requested = false;

	// Menus / popovers (all inline so they survive fullscreen)
	let quality_open = $state(false);
	let speed_open = $state(false);
	let settings_open = $state(false);

	// Seek hover preview (independent of the Range slider)
	let seek_hover_time = $state(0);
	let seek_hover_x = $state(0);
	let show_seek_tooltip = $state(false);
	let seek_el = $state<HTMLElement | undefined>(undefined);

	// Settings popover refs (for focus management)
	let settings_btn = $state<HTMLElement | undefined>(undefined);
	let settings_pop = $state<HTMLElement | undefined>(undefined);

	// Thumbnail track parsed cues
	interface ThumbCue {
		start: number;
		end: number;
		src: string;
		xywh?: [number, number, number, number];
	}
	let thumb_cues = $state<ThumbCue[]>([]);

	function parseTimestamp(ts: string): number {
		const parts = ts.split(':').map((p) => parseFloat(p));
		if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
		if (parts.length === 2) return parts[0] * 60 + parts[1];
		return parts[0] || 0;
	}

	async function loadThumbnails(url: string) {
		try {
			const res = await fetch(url);
			if (!res.ok) return;
			const text = await res.text();
			const lines = text.split(/\r?\n/);
			const cues: ThumbCue[] = [];
			const baseURL = new URL(url, window.location.href);
			for (let i = 0; i < lines.length; i++) {
				const line = lines[i];
				const m = line.match(
					/(\d+(?::\d+){0,2}(?:\.\d+)?)\s*-->\s*(\d+(?::\d+){0,2}(?:\.\d+)?)/,
				);
				if (!m) continue;
				const start = parseTimestamp(m[1]);
				const end = parseTimestamp(m[2]);
				const next = lines[i + 1]?.trim();
				if (!next) continue;
				const hashIdx = next.indexOf('#xywh=');
				let src = next;
				let xywh: [number, number, number, number] | undefined;
				if (hashIdx !== -1) {
					src = next.slice(0, hashIdx);
					const parts = next
						.slice(hashIdx + 6)
						.split(',')
						.map((n) => parseInt(n, 10));
					if (parts.length === 4 && parts.every((n) => !isNaN(n))) {
						xywh = parts as [number, number, number, number];
					}
				}
				const resolved = new URL(src, baseURL).href;
				cues.push({ start, end, src: resolved, xywh });
				i++;
			}
			thumb_cues = cues;
		} catch {
			thumb_cues = [];
		}
	}

	$effect(() => {
		if (thumbnails) loadThumbnails(thumbnails);
		else thumb_cues = [];
	});

	const active_thumb = $derived.by<ThumbCue | undefined>(() => {
		if (!thumb_cues.length || !show_seek_tooltip) return undefined;
		const t = seek_hover_time;
		// Cues are usually sorted; linear scan is fine for typical sizes.
		for (const c of thumb_cues) {
			if (t >= c.start && t < c.end) return c;
		}
		return thumb_cues[thumb_cues.length - 1];
	});

	// Inactivity timer
	let inactivity_timer: ReturnType<typeof setTimeout> | undefined;

	// PiP support
	let pip_supported = $state(false);

	// Playback speeds
	const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];
	let playback_rate = $state(1);

	// --- HLS state ---
	interface HlsLevel {
		index: number;
		height: number;
		bitrate: number;
	}
	let hls_instance: HlsInstance | undefined;
	let hls_levels = $state<HlsLevel[]>([]);
	// User-selected level: -1 = automatic (adaptive bitrate).
	let hls_current_level = $state(-1);

	// --- Derived ---
	const has_src = $derived(
		typeof src === 'string'
			? src.trim().length > 0
			: Array.isArray(src) && src.length > 0,
	);

	// Skeleton stands in for a not-yet-known source. Providing a `src` turns it
	// off, even if the caller leaves `skeleton` true.
	const show_skeleton = $derived(skeleton && !has_src);

	const sources = $derived(
		typeof src === 'string' ? [{ src, type: inferType(src) }] : src,
	);

	const has_quality_options = $derived(
		Array.isArray(src) && src.length > 1 && src.some((s) => s.size != null),
	);

	const quality_sources = $derived(
		has_quality_options
			? (src as Source[])
					.filter((s) => s.size != null)
					.sort((a, b) => (b.size ?? 0) - (a.size ?? 0))
			: [],
	);

	let active_source_index = $state(0);

	const active_source = $derived(
		has_quality_options ? quality_sources[active_source_index] : sources[0],
	);

	const active_quality_label = $derived(
		active_source?.size ? `${active_source.size}p` : '',
	);

	// HLS is delivered as a single playlist URL; quality comes from the manifest
	// (handled by hls.js / the platform), not from the `Source[]` `size` field.
	const is_hls_source = $derived(
		!!active_source && (isHlsType(active_source.type) || isHlsUrl(active_source.src)),
	);

	const hls_quality_label = $derived(
		hls_current_level === -1
			? 'Auto'
			: `${hls_levels.find((l) => l.index === hls_current_level)?.height ?? ''}p`,
	);

	// Whether a quality control should exist at all (array-based or HLS manifest).
	const has_quality = $derived(has_quality_options || hls_levels.length > 1);

	const progress_percent = $derived(duration > 0 ? (current_time / duration) * 100 : 0);
	const buffered_percent = $derived(duration > 0 ? (buffered_end / duration) * 100 : 0);

	// Seek Range scale. Before metadata the duration is unknown, so the bar
	// runs 0..1 and values are *fractions* of the eventual duration — positions
	// stay meaningful and a queued seek can be resolved once metadata lands.
	const seek_max = $derived(duration > 0 ? duration : 1);
	const seek_step = $derived(duration > 0 ? 0.1 : 0.001);

	// --- Responsive collapse ranks ---
	// Controls collapse into the settings popover lowest-priority first. Rank 1 =
	// first to collapse. Ranks are assigned only to controls that actually exist,
	// so the set stays dense (1..N) as PiP / HLS-quality appear after detection.
	// Container-query breakpoints (in CSS) key off these rank classes, which lets
	// the hiding be pure CSS — SSR-safe and flash-free — while the "never exactly
	// one item in the popover" guarantee holds (ranks 1 & 2 collapse together).
	const COLLAPSE_ORDER = [
		'pip',
		'captions',
		'speed',
		'quality',
		'fullscreen',
		'volume',
	] as const;
	const present_controls = $derived<Record<string, boolean>>({
		volume: true,
		fullscreen: true,
		speed: true,
		quality: has_quality,
		captions: captions.length > 0,
		pip: pip_supported,
	});
	const ranks = $derived.by<Record<string, number>>(() => {
		const order = COLLAPSE_ORDER.filter((k) => present_controls[k]);
		const map: Record<string, number> = {};
		order.forEach((k, i) => (map[k] = i + 1));
		return map;
	});

	// --- Helpers ---
	function formatTime(seconds: number): string {
		if (!isFinite(seconds) || isNaN(seconds)) return '0:00';
		const h = Math.floor(seconds / 3600);
		const m = Math.floor((seconds % 3600) / 60);
		const s = Math.floor(seconds % 60);
		if (h > 0)
			return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
		return `${m}:${s.toString().padStart(2, '0')}`;
	}

	const any_menu_open = $derived(quality_open || speed_open || settings_open);

	function resetInactivityTimer() {
		show_controls = true;
		clearTimeout(inactivity_timer);
		if (playing) {
			inactivity_timer = setTimeout(() => {
				if (playing && !any_menu_open) {
					show_controls = false;
				}
			}, 2500);
		}
	}

	function closeAllMenus() {
		quality_open = false;
		speed_open = false;
		settings_open = false;
	}

	// --- Actions ---
	function togglePlay() {
		if (!player) return;
		if (player.paused) {
			player.play();
		} else {
			player.pause();
		}
	}

	function seek(time: number) {
		if (!player) return;
		if (duration > 0 && player.readyState >= HTMLMediaElement.HAVE_METADATA) {
			const t = Math.max(0, Math.min(time, duration));
			player.currentTime = t;
			current_time = t;
		} else {
			// Metadata not loaded yet — queue the target and make sure metadata
			// is on its way. UI updates optimistically; playback stays paused.
			const t = Math.max(0, time);
			current_time = t;
			pending_seek = { kind: 'time', value: t };
			ensureMetadata();
		}
	}

	/** Kick off a metadata load when the media hasn't fetched any yet (e.g.
	 *  `preload="none"`), so a pre-play seek can actually resolve. */
	function ensureMetadata() {
		if (!player || metadata_requested) return;
		if (player.readyState >= HTMLMediaElement.HAVE_METADATA) return;
		metadata_requested = true;
		if (player.preload === 'none') player.preload = 'metadata';
		// HLS attaches/loads through its own effect — never call load() on it.
		// Only restart the resource selection when nothing is being fetched.
		if (
			!is_hls_source &&
			(player.networkState === HTMLMediaElement.NETWORK_EMPTY ||
				player.networkState === HTMLMediaElement.NETWORK_IDLE)
		) {
			player.load();
		}
	}

	/** Apply a queued pre-metadata seek once the duration is known. Stays
	 *  paused — like standard players, seeking while paused shows the new
	 *  frame without starting playback. */
	function applyPendingSeek() {
		if (!pending_seek || !player || !(duration > 0)) return;
		const target =
			pending_seek.kind === 'fraction'
				? pending_seek.value * duration
				: Math.min(pending_seek.value, duration);
		pending_seek = undefined;
		player.currentTime = target;
		current_time = target;
	}

	function setVolume(v: number) {
		if (!player) return;
		volume = Math.max(0, Math.min(1, v));
		player.volume = volume;
		if (volume > 0 && is_muted) {
			is_muted = false;
			player.muted = false;
			muted = false;
		}
	}

	function toggleMute() {
		if (!player) return;
		is_muted = !is_muted;
		player.muted = is_muted;
		muted = is_muted;
	}

	function toggleFullscreen() {
		if (!element) return;
		if (!document.fullscreenElement) {
			element.requestFullscreen().catch(() => {});
		} else {
			document.exitFullscreen().catch(() => {});
		}
	}

	function togglePip() {
		if (!player) return;
		if (document.pictureInPictureElement) {
			document.exitPictureInPicture().catch(() => {});
		} else {
			player.requestPictureInPicture().catch(() => {});
		}
	}

	function toggleCaptions() {
		if (!player) return;
		captions_active = !captions_active;
		for (let i = 0; i < player.textTracks.length; i++) {
			const track = player.textTracks[i];
			if (track.kind === 'captions' || track.kind === 'subtitles') {
				track.mode = captions_active ? 'showing' : 'hidden';
			}
		}
	}

	function selectQuality(index: number) {
		if (!player || index === active_source_index) {
			quality_open = false;
			return;
		}
		const was_playing = !player.paused;
		const time = player.currentTime;
		active_source_index = index;
		// Source change happens via reactive update; restore time after load
		const restore = () => {
			if (!player) return;
			player.currentTime = time;
			if (was_playing) player.play();
			player.removeEventListener('loadeddata', restore);
		};
		// Need a tick for the source to update, then load
		requestAnimationFrame(() => {
			if (!player) return;
			player.load();
			player.addEventListener('loadeddata', restore);
		});
		quality_open = false;
	}

	function selectSpeed(speed: number) {
		if (!player) return;
		playback_rate = speed;
		player.playbackRate = speed;
		speed_open = false;
	}

	function selectHlsLevel(index: number) {
		hls_current_level = index;
		if (hls_instance) hls_instance.currentLevel = index; // -1 re-enables auto
		quality_open = false;
	}

	// Frame stepping — the platform doesn't expose the true frame rate, so assume
	// ~30fps. Stepping implies the user wants to inspect frames, so pause first.
	const FRAME = 1 / 30;
	function stepFrame(dir: number) {
		if (!player) return;
		if (!player.paused) player.pause();
		seek((player.currentTime || current_time) + dir * FRAME);
	}

	// Arrow up/down on the speed / quality selector adjusts the value in place
	// (without needing to open the menu).
	function cycleSpeed(dir: number) {
		const i = SPEEDS.indexOf(playback_rate);
		const next = Math.max(0, Math.min(SPEEDS.length - 1, (i === -1 ? 2 : i) + dir));
		selectSpeed(SPEEDS[next]);
	}
	function cycleQuality(dir: number) {
		if (has_quality_options) {
			// quality_sources is sorted high→low, so "up" (higher quality) = lower index
			const next = Math.max(
				0,
				Math.min(quality_sources.length - 1, active_source_index - dir),
			);
			selectQuality(next);
		} else if (hls_levels.length > 1) {
			// Ordered options: Auto, then levels high→low. Up moves toward Auto/higher.
			const opts = [-1, ...hls_levels.map((l) => l.index)];
			const cur = Math.max(0, opts.indexOf(hls_current_level));
			const next = Math.max(0, Math.min(opts.length - 1, cur - dir));
			selectHlsLevel(opts[next]);
		}
	}
	function onSelectorKeydown(kind: 'speed' | 'quality', e: KeyboardEvent) {
		if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
		e.preventDefault();
		const dir = e.key === 'ArrowUp' ? 1 : -1;
		if (kind === 'speed') cycleSpeed(dir);
		else cycleQuality(dir);
	}

	// --- Seek bar (Range-driven) ---
	// Range only emits oninput/onchange for USER interaction (programmatic
	// `value` prop updates never echo back), so writing player.currentTime here
	// cannot create a feedback loop with timeupdate.
	function onSeekInput(value: number) {
		resetInactivityTimer();
		if (!player) return;
		is_scrubbing = true;
		// Optimistic UI — the thumb stays where the user put it, even when the
		// actual seek is queued or the element is still completing a prior seek.
		current_time = value;
		if (duration > 0 && player.readyState >= HTMLMediaElement.HAVE_METADATA) {
			pending_seek = undefined;
			player.currentTime = value;
		} else if (duration > 0) {
			// Duration known but media not seekable yet (e.g. mid source swap).
			pending_seek = { kind: 'time', value };
			ensureMetadata();
		} else {
			// No metadata: the bar runs 0..1, so the value *is* the fraction.
			pending_seek = {
				kind: 'fraction',
				value: Math.max(0, Math.min(1, value / seek_max)),
			};
			ensureMetadata();
		}
	}

	// Drag released (or click/keyboard committed) — perform the final seek and
	// hand `current_time` back to playback-driven updates.
	function onSeekCommit(value: number) {
		onSeekInput(value);
		is_scrubbing = false;
	}

	// --- Volume (Range-driven) ---
	function onVolumeInput(value: number) {
		setVolume(value / 100);
		resetInactivityTimer();
	}

	// --- Seek hover preview tooltip ---
	// Tracks the pointer over the seek area without intercepting Range's own
	// pointer handling (events bubble up; the tooltip is pointer-events:none).
	function updateSeekHover(e: PointerEvent) {
		if (!seek_el || !(duration > 0)) return;
		const rect = seek_el.getBoundingClientRect();
		const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
		const pct = rect.width > 0 ? x / rect.width : 0;
		seek_hover_time = pct * duration;
		seek_hover_x = x;
		show_seek_tooltip = true;
	}

	// --- Keyboard shortcuts ---
	function handleKeydown(e: KeyboardEvent) {
		if (!player) return;

		// Ignore keyboard when typing in an input or operating a specific control
		// (buttons / range sliders manage their own keys).
		const tag = (e.target as HTMLElement)?.tagName;
		if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON')
			return;
		// While a menu is open let it own arrow/escape navigation.
		if (any_menu_open && e.key !== ' ' && e.key !== 'k' && e.key !== 'K') return;

		let handled = true;

		switch (e.key) {
			case ' ':
			case 'k':
			case 'K':
				togglePlay();
				break;
			case 'ArrowLeft':
				seek(current_time - 10);
				break;
			case 'ArrowRight':
				seek(current_time + 10);
				break;
			case 'ArrowUp':
				setVolume(volume + 0.1);
				break;
			case 'ArrowDown':
				setVolume(volume - 0.1);
				break;
			case 'm':
			case 'M':
				toggleMute();
				break;
			case 'f':
			case 'F':
				toggleFullscreen();
				break;
			case 'c':
			case 'C':
				if (captions.length > 0) toggleCaptions();
				break;
			case ',':
				stepFrame(-1);
				break;
			case '.':
				stepFrame(1);
				break;
			default:
				handled = false;
		}

		if (handled) {
			e.preventDefault();
			e.stopPropagation();
			resetInactivityTimer();
		}
	}

	// --- Settings popover keyboard ---
	function toggleSettings() {
		settings_open = !settings_open;
		quality_open = false;
		speed_open = false;
	}

	function handleSettingsKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.stopPropagation();
			settings_open = false;
			settings_btn?.focus();
			return;
		}
		if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
			e.preventDefault();
			const items = Array.from(
				settings_pop?.querySelectorAll<HTMLElement>('[data-pop-focusable]') ?? [],
			);
			if (!items.length) return;
			const idx = items.indexOf(document.activeElement as HTMLElement);
			const next =
				e.key === 'ArrowDown'
					? items[(idx + 1) % items.length]
					: items[(idx - 1 + items.length) % items.length];
			next?.focus();
		}
	}

	// Move focus into the popover when it opens.
	$effect(() => {
		if (!settings_open || !settings_pop) return;
		const first = settings_pop.querySelector<HTMLElement>('[data-pop-focusable]');
		first?.focus();
	});

	// --- Video event handlers ---
	function handleVideoPlay() {
		playing = true;
		has_started = true;
		resetInactivityTimer();
		onplay?.();
	}

	function handleVideoPause() {
		playing = false;
		show_controls = true;
		clearTimeout(inactivity_timer);
		onpause?.();
	}

	function handleVideoEnded() {
		playing = false;
		has_started = false;
		show_controls = true;
		clearTimeout(inactivity_timer);
		onended?.();
	}

	function handleVideoTimeUpdate() {
		if (!player) return;
		// `loadedmetadata` is supposed to be the canonical place to read
		// duration, but some browser/codec combos fire `timeupdate` first
		// (or never fire `loadedmetadata` at all for already-cached files).
		// Mirror duration here too so the progress bar can't get stuck at 0.
		// Resolve this BEFORE touching `current_time` so the thumb is only ever
		// driven against a real `seek_max`.
		if (duration === 0 && isFinite(player.duration) && player.duration > 0) {
			duration = player.duration;
			applyPendingSeek();
		}
		// While the user is scrubbing — or a pre-metadata seek is still queued —
		// the element's currentTime lags the user's intent; reflecting it back
		// into `current_time` would yank the thumb around. Hold the optimistic
		// value until release / until the queued seek is applied.
		//
		// Also hold while `duration` is still 0 (first play, metadata not yet
		// resolved): the seek bar runs on the pre-metadata 0..1 scale, so an
		// advancing currentTime (e.g. 0.2s) is divided by max=1 and spikes the
		// thumb to ~20% — then snaps back once the real duration lands, an
		// animated jump the track's `width`/`left` transition makes visible.
		// Don't let playback drive the thumb until the scale is real; this makes
		// first play look identical to subsequent plays.
		if (!is_scrubbing && !pending_seek && duration > 0) {
			current_time = player.currentTime;
		}
		ontimeupdate?.({ currentTime: player.currentTime, duration: player.duration });
	}

	function handleVideoDurationChange() {
		if (!player) return;
		if (isFinite(player.duration) && player.duration > 0) {
			duration = player.duration;
			applyPendingSeek();
		}
	}

	function handleVideoLoadedMetadata() {
		if (!player) return;
		if (isFinite(player.duration) && player.duration > 0) {
			duration = player.duration;
		}
		is_ready = true;
		metadata_requested = false;
		applyPendingSeek();
		pip_supported =
			'pictureInPictureEnabled' in document && document.pictureInPictureEnabled;
		onready?.({ player });
	}

	function handleVideoProgress() {
		if (!player || player.buffered.length === 0) return;
		buffered_end = player.buffered.end(player.buffered.length - 1);
	}

	function handleVideoVolumeChange() {
		if (!player) return;
		volume = player.volume;
		is_muted = player.muted;
		muted = player.muted;
	}

	function handleVideoError() {
		has_error = true;
		if (player?.error) {
			onerror?.({ error: player.error });
		}
	}

	// --- Fullscreen change ---
	$effect(() => {
		function onFullscreenChange() {
			const was = is_fullscreen;
			is_fullscreen =
				!!document.fullscreenElement && document.fullscreenElement === element;
			if (is_fullscreen && !was) onenterfullscreen?.();
			if (!is_fullscreen && was) onexitfullscreen?.();
		}
		document.addEventListener('fullscreenchange', onFullscreenChange);
		return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
	});

	// --- PiP change ---
	$effect(() => {
		if (!player) return;
		const vid = player;
		function onEnterPip() {
			is_pip = true;
			onenterpip?.();
		}
		function onLeavePip() {
			is_pip = false;
			onexitpip?.();
		}
		vid.addEventListener('enterpictureinpicture', onEnterPip);
		vid.addEventListener('leavepictureinpicture', onLeavePip);
		return () => {
			vid.removeEventListener('enterpictureinpicture', onEnterPip);
			vid.removeEventListener('leavepictureinpicture', onLeavePip);
		};
	});

	// --- HLS attachment ---
	// HLS playlists are never rendered as a <source> child (the browser can't
	// load them, and it would error on non-Safari). Instead we wire the stream
	// up here, client-side only: natively on Safari/iOS, otherwise via a
	// lazily-imported hls.js. Either way the platform feeds our custom controls,
	// so the native `controls` attribute is never set.
	$effect(() => {
		const vid = player;
		if (!vid || !is_hls_source) return;
		const url = active_source.src;

		// Native HLS — hand the URL straight to the media element.
		if (supportsNativeHls()) {
			vid.src = url;
			vid.load();
			return () => {
				vid.removeAttribute('src');
				vid.load();
			};
		}

		// Everywhere else — pull in hls.js on demand and attach it.
		let cancelled = false;
		let instance: HlsInstance | undefined;

		(async () => {
			try {
				// @ts-ignore — hls.js is an optional peer dependency, loaded on demand
				const mod: { default: HlsStatic } = await import('hls.js');
				const Hls = mod.default;
				if (cancelled || player !== vid) return;
				if (!Hls.isSupported()) {
					// No native HLS and no Media Source Extensions — nothing we can do.
					has_error = true;
					return;
				}
				instance = new Hls();
				hls_instance = instance;

				instance.on(Hls.Events.MANIFEST_PARSED, (_e, data) => {
					hls_levels = (data.levels ?? [])
						.map((l, i) => ({ index: i, height: l.height ?? 0, bitrate: l.bitrate ?? 0 }))
						.filter((l) => l.height > 0)
						.sort((a, b) => b.height - a.height);
					hls_current_level = -1;
					// The `autoplay` attribute can be missed when media is attached
					// after load, so kick playback off explicitly when requested.
					if (autoplay) vid.play().catch(() => {});
				});

				instance.on(Hls.Events.ERROR, (_e, data) => {
					if (!data.fatal) return;
					// Attempt the standard recoveries before surfacing an error.
					if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
						instance?.startLoad();
					} else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
						instance?.recoverMediaError();
					} else {
						has_error = true;
					}
				});

				instance.loadSource(url);
				instance.attachMedia(vid);
			} catch {
				has_error = true;
			}
		})();

		return () => {
			cancelled = true;
			if (instance) {
				try {
					instance.destroy();
				} catch {
					// already torn down
				}
			}
			if (hls_instance === instance) hls_instance = undefined;
			hls_levels = [];
			hls_current_level = -1;
		};
	});

	// --- Sync muted prop ---
	$effect(() => {
		if (player) {
			player.muted = muted;
			is_muted = muted;
		}
	});

	// --- Enable default captions ---
	$effect(() => {
		if (!player) return;
		for (let i = 0; i < player.textTracks.length; i++) {
			const track = player.textTracks[i];
			if (track.kind === 'captions' || track.kind === 'subtitles') {
				// Check if this track was marked as default
				const caption = captions[i];
				if (caption?.default) {
					track.mode = 'showing';
					captions_active = true;
				} else {
					track.mode = 'hidden';
				}
			}
		}
	});

	// --- Close menus on outside click ---
	$effect(() => {
		if (!any_menu_open) return;
		function onClickOutside(e: MouseEvent) {
			const target = e.target as HTMLElement;
			if (!target.closest('.menu')) {
				closeAllMenus();
			}
		}
		// Use a timeout to avoid catching the click that opened the menu
		const timer = setTimeout(() => {
			document.addEventListener('click', onClickOutside);
		}, 0);
		return () => {
			clearTimeout(timer);
			document.removeEventListener('click', onClickOutside);
		};
	});

	// Follow playback at ~60fps so the seek thumb glides instead of stepping on
	// each (infrequent) `timeupdate`. Pauses while the user scrubs (or a queued
	// pre-metadata seek is pending) so it never fights the optimistic thumb.
	$effect(() => {
		if (!playing || !player || is_scrubbing) return;
		const vid = player;
		let raf = 0;
		let active = true;
		function tick() {
			if (!active) return;
			// Mirror the timeupdate guard: never drive the thumb until the seek
			// scale is real (duration > 0), or the pre-metadata 0..1 scale spikes
			// the thumb on first play. Also yield to a queued pre-metadata seek.
			if (!pending_seek && duration > 0) current_time = vid.currentTime;
			raf = requestAnimationFrame(tick);
		}
		raf = requestAnimationFrame(tick);
		return () => {
			active = false;
			cancelAnimationFrame(raf);
		};
	});

	// Volume icon state
	const volume_icon = $derived(
		is_muted || volume === 0 ? 'muted' : volume < 0.5 ? 'low' : 'high',
	);
	const volume_display = $derived(is_muted ? 0 : Math.round(volume * 100));
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div
	{id}
	class={['video', class_name].filter(Boolean).join(' ')}
	class:is-fullscreen={is_fullscreen}
	style:aspect-ratio={is_fullscreen ? undefined : aspect_ratio}
	bind:this={element}
	onmousemove={resetInactivityTimer}
	onmouseenter={resetInactivityTimer}
	ontouchstart={resetInactivityTimer}
	onkeydown={handleKeydown}
	tabindex="0"
	role="group"
	aria-label="Video player">
	{#if show_skeleton}
		<div class="skeleton" aria-hidden="true">
			<div class="skeleton-shimmer"></div>
			<div class="skeleton-bar">
				<span class="sk sk-btn"></span>
				<span class="sk sk-track"></span>
				<span class="sk sk-pill"></span>
				<span class="sk sk-btn"></span>
				<span class="sk sk-btn"></span>
			</div>
		</div>
	{/if}

	<!-- Video element -->
	<video
		bind:this={player}
		{poster}
		{autoplay}
		{loop}
		{preload}
		muted={is_muted}
		playsinline
		crossorigin="anonymous"
		onclick={togglePlay}
		onplay={handleVideoPlay}
		onpause={handleVideoPause}
		onended={handleVideoEnded}
		ontimeupdate={handleVideoTimeUpdate}
		ondurationchange={handleVideoDurationChange}
		onloadedmetadata={handleVideoLoadedMetadata}
		onprogress={handleVideoProgress}
		onvolumechange={handleVideoVolumeChange}
		onerror={handleVideoError}>
		{#if !has_src}
			<!-- No source yet (skeleton / async) — nothing to load -->
		{:else if is_hls_source}
			<!-- HLS is attached programmatically (native or via hls.js) in an effect -->
		{:else if has_quality_options}
			<source src={active_source.src} type={active_source.type} />
		{:else}
			{#each sources as source}
				<source src={source.src} type={source.type} />
			{/each}
		{/if}
		{#each captions as track}
			<track
				kind={track.kind}
				src={track.src}
				srclang={track.srclang}
				label={track.label}
				default={track.default} />
		{/each}
	</video>

	<!-- Big play button overlay (skip when autoplay+muted will start on its own) -->
	{#if !has_started && !playing && !show_skeleton && !(autoplay && is_muted)}
		<button
			class="big-play"
			type="button"
			aria-label="Play video"
			onclick={togglePlay}
			{@attach ripple({})}>
			<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
				<path
					d="M8.5 5.4a.8.8 0 0 1 1.2-.7l9 6.6a.8.8 0 0 1 0 1.3l-9 6.6a.8.8 0 0 1-1.2-.7V5.4z" />
			</svg>
		</button>
	{/if}

	<!-- Error overlay -->
	{#if has_error}
		<div class="error">
			<svg
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="1.5"
				stroke-linecap="round"
				stroke-linejoin="round"
				aria-hidden="true">
				<circle cx="12" cy="12" r="10" />
				<line x1="12" y1="8" x2="12" y2="12" />
				<line x1="12" y1="16" x2="12.01" y2="16" />
			</svg>
			<span>Video could not be loaded</span>
		</div>
	{/if}

	<!-- Custom controls -->
	{#if controls && !show_skeleton}
		<div
			class="controls"
			class:visible={show_controls || !playing}
			class:hidden={!show_controls && playing}>
			{#if title}
				<!-- Part of the chrome, not an overlay on top of it: the scrim
				     below runs behind the title and the bar as one ramp, so there's
				     no seam where two gradients meet. -->
				<div class="title">{title}</div>
			{/if}
			<div class="control-bar">
				<!-- Play / pause (always visible) -->
				<button
					class="btn"
					type="button"
					aria-label={playing ? 'Pause' : 'Play'}
					onclick={togglePlay}
					{@attach ripple({ color: '#fff', opacity: 0.18 })}>
					{#if playing}
						<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
							<rect x="6" y="4" width="4" height="16" rx="1" />
							<rect x="14" y="4" width="4" height="16" rx="1" />
						</svg>
					{:else}
						<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
							<path d="M8 5v14l11-7z" />
						</svg>
					{/if}
				</button>

				<!-- Seek track (always visible, flexes) -->
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div
					class="seek"
					bind:this={seek_el}
					onpointermove={updateSeekHover}
					onpointerenter={() => (show_seek_tooltip = true)}
					onpointerleave={() => (show_seek_tooltip = false)}>
					<span class="seek-base"></span>
					<span class="seek-buffered" style:width="{buffered_percent}%"></span>
					<Range
						class="v-range seek-range"
						aria_label="Seek"
						value={current_time}
						min={0}
						max={seek_max}
						step={seek_step}
						oninput={(d) => onSeekInput(d.value as number)}
						onchange={(d) => onSeekCommit(d.value as number)} />

					{#if show_seek_tooltip && duration > 0}
						<div class="seek-tooltip" style:left="{seek_hover_x}px">
							{#if active_thumb}
								{#if active_thumb.xywh}
									<div
										class="seek-thumb"
										style:width="{active_thumb.xywh[2]}px"
										style:height="{active_thumb.xywh[3]}px"
										style:background-image="url('{active_thumb.src}')"
										style:background-position="-{active_thumb.xywh[0]}px -{active_thumb
											.xywh[1]}px"
										aria-hidden="true">
									</div>
								{:else}
									<img
										class="seek-thumb-img"
										src={active_thumb.src}
										alt=""
										aria-hidden="true" />
								{/if}
							{/if}
							<span class="seek-time">{formatTime(seek_hover_time)}</span>
						</div>
					{/if}
				</div>

				<!-- Time (high priority — hidden last) -->
				<span class="time">
					{formatTime(current_time)} / {formatTime(duration)}
				</span>

				<!-- Volume — slider pops up *above* the button so the button never
				     shifts on hover (which used to make it easy to mis-click). -->
				<div class="ctl volume-group rank-{ranks.volume}">
					<div class="volume-pop">
						<Range
							vertical
							class="v-range vol-range"
							aria_label="Volume"
							value={volume_display}
							min={0}
							max={100}
							step={1}
							oninput={(d) => onVolumeInput(d.value as number)} />
					</div>
					<button
						class="btn"
						type="button"
						aria-label={is_muted ? 'Unmute' : 'Mute'}
						onclick={toggleMute}
						{@attach ripple({ color: '#fff', opacity: 0.18 })}>
						{@render volumeGlyph(volume_icon)}
					</button>
				</div>

				<!-- Quality selector -->
				{#if has_quality}
					<div class="ctl menu rank-{ranks.quality}">
						<button
							class="btn btn-text"
							type="button"
							aria-label="Video quality"
							aria-haspopup="true"
							aria-expanded={quality_open}
							onclick={() => {
								quality_open = !quality_open;
								speed_open = false;
								settings_open = false;
							}}
							onkeydown={(e) => onSelectorKeydown('quality', e)}
							{@attach ripple({ color: '#fff', opacity: 0.18 })}>
							{has_quality_options ? active_quality_label : hls_quality_label}
						</button>
						{#if quality_open}
							<div
								class="dropdown"
								role="menu"
								transition:scale={{ duration: 150, start: 0.92, easing: backOut }}>
								{#if has_quality_options}
									{#each quality_sources as source, i}
										<button
											class="dropdown-item"
											class:active={active_source_index === i}
											type="button"
											role="menuitem"
											onclick={() => selectQuality(i)}
											{@attach ripple({ color: '#fff', opacity: 0.18 })}>
											{source.size}p
										</button>
									{/each}
								{:else}
									<button
										class="dropdown-item"
										class:active={hls_current_level === -1}
										type="button"
										role="menuitem"
										onclick={() => selectHlsLevel(-1)}
										{@attach ripple({ color: '#fff', opacity: 0.18 })}>
										Auto
									</button>
									{#each hls_levels as level}
										<button
											class="dropdown-item"
											class:active={hls_current_level === level.index}
											type="button"
											role="menuitem"
											onclick={() => selectHlsLevel(level.index)}
											{@attach ripple({ color: '#fff', opacity: 0.18 })}>
											{level.height}p
										</button>
									{/each}
								{/if}
							</div>
						{/if}
					</div>
				{/if}

				<!-- Playback speed -->
				<div class="ctl menu rank-{ranks.speed}">
					<button
						class="btn btn-text"
						type="button"
						aria-label="Playback speed"
						aria-haspopup="true"
						aria-expanded={speed_open}
						onclick={() => {
							speed_open = !speed_open;
							quality_open = false;
							settings_open = false;
						}}
						onkeydown={(e) => onSelectorKeydown('speed', e)}
						{@attach ripple({ color: '#fff', opacity: 0.18 })}>
						{playback_rate === 1 ? '1x' : `${playback_rate}x`}
					</button>
					{#if speed_open}
						<div
							class="dropdown"
							role="menu"
							transition:scale={{ duration: 150, start: 0.92, easing: backOut }}>
							{#each SPEEDS as speed}
								<button
									class="dropdown-item"
									class:active={playback_rate === speed}
									type="button"
									role="menuitem"
									onclick={() => selectSpeed(speed)}
									{@attach ripple({ color: '#fff', opacity: 0.18 })}>
									{speed}x
								</button>
							{/each}
						</div>
					{/if}
				</div>

				<!-- Captions toggle -->
				{#if captions.length > 0}
					<button
						class="ctl btn rank-{ranks.captions}"
						class:active={captions_active}
						type="button"
						aria-pressed={captions_active}
						aria-label={captions_active ? 'Disable captions' : 'Enable captions'}
						onclick={toggleCaptions}
						{@attach ripple({ color: '#fff', opacity: 0.18 })}>
						{@render captionsGlyph()}
					</button>
				{/if}

				<!-- Picture-in-picture -->
				{#if pip_supported}
					<button
						class="ctl btn rank-{ranks.pip}"
						class:active={is_pip}
						type="button"
						aria-pressed={is_pip}
						aria-label={is_pip ? 'Exit picture-in-picture' : 'Picture-in-picture'}
						onclick={togglePip}
						{@attach ripple({ color: '#fff', opacity: 0.18 })}>
						{@render pipGlyph()}
					</button>
				{/if}

				<!-- Settings (gear) — appears only when ≥2 controls have collapsed -->
				<div class="menu settings-menu">
					<button
						class="btn settings-btn"
						class:open={settings_open}
						type="button"
						bind:this={settings_btn}
						aria-label="Settings"
						aria-haspopup="true"
						aria-expanded={settings_open}
						onclick={toggleSettings}
						{@attach ripple({ color: '#fff', opacity: 0.18 })}>
						<svg
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
							aria-hidden="true">
							<circle cx="12" cy="12" r="3" />
							<path
								d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
						</svg>
					</button>
					{#if settings_open}
						<!-- svelte-ignore a11y_no_static_element_interactions -->
						<div
							class="dropdown settings-pop"
							role="menu"
							tabindex="-1"
							bind:this={settings_pop}
							onkeydown={handleSettingsKeydown}
							transition:scale={{ duration: 160, start: 0.92, easing: backOut }}>
							<!-- Volume row -->
							<div class="pop-row rank-{ranks.volume}">
								<button
									class="pop-icon"
									type="button"
									data-pop-focusable
									aria-label={is_muted ? 'Unmute' : 'Mute'}
									onclick={toggleMute}
									{@attach ripple({ color: '#fff', opacity: 0.18 })}>
									{@render volumeGlyph(volume_icon)}
								</button>
								<div class="pop-slider">
									<Range
										class="v-range vol-range"
										aria_label="Volume"
										value={volume_display}
										min={0}
										max={100}
										step={1}
										oninput={(d) => onVolumeInput(d.value as number)} />
								</div>
							</div>

							<!-- Quality row -->
							{#if has_quality}
								<div class="pop-row pop-group rank-{ranks.quality}">
									<span class="pop-label">Quality</span>
									<div class="pop-options">
										{#if has_quality_options}
											{#each quality_sources as source, i}
												<button
													class="pop-opt"
													class:active={active_source_index === i}
													type="button"
													data-pop-focusable
													onclick={() => selectQuality(i)}
													{@attach ripple({ color: '#fff', opacity: 0.18 })}>
													{source.size}p
												</button>
											{/each}
										{:else}
											<button
												class="pop-opt"
												class:active={hls_current_level === -1}
												type="button"
												data-pop-focusable
												onclick={() => selectHlsLevel(-1)}
												{@attach ripple({ color: '#fff', opacity: 0.18 })}>
												Auto
											</button>
											{#each hls_levels as level}
												<button
													class="pop-opt"
													class:active={hls_current_level === level.index}
													type="button"
													data-pop-focusable
													onclick={() => selectHlsLevel(level.index)}
													{@attach ripple({ color: '#fff', opacity: 0.18 })}>
													{level.height}p
												</button>
											{/each}
										{/if}
									</div>
								</div>
							{/if}

							<!-- Speed row -->
							<div class="pop-row pop-group rank-{ranks.speed}">
								<span class="pop-label">Speed</span>
								<div class="pop-options">
									{#each SPEEDS as speed}
										<button
											class="pop-opt"
											class:active={playback_rate === speed}
											type="button"
											data-pop-focusable
											onclick={() => selectSpeed(speed)}
											{@attach ripple({ color: '#fff', opacity: 0.18 })}>
											{speed}x
										</button>
									{/each}
								</div>
							</div>

							<!-- Captions row -->
							{#if captions.length > 0}
								<button
									class="pop-row pop-toggle rank-{ranks.captions}"
									class:active={captions_active}
									type="button"
									data-pop-focusable
									aria-pressed={captions_active}
									onclick={toggleCaptions}
									{@attach ripple({ color: '#fff', opacity: 0.18 })}>
									{@render captionsGlyph()}
									<span class="pop-text">Captions</span>
									<span class="pop-state">{captions_active ? 'On' : 'Off'}</span>
								</button>
							{/if}

							<!-- PiP row -->
							{#if pip_supported}
								<button
									class="pop-row pop-toggle rank-{ranks.pip}"
									class:active={is_pip}
									type="button"
									data-pop-focusable
									aria-pressed={is_pip}
									onclick={togglePip}
									{@attach ripple({ color: '#fff', opacity: 0.18 })}>
									{@render pipGlyph()}
									<span class="pop-text">Picture in picture</span>
								</button>
							{/if}

							<!-- Fullscreen row -->
							<button
								class="pop-row pop-toggle rank-{ranks.fullscreen}"
								type="button"
								data-pop-focusable
								onclick={toggleFullscreen}
								{@attach ripple({ color: '#fff', opacity: 0.18 })}>
								{@render fullscreenGlyph(is_fullscreen)}
								<span class="pop-text">
									{is_fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
								</span>
							</button>
						</div>
					{/if}
				</div>

				<!-- Fullscreen (always far right until it collapses) -->
				<button
					class="ctl btn rank-{ranks.fullscreen}"
					type="button"
					aria-label={is_fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
					onclick={toggleFullscreen}
					{@attach ripple({ color: '#fff', opacity: 0.18 })}>
					{@render fullscreenGlyph(is_fullscreen)}
				</button>
			</div>
		</div>
	{/if}
</div>

{#snippet volumeGlyph(state: string)}
	{#if state === 'muted'}
		<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
			<path d="M11 5L6 9H2v6h4l5 4V5z" />
			<line
				x1="23"
				y1="9"
				x2="17"
				y2="15"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				fill="none" />
			<line
				x1="17"
				y1="9"
				x2="23"
				y2="15"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				fill="none" />
		</svg>
	{:else if state === 'low'}
		<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
			<path d="M11 5L6 9H2v6h4l5 4V5z" />
			<path
				d="M15.54 8.46a5 5 0 010 7.07"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				fill="none" />
		</svg>
	{:else}
		<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
			<path d="M11 5L6 9H2v6h4l5 4V5z" />
			<path
				d="M15.54 8.46a5 5 0 010 7.07"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				fill="none" />
			<path
				d="M19.07 4.93a10 10 0 010 14.14"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				fill="none" />
		</svg>
	{/if}
{/snippet}

{#snippet captionsGlyph()}
	<svg
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width="2"
		stroke-linecap="round"
		stroke-linejoin="round"
		aria-hidden="true">
		<rect x="2" y="4" width="20" height="16" rx="2" />
		<path d="M7 12h2" />
		<path d="M15 12h2" />
		<path d="M7 16h10" />
	</svg>
{/snippet}

{#snippet pipGlyph()}
	<svg
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width="2"
		stroke-linecap="round"
		stroke-linejoin="round"
		aria-hidden="true">
		<rect x="2" y="3" width="20" height="14" rx="2" />
		<rect x="12" y="9" width="8" height="6" rx="1" fill="currentColor" />
	</svg>
{/snippet}

{#snippet fullscreenGlyph(active: boolean)}
	{#if active}
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			stroke-linejoin="round"
			aria-hidden="true">
			<path d="M8 3v3a2 2 0 01-2 2H3" />
			<path d="M21 8h-3a2 2 0 01-2-2V3" />
			<path d="M3 16h3a2 2 0 012 2v3" />
			<path d="M16 21v-3a2 2 0 012-2h3" />
		</svg>
	{:else}
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			stroke-linejoin="round"
			aria-hidden="true">
			<path d="M8 3H5a2 2 0 00-2 2v3" />
			<path d="M21 8V5a2 2 0 00-2-2h-3" />
			<path d="M3 16v3a2 2 0 002 2h3" />
			<path d="M16 21h3a2 2 0 002-2v-3" />
		</svg>
	{/if}
{/snippet}

<style>
	.video {
		position: relative;
		overflow: hidden;
		background: black;
		border-radius: var(--radius-lg, 8px);
		@supports (corner-shape: squircle) {
			corner-shape: squircle;
			border-radius: calc(var(--radius-lg, 8px) * var(--squircle-ratio, 2));
		}
		width: 100%;
		outline: none;
		font-family: var(--font-sans, system-ui, -apple-system, sans-serif);
		user-select: none;
		-webkit-user-select: none;
		/* Establish a query container so the controls can collapse responsively
		 * with pure CSS (SSR-safe, no hydration flash). */
		container: dsvideo / inline-size;
	}

	.video:focus-visible {
		outline: 2px solid rgba(255, 255, 255, 0.8);
		outline-offset: -2px;
	}

	.video.is-fullscreen {
		border-radius: 0;
		width: 100%;
		height: 100%;
	}

	/* ---------- Skeleton (no source known yet) ---------- */
	.skeleton {
		position: absolute;
		inset: 0;
		z-index: 20;
		overflow: hidden;
		/* Always-dark player chrome (like the real controls), regardless of the
		   page theme — the white control pills and sheen read on it in both
		   color schemes. Override with --video-skeleton-bg. */
		background: var(--video-skeleton-bg, oklch(0.24 0.01 260));
	}

	/* The beam sweeps above the fake control bar (z-index 1) so it reads as
	   glare washing over the whole player surface. The player chrome is
	   always dark, so the sheen stays white rather than theme-aware. */
	.skeleton-shimmer {
		position: absolute;
		inset: 0;
		z-index: 1;
		transform: translateX(-100%);
		background: linear-gradient(
			105deg,
			transparent 25%,
			rgba(255, 255, 255, 0.1) 50%,
			transparent 75%
		);
		animation: delight-skeleton-shimmer var(--skeleton-duration, 2.4s) ease-in-out
			infinite;
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

	.skeleton-bar {
		position: absolute;
		left: 0;
		right: 0;
		bottom: 0;
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 14px 14px 16px;
	}

	.sk {
		display: block;
		background: rgba(255, 255, 255, 0.3);
		border-radius: 999px;
	}
	.sk-btn {
		width: 24px;
		height: 24px;
		border-radius: 8px;
		@supports (corner-shape: squircle) {
			corner-shape: squircle;
			border-radius: calc(8px * var(--squircle-ratio, 2));
		}
		flex-shrink: 0;
	}
	.sk-track {
		flex: 1;
		height: 6px;
	}
	.sk-pill {
		width: 38px;
		height: 16px;
		border-radius: 8px;
		@supports (corner-shape: squircle) {
			corner-shape: squircle;
			border-radius: calc(8px * var(--squircle-ratio, 2));
		}
		flex-shrink: 0;
	}

	/* ---------- Video element ---------- */
	video {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: contain;
		cursor: pointer;
	}

	/* ---------- Big play button ---------- */
	.big-play {
		position: absolute;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		z-index: 5;
		width: 76px;
		height: 76px;
		border-radius: var(--radius-full, 50%);
		background: rgba(0, 0, 0, 0.45);
		color: white;
		border: none;
		overflow: hidden;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		backdrop-filter: blur(14px) saturate(160%);
		-webkit-backdrop-filter: blur(14px) saturate(160%);
		transition:
			transform 150ms var(--ease-out, ease),
			background 150ms var(--ease-out, ease),
			width 200ms var(--ease-out, ease),
			height 200ms var(--ease-out, ease),
			opacity 150ms var(--ease-out, ease);
		box-shadow: 0 4px 24px rgba(0, 0, 0, 0.35);
		-webkit-tap-highlight-color: transparent;
	}

	.big-play:hover {
		transform: translate(-50%, -50%) scale(1.06);
		background: rgba(0, 0, 0, 0.55);
	}

	.big-play:active {
		transform: translate(-50%, -50%) scale(0.9);
	}

	.big-play svg {
		width: 46px;
		height: 46px;
		margin-left: -3px;
		filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.25));
	}

	/* ---------- Error overlay ---------- */
	.error {
		position: absolute;
		inset: 0;
		z-index: 5;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 8px;
		background: rgba(0, 0, 0, 0.8);
		color: rgba(255, 255, 255, 0.7);
		font-size: var(--text-sm, 0.875rem);
	}

	.error svg {
		width: 32px;
		height: 32px;
		opacity: 0.7;
	}

	/* ---------- Controls container ---------- */
	.controls {
		position: absolute;
		bottom: 0;
		left: 0;
		right: 0;
		z-index: 10;
		background: linear-gradient(transparent, rgba(0, 0, 0, 0.7));
		padding: 40px 0 0;
		transition: opacity 150ms var(--ease-out, ease);
		opacity: 0;
		pointer-events: none;
	}

	.controls.visible {
		opacity: 1;
		pointer-events: auto;
	}

	.controls.hidden {
		opacity: 0;
		pointer-events: none;
	}

	/* ---------- Title / caption ---------- */
	.title {
		padding: 0 12px 4px;
		text-align: center;
		color: rgba(255, 255, 255, 0.92);
		font-size: var(--text-md, 1rem);
		line-height: 1.4;
		text-shadow: 0 1px 3px rgba(0, 0, 0, 0.55);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		/* Text only — never intercept a click meant for the picture. */
		pointer-events: none;
	}

	/* Give the scrim a longer runway when it also has to carry the title, and
	   bring the mid-stop up so the text lands on a dark enough band to read
	   over a bright frame — while the top edge still starts fully transparent,
	   so there's no visible band across the picture. */
	.controls:has(.title) {
		padding-top: 72px;
		background: linear-gradient(
			transparent,
			rgba(0, 0, 0, 0.45) 55%,
			rgba(0, 0, 0, 0.78)
		);
	}

	/* ---------- Single-row control bar ---------- */
	.control-bar {
		display: flex;
		align-items: center;
		gap: 2px;
		padding: 6px 8px 8px;
	}

	.ctl {
		flex-shrink: 0;
	}

	/* ---------- Buttons (Button-like ripple + active) ---------- */
	.btn {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 38px;
		height: 38px;
		border: none;
		border-radius: var(--radius-md, 6px);
		@supports (corner-shape: squircle) {
			corner-shape: squircle;
			border-radius: calc(var(--radius-md, 6px) * var(--squircle-ratio, 2));
		}
		background: transparent;
		color: rgba(255, 255, 255, 0.92);
		cursor: pointer;
		padding: 0;
		overflow: hidden;
		flex-shrink: 0;
		-webkit-tap-highlight-color: transparent;
		transition:
			background 150ms var(--ease-out, ease),
			color 150ms var(--ease-out, ease),
			transform 140ms var(--ease-out, ease);
	}

	.btn:hover {
		background: rgba(255, 255, 255, 0.14);
		color: #fff;
		/* Snap the tint in on hover; the base rule eases it back out on leave. */
		transition: transform 140ms var(--ease-out, ease);
	}

	.btn:focus-visible {
		outline: 2px solid rgba(255, 255, 255, 0.85);
		outline-offset: -2px;
		color: #fff;
	}

	/* Strong, Button-style press: scale down + push back. The perspective is
	 * applied per-button (transform function, not the parent) so it recedes
	 * toward its own center, not the bar's. */
	.btn:active {
		background: rgba(255, 255, 255, 0.22);
		transform: perspective(220px) translateZ(-16px) scale(0.84);
	}

	/* Toggle/active state stays monochrome (no brand color) */
	.btn.active {
		color: #fff;
		background: rgba(255, 255, 255, 0.18);
	}

	.btn svg {
		width: 24px;
		height: 24px;
		pointer-events: none;
	}

	.btn-text {
		width: auto;
		min-width: 38px;
		padding: 0 9px;
		font-size: 0.9rem;
		font-weight: 600;
		font-family: inherit;
		letter-spacing: 0.02em;
		font-variant-numeric: tabular-nums;
	}

	/* Settings gear spins open */
	.settings-btn svg {
		transition: transform 400ms var(--ease-spring, cubic-bezier(0.34, 1.56, 0.64, 1));
	}
	.settings-btn.open svg {
		transform: rotate(90deg);
	}

	/* ---------- Seek track ---------- */
	.seek {
		position: relative;
		flex: 1 1 auto;
		min-width: 40px;
		display: flex;
		align-items: center;
		height: 24px;
		margin: 0 6px;
		touch-action: none;
	}

	.seek-base,
	.seek-buffered {
		position: absolute;
		top: 50%;
		transform: translateY(-50%);
		height: 4px;
		border-radius: 999px;
		pointer-events: none;
		transition: height 150ms var(--ease-out, ease);
	}
	.seek-base {
		left: 0;
		right: 0;
		background: rgba(255, 255, 255, 0.26);
	}
	.seek-buffered {
		left: 0;
		background: rgba(255, 255, 255, 0.45);
	}
	.seek:hover .seek-base,
	.seek:hover .seek-buffered {
		height: 6px;
	}

	/* Range slider override: monochrome white + a slightly shorter handle. Uses
	 * :global so the rule reaches the Range child component's container (scoped
	 * selectors would not). */
	.video :global(.v-range) {
		--fill-color: #fff;
		--track-bg: rgba(255, 255, 255, 0.28);
		--handle-height: 20px;
	}
	.video :global(.v-range input) {
		-webkit-tap-highlight-color: transparent;
	}
	/* Seek-specific: transparent inactive track so the buffered/base layers show
	 * through; sit above them and flex to fill the row. */
	.seek :global(.v-range) {
		--track-bg: transparent;
		position: relative;
		z-index: 1;
		flex: 1 1 auto;
		min-width: 0;
	}
	/* The fill is driven at ~60fps by the rAF loop during playback, so drop the
	 * Range's position easing here — otherwise the fill lags ~100ms behind the
	 * pointer/playback position. Keep only the hover height grow. */
	.seek :global(.track-segment) {
		transition: height 150ms var(--ease-out, ease);
	}
	/* Same for the handle: it follows the raw current time at ~60fps, so drop its
	 * position easing so it stays pinned to the fill edge instead of lagging it.
	 * Keep the hover grow + halo. */
	.seek :global(.handle) {
		transition:
			transform 200ms cubic-bezier(0.34, 1.56, 0.64, 1),
			box-shadow 150ms ease;
	}

	/* ---------- Seek hover tooltip ---------- */
	.seek-tooltip {
		position: absolute;
		bottom: calc(100% + 6px);
		transform: translateX(-50%);
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 4px;
		background: rgba(0, 0, 0, 0.85);
		backdrop-filter: blur(8px);
		-webkit-backdrop-filter: blur(8px);
		color: white;
		padding: 4px;
		border-radius: var(--radius-md, 4px);
		@supports (corner-shape: squircle) {
			corner-shape: squircle;
			border-radius: calc(var(--radius-md, 4px) * var(--squircle-ratio, 2));
		}
		font-size: var(--text-xs, 0.75rem);
		white-space: nowrap;
		pointer-events: none;
		font-variant-numeric: tabular-nums;
		z-index: 3;
	}
	.seek-thumb,
	.seek-thumb-img {
		display: block;
		max-width: 200px;
		max-height: 120px;
		background-repeat: no-repeat;
		border-radius: 2px;
	}
	.seek-time {
		padding: 0 4px;
	}

	/* ---------- Time ---------- */
	.time {
		color: rgba(255, 255, 255, 0.92);
		font-size: 0.9rem;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
		padding: 0 6px;
		flex-shrink: 0;
	}

	/* ---------- Volume ---------- */
	.volume-group {
		position: relative;
		display: flex;
		align-items: center;
	}

	/* Vertical slider floating above the mute button, so the button never shifts
	 * on hover (which previously made it easy to mis-click the track). */
	.volume-pop {
		position: absolute;
		bottom: calc(100% + 6px);
		left: 50%;
		display: flex;
		justify-content: center;
		padding: 12px 12px;
		--range-height: 92px;
		background: rgba(20, 20, 22, 0.62);
		backdrop-filter: blur(16px) saturate(150%);
		-webkit-backdrop-filter: blur(16px) saturate(150%);
		border: 1px solid rgba(255, 255, 255, 0.12);
		border-radius: var(--radius-lg, 10px);
		@supports (corner-shape: squircle) {
			corner-shape: squircle;
			border-radius: calc(var(--radius-lg, 10px) * var(--squircle-ratio, 2));
		}
		box-shadow: 0 8px 28px rgba(0, 0, 0, 0.5);
		opacity: 0;
		pointer-events: none;
		transform: translateX(-50%) translateY(6px) scale(0.96);
		transform-origin: bottom center;
		transition:
			opacity 160ms var(--ease-out, ease),
			transform 160ms var(--ease-out, ease);
		z-index: 20;
		touch-action: none;
	}

	/* A vertical Range reserves its full length as layout width; pin it to the
	 * handle thickness and left-align so the popup hugs the slider instead of
	 * being ~92px wide. */
	.volume-pop :global(.range-container.vertical) {
		width: 20px;
		align-items: flex-start;
	}

	/* Invisible bridge over the gap to the button so the hover isn't lost when
	 * the pointer travels from the button up to the slider. */
	.volume-pop::before {
		content: '';
		position: absolute;
		top: 100%;
		left: 0;
		right: 0;
		height: 10px;
	}

	.volume-group:hover .volume-pop,
	.volume-group:focus-within .volume-pop {
		opacity: 1;
		pointer-events: auto;
		transform: translateX(-50%) translateY(0) scale(1);
	}

	/* ---------- Menus / dropdowns ---------- */
	.menu {
		position: relative;
		display: flex;
		align-items: center;
	}

	.dropdown {
		position: absolute;
		bottom: calc(100% + 8px);
		right: 0;
		transform-origin: bottom right;
		background: rgba(20, 20, 22, 0.62);
		backdrop-filter: blur(16px) saturate(150%);
		-webkit-backdrop-filter: blur(16px) saturate(150%);
		border: 1px solid rgba(255, 255, 255, 0.12);
		border-radius: var(--radius-lg, 10px);
		@supports (corner-shape: squircle) {
			corner-shape: squircle;
			border-radius: calc(var(--radius-lg, 10px) * var(--squircle-ratio, 2));
		}
		box-shadow: 0 8px 28px rgba(0, 0, 0, 0.5);
		padding: 5px;
		min-width: 96px;
		z-index: 20;
	}

	.dropdown-item {
		position: relative;
		display: block;
		width: 100%;
		padding: 7px 14px;
		border: none;
		border-radius: var(--radius-md, 6px);
		@supports (corner-shape: squircle) {
			corner-shape: squircle;
			border-radius: calc(var(--radius-md, 6px) * var(--squircle-ratio, 2));
		}
		background: transparent;
		color: rgba(255, 255, 255, 0.9);
		cursor: pointer;
		overflow: hidden;
		font-size: var(--text-sm, 0.875rem);
		font-family: inherit;
		text-align: left;
		white-space: nowrap;
		font-variant-numeric: tabular-nums;
		-webkit-tap-highlight-color: transparent;
		transition:
			background 120ms var(--ease-out, ease),
			transform 120ms var(--ease-out, ease);
	}

	.dropdown-item:hover,
	.dropdown-item:focus-visible {
		background: rgba(255, 255, 255, 0.12);
		outline: none;
		/* Snap the tint in on hover; the base rule eases it back out on leave. */
		transition: transform 120ms var(--ease-out, ease);
	}

	.dropdown-item:active {
		transform: scale(0.96);
	}

	.dropdown-item.active {
		color: #fff;
		font-weight: 700;
		background: rgba(255, 255, 255, 0.08);
	}

	/* ---------- Settings popover content ---------- */
	.settings-menu {
		/* hidden until the responsive breakpoints reveal it (≥2 collapsed) */
		display: none;
	}

	.settings-pop {
		min-width: 240px;
		max-width: min(320px, 80cqw);
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 8px;
	}

	.pop-row {
		/* shown per-control by the responsive breakpoints below */
		display: none;
		align-items: center;
		gap: 10px;
		width: 100%;
		padding: 6px 8px;
		border: none;
		background: transparent;
		color: rgba(255, 255, 255, 0.92);
		border-radius: var(--radius-md, 6px);
		@supports (corner-shape: squircle) {
			corner-shape: squircle;
			border-radius: calc(var(--radius-md, 6px) * var(--squircle-ratio, 2));
		}
		font-family: inherit;
		font-size: var(--text-sm, 0.875rem);
	}

	.pop-row :global(svg) {
		width: 20px;
		height: 20px;
		flex-shrink: 0;
	}

	.pop-icon {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		flex-shrink: 0;
		border: none;
		border-radius: var(--radius-md, 6px);
		@supports (corner-shape: squircle) {
			corner-shape: squircle;
			border-radius: calc(var(--radius-md, 6px) * var(--squircle-ratio, 2));
		}
		background: transparent;
		color: inherit;
		cursor: pointer;
		padding: 0;
		overflow: hidden;
		-webkit-tap-highlight-color: transparent;
		transition: transform 120ms var(--ease-out, ease);
	}
	.pop-icon:hover,
	.pop-icon:focus-visible {
		background: rgba(255, 255, 255, 0.12);
		outline: none;
	}
	.pop-icon:active {
		transform: scale(0.88);
	}
	.pop-slider {
		flex: 1;
		display: flex;
		align-items: center;
		padding-right: 6px;
	}

	.pop-group {
		flex-direction: column;
		align-items: stretch;
		gap: 6px;
	}
	.pop-label {
		font-size: var(--text-xs, 0.72rem);
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: rgba(255, 255, 255, 0.55);
	}
	.pop-options {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
	}
	.pop-opt {
		position: relative;
		flex: 0 0 auto;
		padding: 4px 10px;
		border: 1px solid rgba(255, 255, 255, 0.16);
		border-radius: 999px;
		background: transparent;
		color: rgba(255, 255, 255, 0.85);
		cursor: pointer;
		overflow: hidden;
		font-size: var(--text-xs, 0.75rem);
		font-family: inherit;
		font-variant-numeric: tabular-nums;
		-webkit-tap-highlight-color: transparent;
		transition:
			background 120ms ease,
			border-color 120ms ease,
			transform 120ms var(--ease-out, ease);
	}
	.pop-opt:hover,
	.pop-opt:focus-visible {
		background: rgba(255, 255, 255, 0.12);
		outline: none;
		/* Snap the tint in on hover; the base rule eases it back out on leave. */
		transition: transform 120ms var(--ease-out, ease);
	}
	.pop-opt:active {
		transform: scale(0.9);
	}
	.pop-opt.active {
		background: #fff;
		border-color: #fff;
		color: #000;
		font-weight: 700;
	}

	.pop-toggle {
		position: relative;
		cursor: pointer;
		text-align: left;
		overflow: hidden;
		-webkit-tap-highlight-color: transparent;
		transition:
			background 120ms var(--ease-out, ease),
			transform 120ms var(--ease-out, ease);
	}
	.pop-toggle:hover,
	.pop-toggle:focus-visible {
		background: rgba(255, 255, 255, 0.12);
		outline: none;
		/* Snap the tint in on hover; the base rule eases it back out on leave. */
		transition: transform 120ms var(--ease-out, ease);
	}
	.pop-toggle:active {
		transform: scale(0.97);
	}
	.pop-toggle.active {
		color: #fff;
		background: rgba(255, 255, 255, 0.16);
	}
	.pop-text {
		flex: 1;
	}
	.pop-state {
		color: rgba(255, 255, 255, 0.55);
		font-variant-numeric: tabular-nums;
	}

	/* ====================================================================
	 * Responsive collapse — pure CSS container queries keyed to rank class.
	 * Ranks 1 & 2 collapse together (settings popover never holds 1 item) and
	 * the gear appears at the same breakpoint. Time hides last.
	 * ==================================================================== */
	@container dsvideo (max-width: 520px) {
		.control-bar .ctl.rank-1,
		.control-bar .ctl.rank-2 {
			display: none;
		}
		.settings-menu {
			display: flex;
		}
		.settings-pop .pop-row.rank-1,
		.settings-pop .pop-row.rank-2 {
			display: flex;
		}
	}
	@container dsvideo (max-width: 450px) {
		.control-bar .ctl.rank-3 {
			display: none;
		}
		.settings-pop .pop-row.rank-3 {
			display: flex;
		}
	}
	@container dsvideo (max-width: 390px) {
		.control-bar .ctl.rank-4 {
			display: none;
		}
		.settings-pop .pop-row.rank-4 {
			display: flex;
		}
	}
	@container dsvideo (max-width: 340px) {
		.control-bar .ctl.rank-5 {
			display: none;
		}
		.settings-pop .pop-row.rank-5 {
			display: flex;
		}
	}
	@container dsvideo (max-width: 300px) {
		.control-bar .ctl.rank-6 {
			display: none;
		}
		.settings-pop .pop-row.rank-6 {
			display: flex;
		}
		/* Shrink the centre play button so it doesn't dominate a tiny player */
		.big-play {
			width: 48px;
			height: 48px;
		}
		.big-play svg {
			width: 30px;
			height: 30px;
		}
	}
	@container dsvideo (max-width: 250px) {
		.time {
			display: none;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.skeleton-shimmer {
			animation: none;
		}
		.settings-btn svg,
		.btn,
		.big-play {
			transition: none;
		}
	}
</style>

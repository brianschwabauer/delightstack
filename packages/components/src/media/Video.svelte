<script lang="ts" module>
	export interface Source {
		src: string;
		type: string;
		size?: number;
	}

	export interface Track {
		kind: 'captions' | 'subtitles';
		src: string;
		srclang: string;
		label: string;
		default?: boolean;
	}
</script>

<script lang="ts">
	import { ripple } from '@delightstack/utilities';
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
		aspectRatio = '16/9',

		/** Preload behavior */
		preload = 'metadata' as 'auto' | 'metadata' | 'none',

		/** Caption/subtitle tracks */
		captions = [] as Track[],

		/** URL to a WebVTT thumbnail track. Each cue's text should be the URL
		 *  of a sprite image, optionally suffixed with `#xywh=x,y,w,h` to point
		 *  at a region of a sprite sheet. When provided, hovering the seek bar
		 *  shows a thumbnail preview at the cue's mapped time. */
		thumbnails = undefined as string | undefined,

		/** Show loading skeleton */
		skeleton = false,

		/** Element ID */
		id = propId,

		/** Additional CSS classes */
		class: className = '',

		/** Bindable reference to the root HTML element */
		element = $bindable(undefined as HTMLElement | undefined),

		/** Bindable reference to the video element */
		player = $bindable(undefined as HTMLVideoElement | undefined),

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
		aspectRatio?: string;
		preload?: 'auto' | 'metadata' | 'none';
		captions?: Track[];
		thumbnails?: string;
		skeleton?: boolean;
		id?: string;
		class?: string;
		element?: HTMLElement | undefined;
		player?: HTMLVideoElement | undefined;
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
	let playing = $state(false);
	let current_time = $state(0);
	let duration = $state(0);
	let buffered_end = $state(0);
	let volume = $state(1);
	let is_muted = $state(muted);
	let is_fullscreen = $state(false);
	let is_pip = $state(false);
	let captions_active = $state(false);
	let show_controls = $state(true);
	let has_started = $state(false);
	let has_error = $state(false);
	let is_ready = $state(false);

	// Dropdown menus
	let quality_open = $state(false);
	let speed_open = $state(false);

	// Seeking
	let is_seeking = $state(false);
	let seek_hover_time = $state(0);
	let seek_hover_x = $state(0);
	let show_seek_tooltip = $state(false);

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
				const m = line.match(/(\d+(?::\d+){0,2}(?:\.\d+)?)\s*-->\s*(\d+(?::\d+){0,2}(?:\.\d+)?)/);
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
					const parts = next.slice(hashIdx + 6).split(',').map((n) => parseInt(n, 10));
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

	// --- Derived ---
	const sources = $derived(
		typeof src === 'string' ? [{ src, type: 'video/mp4' }] : src,
	);

	const has_quality_options = $derived(
		Array.isArray(src) && src.length > 1 && src.some((s) => s.size != null),
	);

	const quality_sources = $derived(
		has_quality_options
			? (src as Source[]).filter((s) => s.size != null).sort((a, b) => (b.size ?? 0) - (a.size ?? 0))
			: [],
	);

	let active_source_index = $state(0);

	const active_source = $derived(
		has_quality_options ? quality_sources[active_source_index] : sources[0],
	);

	const active_quality_label = $derived(
		active_source?.size ? `${active_source.size}p` : '',
	);

	const progress_percent = $derived(duration > 0 ? (current_time / duration) * 100 : 0);
	const buffered_percent = $derived(duration > 0 ? (buffered_end / duration) * 100 : 0);

	// --- Helpers ---
	function formatTime(seconds: number): string {
		if (!isFinite(seconds) || isNaN(seconds)) return '0:00';
		const h = Math.floor(seconds / 3600);
		const m = Math.floor((seconds % 3600) / 60);
		const s = Math.floor(seconds % 60);
		if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
		return `${m}:${s.toString().padStart(2, '0')}`;
	}

	function resetInactivityTimer() {
		show_controls = true;
		clearTimeout(inactivity_timer);
		if (playing) {
			inactivity_timer = setTimeout(() => {
				if (playing && !quality_open && !speed_open) {
					show_controls = false;
				}
			}, 2500);
		}
	}

	function closeAllMenus() {
		quality_open = false;
		speed_open = false;
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
		player.currentTime = Math.max(0, Math.min(time, duration));
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

	// --- Progress bar interaction ---
	function handleProgressPointerDown(e: PointerEvent) {
		// Without a known duration there's no meaningful position to seek to —
		// blocking here avoids the "click bar to restart" footgun when metadata
		// hasn't loaded yet.
		if (!duration || duration <= 0) return;
		is_seeking = true;
		updateSeekPosition(e);
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	}

	function handleProgressPointerMove(e: PointerEvent) {
		if (!duration || duration <= 0) return;
		updateSeekPosition(e);
		if (is_seeking && player) {
			player.currentTime = seek_hover_time;
		}
	}

	function handleProgressPointerUp(e: PointerEvent) {
		if (is_seeking && player && duration > 0) {
			player.currentTime = seek_hover_time;
		}
		is_seeking = false;
		try {
			(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
		} catch {
			// no capture to release
		}
	}

	function updateSeekPosition(e: PointerEvent) {
		const bar = e.currentTarget as HTMLElement;
		const rect = bar.getBoundingClientRect();
		const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
		const pct = rect.width > 0 ? x / rect.width : 0;
		seek_hover_time = pct * duration;
		seek_hover_x = x;
		show_seek_tooltip = true;
	}

	// --- Volume slider interaction ---
	let is_volume_dragging = $state(false);

	function handleVolumePointerDown(e: PointerEvent) {
		is_volume_dragging = true;
		updateVolumeFromEvent(e);
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	}

	function handleVolumePointerMove(e: PointerEvent) {
		if (!is_volume_dragging) return;
		updateVolumeFromEvent(e);
	}

	function handleVolumePointerUp(e: PointerEvent) {
		is_volume_dragging = false;
		(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
	}

	function updateVolumeFromEvent(e: PointerEvent) {
		const bar = e.currentTarget as HTMLElement;
		const rect = bar.getBoundingClientRect();
		const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
		setVolume(x / rect.width);
	}

	// --- Keyboard shortcuts ---
	function handleKeydown(e: KeyboardEvent) {
		if (!player) return;

		// Ignore keyboard when typing in an input
		const tag = (e.target as HTMLElement)?.tagName;
		if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

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
			default:
				handled = false;
		}

		if (handled) {
			e.preventDefault();
			e.stopPropagation();
			resetInactivityTimer();
		}
	}

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
		current_time = player.currentTime;
		// `loadedmetadata` is supposed to be the canonical place to read
		// duration, but some browser/codec combos fire `timeupdate` first
		// (or never fire `loadedmetadata` at all for already-cached files).
		// Mirror duration here too so the progress bar can't get stuck at 0.
		if (duration === 0 && isFinite(player.duration) && player.duration > 0) {
			duration = player.duration;
		}
		ontimeupdate?.({ currentTime: player.currentTime, duration: player.duration });
	}

	function handleVideoDurationChange() {
		if (!player) return;
		if (isFinite(player.duration) && player.duration > 0) {
			duration = player.duration;
		}
	}

	function handleVideoLoadedMetadata() {
		if (!player) return;
		if (isFinite(player.duration) && player.duration > 0) {
			duration = player.duration;
		}
		is_ready = true;
		pip_supported = 'pictureInPictureEnabled' in document && document.pictureInPictureEnabled;
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
			is_fullscreen = !!document.fullscreenElement && document.fullscreenElement === element;
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

	// --- Close dropdowns on outside click ---
	$effect(() => {
		if (!quality_open && !speed_open) return;
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

	// Volume icon state
	const volume_icon = $derived(
		is_muted || volume === 0 ? 'muted' : volume < 0.5 ? 'low' : 'high',
	);
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div
	{id}
	class={['video', className].filter(Boolean).join(' ')}
	class:is-fullscreen={is_fullscreen}
	style:aspect-ratio={is_fullscreen ? undefined : aspectRatio}
	bind:this={element}
	onmousemove={resetInactivityTimer}
	onmouseenter={resetInactivityTimer}
	ontouchstart={resetInactivityTimer}
	onkeydown={handleKeydown}
	tabindex="0"
	role="group"
	aria-label="Video player">

	{#if skeleton && !is_ready}
		<div class="skeleton" aria-hidden="true"></div>
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
		class="element"
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
		{#if has_quality_options}
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

	<!-- Big play button overlay -->
	{#if !has_started && !playing}
		<button
			class="big-play"
			type="button"
			aria-label="Play video"
			onclick={togglePlay}
			{@attach ripple({})}>
			<svg class="big-play-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
				<path d="M8.5 5.4a.8.8 0 0 1 1.2-.7l9 6.6a.8.8 0 0 1 0 1.3l-9 6.6a.8.8 0 0 1-1.2-.7V5.4z" />
			</svg>
		</button>
	{/if}

	<!-- Error overlay -->
	{#if has_error}
		<div class="error">
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
				<circle cx="12" cy="12" r="10" />
				<line x1="12" y1="8" x2="12" y2="12" />
				<line x1="12" y1="16" x2="12.01" y2="16" />
			</svg>
			<span>Video could not be loaded</span>
		</div>
	{/if}

	<!-- Custom controls -->
	{#if controls}
		<div
			class="controls"
			class:visible={show_controls || !playing}
			class:hidden={!show_controls && playing}>

			<!-- Progress bar -->
			<div
				class="progress"
				role="slider"
				aria-label="Seek"
				aria-valuenow={Math.floor(current_time)}
				aria-valuemin={0}
				aria-valuemax={Math.floor(duration)}
				tabindex="-1"
				onpointerdown={handleProgressPointerDown}
				onpointermove={handleProgressPointerMove}
				onpointerup={handleProgressPointerUp}
				onpointerenter={() => (show_seek_tooltip = true)}
				onpointerleave={() => { show_seek_tooltip = false; is_seeking = false; }}>

				<div class="progress-track">
					<div class="progress-buffered" style:width="{buffered_percent}%"></div>
					<div class="progress-fill" style:width="{progress_percent}%"></div>
				</div>

				{#if show_seek_tooltip && duration > 0}
					<div class="seek-tooltip" style:left="{seek_hover_x}px">
						{#if active_thumb}
							{#if active_thumb.xywh}
								<div
									class="seek-thumb"
									style:width="{active_thumb.xywh[2]}px"
									style:height="{active_thumb.xywh[3]}px"
									style:background-image="url('{active_thumb.src}')"
									style:background-position="-{active_thumb.xywh[0]}px -{active_thumb.xywh[1]}px"
									aria-hidden="true">
								</div>
							{:else}
								<img class="seek-thumb-img" src={active_thumb.src} alt="" aria-hidden="true" />
							{/if}
						{/if}
						<span class="seek-time">{formatTime(seek_hover_time)}</span>
					</div>
				{/if}
			</div>

			<!-- Control bar -->
			<div class="control-bar">
				<!-- Left controls -->
				<div class="controls-left">
					<!-- Play/Pause -->
					<button
						class="btn"
						type="button"
						aria-label={playing ? 'Pause' : 'Play'}
						onclick={togglePlay}>
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

					<!-- Volume -->
					<div class="volume-group">
						<button
							class="btn"
							type="button"
							aria-label={is_muted ? 'Unmute' : 'Mute'}
							onclick={toggleMute}>
							{#if volume_icon === 'muted'}
								<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
									<path d="M11 5L6 9H2v6h4l5 4V5z" />
									<line x1="23" y1="9" x2="17" y2="15" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none" />
									<line x1="17" y1="9" x2="23" y2="15" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none" />
								</svg>
							{:else if volume_icon === 'low'}
								<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
									<path d="M11 5L6 9H2v6h4l5 4V5z" />
									<path d="M15.54 8.46a5 5 0 010 7.07" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none" />
								</svg>
							{:else}
								<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
									<path d="M11 5L6 9H2v6h4l5 4V5z" />
									<path d="M15.54 8.46a5 5 0 010 7.07" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none" />
									<path d="M19.07 4.93a10 10 0 010 14.14" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none" />
								</svg>
							{/if}
						</button>

						<div
							class="volume-slider"
							role="slider"
							aria-label="Volume"
							aria-valuenow={Math.round(volume * 100)}
							aria-valuemin={0}
							aria-valuemax={100}
							tabindex="-1"
							onpointerdown={handleVolumePointerDown}
							onpointermove={handleVolumePointerMove}
							onpointerup={handleVolumePointerUp}>
							<div class="volume-track">
								<div class="volume-fill" style:width="{is_muted ? 0 : volume * 100}%"></div>
							</div>
						</div>
					</div>

					<!-- Time display -->
					<span class="time">
						{formatTime(current_time)} / {formatTime(duration)}
					</span>
				</div>

				<!-- Right controls -->
				<div class="controls-right">
					<!-- Playback speed -->
					<div class="menu">
						<button
							class="btn btn-text"
							type="button"
							aria-label="Playback speed"
							aria-haspopup="true"
							aria-expanded={speed_open}
							onclick={() => { speed_open = !speed_open; quality_open = false; }}>
							{playback_rate === 1 ? '1x' : `${playback_rate}x`}
						</button>
						{#if speed_open}
							<div class="dropdown" role="menu">
								{#each SPEEDS as speed}
									<button
										class="dropdown-item"
										class:active={playback_rate === speed}
										type="button"
										role="menuitem"
										onclick={() => selectSpeed(speed)}>
										{speed}x
									</button>
								{/each}
							</div>
						{/if}
					</div>

					<!-- Quality selector -->
					{#if has_quality_options}
						<div class="menu">
							<button
								class="btn btn-text"
								type="button"
								aria-label="Video quality"
								aria-haspopup="true"
								aria-expanded={quality_open}
								onclick={() => { quality_open = !quality_open; speed_open = false; }}>
								{active_quality_label}
							</button>
							{#if quality_open}
								<div class="dropdown" role="menu">
									{#each quality_sources as source, i}
										<button
											class="dropdown-item"
											class:active={active_source_index === i}
											type="button"
											role="menuitem"
											onclick={() => selectQuality(i)}>
											{source.size}p
										</button>
									{/each}
								</div>
							{/if}
						</div>
					{/if}

					<!-- Captions toggle -->
					{#if captions.length > 0}
						<button
							class="btn"
							class:active={captions_active}
							type="button"
							aria-label={captions_active ? 'Disable captions' : 'Enable captions'}
							onclick={toggleCaptions}>
							<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
								<rect x="2" y="4" width="20" height="16" rx="2" />
								<path d="M7 12h2" />
								<path d="M15 12h2" />
								<path d="M7 16h10" />
							</svg>
						</button>
					{/if}

					<!-- PiP -->
					{#if pip_supported}
						<button
							class="btn"
							class:active={is_pip}
							type="button"
							aria-label={is_pip ? 'Exit picture-in-picture' : 'Picture-in-picture'}
							onclick={togglePip}>
							<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
								<rect x="2" y="3" width="20" height="14" rx="2" />
								<rect x="12" y="9" width="8" height="6" rx="1" fill="currentColor" />
							</svg>
						</button>
					{/if}

					<!-- Fullscreen -->
					<button
						class="btn"
						type="button"
						aria-label={is_fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
						onclick={toggleFullscreen}>
						{#if is_fullscreen}
							<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
								<path d="M8 3v3a2 2 0 01-2 2H3" />
								<path d="M21 8h-3a2 2 0 01-2-2V3" />
								<path d="M3 16h3a2 2 0 012 2v3" />
								<path d="M16 21v-3a2 2 0 012-2h3" />
							</svg>
						{:else}
							<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
								<path d="M8 3H5a2 2 0 00-2 2v3" />
								<path d="M21 8V5a2 2 0 00-2-2h-3" />
								<path d="M3 16v3a2 2 0 002 2h3" />
								<path d="M16 21h3a2 2 0 002-2v-3" />
							</svg>
						{/if}
					</button>
				</div>
			</div>
		</div>
	{/if}
</div>

<style>
	.video {
		position: relative;
		overflow: hidden;
		background: black;
		border-radius: var(--radius-md, 8px);
		width: 100%;
		outline: none;
		font-family: var(--font-sans, system-ui, -apple-system, sans-serif);
		user-select: none;
		-webkit-user-select: none;
	}

	.video:focus-visible {
		outline: 2px solid var(--color-action, #2563eb);
		outline-offset: 2px;
	}

	.video.is-fullscreen {
		border-radius: 0;
		width: 100%;
		height: 100%;
	}

	/* Skeleton */
	.skeleton {
		position: absolute;
		inset: 0;
		z-index: 1;
		background: linear-gradient(
			90deg,
			var(--color-surface-2, rgba(128, 128, 128, 0.1)) 25%,
			var(--color-surface-3, rgba(128, 128, 128, 0.2)) 50%,
			var(--color-surface-2, rgba(128, 128, 128, 0.1)) 75%
		);
		background-size: 200% 100%;
		animation: shimmer 1.5s ease-in-out infinite;
	}

	@keyframes shimmer {
		0% { background-position: 200% 0; }
		100% { background-position: -200% 0; }
	}

	/* Video element */
	.element {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: contain;
		cursor: pointer;
	}

	/* Big play button — semi-transparent black with backdrop blur for an
	 * iOS/macOS player feel, white play glyph slightly cheated left so the
	 * triangle reads optically centered against the round button. */
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
			transform var(--duration-fast, 150ms) var(--ease-default, ease),
			background var(--duration-fast, 150ms) var(--ease-default, ease),
			opacity var(--duration-fast, 150ms) var(--ease-default, ease);
		box-shadow: 0 4px 24px rgba(0, 0, 0, 0.35);
	}

	.big-play:hover {
		transform: translate(-50%, -50%) scale(1.06);
		background: rgba(0, 0, 0, 0.55);
	}

	.big-play:active {
		transform: translate(-50%, -50%) scale(0.96);
	}

	.big-play .big-play-icon {
		width: 32px;
		height: 32px;
		/* Optical centering: the play triangle's visual mass sits to the right
		 * of its geometric center, so nudge the icon left a few pixels. */
		margin-left: -3px;
		filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.25));
	}

	/* Error overlay */
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
		color: var(--color-text-muted, rgba(255, 255, 255, 0.7));
		font-size: var(--text-sm, 0.875rem);
	}

	.error svg {
		width: 32px;
		height: 32px;
		opacity: 0.7;
	}

	/* Controls container */
	.controls {
		position: absolute;
		bottom: 0;
		left: 0;
		right: 0;
		z-index: 10;
		display: flex;
		flex-direction: column;
		background: linear-gradient(transparent, rgba(0, 0, 0, 0.7));
		padding: 32px 0 0;
		transition: opacity var(--duration-fast, 150ms) var(--ease-default, ease);
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

	/* Progress bar */
	.progress {
		position: relative;
		height: 20px;
		cursor: pointer;
		display: flex;
		align-items: center;
		padding: 0 12px;
		touch-action: none;
	}

	.progress-track {
		position: relative;
		width: 100%;
		height: 4px;
		background: rgba(255, 255, 255, 0.2);
		border-radius: 2px;
		overflow: hidden;
		transition: height var(--duration-fast, 150ms) var(--ease-default, ease);
	}

	.progress:hover .progress-track {
		height: 6px;
	}

	.progress-buffered {
		position: absolute;
		top: 0;
		left: 0;
		height: 100%;
		background: rgba(255, 255, 255, 0.3);
		border-radius: 2px;
		pointer-events: none;
	}

	.progress-fill {
		position: absolute;
		top: 0;
		left: 0;
		height: 100%;
		background: var(--color-action, #2563eb);
		border-radius: 2px;
		pointer-events: none;
	}

	/* Seek tooltip */
	.seek-tooltip {
		position: absolute;
		bottom: 16px;
		transform: translateX(-50%);
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 4px;
		background: rgba(0, 0, 0, 0.85);
		color: white;
		padding: 4px;
		border-radius: var(--radius-sm, 4px);
		font-size: var(--text-xs, 0.75rem);
		white-space: nowrap;
		pointer-events: none;
		font-variant-numeric: tabular-nums;
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

	/* Control bar */
	.control-bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 4px 8px 8px;
		gap: 4px;
	}

	.controls-left {
		display: flex;
		align-items: center;
		gap: 4px;
	}

	.controls-right {
		display: flex;
		align-items: center;
		gap: 4px;
	}

	/* Button base — matches delightstack Button's :active scale + ripple feel. */
	.btn {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 36px;
		height: 36px;
		border: none;
		border-radius: var(--radius-sm, 4px);
		background: transparent;
		color: white;
		cursor: pointer;
		padding: 0;
		overflow: hidden;
		transition:
			background var(--duration-fast, 150ms) var(--ease-default, ease),
			translate 200ms ease;
		flex-shrink: 0;
	}

	.btn:hover {
		background: rgba(255, 255, 255, 0.15);
		transition: translate 200ms ease;
	}

	.btn:active {
		background: rgba(255, 255, 255, 0.25);
		translate: 0 1px;
	}

	.btn.active {
		color: var(--color-action, #2563eb);
	}

	.btn svg {
		width: 20px;
		height: 20px;
	}

	/* Text-style button (speed, quality) */
	.btn-text {
		width: auto;
		padding: 0 8px;
		font-size: var(--text-xs, 0.75rem);
		font-weight: 600;
		font-family: inherit;
		letter-spacing: 0.02em;
		font-variant-numeric: tabular-nums;
	}

	/* Volume group */
	.volume-group {
		display: flex;
		align-items: center;
		gap: 0;
	}

	.volume-slider {
		width: 0;
		overflow: hidden;
		transition: width var(--duration-fast, 150ms) var(--ease-default, ease);
		cursor: pointer;
		display: flex;
		align-items: center;
		padding: 0;
		touch-action: none;
	}

	.volume-group:hover .volume-slider {
		width: 64px;
		padding: 0 4px;
	}

	.volume-track {
		position: relative;
		width: 100%;
		height: 4px;
		background: rgba(255, 255, 255, 0.2);
		border-radius: 2px;
		overflow: hidden;
	}

	.volume-fill {
		position: absolute;
		top: 0;
		left: 0;
		height: 100%;
		background: white;
		border-radius: 2px;
		pointer-events: none;
	}

	/* Time display */
	.time {
		color: rgba(255, 255, 255, 0.9);
		font-size: var(--text-xs, 0.75rem);
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
		padding: 0 4px;
	}

	/* Dropdown menus */
	.menu {
		position: relative;
	}

	.dropdown {
		position: absolute;
		bottom: 100%;
		right: 0;
		margin-bottom: 8px;
		background: var(--color-surface, rgba(20, 20, 20, 0.95));
		backdrop-filter: blur(12px);
		-webkit-backdrop-filter: blur(12px);
		border: 1px solid var(--color-border, rgba(255, 255, 255, 0.1));
		border-radius: var(--radius-md, 8px);
		box-shadow: var(--shadow-md, 0 4px 12px rgba(0, 0, 0, 0.4));
		padding: 4px;
		min-width: 80px;
		z-index: 20;
	}

	.dropdown-item {
		display: block;
		width: 100%;
		padding: 6px 12px;
		border: none;
		border-radius: var(--radius-sm, 4px);
		background: transparent;
		color: var(--color-text, rgba(255, 255, 255, 0.9));
		cursor: pointer;
		font-size: var(--text-sm, 0.875rem);
		font-family: inherit;
		text-align: left;
		white-space: nowrap;
		transition: background var(--duration-fast, 150ms) var(--ease-default, ease);
	}

	.dropdown-item:hover {
		background: rgba(255, 255, 255, 0.1);
	}

	.dropdown-item.active {
		color: var(--color-action, #2563eb);
		font-weight: 600;
	}
</style>

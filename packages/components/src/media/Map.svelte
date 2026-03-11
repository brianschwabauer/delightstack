<script lang="ts" module>
	export interface MapMarker {
		position: [number, number];
		title?: string;
		icon?: string;
		data?: Record<string, unknown>;
	}

	export interface MapInitOptions {
		center: [number, number];
		zoom: number;
		interactive: boolean;
	}

	export interface MapProvider {
		init(container: HTMLElement, options: MapInitOptions): Promise<unknown>;
		destroy(): void;
		setCenter(center: [number, number]): void;
		setZoom(zoom: number): void;
		addMarker(marker: MapMarker, onClick?: () => void): unknown;
		removeMarker(markerRef: unknown): void;
		clearMarkers(): void;
		fitToMarkers(padding: number): void;
		on(event: string, handler: Function): void;
	}

	const DEFAULT_LIGHT_TILES = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
	const DEFAULT_DARK_TILES = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';

	/** Default Leaflet provider — consumer must have `leaflet` installed */
	export function leafletProvider(options?: { tileUrl?: string; darkTileUrl?: string }): MapProvider {
		let L: typeof import('leaflet');
		let map: import('leaflet').Map | undefined;
		let tile_layer: import('leaflet').TileLayer | undefined;
		let marker_refs: import('leaflet').Marker[] = [];
		let dark_query: MediaQueryList | undefined;
		let theme_handler: (() => void) | undefined;

		const light_url = options?.tileUrl ?? DEFAULT_LIGHT_TILES;
		const dark_url = options?.darkTileUrl ?? DEFAULT_DARK_TILES;

		function getCurrentTileUrl(): string {
			if (typeof window === 'undefined') return light_url;
			return window.matchMedia('(prefers-color-scheme: dark)').matches ? dark_url : light_url;
		}

		function updateTileLayer() {
			if (!map || !L) return;
			if (tile_layer) {
				tile_layer.setUrl(getCurrentTileUrl());
			}
		}

		return {
			async init(container, opts) {
				L = await import('leaflet');

				map = L.map(container, {
					center: opts.center,
					zoom: opts.zoom,
					zoomControl: opts.interactive,
					dragging: opts.interactive,
					touchZoom: opts.interactive,
					scrollWheelZoom: opts.interactive,
					doubleClickZoom: opts.interactive,
					boxZoom: opts.interactive,
					keyboard: opts.interactive,
				});

				tile_layer = L.tileLayer(getCurrentTileUrl(), {
					attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
					maxZoom: 19,
				}).addTo(map);

				// Listen for theme changes
				if (typeof window !== 'undefined') {
					dark_query = window.matchMedia('(prefers-color-scheme: dark)');
					theme_handler = () => updateTileLayer();
					dark_query.addEventListener('change', theme_handler);
				}

				return map;
			},

			destroy() {
				if (dark_query && theme_handler) {
					dark_query.removeEventListener('change', theme_handler);
					dark_query = undefined;
					theme_handler = undefined;
				}
				if (map) {
					map.remove();
					map = undefined;
				}
				tile_layer = undefined;
				marker_refs = [];
			},

			setCenter(center) {
				map?.setView(center, map.getZoom(), { animate: true });
			},

			setZoom(zoom) {
				map?.setZoom(zoom, { animate: true });
			},

			addMarker(marker, onClick) {
				if (!map || !L) return undefined;

				const marker_options: import('leaflet').MarkerOptions = {};

				if (marker.title) {
					marker_options.title = marker.title;
				}

				if (marker.icon) {
					marker_options.icon = L.icon({
						iconUrl: marker.icon,
						iconSize: [25, 41],
						iconAnchor: [12, 41],
						popupAnchor: [1, -34],
					});
				}

				const leaflet_marker = L.marker(marker.position, marker_options).addTo(map);

				if (onClick) {
					leaflet_marker.on('click', onClick);
				}

				marker_refs.push(leaflet_marker);
				return leaflet_marker;
			},

			removeMarker(markerRef) {
				if (!map) return;
				const m = markerRef as import('leaflet').Marker;
				m.remove();
				marker_refs = marker_refs.filter(ref => ref !== m);
			},

			clearMarkers() {
				for (const m of marker_refs) {
					m.remove();
				}
				marker_refs = [];
			},

			fitToMarkers(padding) {
				if (!map || !L || marker_refs.length === 0) return;
				const group = L.featureGroup(marker_refs);
				map.fitBounds(group.getBounds(), { padding: [padding, padding] });
			},

			on(event, handler) {
				map?.on(event, handler as import('leaflet').LeafletEventHandlerFn);
			},
		};
	}
</script>

<script lang="ts">
	import type { Snippet } from 'svelte';
	import { tick } from 'svelte';

	const propId = $props.id();

	let {
		/** Map provider adapter */
		provider = leafletProvider(),

		/** Map center [lat, lng] */
		center = $bindable([0, 0]) as [number, number],

		/** Zoom level */
		zoom = $bindable(10) as number,

		/** Markers to display */
		markers = [] as MapMarker[],

		/** Enable marker clustering (consumer must install leaflet.markercluster) */
		cluster = false,

		/** Enable pan/zoom */
		interactive = true,

		/** Auto-fit bounds to show all markers */
		fitMarkers = false,

		/** Padding when fitting */
		fitPadding = 50,

		/** Container height */
		height = '400px',

		/** Show loading skeleton */
		skeleton = false,

		/** Element ID */
		id = propId,

		/** Additional CSS classes */
		class: className = '',

		/** Bind to the underlying DOM element */
		element = $bindable(undefined as HTMLElement | undefined),

		/** Bind to provider map instance */
		map = $bindable(undefined as unknown),

		/** Custom popup content snippet */
		popup = undefined as undefined | Snippet<[marker: MapMarker]>,

		/** Marker clicked */
		onmarkerclick = undefined as undefined | ((detail: { marker: MapMarker }) => void),

		/** Map moved/zoomed */
		onmove = undefined as undefined | ((detail: { center: [number, number]; zoom: number }) => void),

		/** Map background clicked */
		onclick = undefined as undefined | ((detail: { latlng: [number, number] }) => void),

		/** Map provider initialized */
		onload = undefined as undefined | ((detail: { map: unknown }) => void),
	}: {
		provider?: MapProvider;
		center?: [number, number];
		zoom?: number;
		markers?: MapMarker[];
		cluster?: boolean;
		interactive?: boolean;
		fitMarkers?: boolean;
		fitPadding?: number;
		height?: string;
		skeleton?: boolean;
		id?: string;
		class?: string;
		element?: HTMLElement | undefined;
		map?: unknown;
		popup?: Snippet<[marker: MapMarker]>;
		onmarkerclick?: (detail: { marker: MapMarker }) => void;
		onmove?: (detail: { center: [number, number]; zoom: number }) => void;
		onclick?: (detail: { latlng: [number, number] }) => void;
		onload?: (detail: { map: unknown }) => void;
	} = $props();

	let container: HTMLElement | undefined = $state(undefined);
	let popup_container: HTMLElement | undefined = $state(undefined);
	let initialized = $state(false);
	let suppressing_move = false;
	let marker_ref_map = new Map<MapMarker, unknown>();

	/** The marker whose popup is currently being rendered in the hidden container */
	let popup_marker = $state<MapMarker | undefined>(undefined);
	/** The marker ref that should receive the popup after rendering */
	let popup_target_ref: unknown = undefined;

	/* ── Initialize provider ────────────────────────────────────── */

	$effect(() => {
		if (!container) return;
		// Track these to re-init if they change
		void provider;
		void interactive;

		initialized = false;

		provider.init(container, {
			center,
			zoom,
			interactive,
		}).then((instance) => {
			map = instance;
			initialized = true;
			onload?.({ map: instance });

			// Listen for move/zoom events from the map
			provider.on('moveend', () => {
				if (suppressing_move) return;
				if (map && typeof map === 'object' && 'getCenter' in map && 'getZoom' in map) {
					const m = map as { getCenter(): { lat: number; lng: number }; getZoom(): number };
					const new_center = m.getCenter();
					const new_zoom = m.getZoom();
					center = [new_center.lat, new_center.lng];
					zoom = new_zoom;
					onmove?.({ center: [new_center.lat, new_center.lng], zoom: new_zoom });
				}
			});

			// Listen for map clicks
			provider.on('click', (e: unknown) => {
				if (e && typeof e === 'object' && 'latlng' in e) {
					const evt = e as { latlng: { lat: number; lng: number } };
					onclick?.({ latlng: [evt.latlng.lat, evt.latlng.lng] });
				}
			});
		});

		return () => {
			popup_marker = undefined;
			popup_target_ref = undefined;
			provider.destroy();
			map = undefined;
			initialized = false;
			marker_ref_map.clear();
		};
	});

	/* ── Sync center from props to provider ────────────────────── */

	$effect(() => {
		if (!initialized) return;
		const [lat, lng] = center;
		suppressing_move = true;
		provider.setCenter([lat, lng]);
		queueMicrotask(() => { suppressing_move = false; });
	});

	/* ── Sync zoom from props to provider ──────────────────────── */

	$effect(() => {
		if (!initialized) return;
		const z = zoom;
		suppressing_move = true;
		provider.setZoom(z);
		queueMicrotask(() => { suppressing_move = false; });
	});

	/* ── Manage markers ────────────────────────────────────────── */

	$effect(() => {
		if (!initialized) return;

		const current_markers = markers;

		// Clear all existing markers and popup state
		popup_marker = undefined;
		popup_target_ref = undefined;
		provider.clearMarkers();
		marker_ref_map.clear();

		// Add new markers
		for (const marker of current_markers) {
			const ref = provider.addMarker(marker, () => {
				onmarkerclick?.({ marker });

				// Show popup if snippet is provided
				if (popup && ref) {
					openPopupForMarker(marker, ref);
				}
			});
			if (ref !== undefined) {
				marker_ref_map.set(marker, ref);
			}
		}

		// Fit markers if requested
		if (fitMarkers && current_markers.length > 0) {
			provider.fitToMarkers(fitPadding);
		}
	});

	/* ── Fit markers when fitMarkers/fitPadding changes ────────── */

	$effect(() => {
		if (!initialized) return;
		if (fitMarkers && markers.length > 0) {
			void fitPadding;
			provider.fitToMarkers(fitPadding);
		}
	});

	/* ── Popup rendering ───────────────────────────────────────── */

	/**
	 * Sets the popup_marker state so the snippet renders in the hidden container,
	 * then after Svelte updates the DOM, passes the rendered HTML to the Leaflet
	 * marker popup as a string.
	 */
	async function openPopupForMarker(marker: MapMarker, markerRef: unknown) {
		popup_marker = marker;
		popup_target_ref = markerRef;

		// Wait for Svelte to render the snippet into popup_container
		await tick();

		if (!popup_container || !popup_target_ref) return;

		// Extract the rendered HTML content to pass to Leaflet
		const html = popup_container.innerHTML;

		if (
			popup_target_ref &&
			typeof popup_target_ref === 'object' &&
			'bindPopup' in popup_target_ref
		) {
			const m = popup_target_ref as {
				unbindPopup(): void;
				bindPopup(content: string): unknown;
				openPopup(): void;
			};
			m.unbindPopup();
			m.bindPopup(html);
			m.openPopup();
		}
	}
</script>

<!-- Hidden container for rendering popup snippet content -->
{#if popup && popup_marker}
	<div class="ds-map-popup-render" bind:this={popup_container} aria-hidden="true">
		{@render popup(popup_marker)}
	</div>
{/if}

<div
	{id}
	class={['ds-map', className].filter(Boolean).join(' ')}
	style:height
	bind:this={element}
	role={interactive ? 'application' : 'img'}
	aria-label={interactive ? 'Interactive map' : 'Map'}
	tabindex={interactive ? 0 : undefined}>

	{#if skeleton}
		<div class="ds-map-skeleton">
			<div class="ds-map-skeleton-shimmer"></div>
			<div class="ds-map-skeleton-icon" aria-hidden="true">
				<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="48" height="48">
					<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
					<circle cx="12" cy="10" r="3" />
				</svg>
			</div>
		</div>
	{:else}
		<div class="ds-map-container" bind:this={container}></div>
	{/if}
</div>

<style>
	.ds-map {
		position: relative;
		width: 100%;
		border-radius: var(--radius-md, 0.5rem);
		overflow: hidden;
	}

	.ds-map:focus-visible {
		outline: 2px solid var(--color-action, #3b82f6);
		outline-offset: 2px;
	}

	/* ── Map container ─────────────────────────────────────────── */

	.ds-map-container {
		width: 100%;
		height: 100%;
	}

	/* ── Hidden popup render target ────────────────────────────── */

	.ds-map-popup-render {
		position: absolute;
		pointer-events: none;
		visibility: hidden;
		width: 0;
		height: 0;
		overflow: hidden;
	}

	/* ── Skeleton ──────────────────────────────────────────────── */

	.ds-map-skeleton {
		position: relative;
		width: 100%;
		height: 100%;
		background-color: var(--color-surface-raised, light-dark(#f3f4f6, #1f2937));
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.ds-map-skeleton-shimmer {
		position: absolute;
		inset: 0;
		background: linear-gradient(
			90deg,
			transparent 25%,
			light-dark(rgba(0, 0, 0, 0.04), rgba(255, 255, 255, 0.04)) 50%,
			transparent 75%
		);
		background-size: 200% 100%;
		animation: ds-map-shimmer 1.5s ease-in-out infinite;
	}

	@keyframes ds-map-shimmer {
		0% {
			background-position: 200% 0;
		}
		100% {
			background-position: -200% 0;
		}
	}

	.ds-map-skeleton-icon {
		position: relative;
		z-index: 1;
		color: light-dark(rgba(0, 0, 0, 0.15), rgba(255, 255, 255, 0.1));
	}

	/* ── Popup styling ─────────────────────────────────────────── */

	:global(.ds-map-popup-render) {
		font-family: var(--font-sans, system-ui, -apple-system, sans-serif);
		font-size: var(--text-sm, 0.875rem);
		color: var(--color-text, light-dark(#111827, #f9fafb));
	}

	/* Override Leaflet default popup styles */
	.ds-map-container :global(.leaflet-popup-content-wrapper) {
		border-radius: var(--radius-md, 0.5rem);
		border: 1px solid var(--color-border, light-dark(#e5e7eb, #374151));
		box-shadow: 0 4px 12px rgb(0 0 0 / 0.1);
		font-family: var(--font-sans, system-ui, -apple-system, sans-serif);
		font-size: var(--text-sm, 0.875rem);
		color: var(--color-text, light-dark(#111827, #f9fafb));
		background: light-dark(#ffffff, #1f2937);
	}

	.ds-map-container :global(.leaflet-popup-content) {
		margin: 0.75rem;
	}

	.ds-map-container :global(.leaflet-popup-tip) {
		background: light-dark(#ffffff, #1f2937);
		border: 1px solid var(--color-border, light-dark(#e5e7eb, #374151));
	}

	/* ── Reduced motion ────────────────────────────────────────── */

	@media (prefers-reduced-motion: reduce) {
		.ds-map-skeleton-shimmer {
			animation: none;
		}
	}
</style>

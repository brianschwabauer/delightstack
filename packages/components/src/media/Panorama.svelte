<script lang="ts" module>
	export interface Hotspot {
		position: { pitch: number; yaw: number };
		label?: string;
		data?: Record<string, unknown>;
	}
</script>

<script lang="ts">
	import { untrack } from 'svelte';
	import Button from '../actions/Button.svelte';

	/* ── Minimal Three.js type surface ───────────────────────── */

	interface ThreeVector2 {
		x: number;
		y: number;
	}

	interface ThreeVector3 {
		x: number;
		y: number;
		z: number;
		clone(): ThreeVector3;
		normalize(): ThreeVector3;
		project(camera: ThreeCamera): ThreeVector3;
		dot(v: ThreeVector3): number;
	}

	interface ThreeTexture {
		colorSpace: string;
		dispose(): void;
	}

	interface ThreeMaterial {
		map: ThreeTexture | null;
		needsUpdate: boolean;
		dispose(): void;
	}

	interface ThreeMesh {
		// no methods/properties used directly
	}

	interface ThreeGeometry {
		dispose(): void;
	}

	interface ThreeCamera {
		position: { set(x: number, y: number, z: number): void };
		fov: number;
		aspect: number;
		lookAt(x: number, y: number, z: number): void;
		updateProjectionMatrix(): void;
		getWorldDirection(target: ThreeVector3): ThreeVector3;
	}

	interface ThreeRenderer {
		setSize(width: number, height: number): void;
		setPixelRatio(ratio: number): void;
		getSize(target: ThreeVector2): ThreeVector2;
		render(scene: ThreeScene, camera: ThreeCamera): void;
		dispose(): void;
	}

	interface ThreeScene {
		add(object: ThreeMesh): void;
	}

	interface ThreeTextureLoader {
		load(
			url: string,
			onLoad: (texture: ThreeTexture) => void,
			onProgress: undefined,
			onError: (err: unknown) => void,
		): void;
	}

	interface ThreeModule {
		Scene: new () => ThreeScene;
		PerspectiveCamera: new (
			fov: number,
			aspect: number,
			near: number,
			far: number,
		) => ThreeCamera;
		WebGLRenderer: new (params: {
			canvas: HTMLCanvasElement;
			antialias: boolean;
		}) => ThreeRenderer;
		SphereGeometry: new (
			radius: number,
			widthSegments: number,
			heightSegments: number,
		) => ThreeGeometry;
		MeshBasicMaterial: new (params: { map: ThreeTexture; side: number }) => ThreeMaterial;
		Mesh: new (geometry: ThreeGeometry, material: ThreeMaterial) => ThreeMesh;
		TextureLoader: new () => ThreeTextureLoader;
		Vector2: new () => ThreeVector2;
		Vector3: new (x?: number, y?: number, z?: number) => ThreeVector3;
		SRGBColorSpace: string;
		BackSide: number;
	}

	const DEG2RAD = Math.PI / 180;
	const FOV_MIN = 30;
	const FOV_MAX = 120;
	const AUTO_RESUME_DELAY = 3000;
	const INERTIA_DAMPING = 0.92;
	const VIEWCHANGE_THROTTLE = 50;

	const propId = $props.id();

	let {
		/** Equirectangular panorama image URL */
		src,

		/** Starting camera orientation in degrees */
		initial_view = { pitch: 0, yaw: 0 },

		/** Field of view in degrees */
		fov = 75,

		/** Gentle continuous rotation */
		auto_rotate = false,

		/** Rotation speed multiplier */
		auto_rotate_speed = 1,

		/** Show zoom/fullscreen buttons */
		show_controls = true,

		/** Whether the panorama is being rendered inside an embedded context
		 *  (Carousel/Gallery). When true, controls are hidden, keyboard text
		 *  selection is disabled, and the canvas is rendered at lower DPR for
		 *  better performance. */
		embedded = false,

		/** Enable drag/touch/scroll interaction */
		interactive = true,

		/** Enable device orientation control on mobile */
		gyroscope = false,

		/** Interactive markers in the panorama */
		hotspots = [] as Hotspot[],

		/** Static image URL when WebGL unavailable */
		fallback = undefined as string | undefined,

		/** Show loading skeleton */
		skeleton = false,

		/** Element ID */
		id = propId,

		/** Additional CSS classes */
		class: className = '',

		/** Bindable root element reference */
		element = $bindable(undefined as HTMLElement | undefined),

		/** Camera changed */
		onviewchange = undefined as
			| undefined
			| ((detail: { pitch: number; yaw: number; fov: number }) => void),

		/** Hotspot clicked */
		onhotspotclick = undefined as undefined | ((detail: { hotspot: Hotspot }) => void),

		/** Panorama ready */
		onload = undefined as undefined | (() => void),

		/** Failed to load */
		onerror = undefined as undefined | ((detail: { error: Error }) => void),
	}: {
		src: string;
		initial_view?: { pitch: number; yaw: number };
		fov?: number;
		auto_rotate?: boolean;
		auto_rotate_speed?: number;
		show_controls?: boolean;
		embedded?: boolean;
		interactive?: boolean;
		gyroscope?: boolean;
		hotspots?: Hotspot[];
		fallback?: string;
		skeleton?: boolean;
		id?: string;
		class?: string;
		element?: HTMLElement | undefined;
		onviewchange?: (detail: { pitch: number; yaw: number; fov: number }) => void;
		onhotspotclick?: (detail: { hotspot: Hotspot }) => void;
		onload?: () => void;
		onerror?: (detail: { error: Error }) => void;
	} = $props();

	/* ── State ────────────────────────────────────────────────── */

	let canvas_el: HTMLCanvasElement | undefined = $state(undefined);
	let has_webgl = $state(true);
	let loaded = $state(false);
	let loading = $state(true);
	let error_state = $state(false);

	let current_pitch = $state(initial_view.pitch);
	let current_yaw = $state(initial_view.yaw);
	let current_fov = $state(fov);
	let is_fullscreen = $state(false);

	// Hotspot screen positions: [x, y, visible]
	let hotspot_positions = $state<{ x: number; y: number; visible: boolean }[]>([]);

	/* ── Internals (not reactive) ─────────────────────────────── */

	let three: ThreeModule | undefined;
	let renderer: ThreeRenderer | undefined;
	let scene: ThreeScene | undefined;
	let camera: ThreeCamera | undefined;
	let sphere_mesh: ThreeMesh | undefined;
	let texture: ThreeTexture | undefined;
	let material: ThreeMaterial | undefined;
	let geometry: ThreeGeometry | undefined;

	let animation_frame_id = 0;
	let is_dragging = $state(false);
	let drag_start_x = 0;
	let drag_start_y = 0;
	let drag_start_yaw = 0;
	let drag_start_pitch = 0;
	let velocity_x = 0;
	let velocity_y = 0;
	let last_move_x = 0;
	let last_move_y = 0;
	let last_move_time = 0;
	let auto_rotate_paused = false;
	let auto_rotate_resume_timer: ReturnType<typeof setTimeout> | undefined;
	let last_viewchange_time = 0;
	let intersection_observer: IntersectionObserver | undefined;
	let is_visible = true;
	let prefers_reduced_motion = false;
	let gyro_enabled = false;
	let gyro_initial_alpha: number | null = null;
	let gyro_initial_beta: number | null = null;

	/* ── WebGL check ──────────────────────────────────────────── */

	function checkWebGL(): boolean {
		try {
			const test_canvas = document.createElement('canvas');
			const ctx =
				test_canvas.getContext('webgl') || test_canvas.getContext('experimental-webgl');
			return !!ctx;
		} catch {
			return false;
		}
	}

	/* ── Reduced motion ───────────────────────────────────────── */

	function checkReducedMotion(): boolean {
		return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
	}

	/* ── Camera orientation helpers ───────────────────────────── */

	function updateCameraRotation() {
		if (!camera) return;
		// Clamp pitch to avoid flipping
		current_pitch = Math.max(-85, Math.min(85, current_pitch));

		const phi = (90 - current_pitch) * DEG2RAD;
		const theta = current_yaw * DEG2RAD;

		const target_x = 500 * Math.sin(phi) * Math.cos(theta);
		const target_y = 500 * Math.cos(phi);
		const target_z = 500 * Math.sin(phi) * Math.sin(theta);

		camera.lookAt(target_x, target_y, target_z);
	}

	function emitViewChange() {
		if (!onviewchange) return;
		const now = performance.now();
		if (now - last_viewchange_time < VIEWCHANGE_THROTTLE) return;
		last_viewchange_time = now;
		onviewchange({
			pitch: Math.round(current_pitch * 100) / 100,
			yaw: Math.round(current_yaw * 100) / 100,
			fov: Math.round(current_fov * 100) / 100,
		});
	}

	/* ── Interaction handlers ─────────────────────────────────── */

	function pauseAutoRotate() {
		auto_rotate_paused = true;
		clearTimeout(auto_rotate_resume_timer);
		auto_rotate_resume_timer = setTimeout(() => {
			auto_rotate_paused = false;
		}, AUTO_RESUME_DELAY);
	}

	function handlePointerDown(e: PointerEvent) {
		if (!interactive) return;
		is_dragging = true;
		drag_start_x = e.clientX;
		drag_start_y = e.clientY;
		drag_start_yaw = current_yaw;
		drag_start_pitch = current_pitch;
		velocity_x = 0;
		velocity_y = 0;
		last_move_x = e.clientX;
		last_move_y = e.clientY;
		last_move_time = performance.now();
		pauseAutoRotate();
		(e.currentTarget as HTMLElement)?.setPointerCapture(e.pointerId);
	}

	function handlePointerMove(e: PointerEvent) {
		if (!is_dragging || !interactive) return;
		const now = performance.now();
		const dt = Math.max(1, now - last_move_time);
		const dx = e.clientX - drag_start_x;
		const dy = e.clientY - drag_start_y;

		velocity_x = (e.clientX - last_move_x) / dt;
		velocity_y = (e.clientY - last_move_y) / dt;
		last_move_x = e.clientX;
		last_move_y = e.clientY;
		last_move_time = now;

		const scale = current_fov / 1000;
		current_yaw = drag_start_yaw - dx * scale;
		current_pitch = drag_start_pitch + dy * scale;
		updateCameraRotation();
		emitViewChange();
	}

	function handlePointerUp(e: PointerEvent) {
		if (!is_dragging) return;
		is_dragging = false;
		(e.currentTarget as HTMLElement)?.releasePointerCapture(e.pointerId);

		// Start inertia unless reduced motion
		if (!prefers_reduced_motion) {
			applyInertia();
		}
	}

	function applyInertia() {
		if (Math.abs(velocity_x) < 0.001 && Math.abs(velocity_y) < 0.001) return;

		const scale = current_fov / 1000;
		current_yaw -= velocity_x * 16 * scale;
		current_pitch += velocity_y * 16 * scale;
		velocity_x *= INERTIA_DAMPING;
		velocity_y *= INERTIA_DAMPING;
		updateCameraRotation();
		emitViewChange();

		if (Math.abs(velocity_x) > 0.001 || Math.abs(velocity_y) > 0.001) {
			requestAnimationFrame(applyInertia);
		}
	}

	function handleWheel(e: WheelEvent) {
		if (!interactive) return;
		e.preventDefault();
		const delta = e.deltaY > 0 ? 5 : -5;
		current_fov = Math.max(FOV_MIN, Math.min(FOV_MAX, current_fov + delta));
		if (camera) {
			camera.fov = current_fov;
			camera.updateProjectionMatrix();
		}
		pauseAutoRotate();
		emitViewChange();
	}

	/* ── Touch zoom (pinch) ───────────────────────────────────── */

	let pinch_start_distance = 0;
	let pinch_start_fov = 0;

	function getTouchDistance(e: TouchEvent): number {
		if (e.touches.length < 2) return 0;
		const dx = e.touches[0].clientX - e.touches[1].clientX;
		const dy = e.touches[0].clientY - e.touches[1].clientY;
		return Math.sqrt(dx * dx + dy * dy);
	}

	function handleTouchStart(e: TouchEvent) {
		if (e.touches.length === 2) {
			pinch_start_distance = getTouchDistance(e);
			pinch_start_fov = current_fov;
		}
	}

	function handleTouchMove(e: TouchEvent) {
		if (!interactive || e.touches.length < 2) return;
		e.preventDefault();
		const dist = getTouchDistance(e);
		if (pinch_start_distance > 0 && dist > 0) {
			const scale = pinch_start_distance / dist;
			current_fov = Math.max(FOV_MIN, Math.min(FOV_MAX, pinch_start_fov * scale));
			if (camera) {
				camera.fov = current_fov;
				camera.updateProjectionMatrix();
			}
			emitViewChange();
		}
	}

	function handleTouchEnd() {
		pinch_start_distance = 0;
	}

	/* ── Keyboard ─────────────────────────────────────────────── */

	function handleKeyDown(e: KeyboardEvent) {
		if (!interactive) return;
		const PAN_STEP = 5;

		switch (e.key) {
			case 'ArrowLeft':
				e.preventDefault();
				current_yaw -= PAN_STEP;
				updateCameraRotation();
				emitViewChange();
				pauseAutoRotate();
				break;
			case 'ArrowRight':
				e.preventDefault();
				current_yaw += PAN_STEP;
				updateCameraRotation();
				emitViewChange();
				pauseAutoRotate();
				break;
			case 'ArrowUp':
				e.preventDefault();
				current_pitch += PAN_STEP;
				updateCameraRotation();
				emitViewChange();
				pauseAutoRotate();
				break;
			case 'ArrowDown':
				e.preventDefault();
				current_pitch -= PAN_STEP;
				updateCameraRotation();
				emitViewChange();
				pauseAutoRotate();
				break;
			case '+':
			case '=':
				e.preventDefault();
				zoomIn();
				break;
			case '-':
				e.preventDefault();
				zoomOut();
				break;
			case 'Home':
				e.preventDefault();
				resetView();
				break;
			case ' ':
				e.preventDefault();
				auto_rotate_paused = !auto_rotate_paused;
				break;
		}
	}

	/* ── Control actions ──────────────────────────────────────── */

	function zoomIn() {
		animateFovTo(Math.max(FOV_MIN, current_fov - 15));
	}

	function zoomOut() {
		animateFovTo(Math.min(FOV_MAX, current_fov + 15));
	}

	/**
	 * Double-click / double-tap toggles between the initial `fov` and a
	 * zoomed-in fov. If the user has already zoomed in via wheel/pinch,
	 * the double-click resets to initial. The change is animated over
	 * ~300ms to give physical-feeling zoom.
	 */
	let fov_tween_raf = 0;
	function animateFovTo(target: number, duration_ms = 300) {
		if (fov_tween_raf) cancelAnimationFrame(fov_tween_raf);
		const start = current_fov;
		const delta = target - start;
		const t0 = performance.now();
		const step = (now: number) => {
			const t = Math.min(1, (now - t0) / duration_ms);
			// easeOutCubic — fast start, gentle settle (feels like physical inertia)
			const eased = 1 - Math.pow(1 - t, 3);
			current_fov = start + delta * eased;
			if (camera) {
				camera.fov = current_fov;
				camera.updateProjectionMatrix();
			}
			emitViewChange();
			if (t < 1) {
				fov_tween_raf = requestAnimationFrame(step);
			} else {
				fov_tween_raf = 0;
			}
		};
		fov_tween_raf = requestAnimationFrame(step);
	}

	function handleDoubleClick(e: MouseEvent) {
		if (!interactive) return;
		e.preventDefault();
		// Zoom in to roughly 1/3 of initial — closer than half feels noticeably
		// punchy without crossing the FOV_MIN boundary (30°) for typical
		// initial fovs (40-90°).
		const zoomed_fov = Math.max(FOV_MIN, fov * 0.35);
		// Consider "zoomed in" if current is meaningfully below initial.
		const is_zoomed_in = current_fov < fov - 0.5;
		const target = is_zoomed_in ? fov : zoomed_fov;
		pauseAutoRotate();
		animateFovTo(target);
	}

	function resetView() {
		current_pitch = initial_view.pitch;
		current_yaw = initial_view.yaw;
		current_fov = fov;
		if (camera) {
			camera.fov = current_fov;
			camera.updateProjectionMatrix();
		}
		updateCameraRotation();
		emitViewChange();
	}

	function toggleFullscreen() {
		if (!element) return;
		if (document.fullscreenElement) {
			document.exitFullscreen();
		} else {
			element.requestFullscreen();
		}
	}

	/* ── Hotspot projection ───────────────────────────────────── */

	function projectHotspots() {
		if (!camera || !renderer || !three) {
			hotspot_positions = hotspots.map(() => ({
				x: 0,
				y: 0,
				visible: false,
			}));
			return;
		}

		const size = renderer.getSize(new three.Vector2());
		const half_w = size.x / 2;
		const half_h = size.y / 2;

		hotspot_positions = hotspots.map((hs) => {
			const phi = (90 - hs.position.pitch) * DEG2RAD;
			const theta = hs.position.yaw * DEG2RAD;

			const x = 500 * Math.sin(phi) * Math.cos(theta);
			const y = 500 * Math.cos(phi);
			const z = 500 * Math.sin(phi) * Math.sin(theta);

			const pos = new three!.Vector3(x, y, z);

			// Check if behind camera using dot product
			const cam_dir = new three!.Vector3();
			camera!.getWorldDirection(cam_dir);
			const to_hotspot = pos.clone().normalize();
			const dot = cam_dir.dot(to_hotspot);

			if (dot < 0) {
				return { x: 0, y: 0, visible: false };
			}

			// Project to screen
			const projected = pos.clone().project(camera!);
			const screen_x = projected.x * half_w + half_w;
			const screen_y = -(projected.y * half_h) + half_h;

			const in_bounds =
				screen_x >= -50 &&
				screen_x <= size.x + 50 &&
				screen_y >= -50 &&
				screen_y <= size.y + 50;

			return { x: screen_x, y: screen_y, visible: in_bounds };
		});
	}

	/* ── Gyroscope ────────────────────────────────────────────── */

	function handleDeviceOrientation(e: DeviceOrientationEvent) {
		if (!gyro_enabled) return;
		if (e.alpha === null || e.beta === null || e.gamma === null) return;

		if (gyro_initial_alpha === null) {
			gyro_initial_alpha = e.alpha;
			gyro_initial_beta = e.beta;
		}

		// Map device orientation to panorama view
		current_yaw = initial_view.yaw + (e.alpha - gyro_initial_alpha!) * -1;
		current_pitch = initial_view.pitch + (e.beta - gyro_initial_beta!) * -1;
		current_pitch = Math.max(-85, Math.min(85, current_pitch));

		updateCameraRotation();
		emitViewChange();
	}

	async function enableGyroscope() {
		if (!gyroscope) return;

		// Check if device orientation is available
		if (typeof DeviceOrientationEvent === 'undefined') return;

		// iOS 13+ requires permission
		const DOE = DeviceOrientationEvent as typeof DeviceOrientationEvent & {
			requestPermission?: () => Promise<string>;
		};
		if (typeof DOE.requestPermission === 'function') {
			try {
				const permission = await DOE.requestPermission();
				if (permission !== 'granted') return;
			} catch {
				return;
			}
		}

		gyro_enabled = true;
		window.addEventListener('deviceorientation', handleDeviceOrientation);
	}

	/* ── Render loop ──────────────────────────────────────────── */

	function renderLoop() {
		animation_frame_id = requestAnimationFrame(renderLoop);

		if (!is_visible || !renderer || !scene || !camera) return;

		// Auto-rotate
		if (auto_rotate && !auto_rotate_paused && !is_dragging && !prefers_reduced_motion) {
			current_yaw += 0.02 * auto_rotate_speed;
			updateCameraRotation();
			emitViewChange();
		}

		// Project hotspots
		if (hotspots.length > 0) {
			projectHotspots();
		}

		renderer.render(scene, camera);
	}

	/* ── Resize handling ──────────────────────────────────────── */

	function handleResize() {
		if (!canvas_el || !renderer || !camera) return;
		const container = canvas_el.parentElement;
		if (!container) return;

		const width = container.clientWidth;
		const height = container.clientHeight;
		const dpr = embedded
			? Math.min(window.devicePixelRatio || 1, 1.5)
			: window.devicePixelRatio || 1;

		renderer.setSize(width, height);
		renderer.setPixelRatio(dpr);
		camera.aspect = width / height;
		camera.updateProjectionMatrix();
	}

	/* ── Fullscreen change ────────────────────────────────────── */

	function handleFullscreenChange() {
		is_fullscreen = !!document.fullscreenElement;
		// Give the browser a tick to update layout before resizing
		requestAnimationFrame(handleResize);
	}

	/* ── Initialize Three.js ──────────────────────────────────── */

	async function initialize() {
		if (!canvas_el) return;

		loading = true;
		error_state = false;

		try {
			// @ts-ignore — three is an optional peer dependency
			three = await import('three');
		} catch (err) {
			error_state = true;
			loading = false;
			onerror?.({
				error: new Error('Failed to load Three.js. Ensure "three" is installed.'),
			});
			return;
		}

		const container = canvas_el.parentElement;
		if (!container) return;

		const width = container.clientWidth;
		const height = container.clientHeight;
		const dpr = embedded
			? Math.min(window.devicePixelRatio || 1, 1.5)
			: window.devicePixelRatio || 1;

		// Scene
		scene = new three.Scene();

		// Camera
		camera = new three.PerspectiveCamera(current_fov, width / height, 1, 1100);
		camera.position.set(0, 0, 0);

		// Renderer
		renderer = new three.WebGLRenderer({
			canvas: canvas_el,
			antialias: false,
		});
		renderer.setSize(width, height);
		renderer.setPixelRatio(dpr);

		// Sphere geometry
		geometry = new three.SphereGeometry(500, 60, 40);

		// Load texture
		const loader = new three.TextureLoader();
		try {
			texture = await new Promise<ThreeTexture>((resolve, reject) => {
				loader.load(
					src,
					(tex) => resolve(tex),
					undefined,
					(err) => reject(err),
				);
			});
		} catch (err) {
			error_state = true;
			loading = false;
			onerror?.({
				error: err instanceof Error ? err : new Error('Failed to load panorama image'),
			});
			return;
		}

		texture.colorSpace = three.SRGBColorSpace;

		// Material
		material = new three.MeshBasicMaterial({
			map: texture,
			side: three.BackSide,
		});

		// Mesh
		sphere_mesh = new three.Mesh(geometry, material);
		scene.add(sphere_mesh);

		// Set initial view
		updateCameraRotation();

		// Start render loop
		renderLoop();

		// Set up visibility observer
		intersection_observer = new IntersectionObserver(
			(entries) => {
				is_visible = entries[0]?.isIntersecting ?? true;
			},
			{ threshold: 0.1 },
		);
		intersection_observer.observe(container);

		// Resize observer
		const resize_observer = new ResizeObserver(handleResize);
		resize_observer.observe(container);

		// Fullscreen listener
		document.addEventListener('fullscreenchange', handleFullscreenChange);

		// Gyroscope
		if (gyroscope) {
			enableGyroscope();
		}

		loading = false;
		loaded = true;
		onload?.();

		return () => {
			resize_observer.disconnect();
		};
	}

	/* ── Lifecycle ────────────────────────────────────────────── */

	$effect(() => {
		prefers_reduced_motion = checkReducedMotion();

		const mql = window.matchMedia('(prefers-reduced-motion: reduce)');
		const handler = () => {
			prefers_reduced_motion = mql.matches;
		};
		mql.addEventListener('change', handler);

		return () => {
			mql.removeEventListener('change', handler);
		};
	});

	$effect(() => {
		has_webgl = checkWebGL();
		if (!has_webgl) {
			loading = false;
			return;
		}

		// Track canvas_el
		if (!canvas_el) return;

		let resize_cleanup: (() => void) | undefined;

		untrack(() => {
			initialize().then((cleanup) => {
				resize_cleanup = cleanup;
			});
		});

		return () => {
			// Cleanup
			cancelAnimationFrame(animation_frame_id);
			clearTimeout(auto_rotate_resume_timer);

			if (gyro_enabled) {
				window.removeEventListener('deviceorientation', handleDeviceOrientation);
			}

			document.removeEventListener('fullscreenchange', handleFullscreenChange);
			intersection_observer?.disconnect();
			resize_cleanup?.();

			// Dispose Three.js resources
			renderer?.dispose();
			geometry?.dispose();
			material?.dispose();
			texture?.dispose();

			renderer = undefined;
			scene = undefined;
			camera = undefined;
			sphere_mesh = undefined;
			texture = undefined;
			material = undefined;
			geometry = undefined;
			three = undefined;
			loaded = false;
		};
	});

	// React to src changes after initial load. Use untrack inside so this
	// effect only re-fires when src itself changes — without it, the read of
	// `loaded` after init becoming true would cause the effect to refire and
	// reload the same texture (visible as a second loading spinner flash).
	$effect(() => {
		void src;
		untrack(() => {
			if (!loaded || !three || !material) return;

			loading = true;
			error_state = false;

			const loader = new three!.TextureLoader();
			loader.load(
				src,
				(new_texture) => {
					new_texture.colorSpace = three!.SRGBColorSpace;
					texture?.dispose();
					texture = new_texture;
					material!.map = new_texture;
					material!.needsUpdate = true;
					loading = false;
					onload?.();
				},
				undefined,
				(err) => {
					error_state = true;
					loading = false;
					onerror?.({
						error:
							err instanceof Error ? err : new Error('Failed to load panorama image'),
					});
				},
			);
		});
	});

	// React to fov prop changes
	$effect(() => {
		void fov;
		if (!camera) return;
		current_fov = fov;
		camera.fov = current_fov;
		camera.updateProjectionMatrix();
	});
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex a11y_no_noninteractive_element_interactions a11y_no_static_element_interactions -->
<div
	{id}
	class={['panorama-container', className].filter(Boolean).join(' ')}
	class:panorama-dragging={is_dragging}
	class:panorama-fullscreen={is_fullscreen}
	bind:this={element}
	role="application"
	aria-label="360 degree panorama viewer"
	tabindex="0"
	onkeydown={handleKeyDown}>
	{#if skeleton && !loaded}
		<!-- Skeleton shimmer -->
		<div class="panorama-skeleton"></div>
	{:else if !has_webgl}
		<!-- WebGL not supported fallback -->
		{#if fallback}
			<img class="panorama-fallback-img" src={fallback} alt="Panorama view" />
		{:else}
			<div class="panorama-fallback">
				<svg
					xmlns="http://www.w3.org/2000/svg"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="1.5"
					stroke-linecap="round"
					stroke-linejoin="round"
					class="panorama-fallback-icon"
					aria-hidden="true">
					<circle cx="12" cy="12" r="10" />
					<path d="M2 12h20" />
					<path
						d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
				</svg>
				<span>360 view not supported</span>
			</div>
		{/if}
	{:else if error_state}
		<!-- Error state -->
		{#if fallback}
			<img class="panorama-fallback-img" src={fallback} alt="Panorama view" />
		{:else}
			<div class="panorama-fallback">
				<svg
					xmlns="http://www.w3.org/2000/svg"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="1.5"
					stroke-linecap="round"
					stroke-linejoin="round"
					class="panorama-fallback-icon"
					aria-hidden="true">
					<circle cx="12" cy="12" r="10" />
					<line x1="12" y1="8" x2="12" y2="12" />
					<line x1="12" y1="16" x2="12.01" y2="16" />
				</svg>
				<span>Failed to load panorama</span>
			</div>
		{/if}
	{:else}
		<!-- Three.js canvas -->
		<canvas
			class="panorama-canvas"
			bind:this={canvas_el}
			onpointerdown={handlePointerDown}
			onpointermove={handlePointerMove}
			onpointerup={handlePointerUp}
			onpointercancel={handlePointerUp}
			ondblclick={handleDoubleClick}
			onwheel={handleWheel}
			ontouchstart={handleTouchStart}
			ontouchmove={handleTouchMove}
			ontouchend={handleTouchEnd}>
		</canvas>

		<!-- Loading overlay: kept mounted so we can fade it out after the
		     texture is in place, hiding the dark/empty WebGL canvas during load. -->
		<div class="panorama-loading" class:is-loaded={!loading && loaded}>
			<div class="panorama-spinner"></div>
		</div>

		<!-- Hotspots -->
		{#each hotspots as hotspot, i}
			{@const pos = hotspot_positions[i]}
			{#if pos?.visible}
				<button
					class="panorama-hotspot"
					style:left="{pos.x}px"
					style:top="{pos.y}px"
					type="button"
					title={hotspot.label}
					aria-label={hotspot.label ?? `Hotspot ${i + 1}`}
					onclick={() => onhotspotclick?.({ hotspot })}>
					<span class="panorama-hotspot-marker">
						<svg
							xmlns="http://www.w3.org/2000/svg"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
							width="16"
							height="16"
							aria-hidden="true">
							<circle cx="12" cy="12" r="3" />
						</svg>
					</span>
					{#if hotspot.label}
						<span class="panorama-hotspot-label">{hotspot.label}</span>
					{/if}
				</button>
			{/if}
		{/each}

		<!-- Controls -->
		{#if show_controls && !embedded && loaded}
			<div class="panorama-controls">
				<Button translucent icon size="0" tooltip="Zoom in" onclick={zoomIn}>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
						aria-hidden="true">
						<line x1="12" y1="5" x2="12" y2="19" />
						<line x1="5" y1="12" x2="19" y2="12" />
					</svg>
				</Button>
				<Button translucent icon size="0" tooltip="Zoom out" onclick={zoomOut}>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
						aria-hidden="true">
						<line x1="5" y1="12" x2="19" y2="12" />
					</svg>
				</Button>
				<Button
					translucent
					icon
					size="0"
					tooltip={is_fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
					onclick={toggleFullscreen}>
					{#if is_fullscreen}
						<svg
							xmlns="http://www.w3.org/2000/svg"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
							aria-hidden="true">
							<polyline points="4 14 8 14 8 18" />
							<polyline points="20 10 16 10 16 6" />
							<line x1="14" y1="10" x2="21" y2="3" />
							<line x1="3" y1="21" x2="10" y2="14" />
						</svg>
					{:else}
						<svg
							xmlns="http://www.w3.org/2000/svg"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
							aria-hidden="true">
							<polyline points="15 3 21 3 21 9" />
							<polyline points="9 21 3 21 3 15" />
							<line x1="21" y1="3" x2="14" y2="10" />
							<line x1="3" y1="21" x2="10" y2="14" />
						</svg>
					{/if}
				</Button>
			</div>
		{/if}
	{/if}
</div>

<style>
	.panorama-container {
		position: relative;
		width: 100%;
		aspect-ratio: 16 / 9;
		border-radius: var(--radius-md, 0.5rem);
		overflow: hidden;
		background: light-dark(
			var(--color-surface-raised, #f3f4f6),
			var(--color-surface-raised, #1f2937)
		);
		cursor: grab;
		outline: none;
	}

	.panorama-container:focus-visible {
		outline: 2px solid var(--color-action, #3b82f6);
		outline-offset: 2px;
	}

	.panorama-container.panorama-dragging {
		cursor: grabbing;
	}

	.panorama-container.panorama-fullscreen {
		border-radius: 0;
		aspect-ratio: auto;
		width: 100%;
		height: 100%;
	}

	.panorama-canvas {
		display: block;
		width: 100%;
		height: 100%;
		touch-action: none;
	}

	/* ── Skeleton ─────────────────────────────────────────────── */

	.panorama-skeleton {
		position: absolute;
		inset: 0;
		background: linear-gradient(
			90deg,
			var(--color-surface-2, rgba(128, 128, 128, 0.1)) 25%,
			var(--color-surface-3, rgba(128, 128, 128, 0.2)) 50%,
			var(--color-surface-2, rgba(128, 128, 128, 0.1)) 75%
		);
		background-size: 200% 100%;
		animation: panorama-shimmer 1.5s ease-in-out infinite;
	}

	@keyframes panorama-shimmer {
		0% {
			background-position: 200% 0;
		}
		100% {
			background-position: -200% 0;
		}
	}

	/* ── Loading ──────────────────────────────────────────────── */

	.panorama-loading {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		/* Opaque while loading so the empty WebGL canvas (which clears to
		   black) doesn't show through and make the panorama look "dark"
		   the first time it appears. */
		background: light-dark(var(--color-surface, #fff), var(--color-surface, #111));
		opacity: 1;
		transition:
			opacity 220ms ease,
			visibility 0s linear 0s;
	}

	.panorama-loading.is-loaded {
		opacity: 0;
		visibility: hidden;
		pointer-events: none;
		transition:
			opacity 220ms ease,
			visibility 0s linear 220ms;
	}

	.panorama-spinner {
		width: 32px;
		height: 32px;
		border: 3px solid var(--color-border, #d1d5db);
		border-top-color: var(--color-action, #3b82f6);
		border-radius: 50%;
		animation: panorama-spin 0.8s linear infinite;
	}

	@keyframes panorama-spin {
		to {
			transform: rotate(360deg);
		}
	}

	/* ── Fallback ─────────────────────────────────────────────── */

	.panorama-fallback {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.75rem;
		background-color: var(--color-surface-2, rgba(128, 128, 128, 0.1));
		color: var(--color-text-secondary, rgba(128, 128, 128, 0.6));
		font-size: 14px;
	}

	.panorama-fallback-icon {
		width: 3rem;
		height: 3rem;
		opacity: 0.5;
	}

	.panorama-fallback-img {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	/* ── Controls ─────────────────────────────────────────────── */

	.panorama-controls {
		position: absolute;
		bottom: 1rem;
		right: 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		z-index: 2;
		:global(.button) {
			--color-bg-active: rgb(0 0 0 / 0.55);
			--color-bg: rgb(0 0 0 / 0.35);
			--color-text: rgb(255 255 255 / 0.8);
			--color-text-active: rgb(255 255 255 / 1);
			--color-action-outline: transparent;
			--color-action-outline-active: transparent;
		}
	}

	/* ── Hotspots ─────────────────────────────────────────────── */

	.panorama-hotspot {
		position: absolute;
		transform: translate(-50%, -50%);
		cursor: pointer;
		z-index: 1;
		background: none;
		border: none;
		padding: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 4px;
	}

	.panorama-hotspot:focus-visible {
		outline: 2px solid var(--color-action, #3b82f6);
		outline-offset: 4px;
		border-radius: var(--radius-full, 9999px);
	}

	.panorama-hotspot-marker {
		width: 32px;
		height: 32px;
		border-radius: var(--radius-full, 9999px);
		background: var(--color-action, #3b82f6);
		color: var(--color-action-text, #fff);
		display: flex;
		align-items: center;
		justify-content: center;
		animation: panorama-hotspot-pulse 2s infinite;
		transition: transform 0.15s ease;
	}

	.panorama-hotspot:hover .panorama-hotspot-marker {
		transform: scale(1.15);
	}

	.panorama-hotspot-label {
		font-size: 12px;
		font-weight: 500;
		color: var(--color-text, inherit);
		background: light-dark(
			color-mix(in oklch, var(--color-surface, #fff) 90%, transparent),
			color-mix(in oklch, var(--color-surface, #1f2937) 80%, transparent)
		);
		backdrop-filter: blur(4px);
		padding: 2px 8px;
		border-radius: var(--radius-sm, 0.25rem);
		white-space: nowrap;
		pointer-events: none;
	}

	@keyframes panorama-hotspot-pulse {
		0%,
		100% {
			box-shadow: 0 0 0 0
				color-mix(in oklch, var(--color-action, #3b82f6) 40%, transparent);
		}
		50% {
			box-shadow: 0 0 0 8px
				color-mix(in oklch, var(--color-action, #3b82f6) 0%, transparent);
		}
	}

	/* ── Reduced motion ───────────────────────────────────────── */

	@media (prefers-reduced-motion: reduce) {
		.panorama-skeleton {
			animation: none;
		}

		.panorama-spinner {
			animation: none;
			border-top-color: var(--color-border, #d1d5db);
			opacity: 0.5;
		}

		.panorama-hotspot-marker {
			animation: none;
		}
	}
</style>

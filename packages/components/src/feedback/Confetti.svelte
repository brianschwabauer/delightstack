<script lang="ts" module>
	/**
	 * Where a local effect (burst/cannon) should originate from. Accepts a DOM
	 * element, a CSS selector resolved against the document, or a pointer/mouse
	 * event. Resolves to a point in the viewport and overrides `origin`.
	 */
	export type ConfettiTarget = Element | string | MouseEvent;

	export interface ConfettiOptions {
		particle_count?: number;
		spread?: number;
		start_velocity?: number;
		decay?: number;
		gravity?: number;
		drift?: number;
		ticks?: number;
		origin?: { x: number; y: number };
		/**
		 * Anchor a local effect (burst/cannon) to an element, selector, or event.
		 * Takes precedence over `origin`. Ignored by global effects (fireworks,
		 * sides, rain) which manage their own positions.
		 */
		target?: ConfettiTarget;
		colors?: string[];
		scalar?: number;
		z_index?: number;
		angle?: number;
	}

	export interface CannonOptions extends ConfettiOptions {
		interval?: number;
		duration?: number;
	}

	export interface RainOptions extends ConfettiOptions {
		duration?: number;
	}

	const DEFAULT_COLORS = [
		'#ff577f',
		'#ff884b',
		'#ffd384',
		'#fff9b0',
		'#3ec1d3',
		'#7c5cbf',
	];

	type ParticleShape = 'circle' | 'square';
	const PARTICLE_SHAPES: ParticleShape[] = ['circle', 'square'];

	interface Particle {
		x: number;
		y: number;
		vx: number;
		vy: number;
		ticks_remaining: number;
		color: string;
		shape: ParticleShape;
		scalar: number;
		decay: number;
		gravity: number;
		drift: number;
		rotation: number;
		rotation_speed: number;
		opacity: number;
	}

	let canvas: HTMLCanvasElement | null = null;
	let ctx: CanvasRenderingContext2D | null = null;
	let particles: Particle[] = [];
	let animation_frame: number | null = null;
	let active_intervals: number[] = [];

	function isBrowser(): boolean {
		return typeof window !== 'undefined' && typeof document !== 'undefined';
	}

	function checkReducedMotion(): boolean {
		if (!isBrowser()) return false;
		return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
	}

	// ---- Automatic targeting for local effects ----
	// We track the most recent interaction point so a bare `confetti()` /
	// `confetti.burst()` looks like it erupts from whatever the user just
	// clicked, without the caller having to thread a target through every call.
	let last_pointer: { x: number; y: number } | null = null;

	function trackPointer(event: MouseEvent): void {
		const w = window.innerWidth;
		const h = window.innerHeight;
		// Keyboard-activated clicks report detail 0 (and client coords of 0); fall
		// back to the activated element's center so confetti still erupts from it.
		if (event.detail === 0 && event.target instanceof Element) {
			const rect = event.target.getBoundingClientRect();
			last_pointer = {
				x: (rect.left + rect.width / 2) / w,
				y: (rect.top + rect.height / 2) / h,
			};
			return;
		}
		last_pointer = { x: event.clientX / w, y: event.clientY / h };
	}

	if (isBrowser()) {
		// Capture phase so the point is recorded before a click handler fires confetti.
		document.addEventListener('click', trackPointer, true);
	}

	/** Resolve an explicit target to a normalized viewport point, or null. */
	function resolveTargetOrigin(target: ConfettiTarget): { x: number; y: number } | null {
		if (!isBrowser()) return null;
		const w = window.innerWidth;
		const h = window.innerHeight;

		if (typeof MouseEvent !== 'undefined' && target instanceof MouseEvent) {
			return { x: target.clientX / w, y: target.clientY / h };
		}

		const el = typeof target === 'string' ? document.querySelector(target) : target;
		if (el instanceof Element) {
			const rect = el.getBoundingClientRect();
			return {
				x: (rect.left + rect.width / 2) / w,
				y: (rect.top + rect.height / 2) / h,
			};
		}

		return null;
	}

	/**
	 * Resolve the origin for a local effect. Precedence: explicit `target`,
	 * then explicit `origin`, then the last interaction point, then bottom-center.
	 */
	function resolveLocalOrigin(options?: ConfettiOptions): { x: number; y: number } {
		if (options?.target != null) {
			const resolved = resolveTargetOrigin(options.target);
			if (resolved) return resolved;
		}
		if (options?.origin) return options.origin;
		if (last_pointer) return last_pointer;
		return { x: 0.5, y: 1.0 };
	}

	function ensureCanvas(z_index: number = 1000): void {
		if (!isBrowser()) return;
		if (canvas) {
			canvas.style.zIndex = String(z_index);
			return;
		}

		canvas = document.createElement('canvas');
		canvas.setAttribute('aria-hidden', 'true');
		canvas.style.position = 'fixed';
		canvas.style.top = '0';
		canvas.style.left = '0';
		canvas.style.width = '100vw';
		canvas.style.height = '100vh';
		canvas.style.pointerEvents = 'none';
		canvas.style.zIndex = String(z_index);

		const dpr = window.devicePixelRatio || 1;
		canvas.width = window.innerWidth * dpr;
		canvas.height = window.innerHeight * dpr;

		ctx = canvas.getContext('2d');
		if (ctx) {
			ctx.scale(dpr, dpr);
		}

		document.body.appendChild(canvas);

		window.addEventListener('resize', handleResize);
	}

	function handleResize(): void {
		if (!canvas || !ctx) return;
		const dpr = window.devicePixelRatio || 1;
		canvas.width = window.innerWidth * dpr;
		canvas.height = window.innerHeight * dpr;
		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.scale(dpr, dpr);
	}

	function removeCanvas(): void {
		if (!isBrowser()) return;
		if (canvas) {
			canvas.remove();
			canvas = null;
			ctx = null;
			window.removeEventListener('resize', handleResize);
		}
	}

	function randomInRange(min: number, max: number): number {
		return Math.random() * (max - min) + min;
	}

	function createParticle(options: ConfettiOptions): Particle {
		const angle = ((options.angle ?? 90) * Math.PI) / 180;
		const spread = ((options.spread ?? 60) * Math.PI) / 180;
		const start_velocity = options.start_velocity ?? 30;
		const launch_angle = angle + randomInRange(-spread / 2, spread / 2);
		const velocity = start_velocity * randomInRange(0.4, 1);

		const colors = options.colors ?? DEFAULT_COLORS;

		const w = window.innerWidth;
		const h = window.innerHeight;
		const origin = options.origin ?? { x: 0.5, y: 1.0 };

		return {
			x: origin.x * w,
			y: origin.y * h,
			vx: Math.cos(launch_angle) * velocity + (options.drift ?? 0),
			vy: -Math.sin(launch_angle) * velocity,
			ticks_remaining: options.ticks ?? 200,
			color: colors[Math.floor(Math.random() * colors.length)],
			shape: PARTICLE_SHAPES[Math.floor(Math.random() * PARTICLE_SHAPES.length)],
			scalar: (options.scalar ?? 1) * randomInRange(0.6, 1.0),
			decay: options.decay ?? 0.94,
			gravity: options.gravity ?? 1,
			drift: options.drift ?? 0,
			rotation: randomInRange(0, Math.PI * 2),
			rotation_speed: randomInRange(-0.1, 0.1),
			opacity: 1,
		};
	}

	function drawParticle(context: CanvasRenderingContext2D, p: Particle): void {
		const size = 6 * p.scalar;
		context.save();
		context.translate(p.x, p.y);
		context.rotate(p.rotation);
		context.globalAlpha = p.opacity;
		context.fillStyle = p.color;

		if (p.shape === 'circle') {
			context.beginPath();
			context.arc(0, 0, size / 2, 0, Math.PI * 2);
			context.fill();
		} else {
			context.fillRect(-size / 2, -size / 2, size, size);
		}

		context.restore();
	}

	function updateParticle(p: Particle): boolean {
		p.x += p.vx;
		p.y += p.vy;
		p.vx *= p.decay;
		p.vy = p.vy * p.decay + p.gravity;
		p.rotation += p.rotation_speed;
		p.ticks_remaining--;

		// Fade out in the last 20% of ticks
		const fade_start = 40;
		if (p.ticks_remaining < fade_start) {
			p.opacity = Math.max(0, p.ticks_remaining / fade_start);
		}

		return p.ticks_remaining > 0;
	}

	function tick(): void {
		if (!ctx || !canvas) return;

		const w = window.innerWidth;
		const h = window.innerHeight;
		ctx.clearRect(0, 0, w, h);

		particles = particles.filter((p) => {
			const alive = updateParticle(p);
			if (alive) {
				drawParticle(ctx!, p);
			}
			return alive;
		});

		if (particles.length > 0) {
			animation_frame = requestAnimationFrame(tick);
		} else {
			animation_frame = null;
			removeCanvas();
		}
	}

	function startLoop(): void {
		if (animation_frame !== null) return;
		animation_frame = requestAnimationFrame(tick);
	}

	function addParticles(options: ConfettiOptions): void {
		if (checkReducedMotion()) return;

		ensureCanvas(options.z_index);

		const count = options.particle_count ?? 50;
		for (let i = 0; i < count; i++) {
			particles.push(createParticle(options));
		}

		startLoop();
	}

	// ---- Programmatic API ----

	/**
	 * Fire a single burst of confetti. Shorthand for `confetti.burst()`.
	 */
	export function confetti(options?: ConfettiOptions): void {
		confetti.burst(options);
	}

	/**
	 * Single explosion. A local effect: when no `target`/`origin` is given it
	 * erupts from the last clicked element/pointer, otherwise from bottom-center.
	 */
	confetti.burst = function burst(options?: ConfettiOptions): void {
		addParticles({
			particle_count: 50,
			spread: 60,
			start_velocity: 30,
			...options,
			origin: resolveLocalOrigin(options),
		});
	};

	/**
	 * Continuous stream with interval. A local effect: anchors to the last
	 * clicked element/pointer (or a given `target`/`origin`). Returns a stop function.
	 */
	confetti.cannon = function cannon(options?: CannonOptions): () => void {
		const interval_ms = options?.interval ?? 100;
		const duration = options?.duration ?? 3000;
		const per_burst = Math.max(1, Math.floor((options?.particle_count ?? 50) / 10));

		const opts: ConfettiOptions = {
			...options,
			particle_count: per_burst,
			spread: options?.spread ?? 40,
			start_velocity: options?.start_velocity ?? 35,
			origin: resolveLocalOrigin(options),
		};

		const id = window.setInterval(() => {
			addParticles(opts);
		}, interval_ms);

		active_intervals.push(id);

		// Fire first batch immediately
		addParticles(opts);

		const timeout = window.setTimeout(() => {
			stop();
		}, duration);

		function stop() {
			window.clearInterval(id);
			window.clearTimeout(timeout);
			active_intervals = active_intervals.filter((i) => i !== id);
		}

		return stop;
	};

	/** Multiple large bursts from random positions across the viewport. A global effect. */
	confetti.fireworks = function fireworks(options?: ConfettiOptions): void {
		const burst_count = 8;
		const stagger = 220;

		for (let i = 0; i < burst_count; i++) {
			const delay = i * stagger;
			const timeout = window.setTimeout(() => {
				addParticles({
					particle_count: 65,
					spread: 130,
					start_velocity: 50,
					scalar: 1.1,
					...options,
					origin: {
						x: randomInRange(0.1, 0.9),
						y: randomInRange(0.2, 0.55),
					},
				});
			}, delay);
			active_intervals.push(timeout);
		}
	};

	/** Two large bursts from the left/right edges angled inward. A global effect. */
	confetti.sides = function sides(options?: ConfettiOptions): void {
		// Left side burst
		addParticles({
			particle_count: 100,
			spread: 65,
			start_velocity: 60,
			scalar: 1.1,
			...options,
			origin: { x: 0, y: 0.65 },
			angle: 50,
		});

		// Right side burst
		addParticles({
			particle_count: 100,
			spread: 65,
			start_velocity: 60,
			scalar: 1.1,
			...options,
			origin: { x: 1, y: 0.65 },
			angle: 130,
		});
	};

	/** Gentle fall from top, full width. A global effect. Returns a stop function. */
	confetti.rain = function rain(options?: RainOptions): () => void {
		const interval_ms = 150;
		const duration = options?.duration ?? 5000;
		const per_batch = 3;

		const opts: ConfettiOptions = {
			gravity: 0.4,
			start_velocity: 5,
			decay: 0.98,
			ticks: 400,
			drift: 0,
			spread: 180,
			...options,
			particle_count: per_batch,
			angle: 270,
		};

		const id = window.setInterval(() => {
			addParticles({
				...opts,
				origin: { x: Math.random(), y: -0.05 },
			});
		}, interval_ms);

		active_intervals.push(id);

		const timeout = window.setTimeout(() => {
			stop();
		}, duration);

		function stop() {
			window.clearInterval(id);
			window.clearTimeout(timeout);
			active_intervals = active_intervals.filter((i) => i !== id);
		}

		return stop;
	};

	/** Stop all active continuous effects and clear particles. */
	confetti.stop = function stop(): void {
		for (const id of active_intervals) {
			window.clearInterval(id);
			window.clearTimeout(id);
		}
		active_intervals = [];
		particles = [];

		if (animation_frame !== null) {
			cancelAnimationFrame(animation_frame);
			animation_frame = null;
		}

		removeCanvas();
	};
</script>

<script lang="ts">
	type Preset = 'burst' | 'cannon' | 'fireworks' | 'sides' | 'rain';

	const propId = $props.id();
	let {
		/** Whether the confetti effect is active */
		active = false,

		/** Preset animation type */
		preset = 'burst' as Preset,

		/** Number of confetti particles (falls back to the preset default when unset) */
		particle_count = undefined as number | undefined,

		/** Spread angle in degrees */
		spread = undefined as number | undefined,

		/** Initial launch velocity */
		start_velocity = undefined as number | undefined,

		/** Velocity multiplier each frame (0-1) */
		decay = undefined as number | undefined,

		/** Downward acceleration per frame */
		gravity = undefined as number | undefined,

		/** Horizontal drift per frame */
		drift = undefined as number | undefined,

		/** Particle lifetime in frames */
		ticks = undefined as number | undefined,

		/** Launch origin {x, y} as fraction of viewport (0-1) for local effects */
		origin = undefined as { x: number; y: number } | undefined,

		/** Anchor a local effect (burst/cannon) to an element, selector, or event */
		target = undefined as ConfettiTarget | undefined,

		/** Array of hex color strings */
		colors = undefined as string[] | undefined,

		/** Size multiplier */
		scalar = undefined as number | undefined,

		/** CSS z-index for the canvas overlay */
		z_index = 1000,

		/** Duration in ms for continuous presets (cannon, rain) */
		duration = 3000,

		/** Skip animation when prefers-reduced-motion is set */
		disable_for_reduced_motion = true,

		/** Element ID (unused by canvas, for component identification) */
		id = propId,

		/** Additional CSS classes (unused by canvas, for component identification) */
		class: class_name = '',

		/** Called when all particles have finished */
		onend = undefined as (() => void) | undefined,
	} = $props();

	let stop_fn: (() => void) | null = null;
	let was_active = false;

	// Only forward props the caller actually set, so each preset keeps its own
	// defaults (e.g. the bigger fireworks/sides bursts) when a prop is left unset.
	function buildOptions(): ConfettiOptions {
		const opts: ConfettiOptions = { z_index };
		if (particle_count !== undefined) opts.particle_count = particle_count;
		if (spread !== undefined) opts.spread = spread;
		if (start_velocity !== undefined) opts.start_velocity = start_velocity;
		if (decay !== undefined) opts.decay = decay;
		if (gravity !== undefined) opts.gravity = gravity;
		if (drift !== undefined) opts.drift = drift;
		if (ticks !== undefined) opts.ticks = ticks;
		if (origin !== undefined) opts.origin = origin;
		if (target !== undefined) opts.target = target;
		if (colors !== undefined) opts.colors = colors;
		if (scalar !== undefined) opts.scalar = scalar;
		return opts;
	}

	function fire(): void {
		if (disable_for_reduced_motion && checkReducedMotion()) return;

		// Clean up any previous continuous effect
		cleanup();

		const opts = buildOptions();

		switch (preset) {
			case 'burst':
				confetti.burst(opts);
				break;
			case 'cannon':
				stop_fn = confetti.cannon({ ...opts, duration });
				break;
			case 'fireworks':
				confetti.fireworks(opts);
				break;
			case 'sides':
				confetti.sides(opts);
				break;
			case 'rain':
				stop_fn = confetti.rain({ ...opts, duration });
				break;
		}

		// Schedule onend callback
		if (onend) {
			const estimated_duration =
				preset === 'cannon' || preset === 'rain' ? duration + 5000 : 5000;
			setTimeout(() => {
				onend?.();
			}, estimated_duration);
		}
	}

	function cleanup(): void {
		if (stop_fn) {
			stop_fn();
			stop_fn = null;
		}
	}

	$effect(() => {
		if (active && !was_active) {
			fire();
		} else if (!active && was_active) {
			cleanup();
		}
		was_active = active;

		return () => {
			cleanup();
		};
	});
</script>

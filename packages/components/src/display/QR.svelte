<script module lang="ts">
	// ── QR Code Generator ─────────────────────────────────────────────
	// Minimal self-contained implementation supporting versions 1-40,
	// byte-mode encoding, and error correction levels L/M/Q/H.
	// Based on the public-domain QR specification (ISO/IEC 18004).

	type ECLevel = 'L' | 'M' | 'Q' | 'H';

	const EC_LEVEL_BITS: Record<ECLevel, number> = { L: 1, M: 0, Q: 3, H: 2 };

	// Error correction codewords per block and block structure for each version/level.
	// Format: [ec_codewords_per_block, num_blocks_group1, data_codewords_per_block_g1, num_blocks_group2, data_codewords_per_block_g2]
	const EC_TABLE: Record<ECLevel, number[][]> = {
		L: [
			[7, 1, 19, 0, 0],
			[10, 1, 34, 0, 0],
			[15, 1, 55, 0, 0],
			[20, 1, 80, 0, 0],
			[26, 1, 108, 0, 0],
			[18, 2, 68, 0, 0],
			[20, 2, 78, 0, 0],
			[24, 2, 97, 0, 0],
			[30, 2, 116, 0, 0],
			[18, 2, 68, 2, 69],
			[20, 4, 81, 0, 0],
			[24, 2, 92, 2, 93],
			[26, 4, 107, 0, 0],
			[30, 3, 115, 1, 116],
			[22, 5, 87, 1, 88],
			[24, 5, 98, 1, 99],
			[28, 1, 107, 5, 108],
			[30, 5, 120, 1, 121],
			[28, 3, 113, 4, 114],
			[28, 3, 107, 5, 108],
			[28, 4, 116, 4, 117],
			[28, 2, 111, 7, 112],
			[30, 4, 121, 5, 122],
			[30, 6, 117, 4, 118],
			[26, 8, 106, 4, 107],
			[28, 10, 114, 2, 115],
			[30, 8, 122, 4, 123],
			[30, 3, 117, 10, 118],
			[30, 7, 116, 7, 117],
			[30, 5, 115, 10, 116],
			[30, 13, 115, 3, 116],
			[30, 17, 115, 0, 0],
			[30, 17, 115, 1, 116],
			[30, 13, 115, 6, 116],
			[30, 12, 121, 7, 122],
			[30, 6, 121, 14, 122],
			[30, 17, 122, 4, 123],
			[30, 4, 122, 18, 123],
			[30, 20, 117, 4, 118],
			[30, 19, 118, 6, 119],
		],
		M: [
			[10, 1, 16, 0, 0],
			[16, 1, 28, 0, 0],
			[26, 1, 44, 0, 0],
			[18, 2, 32, 0, 0],
			[24, 2, 43, 0, 0],
			[16, 4, 27, 0, 0],
			[18, 4, 31, 0, 0],
			[22, 2, 38, 2, 39],
			[22, 3, 36, 2, 37],
			[26, 4, 43, 1, 44],
			[30, 1, 50, 4, 51],
			[22, 6, 36, 2, 37],
			[22, 8, 37, 1, 38],
			[24, 4, 40, 5, 41],
			[24, 5, 41, 5, 42],
			[28, 7, 45, 3, 46],
			[28, 10, 46, 1, 47],
			[26, 9, 43, 4, 44],
			[26, 3, 44, 11, 45],
			[26, 3, 41, 13, 42],
			[26, 17, 42, 0, 0],
			[28, 17, 46, 0, 0],
			[28, 4, 47, 14, 48],
			[28, 6, 45, 14, 46],
			[28, 8, 47, 13, 48],
			[28, 19, 46, 4, 47],
			[28, 22, 45, 3, 46],
			[28, 3, 45, 23, 46],
			[28, 21, 45, 7, 46],
			[28, 19, 47, 10, 48],
			[28, 2, 46, 29, 47],
			[28, 10, 46, 23, 47],
			[28, 14, 46, 21, 47],
			[28, 14, 46, 23, 47],
			[28, 12, 47, 26, 48],
			[28, 6, 47, 34, 48],
			[28, 29, 46, 14, 47],
			[28, 13, 46, 32, 47],
			[28, 40, 47, 7, 48],
			[28, 18, 47, 31, 48],
		],
		Q: [
			[13, 1, 13, 0, 0],
			[22, 1, 22, 0, 0],
			[18, 2, 17, 0, 0],
			[26, 2, 24, 0, 0],
			[18, 2, 15, 2, 16],
			[24, 4, 19, 0, 0],
			[18, 2, 14, 4, 15],
			[22, 4, 18, 2, 19],
			[20, 4, 16, 4, 17],
			[24, 6, 19, 2, 20],
			[28, 4, 22, 4, 23],
			[26, 4, 20, 6, 21],
			[24, 8, 20, 4, 21],
			[20, 11, 16, 5, 17],
			[30, 5, 24, 7, 25],
			[24, 15, 19, 2, 20],
			[28, 1, 22, 15, 23],
			[28, 17, 22, 1, 23],
			[26, 17, 21, 4, 22],
			[30, 15, 24, 5, 25],
			[28, 17, 22, 6, 23],
			[30, 7, 24, 16, 25],
			[30, 11, 24, 14, 25],
			[30, 11, 24, 16, 25],
			[30, 7, 24, 22, 25],
			[28, 28, 22, 6, 23],
			[30, 8, 23, 26, 24],
			[30, 4, 24, 31, 25],
			[30, 1, 23, 37, 24],
			[30, 15, 24, 25, 25],
			[30, 42, 24, 1, 25],
			[30, 10, 24, 35, 25],
			[30, 29, 24, 19, 25],
			[30, 44, 24, 7, 25],
			[30, 39, 24, 14, 25],
			[30, 46, 24, 10, 25],
			[30, 49, 24, 10, 25],
			[30, 48, 24, 14, 25],
			[30, 43, 24, 22, 25],
			[30, 34, 24, 34, 25],
		],
		H: [
			[17, 1, 9, 0, 0],
			[28, 1, 16, 0, 0],
			[22, 2, 13, 0, 0],
			[16, 4, 9, 0, 0],
			[22, 2, 11, 2, 12],
			[28, 4, 15, 0, 0],
			[26, 4, 13, 1, 14],
			[26, 4, 14, 2, 15],
			[24, 4, 12, 4, 13],
			[28, 6, 15, 2, 16],
			[24, 3, 12, 8, 13],
			[28, 7, 14, 4, 15],
			[22, 12, 11, 4, 12],
			[24, 11, 12, 5, 13],
			[24, 11, 12, 7, 13],
			[30, 3, 15, 13, 16],
			[28, 2, 14, 17, 15],
			[28, 2, 14, 19, 15],
			[26, 9, 13, 16, 14],
			[28, 15, 15, 10, 16],
			[30, 19, 16, 6, 17],
			[24, 34, 13, 0, 0],
			[30, 16, 15, 14, 16],
			[30, 30, 16, 2, 17],
			[30, 22, 15, 13, 16],
			[30, 33, 16, 4, 17],
			[30, 12, 15, 28, 16],
			[30, 11, 15, 31, 16],
			[30, 19, 15, 26, 16],
			[30, 23, 15, 25, 16],
			[30, 23, 15, 28, 16],
			[30, 19, 15, 35, 16],
			[30, 11, 15, 46, 16],
			[30, 59, 16, 1, 17],
			[30, 22, 15, 41, 16],
			[30, 2, 15, 64, 16],
			[30, 24, 15, 46, 16],
			[30, 42, 15, 32, 16],
			[30, 10, 15, 67, 16],
			[30, 20, 15, 61, 16],
		],
	};

	// Total data codewords per version/level
	function getDataCapacity(version: number, level: ECLevel): number {
		const row = EC_TABLE[level][version - 1];
		return row[1] * row[2] + row[3] * row[4];
	}

	// Alignment pattern positions per version
	const ALIGNMENT_POSITIONS: number[][] = [
		[],
		[], // v0 placeholder, v1
		[6, 18],
		[6, 22],
		[6, 26],
		[6, 30],
		[6, 34],
		[6, 22, 38],
		[6, 24, 42],
		[6, 26, 46],
		[6, 28, 50],
		[6, 30, 54],
		[6, 32, 58],
		[6, 34, 62],
		[6, 26, 46, 66],
		[6, 26, 48, 70],
		[6, 26, 50, 74],
		[6, 30, 54, 78],
		[6, 30, 56, 82],
		[6, 30, 58, 86],
		[6, 34, 62, 90],
		[6, 28, 50, 72, 94],
		[6, 26, 50, 74, 98],
		[6, 30, 54, 78, 102],
		[6, 28, 54, 80, 106],
		[6, 32, 58, 84, 110],
		[6, 30, 58, 86, 114],
		[6, 34, 62, 90, 118],
		[6, 26, 50, 74, 98, 122],
		[6, 30, 54, 78, 102, 126],
		[6, 26, 52, 78, 104, 130],
		[6, 30, 56, 82, 108, 134],
		[6, 34, 60, 86, 112, 138],
		[6, 30, 58, 86, 114, 142],
		[6, 34, 62, 90, 118, 146],
		[6, 30, 54, 78, 102, 126, 150],
		[6, 24, 50, 76, 102, 128, 154],
		[6, 28, 54, 80, 106, 132, 158],
		[6, 32, 58, 84, 110, 136, 162],
		[6, 26, 54, 82, 110, 138, 166],
		[6, 30, 58, 86, 114, 142, 170],
	];

	// GF(256) arithmetic for Reed-Solomon
	const GF_EXP = new Uint8Array(512);
	const GF_LOG = new Uint8Array(256);
	{
		let x = 1;
		for (let i = 0; i < 255; i++) {
			GF_EXP[i] = x;
			GF_LOG[x] = i;
			x = x << 1;
			if (x >= 256) x ^= 0x11d;
		}
		for (let i = 255; i < 512; i++) {
			GF_EXP[i] = GF_EXP[i - 255];
		}
	}

	function gfMul(a: number, b: number): number {
		if (a === 0 || b === 0) return 0;
		return GF_EXP[GF_LOG[a] + GF_LOG[b]];
	}

	function rsGeneratorPoly(degree: number): Uint8Array {
		let gen = new Uint8Array([1]);
		for (let i = 0; i < degree; i++) {
			const next = new Uint8Array(gen.length + 1);
			for (let j = 0; j < gen.length; j++) {
				next[j] ^= gen[j];
				next[j + 1] ^= gfMul(gen[j], GF_EXP[i]);
			}
			gen = next;
		}
		return gen;
	}

	function rsEncode(data: Uint8Array, ec_count: number): Uint8Array {
		const gen = rsGeneratorPoly(ec_count);
		const remainder = new Uint8Array(ec_count);
		for (let i = 0; i < data.length; i++) {
			const factor = data[i] ^ remainder[0];
			// Shift remainder left
			for (let j = 0; j < ec_count - 1; j++) {
				remainder[j] = remainder[j + 1];
			}
			remainder[ec_count - 1] = 0;
			for (let j = 0; j < gen.length - 1; j++) {
				remainder[j] ^= gfMul(gen[j + 1], factor);
			}
		}
		return remainder;
	}

	// Encode data in byte mode, return bits
	function encodeData(text: string, version: number, level: ECLevel): Uint8Array {
		const capacity = getDataCapacity(version, level);
		const encoder = new TextEncoder();
		const bytes = encoder.encode(text);

		// Build bit stream: mode(4) + count(8 or 16) + data + terminator + padding
		const count_bits = version <= 9 ? 8 : 16;
		const bits: number[] = [];

		function pushBits(value: number, length: number) {
			for (let i = length - 1; i >= 0; i--) {
				bits.push((value >> i) & 1);
			}
		}

		// Mode indicator: 0100 = byte mode
		pushBits(0b0100, 4);
		// Character count
		pushBits(bytes.length, count_bits);
		// Data bytes
		for (const b of bytes) {
			pushBits(b, 8);
		}

		// Terminator (up to 4 zeros)
		const total_bits = capacity * 8;
		const term = Math.min(4, total_bits - bits.length);
		for (let i = 0; i < term; i++) bits.push(0);

		// Pad to byte boundary
		while (bits.length % 8 !== 0) bits.push(0);

		// Pad codewords
		const pad_bytes = [0xec, 0x11];
		let pad_idx = 0;
		while (bits.length < total_bits) {
			pushBits(pad_bytes[pad_idx % 2], 8);
			pad_idx++;
		}

		// Convert to codewords
		const codewords = new Uint8Array(capacity);
		for (let i = 0; i < capacity; i++) {
			let byte = 0;
			for (let b = 0; b < 8; b++) {
				byte = (byte << 1) | (bits[i * 8 + b] || 0);
			}
			codewords[i] = byte;
		}

		return codewords;
	}

	function interleaveBlocks(
		codewords: Uint8Array,
		version: number,
		level: ECLevel,
	): number[] {
		const row = EC_TABLE[level][version - 1];
		const ec_per_block = row[0];
		const g1_blocks = row[1];
		const g1_data = row[2];
		const g2_blocks = row[3];
		const g2_data = row[4];

		type Block = { data: Uint8Array; ec: Uint8Array };
		const blocks: Block[] = [];
		let offset = 0;

		for (let i = 0; i < g1_blocks; i++) {
			const data = codewords.slice(offset, offset + g1_data);
			offset += g1_data;
			blocks.push({ data, ec: rsEncode(data, ec_per_block) });
		}
		for (let i = 0; i < g2_blocks; i++) {
			const data = codewords.slice(offset, offset + g2_data);
			offset += g2_data;
			blocks.push({ data, ec: rsEncode(data, ec_per_block) });
		}

		// Interleave data codewords
		const result: number[] = [];
		const max_data = Math.max(g1_data, g2_data);
		for (let i = 0; i < max_data; i++) {
			for (const block of blocks) {
				if (i < block.data.length) {
					result.push(block.data[i]);
				}
			}
		}
		// Interleave EC codewords
		for (let i = 0; i < ec_per_block; i++) {
			for (const block of blocks) {
				result.push(block.ec[i]);
			}
		}

		return result;
	}

	function chooseVersion(text: string, level: ECLevel): number {
		const encoder = new TextEncoder();
		const byte_length = encoder.encode(text).length;
		for (let v = 1; v <= 40; v++) {
			const count_bits = v <= 9 ? 8 : 16;
			const data_bits = 4 + count_bits + byte_length * 8;
			const capacity = getDataCapacity(v, level);
			if (data_bits <= capacity * 8) return v;
		}
		return 40; // best effort
	}

	function createMatrix(version: number): {
		modules: boolean[][];
		reserved: boolean[][];
	} {
		const size = version * 4 + 17;
		const modules = Array.from({ length: size }, () => Array(size).fill(false));
		const reserved = Array.from({ length: size }, () => Array(size).fill(false));
		return { modules, reserved };
	}

	function placeFinderPattern(
		modules: boolean[][],
		reserved: boolean[][],
		row: number,
		col: number,
	) {
		for (let r = -1; r <= 7; r++) {
			for (let c = -1; c <= 7; c++) {
				const rr = row + r;
				const cc = col + c;
				if (rr < 0 || rr >= modules.length || cc < 0 || cc >= modules.length) continue;
				const is_border = r === -1 || r === 7 || c === -1 || c === 7;
				const is_outer = r === 0 || r === 6 || c === 0 || c === 6;
				const is_inner = r >= 2 && r <= 4 && c >= 2 && c <= 4;
				modules[rr][cc] = is_outer || is_inner;
				if (!is_border) {
					reserved[rr][cc] = true;
				}
			}
		}
	}

	function placeAlignmentPattern(
		modules: boolean[][],
		reserved: boolean[][],
		row: number,
		col: number,
	) {
		for (let r = -2; r <= 2; r++) {
			for (let c = -2; c <= 2; c++) {
				const rr = row + r;
				const cc = col + c;
				if (reserved[rr][cc]) return; // Overlaps finder, skip entirely
			}
		}
		for (let r = -2; r <= 2; r++) {
			for (let c = -2; c <= 2; c++) {
				const rr = row + r;
				const cc = col + c;
				const is_outer = Math.abs(r) === 2 || Math.abs(c) === 2;
				const is_center = r === 0 && c === 0;
				modules[rr][cc] = is_outer || is_center;
				reserved[rr][cc] = true;
			}
		}
	}

	function placeTimingPatterns(modules: boolean[][], reserved: boolean[][]) {
		const size = modules.length;
		for (let i = 8; i < size - 8; i++) {
			// Horizontal
			if (!reserved[6][i]) {
				modules[6][i] = i % 2 === 0;
				reserved[6][i] = true;
			}
			// Vertical
			if (!reserved[i][6]) {
				modules[i][6] = i % 2 === 0;
				reserved[i][6] = true;
			}
		}
	}

	function reserveFormatArea(reserved: boolean[][], version: number) {
		const size = reserved.length;
		// Around top-left finder
		for (let i = 0; i < 9; i++) {
			reserved[8][i] = true;
			reserved[i][8] = true;
		}
		// Around top-right finder
		for (let i = 0; i < 8; i++) {
			reserved[8][size - 1 - i] = true;
		}
		// Around bottom-left finder
		for (let i = 0; i < 7; i++) {
			reserved[size - 1 - i][8] = true;
		}
		// Dark module
		reserved[size - 8][8] = true;

		// Version info areas (versions >= 7)
		if (version >= 7) {
			for (let i = 0; i < 6; i++) {
				for (let j = 0; j < 3; j++) {
					reserved[i][size - 11 + j] = true;
					reserved[size - 11 + j][i] = true;
				}
			}
		}
	}

	function placeDataBits(
		modules: boolean[][],
		reserved: boolean[][],
		data_bits: number[],
	) {
		const size = modules.length;
		let bit_idx = 0;
		// Data is placed in 2-column strips from right to left
		for (let right = size - 1; right >= 1; right -= 2) {
			// Skip column 6 (timing pattern)
			let col = right;
			if (col <= 6) col--;

			// Alternate upward and downward
			const is_upward = ((size - 1 - right) / 2) % 2 === 0;
			const rows = is_upward
				? Array.from({ length: size }, (_, i) => size - 1 - i)
				: Array.from({ length: size }, (_, i) => i);

			for (const row of rows) {
				for (let dc = 0; dc <= 1; dc++) {
					const c = col - dc;
					if (c < 0) continue;
					if (reserved[row][c]) continue;
					if (bit_idx < data_bits.length) {
						modules[row][c] = data_bits[bit_idx] === 1;
						bit_idx++;
					}
				}
			}
		}
	}

	// Mask patterns
	const MASK_FUNCTIONS: ((r: number, c: number) => boolean)[] = [
		(r, c) => (r + c) % 2 === 0,
		(r, _c) => r % 2 === 0,
		(_r, c) => c % 3 === 0,
		(r, c) => (r + c) % 3 === 0,
		(r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
		(r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
		(r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
		(r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
	];

	function applyMask(
		modules: boolean[][],
		reserved: boolean[][],
		mask_idx: number,
	): boolean[][] {
		const size = modules.length;
		const result = modules.map((row) => [...row]);
		const fn = MASK_FUNCTIONS[mask_idx];
		for (let r = 0; r < size; r++) {
			for (let c = 0; c < size; c++) {
				if (!reserved[r][c]) {
					if (fn(r, c)) {
						result[r][c] = !result[r][c];
					}
				}
			}
		}
		return result;
	}

	function writeFormatBits(
		modules: boolean[][],
		version: number,
		level: ECLevel,
		mask_idx: number,
	) {
		const size = modules.length;
		const ec_bits = EC_LEVEL_BITS[level];
		let data = (ec_bits << 3) | mask_idx;

		// Calculate BCH(15,5) error correction
		let rem = data;
		for (let i = 0; i < 10; i++) {
			rem = (rem << 1) ^ ((rem >> 9) * 0x537);
		}
		const format_bits = ((data << 10) | rem) ^ 0x5412;

		// Place format bits
		for (let i = 0; i < 15; i++) {
			const bit = ((format_bits >> (14 - i)) & 1) === 1;

			// Top-left
			if (i < 6) {
				modules[8][i] = bit;
			} else if (i === 6) {
				modules[8][7] = bit;
			} else if (i === 7) {
				modules[8][8] = bit;
			} else if (i === 8) {
				modules[7][8] = bit;
			} else {
				modules[14 - i][8] = bit;
			}

			// Other two strips
			if (i < 8) {
				modules[size - 1 - i][8] = bit;
			} else {
				modules[8][size - 15 + i] = bit;
			}
		}

		// Dark module
		modules[size - 8][8] = true;

		// Version info (version >= 7)
		if (version >= 7) {
			let ver_rem = version;
			for (let i = 0; i < 12; i++) {
				ver_rem = (ver_rem << 1) ^ ((ver_rem >> 11) * 0x1f25);
			}
			const ver_bits = (version << 12) | ver_rem;
			for (let i = 0; i < 18; i++) {
				const bit = ((ver_bits >> i) & 1) === 1;
				const row = Math.floor(i / 3);
				const col = i % 3;
				modules[row][size - 11 + col] = bit;
				modules[size - 11 + col][row] = bit;
			}
		}
	}

	// Penalty scoring for mask selection
	function scoreMask(modules: boolean[][]): number {
		const size = modules.length;
		let penalty = 0;

		// Rule 1: consecutive same-color modules in row/col
		for (let r = 0; r < size; r++) {
			let run = 1;
			for (let c = 1; c < size; c++) {
				if (modules[r][c] === modules[r][c - 1]) {
					run++;
				} else {
					if (run >= 5) penalty += run - 2;
					run = 1;
				}
			}
			if (run >= 5) penalty += run - 2;
		}
		for (let c = 0; c < size; c++) {
			let run = 1;
			for (let r = 1; r < size; r++) {
				if (modules[r][c] === modules[r - 1][c]) {
					run++;
				} else {
					if (run >= 5) penalty += run - 2;
					run = 1;
				}
			}
			if (run >= 5) penalty += run - 2;
		}

		// Rule 2: 2x2 blocks of same color
		for (let r = 0; r < size - 1; r++) {
			for (let c = 0; c < size - 1; c++) {
				const v = modules[r][c];
				if (
					v === modules[r][c + 1] &&
					v === modules[r + 1][c] &&
					v === modules[r + 1][c + 1]
				) {
					penalty += 3;
				}
			}
		}

		// Rule 3: finder-like patterns
		const pattern_a = [
			true,
			false,
			true,
			true,
			true,
			false,
			true,
			false,
			false,
			false,
			false,
		];
		const pattern_b = [...pattern_a].reverse();
		for (let r = 0; r < size; r++) {
			for (let c = 0; c <= size - 11; c++) {
				let match_a = true;
				let match_b = true;
				for (let i = 0; i < 11; i++) {
					if (modules[r][c + i] !== pattern_a[i]) match_a = false;
					if (modules[r][c + i] !== pattern_b[i]) match_b = false;
				}
				if (match_a || match_b) penalty += 40;
			}
		}
		for (let c = 0; c < size; c++) {
			for (let r = 0; r <= size - 11; r++) {
				let match_a = true;
				let match_b = true;
				for (let i = 0; i < 11; i++) {
					if (modules[r + i][c] !== pattern_a[i]) match_a = false;
					if (modules[r + i][c] !== pattern_b[i]) match_b = false;
				}
				if (match_a || match_b) penalty += 40;
			}
		}

		// Rule 4: proportion of dark modules
		let dark = 0;
		for (let r = 0; r < size; r++) {
			for (let c = 0; c < size; c++) {
				if (modules[r][c]) dark++;
			}
		}
		const total = size * size;
		const pct = (dark / total) * 100;
		const prev5 = Math.floor(pct / 5) * 5;
		const next5 = prev5 + 5;
		penalty += Math.min(Math.abs(prev5 - 50) / 5, Math.abs(next5 - 50) / 5) * 10;

		return penalty;
	}

	/**
	 * Generate a QR code matrix from text data.
	 * Returns a 2D boolean array where `true` = dark module.
	 */
	function generateQRMatrix(text: string, level: ECLevel): boolean[][] {
		const version = chooseVersion(text, level);
		const size = version * 4 + 17;

		// Encode data
		const codewords = encodeData(text, version, level);
		const interleaved = interleaveBlocks(codewords, version, level);

		// Convert to bits
		const data_bits: number[] = [];
		for (const byte of interleaved) {
			for (let i = 7; i >= 0; i--) {
				data_bits.push((byte >> i) & 1);
			}
		}

		// Build matrix
		const { modules, reserved } = createMatrix(version);

		// Finder patterns
		placeFinderPattern(modules, reserved, 0, 0);
		placeFinderPattern(modules, reserved, 0, size - 7);
		placeFinderPattern(modules, reserved, size - 7, 0);

		// Alignment patterns
		if (version >= 2) {
			const positions = ALIGNMENT_POSITIONS[version];
			for (const r of positions) {
				for (const c of positions) {
					placeAlignmentPattern(modules, reserved, r, c);
				}
			}
		}

		// Timing patterns
		placeTimingPatterns(modules, reserved);

		// Reserve format/version areas
		reserveFormatArea(reserved, version);

		// Place data
		placeDataBits(modules, reserved, data_bits);

		// Try all masks, pick best
		let best_mask = 0;
		let best_score = Infinity;
		let best_modules: boolean[][] = modules;

		for (let m = 0; m < 8; m++) {
			const masked = applyMask(modules, reserved, m);
			// Write format bits to a copy
			const copy = masked.map((row) => [...row]);
			writeFormatBits(copy, version, level, m);
			const score = scoreMask(copy);
			if (score < best_score) {
				best_score = score;
				best_mask = m;
				best_modules = copy;
			}
		}

		// If no best was found (shouldn't happen), use mask 0
		if (best_modules === modules) {
			const masked = applyMask(modules, reserved, best_mask);
			writeFormatBits(masked, version, level, best_mask);
			best_modules = masked;
		}

		return best_modules;
	}
</script>

<script lang="ts">
	const propId = $props.id();
	let {
		/** The data to encode (URL, text, etc.) */
		value,

		/** The pixel size of the rendered QR code */
		size = 200,

		/** Error correction level */
		level = 'M' as ECLevel,

		/** Foreground (dark module) color */
		foreground = '#000000',

		/** Background (light module) color */
		background = '#ffffff',

		/** Quiet zone margin in modules around the QR code */
		margin = 4,

		/** Optional logo image URL to overlay in the center */
		logo = undefined as string | undefined,

		/** Logo size as a fraction of the QR code size (0 to 1) */
		logo_size = 0.25,

		/** Use rounded module shapes */
		rounded = false,

		/** Show a download button */
		downloadable = false,

		/** Filename for the downloaded PNG (without extension) */
		download_filename = 'qr-code',

		/** Show a skeleton loading state */
		skeleton = false,

		/** Element ID */
		id = propId,

		/** Additional CSS classes */
		class: class_name = '',
	}: {
		value: string;
		size?: number;
		level?: ECLevel;
		foreground?: string;
		background?: string;
		margin?: number;
		logo?: string;
		logo_size?: number;
		rounded?: boolean;
		downloadable?: boolean;
		download_filename?: string;
		skeleton?: boolean;
		id?: string;
		class?: string;
	} = $props();

	// Auto-upgrade EC level to H when logo is present (logo obscures center modules)
	const effective_level = $derived<ECLevel>(logo ? 'H' : level);

	const matrix = $derived(value ? generateQRMatrix(value, effective_level) : null);
	const module_count = $derived(matrix ? matrix.length : 0);
	const total_modules = $derived(module_count + margin * 2);
	const viewbox = $derived(`0 0 ${total_modules} ${total_modules}`);
	const radius = $derived(rounded ? 0.5 : 0);

	// Logo dimensions (in viewBox units)
	const logo_modules = $derived(Math.floor(module_count * logo_size));
	const logo_offset = $derived(margin + Math.floor((module_count - logo_modules) / 2));

	let is_downloading = $state(false);
	let logo_loaded = $state(!logo);
	let logo_error = $state(false);

	$effect(() => {
		if (logo) {
			logo_loaded = false;
			logo_error = false;
		} else {
			logo_loaded = true;
			logo_error = false;
		}
	});

	function handleLogoLoad() {
		logo_loaded = true;
	}

	function handleLogoError() {
		logo_error = true;
		logo_loaded = true;
	}

	/** Trigger a PNG download of the QR code. Consumers can call this to wire
	 *  up their own download button. Returns a promise that resolves when the
	 *  download has been initiated. */
	export async function triggerDownload(filename?: string): Promise<void> {
		await handleDownload(filename);
	}

	/** Load the logo for canvas export. Uses an anonymous CORS request so a
	 *  successfully-loaded image never taints the canvas; resolves null on any
	 *  failure so export can proceed without the logo. */
	function loadLogoForExport(src: string): Promise<HTMLImageElement | null> {
		return new Promise((resolve) => {
			const img = new Image();
			img.crossOrigin = 'anonymous';
			img.onload = () => resolve(img);
			img.onerror = () => resolve(null);
			img.src = src;
		});
	}

	async function handleDownload(filenameOverride?: string) {
		const current = matrix;
		if (is_downloading || !current) return;
		is_downloading = true;
		const filename = filenameOverride ?? download_filename;

		try {
			// Rasterise the QR directly from the matrix instead of serialising the
			// <svg> and loading it through an <img>. The latter taints the canvas
			// in several browsers, which makes canvas.toBlob() silently never fire
			// its callback — the download promise never settles and the button
			// spins forever. Drawing rects keeps the canvas clean.
			const px = Math.max(4, Math.round((size * 2) / total_modules));
			const dim = total_modules * px;
			const canvas = document.createElement('canvas');
			canvas.width = dim;
			canvas.height = dim;
			const ctx = canvas.getContext('2d');
			if (!ctx) return;

			// Background / quiet zone
			ctx.fillStyle = background;
			ctx.fillRect(0, 0, dim, dim);

			// Modules
			ctx.fillStyle = foreground;
			const supports_round = typeof ctx.roundRect === 'function';
			const r_px = rounded ? Math.min(px / 2, radius * px) : 0;
			for (let r = 0; r < current.length; r++) {
				const row = current[r];
				for (let c = 0; c < row.length; c++) {
					if (!row[c]) continue;
					const x = (c + margin) * px;
					const y = (r + margin) * px;
					if (rounded && supports_round) {
						ctx.beginPath();
						ctx.roundRect(x, y, px, px, r_px);
						ctx.fill();
					} else {
						ctx.fillRect(x, y, px, px);
					}
				}
			}

			// Optional centre logo (best effort — skipped if it can't be loaded
			// CORS-clean, so the canvas is never tainted)
			if (logo && !logo_error) {
				const logo_img = await loadLogoForExport(logo);
				if (logo_img) {
					ctx.fillStyle = background;
					ctx.fillRect(
						(logo_offset - 1) * px,
						(logo_offset - 1) * px,
						(logo_modules + 2) * px,
						(logo_modules + 2) * px,
					);
					ctx.drawImage(
						logo_img,
						logo_offset * px,
						logo_offset * px,
						logo_modules * px,
						logo_modules * px,
					);
				}
			}

			const blob = await new Promise<Blob | null>((resolve) =>
				canvas.toBlob((b) => resolve(b), 'image/png'),
			);
			if (!blob) return;

			const download_url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = download_url;
			a.download = `${filename}.png`;
			document.body.appendChild(a);
			a.click();
			document.body.removeChild(a);
			URL.revokeObjectURL(download_url);
		} finally {
			is_downloading = false;
		}
	}
</script>

{#if skeleton}
	<div
		class={['qr', 'skeleton', class_name].filter(Boolean).join(' ')}
		{id}
		style:--qr-size="{size}px"
		role="img"
		aria-label="Loading QR code">
		<div class="skeleton-inner"></div>
	</div>
{:else if matrix}
	<div
		class={['qr', class_name].filter(Boolean).join(' ')}
		{id}
		style:--qr-size="{size}px"
		role="img"
		aria-label="QR code for {value}">
		<svg
			id="{id}-svg"
			xmlns="http://www.w3.org/2000/svg"
			viewBox={viewbox}
			width={size}
			height={size}
			shape-rendering={rounded ? 'auto' : 'crispEdges'}>
			<!-- Background -->
			<rect width={total_modules} height={total_modules} fill={background} />

			<!-- QR modules -->
			{#each matrix as row, r}
				{#each row as cell, c}
					{#if cell}
						{#if rounded}
							<rect
								x={c + margin}
								y={r + margin}
								width={1}
								height={1}
								rx={radius}
								ry={radius}
								fill={foreground} />
						{:else}
							<rect
								x={c + margin}
								y={r + margin}
								width={1}
								height={1}
								fill={foreground} />
						{/if}
					{/if}
				{/each}
			{/each}

			<!-- Logo overlay -->
			{#if logo && !logo_error}
				<!-- White background behind logo -->
				<rect
					x={logo_offset - 1}
					y={logo_offset - 1}
					width={logo_modules + 2}
					height={logo_modules + 2}
					rx={rounded ? 1 : 0}
					ry={rounded ? 1 : 0}
					fill={background} />
				<image
					href={logo}
					x={logo_offset}
					y={logo_offset}
					width={logo_modules}
					height={logo_modules}
					preserveAspectRatio="xMidYMid meet"
					onload={handleLogoLoad}
					onerror={handleLogoError} />
			{/if}
		</svg>
	</div>
{/if}

<style>
	.qr {
		position: relative;
		display: inline-flex;
		flex-direction: column;
		align-items: center;
		gap: 8px;
		width: var(--qr-size);
	}

	.qr svg {
		display: block;
		width: var(--qr-size);
		height: var(--qr-size);
	}

	/* ── Skeleton ──────────────────────────────────────────────────── */

	.qr.skeleton {
		pointer-events: none;
	}

	.skeleton-inner {
		width: var(--qr-size);
		height: var(--qr-size);
		border-radius: var(--radius-3, 8px);
		background: light-dark(var(--color-outline, #e5e7eb), var(--color-outline, #374151));
		position: relative;
		overflow: hidden;

		&::after {
			content: '';
			position: absolute;
			top: 0;
			right: 0;
			bottom: 0;
			left: 0;
			transform: translateX(-100%);
			background-image: linear-gradient(
				90deg,
				rgb(from var(--color-text, #000) r g b / 0) 0,
				rgb(from var(--color-text, #000) r g b / 0.08) 20%,
				rgb(from var(--color-text, #000) r g b / 0.15) 60%,
				rgb(from var(--color-text, #000) r g b / 0)
			);
			animation: qr-shimmer 2s infinite;
		}
	}

	@keyframes qr-shimmer {
		100% {
			transform: translateX(100%);
		}
	}

	/* ── Download Button ──────────────────────────────────────────── */

	.download-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 6px 12px;
		border: 1px solid
			light-dark(var(--color-outline, #d1d5db), var(--color-outline, #4b5563));
		border-radius: var(--radius-2, 6px);
		background: light-dark(var(--color-bg, #fff), var(--color-bg, #1f2937));
		color: light-dark(var(--color-text, #374151), var(--color-text, #d1d5db));
		cursor: pointer;
		transition:
			background 150ms ease,
			border-color 150ms ease;
		font-size: 0.8125rem;
		line-height: 1;

		&:hover:not(:disabled) {
			background: light-dark(
				var(--color-bg-active, #f3f4f6),
				var(--color-bg-active, #374151)
			);
			border-color: light-dark(
				var(--color-outline-active, #9ca3af),
				var(--color-outline-active, #6b7280)
			);
			transition: none;
		}

		&:active:not(:disabled) {
			transform: scale(0.97);
		}

		&:focus-visible {
			outline: 2px solid var(--color-accent, #3b82f6);
			outline-offset: 2px;
		}

		&:disabled {
			opacity: 0.5;
			cursor: not-allowed;
		}
	}

	.download-icon {
		width: 16px;
		height: 16px;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	.download-icon.spin {
		animation: qr-spin 1s linear infinite;
	}

	@keyframes qr-spin {
		100% {
			transform: rotate(360deg);
		}
	}

	/* ── Reduced Motion ───────────────────────────────────────────── */

	@media (prefers-reduced-motion: reduce) {
		.skeleton-inner::after {
			animation: none;
		}
		.download-icon.spin {
			animation: none;
		}
	}
</style>

"""Independent Python re-implementation of OutbreakScope's PRNG (known-answer test vectors).

Written from the published C reference for xoshiro128** (https://prng.di.unimi.it/xoshiro128starstar.c) and the
seeding scheme documented in src/sim/rng.ts. It shares no code with the TypeScript version, so agreement means
both implement the same algorithm. Output: tests/fixtures/rng_kat.json
"""
import json
from pathlib import Path

M = 0xFFFFFFFF


def rotl(x, k):
    return ((x << k) | (x >> (32 - k))) & M


def fmix32(h):
    h &= M
    h ^= h >> 16
    h = (h * 0x85EBCA6B) & M
    h ^= h >> 13
    h = (h * 0xC2B2AE35) & M
    h ^= h >> 16
    return h


def derive_state(seed, stream):
    w = [0x243F6A88, 0x85A308D3, 0x13198A2E, 0x03707344]

    def absorb(x):
        for j in range(4):
            w[j] = fmix32(w[j] ^ x ^ ((j + 1) * 0x9E3779B9 & M))
        for _ in range(2):
            for j in range(4):
                nxt = (j + 1) & 3
                w[nxt] = (w[nxt] + rotl(w[j], 7 + j)) & M

    absorb(seed)
    absorb(stream)
    absorb(0x5BD1E995)
    return list(w)


def xoshiro_next(s):
    result = (rotl((s[1] * 5) & M, 7) * 9) & M
    t = (s[1] << 9) & M
    s[2] ^= s[0]
    s[3] ^= s[1]
    s[1] ^= s[2]
    s[0] ^= s[3]
    s[2] ^= t
    s[3] = rotl(s[3], 11)
    return result


def next_float(s):
    hi = xoshiro_next(s) >> 5
    lo = xoshiro_next(s) >> 6
    return (hi * 67108864 + lo) / 9007199254740992


out = {"raw_state_1_2_3_4": {"state": [1, 2, 3, 4], "u32": []}, "streams": []}
s = [1, 2, 3, 4]
out["raw_state_1_2_3_4"]["u32"] = [xoshiro_next(s) for _ in range(8)]
for seed, stream in [(0, 0), (42, 0), (42, 1), (123456789, 7), (4294967295, 4294967295)]:
    st = derive_state(seed, stream)
    start = list(st)
    u32 = [xoshiro_next(st) for _ in range(8)]
    st2 = list(start)
    floats = [next_float(st2) for _ in range(4)]
    out["streams"].append({"seed": seed, "stream": stream, "state": start, "u32": u32, "floats": floats})
path = Path(__file__).resolve().parent.parent / "tests" / "fixtures" / "rng_kat.json"
path.write_text(json.dumps(out, indent=1))
print(json.dumps(out["raw_state_1_2_3_4"]), len(out["streams"]), "stream vectors written")
